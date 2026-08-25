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

export interface SignalRepository {
  checkReadiness(): Promise<void>;
  upsertTenant(input: { slug: string; name: string; config?: JsonRecord }): Promise<SignalTenant>;
  createAutonomousTenant(input: { slug: string; name: string }): Promise<SignalTenant | null>;
  createAutonomousEnrollment(input: { slug: string; name: string; label: string; tokenHash: string; tokenPrefix: string; maxEnrollmentsPerDay: number }): Promise<{ tenant: SignalTenant; credential: AgentCredential } | { limited: true } | null>;
  getTenantBySlug(slug: string): Promise<SignalTenant | null>;
  getTenantById(tenantId: string): Promise<SignalTenant | null>;
  createAgentCredential(input: { tenantId: string; label: string; tokenHash: string; tokenPrefix: string }): Promise<AgentCredential>;
  findActiveAgentCredential(tokenHash: string): Promise<AgentCredential | null>;
  countAgentCredentialsSince(since: Date): Promise<number>;
  createSource(input: {
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
  }): Promise<SignalSource>;
  getSourceByTenantAndUrl(tenantId: string, url: string): Promise<SignalSource | null>;
  countSourcesForTenant(tenantId: string): Promise<number>;
  listSources(input: { tenantSlug?: string; tenantId?: string }): Promise<SignalSource[]>;
  listDueSources(limit: number, now: Date): Promise<SignalSource[]>;
  getSource(sourceId: string): Promise<SignalSource | null>;
  upsertSourceFeed(input: {
    tenantId: string;
    idempotencyKey: string;
    name: string;
    purpose: string;
    everyMinutes: number;
    maxItemsPerRun: number;
    maxCandidatesPerRun: number;
  }): Promise<SourceFeed>;
  replaceSourceFeedSources(sourceFeedId: string, sources: SourceFeedSource[]): Promise<void>;
  getSourceFeed(sourceFeedId: string): Promise<SourceFeed | null>;
  listSourceFeedSources(sourceFeedId: string): Promise<Array<SourceFeedSource & { source: SignalSource }>>;
  createSourceFeedRun(input: { tenantId: string; sourceFeedId: string; jobIds: string[] }): Promise<SourceFeedRun>;
  getActiveSourceFeedRun(sourceFeedId: string): Promise<SourceFeedRun | null>;
  getSourceFeedRun(runId: string): Promise<SourceFeedRun | null>;
  getSourceFeedHealth(sourceFeedId: string): Promise<SourceFeedHealth | null>;
  enqueueSourceFetch(input: EnqueueSourceJobInput & { agentRunBudget?: { perTenantPerDay: number; serviceTotalPerDay: number } }): Promise<{ jobId: string; created: boolean; limited?: 'tenant_daily' | 'service_daily' }>;
  countAgentManagedJobsSince(since: Date): Promise<number>;
  claimNextJob(input: { jobTypes: string[]; maxAttempts: number }): Promise<SignalJob | null>;
  claimJobById(input: { jobId: string; maxAttempts: number }): Promise<SignalJob | null>;
  markJobCompleted(jobId: string, result: JsonRecord): Promise<void>;
  markJobFailed(jobId: string, error: string): Promise<void>;
  deferJob(jobId: string, error: string, runAfter: Date): Promise<void>;
  reapZombieJobs(staleMinutes: number): Promise<number>;
  recordFetchAttempt(input: FetchAttemptInput): Promise<void>;
  markSourceSuccess(sourceId: string, input: { nextFetchAt: Date; etag?: string | null; lastModified?: string | null }): Promise<void>;
  markSourceFailure(sourceId: string, input: { nextFetchAt: Date; error: string }): Promise<void>;
  upsertSourceItem(input: SourceItemInput): Promise<{ item: SourceItem; inserted: boolean }>;
  upsertCandidate(input: CandidateInput): Promise<void>;
  listSignals(input: { tenantSlug?: string; tenantId?: string; sourceFeedId?: string; since?: string; statuses: string[]; limit: number }): Promise<PublicSignal[]>;
  writeHeartbeat(input: HeartbeatInput): Promise<void>;
}

export function toSourceFeed(row: Record<string, unknown>): SourceFeed {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    idempotencyKey: String(row.idempotency_key),
    name: String(row.name),
    purpose: String(row.purpose),
    status: row.status as SourceFeed['status'],
    everyMinutes: Number(row.every_minutes),
    maxItemsPerRun: Number(row.max_items_per_run),
    maxCandidatesPerRun: Number(row.max_candidates_per_run),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
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
    agentManaged: Boolean(row.agent_managed),
    metadata: objectValue(row.metadata),
  };
}

export function toAgentCredential(row: Record<string, unknown>): AgentCredential {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    label: String(row.label),
    tokenPrefix: String(row.token_prefix),
    createdAt: String(row.created_at),
    revokedAt: optionalString(row.revoked_at),
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
