import pg from 'pg';
import type {
  CandidateInput,
  EnqueueSourceJobInput,
  FetchAttemptInput,
  HeartbeatInput,
  JsonRecord,
  PublicSignal,
  SignalJob,
  SignalSource,
  SignalTenant,
  SourceItem,
  SourceItemInput,
} from './types.js';
import { objectValue, toJob, toSource, toTenant, type SignalRepository } from './repository.js';
import { aggregatePublicSignals, signalKeyFor } from './signals.js';

const { Pool } = pg;

export class PostgresSourceFoundryRepository implements SignalRepository {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
      max: 10,
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
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

  async createSource(input: {
    tenantId: string;
    name: string;
    sourceType: 'rss' | 'atom' | 'web';
    url: string;
    reliability?: number;
    intervalMinutes?: number;
    maxItemsPerFetch?: number;
    metadata?: JsonRecord;
  }): Promise<SignalSource> {
    const result = await this.pool.query(
      `
      INSERT INTO sourcefoundry_sources (
        tenant_id, name, source_type, url, reliability, interval_minutes,
        max_items_per_fetch, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (tenant_id, url)
      DO UPDATE SET
        name = EXCLUDED.name,
        source_type = EXCLUDED.source_type,
        reliability = EXCLUDED.reliability,
        interval_minutes = EXCLUDED.interval_minutes,
        max_items_per_fetch = EXCLUDED.max_items_per_fetch,
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
        input.metadata ?? {},
      ],
    );
    return toSource(requiredRow(result.rows, 'source'));
  }

  async listDueSources(limit: number, now: Date): Promise<SignalSource[]> {
    const result = await this.pool.query(
      `
      SELECT *
      FROM sourcefoundry_sources
      WHERE enabled = true AND next_fetch_at <= $1
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

  async enqueueSourceFetch(
    input: EnqueueSourceJobInput,
  ): Promise<{ jobId: string; created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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

  async claimNextJob(input: { jobTypes: string[]; maxAttempts: number }): Promise<SignalJob | null> {
    const result = await this.pool.query(
      'SELECT * FROM claim_next_sourcefoundry_job($1, $2::text[])',
      [input.maxAttempts, input.jobTypes],
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
      ON CONFLICT (tenant_id, canonical_url) DO NOTHING
      RETURNING *
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
      return { item: toItem(result.rows[0], input), inserted: true };
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
      ON CONFLICT (tenant_id, source_item_id) DO NOTHING
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
        AND c.status = ANY($3::text[])
      ORDER BY c.generated_at DESC
      LIMIT $4
      `,
      [input.tenantId ?? null, input.tenantSlug ?? null, input.statuses, Math.min(input.limit * 10, 1000)],
    );
    const signals = result.rows.map((row) => {
      const sourceMetadata = objectValue(row.source_metadata);
      const rawPayload = objectValue(row.raw_payload);
      const rawDiscovery = objectValue(rawPayload.raw);
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
        status: String(row.status),
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
        },
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

function toItem(row: Record<string, unknown>, fallback: SourceItemInput): SourceItem {
  return {
    ...fallback,
    id: String(row.id),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    rawPayload: objectValue(row.raw_payload) || fallback.rawPayload,
  };
}
