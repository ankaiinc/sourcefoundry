import { fetchDiscoveryEntries, isActionableLinkedInUrl } from './ingest/discovery.js';
import { entryPayload, parseFeed, sourceItemHash } from './ingest/rss.js';
import type { SignalRepository } from './repository.js';
import { scoreEntry } from './scoring.js';
import type { JsonRecord, SignalJob, SignalSource } from './types.js';

export const SIGNAL_JOB_TYPES = ['fetch_source'];

export interface PipelineOptions {
  maxDueSources: number;
  maxAttempts: number;
  staleJobMinutes: number;
  maxAgentManagedRunsPerDay?: number;
  now?: Date;
  fetchFn?: typeof fetch;
}

export interface TickResult {
  itemsProcessed: number;
  detail: JsonRecord;
}

export async function scheduleDueSources(
  repo: SignalRepository,
  options: Pick<PipelineOptions, 'maxDueSources' | 'maxAgentManagedRunsPerDay'> & { now?: Date },
): Promise<TickResult> {
  const now = options.now ?? new Date();
  const sources = await repo.listDueSources(options.maxDueSources, now);
  let enqueued = 0;
  let alreadyActive = 0;
  let agentManagedSkipped = 0;
  const maxAgentManagedRunsPerDay = options.maxAgentManagedRunsPerDay ?? Number.POSITIVE_INFINITY;
  let agentManagedRuns = await repo.countAgentManagedJobsSince(new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
  )));

  for (const source of sources) {
    if (source.agentManaged && agentManagedRuns >= maxAgentManagedRunsPerDay) {
      agentManagedSkipped++;
      continue;
    }
    const result = await repo.enqueueSourceFetch({
      tenantId: source.tenantId,
      sourceId: source.id,
      priority: sourcePriority(source),
      runAfter: now.toISOString(),
    });
    if (result.created) {
      enqueued++;
      if (source.agentManaged) agentManagedRuns++;
    }
    else alreadyActive++;
  }

  return {
    itemsProcessed: enqueued,
    detail: { dueSources: sources.length, enqueued, alreadyActive, agentManagedSkipped, agentManagedRuns },
  };
}

export async function drainOnce(
  repo: SignalRepository,
  options: Pick<PipelineOptions, 'maxAttempts'> & { fetchFn?: typeof fetch },
): Promise<TickResult> {
  const job = await repo.claimNextJob({
    jobTypes: SIGNAL_JOB_TYPES,
    maxAttempts: options.maxAttempts,
  });
  if (!job) {
    return { itemsProcessed: 0, detail: { claimed: 0 } };
  }

  return executeClaimedJob(repo, job, options.fetchFn ?? fetch, options.maxAttempts);
}

export async function drainJobOnce(
  repo: SignalRepository,
  jobId: string,
  options: Pick<PipelineOptions, 'maxAttempts'> & { fetchFn?: typeof fetch },
): Promise<TickResult> {
  const job = await repo.claimJobById({ jobId, maxAttempts: options.maxAttempts });
  if (!job) {
    return { itemsProcessed: 0, detail: { claimed: 0, jobId } };
  }

  return executeClaimedJob(repo, job, options.fetchFn ?? fetch, options.maxAttempts);
}

async function executeClaimedJob(
  repo: SignalRepository,
  job: SignalJob,
  fetchFn: typeof fetch,
  maxAttempts: number,
): Promise<TickResult> {
  try {
    const result = await processJob(repo, job, fetchFn);
    await repo.markJobCompleted(job.id, result.detail);
    return result;
  } catch (error) {
    const message = serializeError(error);
    const retryAt = new Date(Date.now() + backoffMs(job.attemptCount));
    if (job.attemptCount < maxAttempts) {
      await repo.deferJob(job.id, message, retryAt);
    } else {
      await repo.markJobFailed(job.id, message);
    }
    return {
      itemsProcessed: 0,
      detail: { claimed: 1, failed: 1, error: message },
    };
  }
}

export async function workerTick(repo: SignalRepository, options: PipelineOptions): Promise<TickResult> {
  const reaped = await repo.reapZombieJobs(options.staleJobMinutes);
  const scheduled = await scheduleDueSources(repo, options);
  const drained = await drainOnce(repo, options);

  return {
    itemsProcessed: scheduled.itemsProcessed + drained.itemsProcessed,
    detail: {
      reaped,
      scheduled: scheduled.detail,
      drained: drained.detail,
    },
  };
}

