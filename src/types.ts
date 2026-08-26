export type JsonRecord = Record<string, unknown>;

export type SourceType = 'rss' | 'atom' | 'web';

export interface SignalTenant {
  id: string;
  slug: string;
  name: string;
  config: JsonRecord;
}

export interface AgentCredential {
  id: string;
  tenantId: string;
  label: string;
  tokenPrefix: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface SignalSource {
  id: string;
  tenantId: string;
  name: string;
  sourceType: SourceType;
  url: string;
  enabled: boolean;
  reliability: number;
  intervalMinutes: number;
  maxItemsPerFetch: number;
  timeoutSeconds: number;
  etag?: string | null;
  lastModified?: string | null;
  failureCount: number;
  agentManaged?: boolean;
  metadata: JsonRecord;
}

export type SourceFeedSourceKind = 'feed' | 'page' | 'discovery';

export interface SourceFeed {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  name: string;
  purpose: string;
  status: 'active' | 'paused';
  everyMinutes: number;
  maxItemsPerRun: number;
  maxCandidatesPerRun: number;
  createdAt: string;
  updatedAt: string;
}

export interface SourceFeedSource {
  sourceFeedId: string;
  sourceId: string;
  kind: SourceFeedSourceKind;
  required: boolean;
  position: number;
  config: JsonRecord;
}

export interface SourceFeedRun {
  id: string;
  tenantId: string;
  sourceFeedId: string;
  status: 'queued' | 'collecting' | 'completed' | 'partial' | 'failed';
  jobIds: string[];
  createdAt: string;
  completedAt: string | null;
}

export interface SourceFeedHealth {
  sourceFeedId: string;
  status: 'healthy' | 'degraded' | 'never_run';
  newestCandidateAt: string | null;
  lastRun: SourceFeedRun | null;
  sources: Array<{
    source: SignalSource;
    required: boolean;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    nextFetchAt: string | null;
  }>;
}

export interface SignalJob {
  id: string;
  tenantId: string;
  jobType: string;
  entityType: string;
  entityId: string | null;
  attemptCount: number;
  payload: JsonRecord;
}

export interface SourceEntry {
  title: string;
  url: string;
  canonicalUrl: string;
  summary: string;
  author: string;
  publishedAt: string | null;
  conversation?: SignalConversation;
  raw: JsonRecord;
}

export interface SignalConversationParticipant {
  displayName: string;
  handle: string | null;
  profileUrl: string | null;
  commentUrl: string | null;
  excerpt: string;
  publishedAt: string | null;
}

export interface SignalConversation {
  provider: string;
  observedAt: string;
  commentsReturned: number;
  commentsTotal: number | null;
  partial: boolean;
  participants: SignalConversationParticipant[];
}

export interface SourceItemInput {
  tenantId: string;
  sourceId: string;
  canonicalUrl: string;
  url: string;
  title: string;
  summary: string;
  author: string;
  publishedAt: string | null;
  contentHash: string;
  rawPayload: JsonRecord;
  relevanceScore: number;
  sourceReliability: number;
}

export interface SourceItem extends SourceItemInput {
  id: string;
  createdAt: string;
}

export interface CandidateInput {
  tenantId: string;
  sourceItemId: string;
  title: string;
  summary: string;
  url: string;
  score: number;
  tags: string[];
  status: 'draft' | 'ready_for_review' | 'approved' | 'published' | 'rejected';
  metadata: JsonRecord;
}

export type PublicSignalStatus = CandidateInput['status'];

export interface SignalObservation {
  candidateId: string;
  title: string;
  summary: string;
  url: string;
  score: number;
  generatedAt: string;
  publishedAt: string | null;
  source: PublicSignal['source'];
  provenance: PublicSignal['provenance'];
  freshness: PublicSignal['freshness'];
  completeness: PublicSignal['completeness'];
  failureState: PublicSignal['failureState'];
  conversation?: SignalConversation;
}

export interface PublicSignal {
  schemaVersion: 1;
  id: string;
  tenantId: string;
  title: string;
  summary: string;
  url: string;
  status: PublicSignalStatus;
  score: number;
  tags: string[];
  generatedAt: string;
  publishedAt: string | null;
  source: {
    id: string;
    name: string;
    type: SourceType;
    provider: string;
    reliability: number;
  };
  provenance: {
    sourceItemId: string;
    canonicalUrl: string;
    fetchedAt: string;
    contentHash: string;
    author: string | null;
    query: string | null;
  };
  conversation?: SignalConversation;
  freshness: {
    publishedAt: string | null;
    fetchedAt: string;
    ageSeconds: number;
  };
  completeness: {
    title: boolean;
    summary: boolean;
    author: boolean;
    publishedAt: boolean;
  };
  failureState: {
    state: 'healthy' | 'degraded';
    consecutiveFailures: number;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
  };
  aggregation: {
    signalKey: string;
    observationCount: number;
    sourceCount: number;
    capped: boolean;
  };
  observations: SignalObservation[];
}

export interface PublicSignalsResponse {
  schemaVersion: 1;
  release: string;
  signals: PublicSignal[];
}

export type SourceFoundryErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'rate_limited'
  | 'not_found'
  | 'not_ready'
  | 'contract_violation'
  | 'internal_error';

export interface SourceFoundryErrorResponse {
  schemaVersion: 1;
  release: string;
  error: {
    code: SourceFoundryErrorCode;
    message: string;
    retryable: boolean;
  };
}

export interface FetchAttemptInput {
  tenantId: string;
  sourceId: string;
  jobId: string;
  status: string;
  httpStatus?: number | null;
  error?: string | null;
  durationMs: number;
  itemsSeen: number;
  itemsInserted: number;
}

export interface HeartbeatInput {
  stage: string;
  startedAt: Date;
  durationMs: number;
  status: 'ok' | 'failed' | 'skipped';
  itemsProcessed: number;
  error?: string;
  detail?: JsonRecord;
}

export interface EnqueueSourceJobInput {
  tenantId: string;
  sourceId: string;
  priority?: number;
  runAfter?: string;
}
