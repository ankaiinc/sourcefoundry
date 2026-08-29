import pg from 'pg';
import type {
  AgentCredential,
  CandidateInput,
  EnqueueSourceJobInput,
  FetchAttemptInput,
  HeartbeatInput,
  JsonRecord,
  PublicSignal,
  SignalJob,
  SignalSource,
  SignalTenant,
  SourceFeed,
  SourceFeedHealth,
  SourceFeedRun,
  SourceFeedSource,
  SourceItem,
  SourceItemInput,
} from './types.js';
import { objectValue, toAgentCredential, toJob, toSource, toSourceFeed, toTenant, type SignalRepository } from './repository.js';
import { aggregatePublicSignals, signalKeyFor } from './signals.js';
import { conversationFromPayload } from './conversation.js';
import { postgresConnectionOptions } from './postgres.js';

const { Pool } = pg;

export class AgentSourceLimitError extends Error {
  constructor() {
    super('Autonomous workspace source limit reached');
    this.name = 'AgentSourceLimitError';
  }
}

export class PostgresSourceFoundryRepository implements SignalRepository {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      ...postgresConnectionOptions(databaseUrl),
      max: 10,
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async checkReadiness(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async upsertTenant(input: { slug: string; name: string; config?: JsonRecord }): Promise<SignalTenant> {
    const result = await this.pool.query(
      `
      INSERT INTO sourcefoundry_tenants (slug, name, config)
      VALUES ($1, $2, $3)
      ON CONFLICT (slug)
      DO UPDATE SET name = EXCLUDED.name, config = EXCLUDED.config, updated_at = now()
      RETURNING *
      `,
      [input.slug, input.name, input.config ?? {}],
    );
    return toTenant(requiredRow(result.rows, 'tenant'));
  }

  async getTenantBySlug(slug: string): Promise<SignalTenant | null> {
    const result = await this.pool.query('SELECT * FROM sourcefoundry_tenants WHERE slug = $1 LIMIT 1', [slug]);
    return result.rows[0] ? toTenant(result.rows[0]) : null;
  }

  async createAutonomousTenant(input: { slug: string; name: string }): Promise<SignalTenant | null> {
    const result = await this.pool.query(
      `
      INSERT INTO sourcefoundry_tenants (slug, name, config)
      VALUES ($1, $2, $3)
      ON CONFLICT (slug) DO NOTHING
      RETURNING *
      `,
      [input.slug, input.name, { autonomous: true }],
    );
    return result.rows[0] ? toTenant(result.rows[0]) : null;
  }

  async getTenantById(tenantId: string): Promise<SignalTenant | null> {
    const result = await this.pool.query('SELECT * FROM sourcefoundry_tenants WHERE id = $1 LIMIT 1', [tenantId]);
    return result.rows[0] ? toTenant(result.rows[0]) : null;
  }

  async createAgentCredential(input: {
    tenantId: string;
    label: string;
    tokenHash: string;
    tokenPrefix: string;
  }): Promise<AgentCredential> {
    const result = await this.pool.query(
      `
      INSERT INTO sourcefoundry_agent_credentials (tenant_id, label, token_hash, token_prefix)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [input.tenantId, input.label, input.tokenHash, input.tokenPrefix],
    );
    return toAgentCredential(requiredRow(result.rows, 'agent credential'));
  }

  async createAutonomousEnrollment(input: { slug: string; name: string; label: string; tokenHash: string; tokenPrefix: string; maxEnrollmentsPerDay: number }): Promise<{ tenant: SignalTenant; credential: AgentCredential } | { limited: true } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['agent-enrollment:service']);
      const now = new Date();
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
      const enrollmentCount = await client.query(
        'SELECT count(*)::int AS count FROM sourcefoundry_agent_credentials WHERE created_at >= $1',
        [since],
      );
      if (Number(requiredRow(enrollmentCount.rows, 'agent credential count').count ?? 0) >= input.maxEnrollmentsPerDay) {
        await client.query('COMMIT');
        return { limited: true };
      }
      const tenantResult = await client.query(
        'INSERT INTO sourcefoundry_tenants (slug, name, config) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING RETURNING *',
        [input.slug, input.name, { autonomous: true }],
      );
      if (!tenantResult.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const tenant = toTenant(tenantResult.rows[0]);
      const credentialResult = await client.query(
        'INSERT INTO sourcefoundry_agent_credentials (tenant_id, label, token_hash, token_prefix) VALUES ($1, $2, $3, $4) RETURNING *',
        [tenant.id, input.label, input.tokenHash, input.tokenPrefix],
      );
      await client.query('COMMIT');
      return { tenant, credential: toAgentCredential(requiredRow(credentialResult.rows, 'agent credential')) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findActiveAgentCredential(tokenHash: string): Promise<AgentCredential | null> {
    const result = await this.pool.query(
      'SELECT * FROM sourcefoundry_agent_credentials WHERE token_hash = $1 AND revoked_at IS NULL LIMIT 1',
      [tokenHash],
    );
    return result.rows[0] ? toAgentCredential(result.rows[0]) : null;
  }

  async countAgentCredentialsSince(since: Date): Promise<number> {
    const result = await this.pool.query(
      'SELECT count(*)::int AS count FROM sourcefoundry_agent_credentials WHERE created_at >= $1',
      [since.toISOString()],
    );
    return Number(requiredRow(result.rows, 'agent credential count').count ?? 0);
  }

  async createSource(input: {
    tenantId: string;
    name: string;
    sourceType: 'rss' | 'atom' | 'web';
    url: string;
    reliability?: number;
    intervalMinutes?: number;
    maxItemsPerFetch?: number;
    timeoutSeconds?: number;
    agentManaged?: boolean;
    maxAgentManagedSources?: number;
    metadata?: JsonRecord;
  }): Promise<SignalSource> {
    if (!input.agentManaged || input.maxAgentManagedSources === undefined) return this.upsertSource(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`agent-source-cap:${input.tenantId}`]);
      const existing = await client.query(
        'SELECT id FROM sourcefoundry_sources WHERE tenant_id = $1 AND url = $2 LIMIT 1',
        [input.tenantId, input.url],
      );
      if (!existing.rows[0]) {
        const count = await client.query(
          'SELECT count(*)::int AS count FROM sourcefoundry_sources WHERE tenant_id = $1 AND agent_managed = true',
          [input.tenantId],
        );
        if (Number(requiredRow(count.rows, 'agent source count').count ?? 0) >= input.maxAgentManagedSources) {
          throw new AgentSourceLimitError();
        }
      }
      const source = await this.upsertSource(input, client);
      await client.query('COMMIT');
      return source;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertSource(input: {
    tenantId: string;
    name: string;
    sourceType: 'rss' | 'atom' | 'web';
    url: string;
    reliability?: number;
    intervalMinutes?: number;
    maxItemsPerFetch?: number;
    timeoutSeconds?: number;
    agentManaged?: boolean;
    maxAgentManagedSources?: number;
    metadata?: JsonRecord;
  }, client: Pick<pg.Pool, 'query'> = this.pool): Promise<SignalSource> {
    const result = await client.query(
      `
      INSERT INTO sourcefoundry_sources (
        tenant_id, name, source_type, url, reliability, interval_minutes,
        max_items_per_fetch, timeout_seconds, agent_managed, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (tenant_id, url)
      DO UPDATE SET
        name = EXCLUDED.name,
        source_type = EXCLUDED.source_type,
        reliability = EXCLUDED.reliability,
        interval_minutes = EXCLUDED.interval_minutes,
        max_items_per_fetch = EXCLUDED.max_items_per_fetch,
        timeout_seconds = EXCLUDED.timeout_seconds,
        agent_managed = sourcefoundry_sources.agent_managed OR EXCLUDED.agent_managed,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      RETURNING *
      `,
      [
        input.tenantId,
        input.name,
        input.sourceType,
        input.url,
        input.reliability ?? 0.7,
        input.intervalMinutes ?? 60,
        input.maxItemsPerFetch ?? 30,
        input.timeoutSeconds ?? 20,
        input.agentManaged ?? false,
        input.metadata ?? {},
      ],
    );
    return toSource(requiredRow(result.rows, 'source'));
  }

  async getSourceByTenantAndUrl(tenantId: string, url: string): Promise<SignalSource | null> {
    const result = await this.pool.query(
      'SELECT * FROM sourcefoundry_sources WHERE tenant_id = $1 AND url = $2 LIMIT 1',
      [tenantId, url],
    );
    return result.rows[0] ? toSource(result.rows[0]) : null;
  }

  async countSourcesForTenant(tenantId: string): Promise<number> {
    const result = await this.pool.query(
      'SELECT count(*)::int AS count FROM sourcefoundry_sources WHERE tenant_id = $1',
      [tenantId],
    );
    return Number(requiredRow(result.rows, 'source count').count ?? 0);
  }

  async listDueSources(limit: number, now: Date): Promise<SignalSource[]> {
    const result = await this.pool.query(
      `
      SELECT *
      FROM (
        SELECT DISTINCT ON (
          tenant_id,
          COALESCE(NULLIF(metadata->>'fallback_group', ''), id::text)
        ) *
        FROM sourcefoundry_sources
        WHERE enabled = true AND next_fetch_at <= $1
        ORDER BY
          tenant_id,
          COALESCE(NULLIF(metadata->>'fallback_group', ''), id::text),
          next_fetch_at ASC,
          failure_count ASC,
          CASE WHEN (metadata->>'provider_rank') ~ '^[0-9]+$'
            THEN (metadata->>'provider_rank')::integer ELSE 1000 END ASC,
          id ASC
      ) ranked
      ORDER BY next_fetch_at ASC
      LIMIT $2
      `,
      [now.toISOString(), limit],
    );
    return result.rows.map(toSource);
  }

  async listSources(input: { tenantSlug?: string; tenantId?: string }): Promise<SignalSource[]> {
    const result = await this.pool.query(
      `
      SELECT s.*
      FROM sourcefoundry_sources s
      JOIN sourcefoundry_tenants t ON t.id = s.tenant_id
      WHERE ($1::uuid IS NULL OR s.tenant_id = $1)
        AND ($2::text IS NULL OR t.slug = $2)
      ORDER BY s.name ASC, s.id ASC
      `,
      [input.tenantId ?? null, input.tenantSlug ?? null],
    );
    return result.rows.map(toSource);
  }

  async getSource(sourceId: string): Promise<SignalSource | null> {
    const result = await this.pool.query('SELECT * FROM sourcefoundry_sources WHERE id = $1 LIMIT 1', [
      sourceId,
    ]);
    return result.rows[0] ? toSource(result.rows[0]) : null;
  }

  async upsertSourceFeed(input: {
    tenantId: string;
    idempotencyKey: string;
    name: string;
    purpose: string;
    everyMinutes: number;
    maxItemsPerRun: number;
    maxCandidatesPerRun: number;
  }): Promise<SourceFeed> {
    const result = await this.pool.query(
      `INSERT INTO sourcefoundry_source_feeds (
         tenant_id, idempotency_key, name, purpose, every_minutes, max_items_per_run, max_candidates_per_run
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, idempotency_key) DO UPDATE SET
         name = EXCLUDED.name,
         purpose = EXCLUDED.purpose,
         every_minutes = EXCLUDED.every_minutes,
         max_items_per_run = EXCLUDED.max_items_per_run,
         max_candidates_per_run = EXCLUDED.max_candidates_per_run,
         updated_at = now()
       RETURNING *`,
      [input.tenantId, input.idempotencyKey, input.name, input.purpose, input.everyMinutes, input.maxItemsPerRun, input.maxCandidatesPerRun],
    );
    return toSourceFeed(requiredRow(result.rows, 'source feed'));
  }

  async replaceSourceFeedSources(sourceFeedId: string, sources: SourceFeedSource[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM sourcefoundry_source_feed_sources WHERE source_feed_id = $1', [sourceFeedId]);
      for (const source of sources) {
        await client.query(
          `INSERT INTO sourcefoundry_source_feed_sources
             (source_feed_id, source_id, kind, required, position, config)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sourceFeedId, source.sourceId, source.kind, source.required, source.position, source.config],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getSourceFeed(sourceFeedId: string): Promise<SourceFeed | null> {
    const result = await this.pool.query('SELECT * FROM sourcefoundry_source_feeds WHERE id = $1 LIMIT 1', [sourceFeedId]);
    return result.rows[0] ? toSourceFeed(result.rows[0]) : null;
  }

  async listSourceFeedSources(sourceFeedId: string): Promise<Array<SourceFeedSource & { source: SignalSource }>> {
    const result = await this.pool.query(
      `SELECT fs.*, row_to_json(s) AS source
       FROM sourcefoundry_source_feed_sources fs
       JOIN sourcefoundry_sources s ON s.id = fs.source_id
       WHERE fs.source_feed_id = $1
       ORDER BY fs.position ASC, fs.source_id ASC`,
      [sourceFeedId],
    );
    return result.rows.map((row) => ({
      sourceFeedId: String(row.source_feed_id),
      sourceId: String(row.source_id),
      kind: row.kind as SourceFeedSource['kind'],
      required: Boolean(row.required),
      position: Number(row.position),
      config: objectValue(row.config),
      source: toSource(objectValue(row.source)),
    }));
  }

  async createSourceFeedRun(input: { tenantId: string; sourceFeedId: string; jobIds: string[] }): Promise<SourceFeedRun> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO sourcefoundry_source_feed_runs (tenant_id, source_feed_id)
         VALUES ($1, $2) RETURNING *`,
        [input.tenantId, input.sourceFeedId],
      );
      const row = requiredRow(result.rows, 'source feed run');
      for (const jobId of [...new Set(input.jobIds)]) {
        await client.query(
          `INSERT INTO sourcefoundry_source_feed_run_jobs (source_feed_run_id, job_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [row.id, jobId],
        );
      }
      await client.query('COMMIT');
      return sourceFeedRun(row, input.jobIds.map(() => 'queued'), input.jobIds);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getSourceFeedRun(runId: string): Promise<SourceFeedRun | null> {
    const result = await this.pool.query(
      `SELECT r.*, COALESCE(array_agg(j.id) FILTER (WHERE j.id IS NOT NULL), ARRAY[]::uuid[]) AS job_ids,
              COALESCE(array_agg(j.status) FILTER (WHERE j.id IS NOT NULL), ARRAY[]::text[]) AS job_statuses,
              max(j.completed_at) AS completed_at
       FROM sourcefoundry_source_feed_runs r
       LEFT JOIN sourcefoundry_source_feed_run_jobs rj ON rj.source_feed_run_id = r.id
       LEFT JOIN sourcefoundry_jobs j ON j.id = rj.job_id
       WHERE r.id = $1
       GROUP BY r.id`,
      [runId],
    );
    const row = result.rows[0];
    return row ? sourceFeedRun(row, row.job_statuses as string[], (row.job_ids as unknown[]).map(String)) : null;
  }

  async getActiveSourceFeedRun(sourceFeedId: string): Promise<SourceFeedRun | null> {
    const result = await this.pool.query(
      `SELECT r.id
       FROM sourcefoundry_source_feed_runs r
       JOIN sourcefoundry_source_feed_run_jobs rj ON rj.source_feed_run_id = r.id
       JOIN sourcefoundry_jobs j ON j.id = rj.job_id
       WHERE r.source_feed_id = $1
       GROUP BY r.id, r.created_at
       HAVING bool_and(j.status IN ('queued', 'running'))
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [sourceFeedId],
    );
    return result.rows[0] ? this.getSourceFeedRun(String(result.rows[0].id)) : null;
  }

  async getSourceFeedHealth(sourceFeedId: string): Promise<SourceFeedHealth | null> {
    const feed = await this.getSourceFeed(sourceFeedId);
    if (!feed) return null;
    const sourceResult = await this.pool.query(
      `SELECT fs.required, s.*, s.last_success_at, s.last_failure_at, s.next_fetch_at
       FROM sourcefoundry_source_feed_sources fs
       JOIN sourcefoundry_sources s ON s.id = fs.source_id
       WHERE fs.source_feed_id = $1
       ORDER BY fs.position ASC`,
      [sourceFeedId],
    );
    const runResult = await this.pool.query(
      'SELECT id FROM sourcefoundry_source_feed_runs WHERE source_feed_id = $1 ORDER BY created_at DESC LIMIT 1',
      [sourceFeedId],
    );
    const lastRun = runResult.rows[0] ? await this.getSourceFeedRun(String(runResult.rows[0].id)) : null;
    const newest = await this.pool.query(
      `SELECT max(c.generated_at) AS generated_at
       FROM sourcefoundry_candidates c
       JOIN sourcefoundry_source_items i ON i.id = c.source_item_id
       JOIN sourcefoundry_source_feed_sources fs ON fs.source_id = i.source_id
       WHERE fs.source_feed_id = $1`,
      [sourceFeedId],
    );
    const sources = sourceResult.rows.map((row) => ({
      source: toSource(row),
      required: Boolean(row.required),
      lastSuccessAt: optionalTimestamp(row.last_success_at),
      lastFailureAt: optionalTimestamp(row.last_failure_at),
      nextFetchAt: optionalTimestamp(row.next_fetch_at),
    }));
    const degraded = sources.some((entry) => entry.required && entry.source.failureCount > 0)
      || lastRun?.status === 'partial' || lastRun?.status === 'failed';
    return {
      sourceFeedId,
      status: !lastRun ? 'never_run' : degraded ? 'degraded' : 'healthy',
      newestCandidateAt: optionalTimestamp(newest.rows[0]?.generated_at),
      lastRun,
      sources,
    };
  }

  async enqueueSourceFetch(
    input: EnqueueSourceJobInput & { agentRunBudget?: { perTenantPerDay: number; serviceTotalPerDay: number } },
  ): Promise<{ jobId: string; created: boolean; limited?: 'tenant_daily' | 'service_daily' }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (input.agentRunBudget) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['agent-run-budget:service']);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`agent-run-budget:${input.tenantId}`]);
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `fetch_source:${input.tenantId}:${input.sourceId}`,
      ]);

      const existing = await client.query(
        `
        SELECT id
        FROM sourcefoundry_jobs
        WHERE tenant_id = $1
          AND job_type = 'fetch_source'
          AND entity_type = 'sourcefoundry_source'
          AND entity_id = $2
          AND status IN ('queued', 'running')
        ORDER BY created_at ASC
        LIMIT 1
        `,
        [input.tenantId, input.sourceId],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return { jobId: String(existing.rows[0].id), created: false };
      }

      if (input.agentRunBudget) {
        const source = await client.query(
          'SELECT agent_managed FROM sourcefoundry_sources WHERE id = $1 AND tenant_id = $2 LIMIT 1',
          [input.sourceId, input.tenantId],
        );
        if (source.rows[0]?.agent_managed === true) {
          const now = new Date();
          const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
          const tenantCount = await client.query(
            `SELECT count(*)::int AS count
             FROM sourcefoundry_jobs jobs
             JOIN sourcefoundry_sources sources ON sources.id = jobs.entity_id
             WHERE jobs.job_type = 'fetch_source' AND jobs.tenant_id = $1
               AND sources.agent_managed = true AND jobs.created_at >= $2`,
            [input.tenantId, since],
          );
          if (Number(requiredRow(tenantCount.rows, 'tenant agent-managed job count').count ?? 0) >= input.agentRunBudget.perTenantPerDay) {
            await client.query('COMMIT');
            return { jobId: '', created: false, limited: 'tenant_daily' };
          }
          const serviceCount = await client.query(
            `SELECT count(*)::int AS count
             FROM sourcefoundry_jobs jobs
             JOIN sourcefoundry_sources sources ON sources.id = jobs.entity_id
             WHERE jobs.job_type = 'fetch_source' AND sources.agent_managed = true AND jobs.created_at >= $1`,
            [since],
          );
          if (Number(requiredRow(serviceCount.rows, 'service agent-managed job count').count ?? 0) >= input.agentRunBudget.serviceTotalPerDay) {
            await client.query('COMMIT');
            return { jobId: '', created: false, limited: 'service_daily' };
          }
        }
      }

      const inserted = await client.query(
        `
        INSERT INTO sourcefoundry_jobs (
          tenant_id, job_type, entity_type, entity_id, priority, run_after, payload
        )
        VALUES ($1, 'fetch_source', 'sourcefoundry_source', $2, $3, $4, $5)
        RETURNING id
        `,
        [
          input.tenantId,
          input.sourceId,
          input.priority ?? 0,
          input.runAfter ?? new Date().toISOString(),
          { sourceId: input.sourceId },
        ],
      );
      await client.query('COMMIT');
      return { jobId: String(requiredRow(inserted.rows, 'job').id), created: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async countAgentManagedJobsSince(since: Date): Promise<number> {
    const result = await this.pool.query(
      `
      SELECT count(*)::int AS count
      FROM sourcefoundry_jobs jobs
      JOIN sourcefoundry_sources sources ON sources.id = jobs.entity_id
      WHERE jobs.job_type = 'fetch_source'
        AND sources.agent_managed = true
        AND jobs.created_at >= $1
      `,
      [since.toISOString()],
    );
    return Number(requiredRow(result.rows, 'agent-managed job count').count ?? 0);
  }

  async claimNextJob(input: { jobTypes: string[]; maxAttempts: number }): Promise<SignalJob | null> {
    const result = await this.pool.query(
      'SELECT * FROM claim_next_sourcefoundry_job($1, $2::text[])',
      [input.maxAttempts, input.jobTypes],
    );
    return result.rows[0] ? toJob(result.rows[0]) : null;
  }

  async claimJobById(input: { jobId: string; maxAttempts: number }): Promise<SignalJob | null> {
    const result = await this.pool.query(
      `
      UPDATE sourcefoundry_jobs
      SET status = 'running',
          attempt_count = attempt_count + 1,
          started_at = now(),
          completed_at = NULL,
          last_error = NULL,
          updated_at = now()
      WHERE id = $1
        AND job_type = 'fetch_source'
        AND status = 'queued'
        AND run_after <= now()
        AND attempt_count < LEAST(max_attempts, $2)
      RETURNING id, tenant_id, job_type, entity_type, entity_id, attempt_count, payload
      `,
      [input.jobId, input.maxAttempts],
    );
    return result.rows[0] ? toJob(result.rows[0]) : null;
  }

  async markJobCompleted(jobId: string, result: JsonRecord): Promise<void> {
    await this.pool.query(
      `
      UPDATE sourcefoundry_jobs
      SET status = 'completed', completed_at = now(), result = $2, last_error = NULL, updated_at = now()
      WHERE id = $1
      `,
      [jobId, result],
    );
  }

  async markJobFailed(jobId: string, error: string): Promise<void> {
    await this.pool.query(
      `
      UPDATE sourcefoundry_jobs
      SET status = 'failed', completed_at = now(), last_error = $2, updated_at = now()
      WHERE id = $1
      `,
      [jobId, error.slice(0, 1000)],
    );
  }

  async deferJob(jobId: string, error: string, runAfter: Date): Promise<void> {
    await this.pool.query(
      `
      UPDATE sourcefoundry_jobs
      SET status = 'queued',
          started_at = NULL,
          completed_at = NULL,
          last_error = $2,
          run_after = $3,
          updated_at = now()
      WHERE id = $1
      `,
      [jobId, error.slice(0, 1000), runAfter.toISOString()],
    );
  }

  async reapZombieJobs(staleMinutes: number): Promise<number> {
    const result = await this.pool.query('SELECT reap_zombie_sourcefoundry_jobs($1) AS count', [
      staleMinutes,
    ]);
    return Number(result.rows[0]?.count ?? 0);
  }

  async recordFetchAttempt(input: FetchAttemptInput): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO sourcefoundry_fetch_attempts (
        tenant_id, source_id, job_id, status, http_status, error,
        duration_ms, items_seen, items_inserted
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        input.tenantId,
        input.sourceId,
        input.jobId,
        input.status,
        input.httpStatus ?? null,
        input.error ?? null,
        input.durationMs,
        input.itemsSeen,
        input.itemsInserted,
      ],
    );
  }

  async markSourceSuccess(
    sourceId: string,
    input: { nextFetchAt: Date; etag?: string | null; lastModified?: string | null },
  ): Promise<void> {
    await this.pool.query(
      `
      UPDATE sourcefoundry_sources
      SET last_success_at = now(),
          failure_count = 0,
          next_fetch_at = $2,
          etag = COALESCE($3, etag),
          last_modified = COALESCE($4, last_modified),
          updated_at = now()
      WHERE id = $1
      `,
      [sourceId, input.nextFetchAt.toISOString(), input.etag ?? null, input.lastModified ?? null],
    );
  }

  async markSourceFailure(sourceId: string, input: { nextFetchAt: Date; error: string }): Promise<void> {
    await this.pool.query(
      `
      UPDATE sourcefoundry_sources
      SET last_failure_at = now(),
          failure_count = failure_count + 1,
          next_fetch_at = $2,
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('last_error', $3::text),
          updated_at = now()
      WHERE id = $1
      `,
      [sourceId, input.nextFetchAt.toISOString(), input.error.slice(0, 500)],
    );
  }

  async upsertSourceItem(input: SourceItemInput): Promise<{ item: SourceItem; inserted: boolean }> {
    const result = await this.pool.query(
      `
      INSERT INTO sourcefoundry_source_items (
        tenant_id, source_id, canonical_url, url, title, summary, author,
        published_at, content_hash, raw_payload, relevance_score, source_reliability
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (tenant_id, canonical_url) DO UPDATE SET
        title = CASE
          WHEN length(EXCLUDED.title) + length(EXCLUDED.summary) > length(sourcefoundry_source_items.title) + length(sourcefoundry_source_items.summary) THEN EXCLUDED.title
          ELSE sourcefoundry_source_items.title
        END,
        summary = CASE
          WHEN length(EXCLUDED.title) + length(EXCLUDED.summary) > length(sourcefoundry_source_items.title) + length(sourcefoundry_source_items.summary) THEN EXCLUDED.summary
          ELSE sourcefoundry_source_items.summary
        END,
        author = CASE
          WHEN sourcefoundry_source_items.author = '' AND EXCLUDED.author <> '' THEN EXCLUDED.author
          ELSE sourcefoundry_source_items.author
        END,
        published_at = COALESCE(sourcefoundry_source_items.published_at, EXCLUDED.published_at),
        content_hash = CASE
          WHEN length(EXCLUDED.title) + length(EXCLUDED.summary) > length(sourcefoundry_source_items.title) + length(sourcefoundry_source_items.summary) THEN EXCLUDED.content_hash
          ELSE sourcefoundry_source_items.content_hash
        END,
        raw_payload = sourcefoundry_source_items.raw_payload || jsonb_build_object('enrichment', EXCLUDED.raw_payload),
        relevance_score = GREATEST(sourcefoundry_source_items.relevance_score, EXCLUDED.relevance_score),
        source_reliability = GREATEST(sourcefoundry_source_items.source_reliability, EXCLUDED.source_reliability),
        updated_at = now()
      WHERE EXCLUDED.raw_payload->'raw'->>'observationMode' = 'enrichment'
      RETURNING *, (xmax = 0) AS was_inserted
      `,
      [
        input.tenantId,
        input.sourceId,
        input.canonicalUrl,
        input.url,
        input.title,
        input.summary,
        input.author,
        input.publishedAt,
        input.contentHash,
        input.rawPayload,
        input.relevanceScore,
        input.sourceReliability,
      ],
    );

    if (result.rows[0]) {
      return { item: toItem(result.rows[0], input), inserted: Boolean(result.rows[0].was_inserted) };
    }

    const existing = await this.pool.query(
      `
      SELECT *
      FROM sourcefoundry_source_items
      WHERE tenant_id = $1 AND canonical_url = $2
      LIMIT 1
      `,
      [input.tenantId, input.canonicalUrl],
    );
    return { item: toItem(requiredRow(existing.rows, 'source item'), input), inserted: false };
  }

  async upsertCandidate(input: CandidateInput): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO sourcefoundry_candidates (
        tenant_id, source_item_id, title, summary, url, status, score, tags, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (tenant_id, source_item_id) DO UPDATE SET
        title = CASE
          WHEN length(EXCLUDED.title) + length(EXCLUDED.summary) > length(sourcefoundry_candidates.title) + length(sourcefoundry_candidates.summary) THEN EXCLUDED.title
          ELSE sourcefoundry_candidates.title
        END,
        summary = CASE
          WHEN length(EXCLUDED.title) + length(EXCLUDED.summary) > length(sourcefoundry_candidates.title) + length(sourcefoundry_candidates.summary) THEN EXCLUDED.summary
          ELSE sourcefoundry_candidates.summary
        END,
        url = EXCLUDED.url,
        score = GREATEST(sourcefoundry_candidates.score, EXCLUDED.score),
        tags = ARRAY(SELECT DISTINCT unnest(sourcefoundry_candidates.tags || EXCLUDED.tags)),
        metadata = sourcefoundry_candidates.metadata || EXCLUDED.metadata,
        updated_at = now()
      WHERE EXCLUDED.metadata->>'observationMode' = 'enrichment'
      `,
      [
        input.tenantId,
        input.sourceItemId,
        input.title,
        input.summary,
        input.url,
        input.status,
        input.score,
        input.tags,
        input.metadata,
      ],
    );
  }

  async listSignals(input: {
    tenantSlug?: string;
    tenantId?: string;
    sourceFeedId?: string;
    since?: string;
    statuses: string[];
    limit: number;
  }): Promise<PublicSignal[]> {
    const result = await this.pool.query(
      `
      SELECT
        c.*,
        i.id AS source_item_id,
        i.canonical_url,
        i.author,
        i.published_at AS item_published_at,
        i.fetched_at,
        i.content_hash,
        i.raw_payload,
        s.id AS source_id,
        s.name AS source_name,
        s.source_type,
        s.reliability AS source_reliability,
        s.metadata AS source_metadata,
        s.failure_count,
        s.last_success_at,
        s.last_failure_at
      FROM sourcefoundry_candidates c
      JOIN sourcefoundry_tenants t ON t.id = c.tenant_id
      JOIN sourcefoundry_source_items i ON i.id = c.source_item_id
      JOIN sourcefoundry_sources s ON s.id = i.source_id
      WHERE ($1::uuid IS NULL OR c.tenant_id = $1::uuid)
        AND ($2::text IS NULL OR t.slug = $2)
        AND ($3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM sourcefoundry_source_feed_sources fs
          WHERE fs.source_feed_id = $3 AND fs.source_id = i.source_id
        ))
        AND ($4::timestamptz IS NULL OR c.generated_at > $4)
        AND c.status = ANY($5::text[])
      ORDER BY c.generated_at DESC
      LIMIT $6
      `,
      [input.tenantId ?? null, input.tenantSlug ?? null, input.sourceFeedId ?? null, input.since ?? null, input.statuses, Math.min(input.limit * 10, 1000)],
    );
    const signals = result.rows.map((row) => {
      const sourceMetadata = objectValue(row.source_metadata);
      const rawPayload = objectValue(row.raw_payload);
      const rawDiscovery = objectValue(rawPayload.raw);
      const providerRaw = objectValue(rawDiscovery.raw);
      const fetchedAt = requiredTimestamp(row.fetched_at, 'fetched_at');
      const itemPublishedAt = optionalTimestamp(row.item_published_at);
      const author = String(row.author ?? '').trim();
      const title = String(row.title);
      const summary = String(row.summary ?? '');
      const failures = Number(row.failure_count ?? 0);
      const signal = {
        schemaVersion: 1 as const,
        id: String(row.id),
        tenantId: String(row.tenant_id),
        title,
        summary,
        url: String(row.url),
        status: String(row.status) as PublicSignal['status'],
        score: Number(row.score ?? 0),
        tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
        generatedAt: requiredTimestamp(row.generated_at, 'generated_at'),
        publishedAt: itemPublishedAt,
        source: {
          id: String(row.source_id),
          name: String(row.source_name),
          type: row.source_type as PublicSignal['source']['type'],
          provider: String(sourceMetadata.provider ?? row.source_type),
          reliability: Number(row.source_reliability ?? 0),
        },
        provenance: {
          sourceItemId: String(row.source_item_id),
          canonicalUrl: String(row.canonical_url),
          fetchedAt,
          contentHash: String(row.content_hash),
          author: author || null,
          query: typeof rawDiscovery.query === 'string' && rawDiscovery.query.trim() ? rawDiscovery.query : null,
          discovery: {
            trustLevel: sourceMetadata.provider === 'x' ? 'authoritative' as const
              : sourceMetadata.mode === 'discovery' ? 'indexed' as const
                : 'unknown' as const,
            creatorHandle: typeof providerRaw.creator_username === 'string' && providerRaw.creator_username.trim()
              ? providerRaw.creator_username : null,
            externalUrls: Array.isArray(providerRaw.external_urls)
              ? providerRaw.external_urls.filter((value): value is string => typeof value === 'string') : [],
          },
        },
        ...conversationField(rawPayload),
        freshness: {
          publishedAt: itemPublishedAt,
          fetchedAt,
          ageSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(itemPublishedAt ?? fetchedAt)) / 1000)),
        },
        completeness: {
          title: title.trim().length > 0,
          summary: summary.trim().length > 0,
          author: author.length > 0,
          publishedAt: itemPublishedAt !== null,
        },
        failureState: {
          state: failures > 0 ? 'degraded' as const : 'healthy' as const,
          consecutiveFailures: failures,
          lastSuccessAt: optionalTimestamp(row.last_success_at),
          lastFailureAt: optionalTimestamp(row.last_failure_at),
        },
        aggregation: {
          signalKey: '',
          observationCount: 1,
          sourceCount: 1,
          capped: false,
        },
        observations: [],
      } satisfies PublicSignal;
      signal.aggregation.signalKey = signalKeyFor(signal);
      return signal;
    });
    return aggregatePublicSignals(signals, input.limit);
  }

