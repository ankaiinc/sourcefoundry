import { entryPayload, parseFeed, sourceItemHash } from './ingest/rss.js';
import type { SignalRepository } from './repository.js';
import { scoreEntry } from './scoring.js';
import type { JsonRecord, SignalJob, SignalSource } from './types.js';

export const SIGNAL_JOB_TYPES = ['fetch_source'];

export interface PipelineOptions {
  maxDueSources: number;
  maxAttempts: number;
  staleJobMinutes: number;
  now?: Date;
  fetchFn?: typeof fetch;
}

export interface TickResult {
  itemsProcessed: number;
  detail: JsonRecord;
}

export async function scheduleDueSources(
  repo: SignalRepository,
  options: Pick<PipelineOptions, 'maxDueSources'> & { now?: Date },
): Promise<TickResult> {
  const now = options.now ?? new Date();
  const sources = await repo.listDueSources(options.maxDueSources, now);
  let enqueued = 0;

  for (const source of sources) {
    await repo.enqueueSourceFetch({
      tenantId: source.tenantId,
      sourceId: source.id,
      priority: sourcePriority(source),
      runAfter: now.toISOString(),
    });
    enqueued++;
  }

  return {
    itemsProcessed: enqueued,
    detail: { dueSources: sources.length, enqueued },
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

  try {
    const result = await processJob(repo, job, options.fetchFn ?? fetch);
    await repo.markJobCompleted(job.id, result.detail);
    return result;
  } catch (error) {
    const message = serializeError(error);
    const retryAt = new Date(Date.now() + backoffMs(job.attemptCount));
    if (job.attemptCount < options.maxAttempts) {
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), source.timeoutSeconds * 1000);
    const headers: Record<string, string> = {};
    if (source.etag) headers['If-None-Match'] = source.etag;
    if (source.lastModified) headers['If-Modified-Since'] = source.lastModified;

    const response = await fetchFn(source.url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    httpStatus = response.status;

    if (response.status === 304) {
      await recordSuccess(repo, source, job, {
        httpStatus,
        durationMs: Date.now() - started,
        itemsSeen,
        itemsInserted,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      });
      return { itemsProcessed: 0, detail: { sourceId: source.id, status: 'not_modified' } };
    }

    if (!response.ok) {
      throw new Error(`Fetch failed: HTTP ${response.status}`);
    }

    const xml = await response.text();
    const entries = parseFeed(xml, source.url).slice(0, source.maxItemsPerFetch);
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
          },
        });
      }
    }

    await recordSuccess(repo, source, job, {
      httpStatus,
      durationMs: Date.now() - started,
      itemsSeen,
      itemsInserted,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
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