export async function withHeartbeat(
  repo: SignalRepository,
  stage: string,
  fn: () => Promise<TickResult>,
): Promise<TickResult> {
  const startedAt = new Date();
  const t0 = Date.now();
  try {
    const result = await fn();
    await repo.writeHeartbeat({
      stage,
      startedAt,
      durationMs: Date.now() - t0,
      status: 'ok',
      itemsProcessed: result.itemsProcessed,
      detail: result.detail,
    });
    return result;
  } catch (error) {
    await repo.writeHeartbeat({
      stage,
      startedAt,
      durationMs: Date.now() - t0,
      status: 'failed',
      itemsProcessed: 0,
      error: serializeError(error),
    });
    throw error;
  }
}

async function processJob(
  repo: SignalRepository,
  job: SignalJob,
  fetchFn: typeof fetch,
): Promise<TickResult> {
  if (job.jobType !== 'fetch_source') {
    throw new Error(`Unsupported job type: ${job.jobType}`);
  }

  const sourceId = typeof job.payload.sourceId === 'string' ? job.payload.sourceId : job.entityId;
  if (!sourceId) throw new Error(`fetch_source job ${job.id} is missing sourceId`);

  const source = await repo.getSource(sourceId);
  if (!source) throw new Error(`Source not found: ${sourceId}`);

  return fetchSource(repo, source, job, fetchFn);
}

async function fetchSource(
  repo: SignalRepository,
  source: SignalSource,
  job: SignalJob,
  fetchFn: typeof fetch,
): Promise<TickResult> {
  const started = Date.now();
  let httpStatus: number | null = null;
  let itemsSeen = 0;
  let itemsInserted = 0;

  try {
    const headers: Record<string, string> = {};
    if (source.etag) headers['If-None-Match'] = source.etag;
    if (source.lastModified) headers['If-Modified-Since'] = source.lastModified;

    const queryOverride = await enrichmentQueries(repo, source);
    // Umbrella deadline for the whole source. Discovery runs its queries
    // sequentially, each with its own timeoutSeconds budget, so this ceiling
    // must leave room for every query plus a small buffer — otherwise it would
    // re-impose one shared budget across all queries and abort them mid-flight.
    const queryCount = Math.max(1, queryOverride?.length
      ?? (Array.isArray(source.metadata.queries) ? source.metadata.queries.length : 1));
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      source.timeoutSeconds * 1000 * queryCount + 5000,
    );

    let fetched: Awaited<ReturnType<typeof fetchSourceEntries>>;
    try {
      fetched = await fetchSourceEntries(source, fetchFn, headers, controller.signal, queryOverride);
    } finally {
      clearTimeout(timeout);
    }
    httpStatus = fetched.httpStatus;

    if (fetched.notModified) {
      await recordSuccess(repo, source, job, {
        httpStatus,
        durationMs: Date.now() - started,
        itemsSeen,
        itemsInserted,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
      });
      return { itemsProcessed: 0, detail: { sourceId: source.id, status: 'not_modified' } };
    }

    const entries = fetched.entries.slice(0, source.maxItemsPerFetch);
    itemsSeen = entries.length;

    for (const entry of entries) {
      const scored = scoreEntry(entry, source);
      const { item, inserted } = await repo.upsertSourceItem({
        tenantId: source.tenantId,
        sourceId: source.id,
        canonicalUrl: entry.canonicalUrl,
        url: entry.url,
        title: entry.title,
        summary: entry.summary,
        author: entry.author,
        publishedAt: entry.publishedAt,
        contentHash: sourceItemHash(entry),
        rawPayload: entryPayload(entry),
        relevanceScore: scored.relevanceScore,
        sourceReliability: source.reliability,
      });

      if (inserted) itemsInserted++;
      if (scored.candidateScore >= 0.45) {
        await repo.upsertCandidate({
          tenantId: source.tenantId,
          sourceItemId: item.id,
          title: entry.title,
          summary: entry.summary,
          url: entry.url,
          status: scored.candidateScore >= 0.78 ? 'published' : 'ready_for_review',
          score: scored.candidateScore,
          tags: scored.tags,
          metadata: {
            sourceId: source.id,
            sourceName: source.name,
            model: 'heuristic-v1',
            ...(source.metadata.mode === 'enrichment' ? { observationMode: 'enrichment' } : {}),
          },
        });
      }
    }

    await recordSuccess(repo, source, job, {
      httpStatus,
      durationMs: Date.now() - started,
      itemsSeen,
      itemsInserted,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
    });

    return {
      itemsProcessed: itemsInserted,
      detail: {
        sourceId: source.id,
        itemsSeen,
        itemsInserted,
      },
    };
  } catch (error) {
    const message = serializeError(error);
    const nextFetchAt = new Date(Date.now() + failureDelayMs(source.failureCount));
    await repo.recordFetchAttempt({
      tenantId: source.tenantId,
      sourceId: source.id,
      jobId: job.id,
      status: 'failed',
      httpStatus,
      error: message,
      durationMs: Date.now() - started,
      itemsSeen,
      itemsInserted,
    });
    await repo.markSourceFailure(source.id, { nextFetchAt, error: message });
    throw error;
  }
}

