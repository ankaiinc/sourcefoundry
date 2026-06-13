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

export interface SignalRepository {
  upsertTenant(input: { slug: string; name: string; config?: JsonRecord }): Promise<SignalTenant>;
  createSource(input: {
    tenantId: string;
    name: string;
    sourceType: 'rss' | 'atom' | 'web';
    url: string;
    reliability?: number;
    intervalMinutes?: number;
    maxItemsPerFetch?: number;
    metadata?: JsonRecord;
  }): Promise<SignalSource>;
  listDueSources(limit: number, now: Date): Promise<SignalSource[]>;
  getSource(sourceId: string): Promise<SignalSource | null>;
  enqueueSourceFetch(input: EnqueueSourceJobInput): Promise<string>;
  claimNextJob(input: { jobTypes: string[]; maxAttempts: number }): Promise<SignalJob | null>;
  markJobCompleted(jobId: string, result: JsonRecord): Promise<void>;
  markJobFailed(jobId: string, error: string): Promise<void>;
  deferJob(jobId: string, error: string, runAfter: Date): Promise<void>;
  reapZombieJobs(staleMinutes: number): Promise<number>;
  recordFetchAttempt(input: FetchAttemptInput): Promise<void>;
  markSourceSuccess(sourceId: string, input: { nextFetchAt: Date; etag?: string | null; lastModified?: string | null }): Promise<void>;
  markSourceFailure(sourceId: string, input: { nextFetchAt: Date; error: string }): Promise<void>;
  upsertSourceItem(input: SourceItemInput): Promise<{ item: SourceItem; inserted: boolean }>;
  upsertCandidate(input: CandidateInput): Promise<void>;
  listSignals(input: { tenantSlug?: string; tenantId?: string; statuses: string[]; limit: number }): Promise<PublicSignal[]>;
  writeHeartbeat(input: HeartbeatInput): Promise<void>;
}

export function toSource(row: Record<string, unknown>): SignalSource {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    sourceType: row.source_type as SignalSource['sourceType'],
    url: String(row.url),
    enabled: Boolean(row.enabled),
    reliability: Number(row.reliability ?? 0.7),
    intervalMinutes: Number(row.interval_minutes ?? 60),
    maxItemsPerFetch: Number(row.max_items_per_fetch ?? 30),
    timeoutSeconds: Number(row.timeout_seconds ?? 20),
    etag: optionalString(row.etag),
    lastModified: optionalString(row.last_modified),
    failureCount: Number(row.failure_count ?? 0),
    metadata: objectValue(row.metadata),
  };
}

export function toTenant(row: Record<string, unknown>): SignalTenant {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    config: objectValue(row.config),
  };
}

export function toJob(row: Record<string, unknown>): SignalJob {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    jobType: String(row.job_type),
    entityType: String(row.entity_type),
    entityId: optionalString(row.entity_id),
    attemptCount: Number(row.attempt_count ?? 0),
    payload: objectValue(row.payload),
  };
}

export function objectValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}