  async writeHeartbeat(input: HeartbeatInput): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO sourcefoundry_heartbeats (
        stage, started_at, completed_at, duration_ms, status, items_processed, error, detail
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        input.stage,
        input.startedAt.toISOString(),
        new Date(input.startedAt.getTime() + input.durationMs).toISOString(),
        input.durationMs,
        input.status,
        input.itemsProcessed,
        input.error ?? null,
        input.detail ?? null,
      ],
    );
  }
}

function conversationField(rawPayload: JsonRecord): { conversation?: NonNullable<PublicSignal['conversation']> } {
  const conversation = conversationFromPayload(rawPayload);
  return conversation ? { conversation } : {};
}

function requiredRow<T>(rows: T[], name: string): T {
  const row = rows[0];
  if (!row) throw new Error(`Expected ${name} row`);
  return row;
}

function optionalTimestamp(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

function requiredTimestamp(value: unknown, field: string): string {
  const timestamp = optionalTimestamp(value);
  if (!timestamp) throw new Error(`Expected ${field} timestamp`);
  return timestamp;
}

function sourceFeedRun(row: Record<string, unknown>, statuses: string[], jobIds: string[]): SourceFeedRun {
  const terminal = statuses.length > 0 && statuses.every((status) => ['completed', 'failed', 'cancelled', 'dead_lettered'].includes(status));
  const completed = statuses.filter((status) => status === 'completed').length;
  const failed = statuses.filter((status) => ['failed', 'cancelled', 'dead_lettered'].includes(status)).length;
  const status: SourceFeedRun['status'] = statuses.some((value) => value === 'running')
    ? 'collecting'
    : !terminal
      ? 'queued'
      : failed === 0
        ? 'completed'
        : completed > 0
          ? 'partial'
          : 'failed';
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    sourceFeedId: String(row.source_feed_id),
    status,
    jobIds,
    createdAt: requiredTimestamp(row.created_at, 'source feed run created_at'),
    completedAt: terminal ? optionalTimestamp(row.completed_at) : null,
  };
}

function toItem(row: Record<string, unknown>, fallback: SourceItemInput): SourceItem {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id ?? fallback.tenantId),
    sourceId: String(row.source_id ?? fallback.sourceId),
    canonicalUrl: String(row.canonical_url ?? fallback.canonicalUrl),
    url: String(row.url ?? fallback.url),
    title: String(row.title ?? fallback.title),
    summary: String(row.summary ?? fallback.summary),
    author: String(row.author ?? fallback.author),
    publishedAt: optionalTimestamp(row.published_at) ?? fallback.publishedAt,
    contentHash: String(row.content_hash ?? fallback.contentHash),
    rawPayload: objectValue(row.raw_payload),
    relevanceScore: Number(row.relevance_score ?? fallback.relevanceScore),
    sourceReliability: Number(row.source_reliability ?? fallback.sourceReliability),
    createdAt: optionalTimestamp(row.created_at) ?? new Date().toISOString(),
  };
}