async function fetchSourceEntries(
  source: SignalSource,
  fetchFn: typeof fetch,
  headers: Record<string, string>,
  signal: AbortSignal,
  queryOverride?: string[],
): Promise<{
  entries: ReturnType<typeof parseFeed>;
  httpStatus: number | null;
  notModified: boolean;
  etag: string | null;
  lastModified: string | null;
}> {
  if (
    source.sourceType === 'web'
    && (source.metadata.mode === 'discovery' || source.metadata.mode === 'enrichment')
  ) {
    const discovered = await fetchDiscoveryEntries(source, fetchFn, signal, queryOverride);
    return {
      entries: discovered.entries,
      httpStatus: discovered.httpStatus,
      notModified: false,
      etag: null,
      lastModified: null,
    };
  }

  const response = await fetchFn(source.url, { headers, signal });
  const httpStatus = response.status;
  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');

  if (response.status === 304) {
    return { entries: [], httpStatus, notModified: true, etag, lastModified };
  }

  if (!response.ok) {
    throw new Error(`Fetch failed: HTTP ${response.status}`);
  }

  const xml = await response.text();
  return {
    entries: parseFeed(xml, source.url),
    httpStatus,
    notModified: false,
    etag,
    lastModified,
  };
}

async function enrichmentQueries(repo: SignalRepository, source: SignalSource): Promise<string[] | undefined> {
  if (source.metadata.mode !== 'enrichment' || source.metadata.provider !== 'apify') return undefined;
  const statuses = Array.isArray(source.metadata.upstream_statuses)
    ? source.metadata.upstream_statuses.filter((status): status is string => typeof status === 'string' && status.trim().length > 0)
    : ['published', 'approved', 'ready_for_review'];
  const minimumScore = typeof source.metadata.upstream_min_score === 'number'
    ? Math.max(0, Math.min(1, source.metadata.upstream_min_score))
    : 0.65;
  const refreshHours = typeof source.metadata.reenrich_after_hours === 'number'
    ? Math.max(1, source.metadata.reenrich_after_hours)
    : 24;
  const cutoff = Date.now() - refreshHours * 3_600_000;
  const signals = await repo.listSignals({
    tenantId: source.tenantId,
    statuses,
    limit: Math.min(100, Math.max(source.maxItemsPerFetch * 5, source.maxItemsPerFetch)),
  });
  return signals
    .filter((signal) => signal.source.provider !== 'apify')
    .filter((signal) => signal.score >= minimumScore && isActionableLinkedInUrl(signal.url))
    .filter((signal) => !signal.conversation || Date.parse(signal.conversation.observedAt) <= cutoff)
    .map((signal) => signal.url)
    .filter((url, index, urls) => urls.indexOf(url) === index)
    .slice(0, source.maxItemsPerFetch);
}

async function recordSuccess(
  repo: SignalRepository,
  source: SignalSource,
  job: SignalJob,
  input: {
    httpStatus: number | null;
    durationMs: number;
    itemsSeen: number;
    itemsInserted: number;
    etag: string | null;
    lastModified: string | null;
  },
): Promise<void> {
  await repo.recordFetchAttempt({
    tenantId: source.tenantId,
    sourceId: source.id,
    jobId: job.id,
    status: 'success',
    httpStatus: input.httpStatus,
    durationMs: input.durationMs,
    itemsSeen: input.itemsSeen,
    itemsInserted: input.itemsInserted,
  });
  await repo.markSourceSuccess(source.id, {
    nextFetchAt: new Date(Date.now() + source.intervalMinutes * 60_000),
    etag: input.etag,
    lastModified: input.lastModified,
  });
}

function sourcePriority(source: SignalSource): number {
  return Math.round(source.reliability * 100);
}

function backoffMs(attemptCount: number): number {
  return [60_000, 300_000, 900_000, 1_800_000][Math.max(0, attemptCount - 1)] ?? 3_600_000;
}

function failureDelayMs(failureCount: number): number {
  const minutes = Math.min(240, 15 * Math.max(1, failureCount + 1));
  return minutes * 60_000;
}

function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
