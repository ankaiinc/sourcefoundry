import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';

const { Pool } = pg;
const CONFIRMATION = 'cancel-duplicate-active-jobs';

export type ActiveJobReconciliation = {
  mode: 'dry-run' | 'applied';
  activeJobsBefore: number;
  duplicateJobs: number;
  duplicateGroups: number;
  cancelledJobs: number;
  activeJobsAfter: number;
  uniqueGuardInstalled: boolean;
};

type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

async function activeSummary(db: Queryable): Promise<{
  activeJobs: number;
  duplicateJobs: number;
  duplicateGroups: number;
}> {
  const result = await db.query(`
    WITH grouped AS (
      SELECT tenant_id, job_type, entity_type, entity_id, count(*)::int AS active_count
      FROM sourcefoundry_jobs
      WHERE status IN ('queued', 'running')
      GROUP BY tenant_id, job_type, entity_type, entity_id
    )
    SELECT
      COALESCE(sum(active_count), 0)::int AS active_jobs,
      COALESCE(sum(GREATEST(active_count - 1, 0)), 0)::int AS duplicate_jobs,
      count(*) FILTER (WHERE active_count > 1)::int AS duplicate_groups
    FROM grouped
  `);
  const row = result.rows[0] ?? {};
  return {
    activeJobs: Number(row.active_jobs ?? 0),
    duplicateJobs: Number(row.duplicate_jobs ?? 0),
    duplicateGroups: Number(row.duplicate_groups ?? 0),
  };
}

export async function reconcileActiveJobs(
  pool: pg.Pool,
  options: { apply: boolean; confirmation?: string },
): Promise<ActiveJobReconciliation> {
  if (options.apply && options.confirmation !== CONFIRMATION) {
    throw new Error(`Refusing to mutate jobs without --confirm=${CONFIRMATION}`);
  }
  const before = await activeSummary(pool);
  if (!options.apply) {
    return {
      mode: 'dry-run',
      activeJobsBefore: before.activeJobs,
      duplicateJobs: before.duplicateJobs,
      duplicateGroups: before.duplicateGroups,
      cancelledJobs: 0,
      activeJobsAfter: before.activeJobs,
      uniqueGuardInstalled: false,
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE sourcefoundry_jobs IN SHARE ROW EXCLUSIVE MODE');
    const lockedBefore = await activeSummary(client);
    const cancelled = await client.query(`
      WITH ranked AS (
        SELECT
          id,
          row_number() OVER (
            PARTITION BY tenant_id, job_type, entity_type, entity_id
            ORDER BY
              CASE status WHEN 'running' THEN 0 ELSE 1 END,
              created_at DESC,
              id
          ) AS position
        FROM sourcefoundry_jobs
        WHERE status IN ('queued', 'running')
      )
      UPDATE sourcefoundry_jobs AS jobs
      SET
        status = 'cancelled',
        completed_at = now(),
        updated_at = now(),
        last_error = 'Cancelled duplicate active job during idempotency reconciliation',
        result = COALESCE(jobs.result, '{}'::jsonb) || jsonb_build_object(
          'reconciled', true,
          'reason', 'duplicate-active-job'
        )
      FROM ranked
      WHERE jobs.id = ranked.id AND ranked.position > 1
      RETURNING jobs.id
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS sourcefoundry_jobs_one_active_entity_idx
      ON sourcefoundry_jobs (tenant_id, job_type, entity_type, entity_id)
      WHERE status IN ('queued', 'running') AND entity_id IS NOT NULL
    `);
    const after = await activeSummary(client);
    await client.query('COMMIT');
    return {
      mode: 'applied',
      activeJobsBefore: lockedBefore.activeJobs,
      duplicateJobs: lockedBefore.duplicateJobs,
      duplicateGroups: lockedBefore.duplicateGroups,
      cancelledJobs: cancelled.rowCount ?? 0,
      activeJobsAfter: after.activeJobs,
      uniqueGuardInstalled: true,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const confirmation = [...args].find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
  const config = loadConfig();
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    max: 2,
  });
  try {
    const result = await reconcileActiveJobs(pool, { apply, ...(confirmation ? { confirmation } : {}) });
    console.log(JSON.stringify(result, null, 2));
    if (!apply && result.duplicateJobs > 0) {
      console.log(`Dry run only. Apply requires --apply --confirm=${CONFIRMATION}`);
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
