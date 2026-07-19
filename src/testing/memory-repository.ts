import type { SignalRepository } from '../repository.js';
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
} from '../types.js';
import { aggregatePublicSignals, signalKeyFor } from '../signals.js';

interface MemoryJob extends SignalJob {
  status: 'queued' | 'running' | 'completed' | 'failed';
  priority: number;
  runAfter: string;
  maxAttempts: number;
  result: JsonRecord;
  lastError: string | null;
  startedAt: string | null;
  updatedAt: string;
}

export class MemorySignalRepository implements SignalRepository {
  readonly tenants = new Map<string, SignalTenant>();
  readonly sources = new Map<string, SignalSource>();
  readonly jobs = new Map<string, MemoryJob>();
  readonly items = new Map<string, SourceItem>();
  readonly candidates = new Map<string, PublicSignal>();
  readonly attempts: FetchAttemptInput[] = [];
  readonly heartbeats: HeartbeatInput[] = [];

  private sequence = 0;

  async upsertTenant(input: { slug: string; name: string; config?: JsonRecord }): Promise<SignalTenant> {
    for (const tenant of this.tenants.values()) {
      if (tenant.slug === input.slug) {
        const updated = { ...tenant, name: input.name, config: input.config ?? tenant.config };
        this.tenants.set(updated.id, updated);
        return updated;
      }
    }
    const tenant = {
      id: this.id('tenant'),
      slug: input.slug,
      name: input.name,
      config: input.config ?? {},
    };
    this.tenants.set(tenant.id, tenant);
    return tenant;
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
    for (const source of this.sources.values()) {
      if (source.tenantId === input.tenantId && source.url === input.url) {
        return source;
      }
    }
    const source: SignalSource = {
      id: this.id('source'),
      tenantId: input.tenantId,
      name: input.name,
      sourceType: input.sourceType,
      url: input.url,
      enabled: true,
      reliability: input.reliability ?? 0.7,
      intervalMinutes: input.intervalMinutes ?? 60,
      maxItemsPerFetch: input.maxItemsPerFetch ?? 30,
      timeoutSeconds: 20,
      etag: null,
      lastModified: null,
      failureCount: 0,
      metadata: input.metadata ?? {},
    };
    this.sources.set(source.id, source);
    return source;
  }

  async listDueSources(limit: number): Promise<SignalSource[]> {
    return Array.from(this.sources.values())
      .filter((source) => source.enabled)
      .slice(0, limit);
  }

  async listSources(input: { tenantSlug?: string; tenantId?: string }): Promise<SignalSource[]> {
    const tenantId = input.tenantId ?? (input.tenantSlug
      ? Array.from(this.tenants.values()).find((tenant) => tenant.slug === input.tenantSlug)?.id
      : undefined);
    if (!tenantId) return [];
    return Array.from(this.sources.values())
      .filter((source) => source.tenantId === tenantId)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }

  async getSource(sourceId: string): Promise<SignalSource | null> {
    return this.sources.get(sourceId) ?? null;
  }

  async enqueueSourceFetch(
    input: EnqueueSourceJobInput,
  ): Promise<{ jobId: string; created: boolean }> {
    const active = Array.from(this.jobs.values()).find(
      (job) =>
        job.tenantId === input.tenantId &&
        job.jobType === 'fetch_source' &&
        job.entityId === input.sourceId &&
        (job.status === 'queued' || job.status === 'running'),
    );
    if (active) return { jobId: active.id, created: false };

    const id = this.id('job');
    this.jobs.set(id, {
      id,
      tenantId: input.tenantId,
      jobType: 'fetch_source',
      entityType: 'sourcefoundry_source',
      entityId: input.sourceId,
      attemptCount: 0,
      payload: { sourceId: input.sourceId },
      status: 'queued',
      priority: input.priority ?? 0,
      runAfter: input.runAfter ?? new Date().toISOString(),
      maxAttempts: 5,
      result: {},
      lastError: null,
      startedAt: null,
      updatedAt: new Date().toISOString(),
    });
    return { jobId: id, created: true };
  }

  async claimNextJob(input: { jobTypes: string[]; maxAttempts: number }): Promise<SignalJob | null> {
    const now = Date.now();
    const claimable = Array.from(this.jobs.values())
      .filter(
        (job) =>
          job.status === 'queued' &&
          Date.parse(job.runAfter) <= now &&
          job.attemptCount < Math.min(job.maxAttempts, input.maxAttempts) &&
          input.jobTypes.includes(job.jobType),
      )
      .sort((a, b) => b.priority - a.priority || Date.parse(a.runAfter) - Date.parse(b.runAfter))[0];

    if (!claimable) return null;

    claimable.status = 'running';
    claimable.attemptCount += 1;
    claimable.startedAt = new Date().toISOString();
    claimable.updatedAt = claimable.startedAt;
    return { ...claimable };
  }

