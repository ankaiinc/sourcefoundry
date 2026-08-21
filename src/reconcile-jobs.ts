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

type ReconcileOptions = {
  apply: boolean;
  confirmation?: string;
  expectedDuplicateJobs?: number;
  expectedDuplicateGroups?: number;
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
      WHERE status IN ('queued', 'running') AND entity_id IS NOT NULL
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

async function uniqueGuardInstalled(db: Queryable): Promise<boolean> {
  const result = await db.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'sourcefoundry_jobs_one_active_entity_idx'
    ) AS installed
  `);
  return result.rows[0]?.installed === true;
}

export async function reconcileActiveJobs(
  pool: pg.Pool,
  options: ReconcileOptions,
): Promise<ActiveJobReconciliation> {
  const expectedDuplicateJobs = options.expectedDuplicateJobs;
  const expectedDuplicateGroups = options.expectedDuplicateGroups;
  if (options.apply && options.confirmation !== CONFIRMATION) {
    throw new Error(`Refusing to mutate jobs without --confirm=${CONFIRMATION}`);
  }
  if (options.apply && (
    typeof expectedDuplicateJobs !== 'number' ||
    !Number.isSafeInteger(expectedDuplicateJobs) ||
    expectedDuplicateJobs < 0
  )) {
    throw new Error('Refusing to mutate jobs without --expect-duplicate-jobs=<dry-run count>');
  }
  if (options.apply && (
    typeof expectedDuplicateGroups !== 'number' ||
    !Number.isSafeInteger(expectedDuplicateGroups) ||
    expectedDuplicateGroups < 0
  )) {
    throw new Error('Refusing to mutate jobs without --expect-duplicate-groups=<dry-run count>');
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
      uniqueGuardInstalled: await uniqueGuardInstalled(pool),
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15min'");
    await client.query('LOCK TABLE sourcefoundry_jobs IN SHARE ROW EXCLUSIVE MODE');
    const lockedBefore = await activeSummary(client);
    if (lockedBefore.duplicateJobs !== expectedDuplicateJobs) {
      throw new Error(
        `Duplicate job count changed after lock: expected ${expectedDuplicateJobs}, observed ${lockedBefore.duplicateJobs}`,
      );
    }
    if (lockedBefore.duplicateGroups !== expectedDuplicateGroups) {
      throw new Error(
        `Duplicate group count changed after lock: expected ${expectedDuplicateGroups}, observed ${lockedBefore.duplicateGroups}`,
      );
    }
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
        WHERE status IN ('queued', 'running') AND entity_id IS NOT NULL
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
    `);
    const cancelledJobs = cancelled.rowCount ?? 0;
    const after = await activeSummary(client);
    const expectedActiveAfter = lockedBefore.activeJobs - lockedBefore.duplicateJobs;
    if (
      cancelledJobs !== lockedBefore.duplicateJobs ||
      after.duplicateJobs !== 0 ||
      after.duplicateGroups !== 0 ||
      after.activeJobs !== expectedActiveAfter
    ) {
      throw new Error(
        `Reconciliation postcondition failed: cancelled=${cancelledJobs}/${lockedBefore.duplicateJobs}, ` +
        `active=${after.activeJobs}/${expectedActiveAfter}, remaining_duplicates=${after.duplicateJobs}, ` +
        `remaining_groups=${after.duplicateGroups}`,
      );
    }
    if (!await uniqueGuardInstalled(client)) {
      await client.query(`
        CREATE UNIQUE INDEX sourcefoundry_jobs_one_active_entity_idx
        ON sourcefoundry_jobs (tenant_id, job_type, entity_type, entity_id)
        WHERE status IN ('queued', 'running') AND entity_id IS NOT NULL
      `);
    }
    if (!await uniqueGuardInstalled(client)) {
      throw new Error('Reconciliation unique guard could not be verified before commit');
    }
    await client.query('COMMIT');
    return {
      mode: 'applied',
      activeJobsBefore: lockedBefore.activeJobs,
      duplicateJobs: lockedBefore.duplicateJobs,
      duplicateGroups: lockedBefore.duplicateGroups,
      cancelledJobs,
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
  const expectedDuplicateJobs = integerArg(args, '--expect-duplicate-jobs=');
  const expectedDuplicateGroups = integerArg(args, '--expect-duplicate-groups=');
  const config = loadConfig();
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    max: 2,
  });
  try {
    const result = await reconcileActiveJobs(pool, {
      apply,
      ...(confirmation ? { confirmation } : {}),
      ...(expectedDuplicateJobs !== undefined ? { expectedDuplicateJobs } : {}),
      ...(expectedDuplicateGroups !== undefined ? { expectedDuplicateGroups } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!apply && result.duplicateJobs > 0) {
      console.log(
        `Dry run only. Apply requires --apply --confirm=${CONFIRMATION} ` +
        `--expect-duplicate-jobs=${result.duplicateJobs} --expect-duplicate-groups=${result.duplicateGroups}`,
      );
    }
  } finally {
    await pool.end();
  }
}

function integerArg(args: Set<string>, prefix: string): number | undefined {
  const raw = [...args].find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) return Number.NaN;
  return Number(raw);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
