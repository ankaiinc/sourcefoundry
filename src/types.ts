export type JsonRecord = Record<string, unknown>;

export type SourceType = 'rss' | 'atom' | 'web';

export interface SignalTenant {
  id: string;
  slug: string;
  name: string;
  config: JsonRecord;
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
  metadata: JsonRecord;
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
  raw: JsonRecord;
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

export interface PublicSignal {
  id: string;
  tenantId: string;
  title: string;
  summary: string;
  url: string;
  status: string;
  score: number;
  tags: string[];
  generatedAt: string;
  publishedAt: string | null;
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