  async markJobCompleted(jobId: string, result: JsonRecord): Promise<void> {
    const job = this.requireJob(jobId);
    job.status = 'completed';
    job.result = result;
    job.updatedAt = new Date().toISOString();
  }

  async markJobFailed(jobId: string, error: string): Promise<void> {
    const job = this.requireJob(jobId);
    job.status = 'failed';
    job.lastError = error;
    job.updatedAt = new Date().toISOString();
  }

  async deferJob(jobId: string, error: string, runAfter: Date): Promise<void> {
    const job = this.requireJob(jobId);
    job.status = 'queued';
    job.startedAt = null;
    job.runAfter = runAfter.toISOString();
    job.lastError = error;
    job.updatedAt = new Date().toISOString();
  }

  async reapZombieJobs(staleMinutes: number): Promise<number> {
    const cutoff = Date.now() - staleMinutes * 60_000;
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'running' && Date.parse(job.updatedAt) < cutoff) {
        job.status = 'queued';
        job.startedAt = null;
        count++;
      }
    }
    return count;
  }

  async recordFetchAttempt(input: FetchAttemptInput): Promise<void> {
    this.attempts.push(input);
  }

  async markSourceSuccess(sourceId: string): Promise<void> {
    const source = this.sources.get(sourceId);
    if (source) {
      source.failureCount = 0;
    }
  }

  async markSourceFailure(sourceId: string): Promise<void> {
    const source = this.sources.get(sourceId);
    if (source) {
      source.failureCount += 1;
    }
  }

  async upsertSourceItem(input: SourceItemInput): Promise<{ item: SourceItem; inserted: boolean }> {
    const key = `${input.tenantId}:${input.canonicalUrl}`;
    const existing = this.items.get(key);
    if (existing) return { item: existing, inserted: false };

    const item: SourceItem = {
      ...input,
      id: this.id('item'),
      createdAt: new Date().toISOString(),
    };
    this.items.set(key, item);
    return { item, inserted: true };
  }

  async upsertCandidate(input: CandidateInput): Promise<void> {
    const key = `${input.tenantId}:${input.sourceItemId}`;
    if (this.candidates.has(key)) return;
    const item = Array.from(this.items.values()).find((candidate) => candidate.id === input.sourceItemId);
    if (!item) throw new Error(`source item not found: ${input.sourceItemId}`);
    const source = this.sources.get(item.sourceId);
    if (!source) throw new Error(`source not found: ${item.sourceId}`);
    const generatedAt = new Date().toISOString();
    const provider = String(source.metadata.provider ?? source.sourceType);
    const rawDiscovery = item.rawPayload.raw && typeof item.rawPayload.raw === 'object' && !Array.isArray(item.rawPayload.raw)
      ? item.rawPayload.raw as JsonRecord
      : {};
    const query = typeof rawDiscovery.query === 'string' ? rawDiscovery.query : null;
    const signal = {
      schemaVersion: 1,
      id: this.id('candidate'),
      tenantId: input.tenantId,
      title: input.title,
      summary: input.summary,
      url: input.url,
      status: input.status,
      score: input.score,
      tags: input.tags,
      generatedAt,
      publishedAt: item.publishedAt,
      source: {
        id: source.id,
        name: source.name,
        type: source.sourceType,
        provider,
        reliability: source.reliability,
      },
      provenance: {
        sourceItemId: item.id,
        canonicalUrl: item.canonicalUrl,
        fetchedAt: item.createdAt,
        contentHash: item.contentHash,
        author: item.author || null,
        query,
      },
      freshness: {
        publishedAt: item.publishedAt,
        fetchedAt: item.createdAt,
        ageSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(item.publishedAt ?? item.createdAt)) / 1000)),
      },
      completeness: {
        title: item.title.trim().length > 0,
        summary: item.summary.trim().length > 0,
        author: item.author.trim().length > 0,
        publishedAt: item.publishedAt !== null,
      },
      failureState: {
        state: source.failureCount > 0 ? 'degraded' : 'healthy',
        consecutiveFailures: source.failureCount,
        lastSuccessAt: null,
        lastFailureAt: null,
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
    this.candidates.set(key, signal);
  }

  async listSignals(input: {
    tenantSlug?: string;
    tenantId?: string;
    statuses: string[];
    limit: number;
  }): Promise<PublicSignal[]> {
    const tenantId =
      input.tenantId ??
      Array.from(this.tenants.values()).find((tenant) => tenant.slug === input.tenantSlug)?.id;
    return aggregatePublicSignals(
      Array.from(this.candidates.values())
        .filter((candidate) => candidate.tenantId === tenantId && input.statuses.includes(candidate.status)),
      input.limit,
    );
  }

  async writeHeartbeat(input: HeartbeatInput): Promise<void> {
    this.heartbeats.push(input);
  }

  private requireJob(jobId: string): MemoryJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    return job;
  }

  private id(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }
}
