import type { SignalRepository } from '../repository.js';
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
} from '../types.js';
import { aggregatePublicSignals, signalKeyFor } from '../signals.js';
import { conversationFromPayload } from '../conversation.js';

interface MemoryJob extends SignalJob {
  status: 'queued' | 'running' | 'completed' | 'failed';
  priority: number;
  runAfter: string;
  maxAttempts: number;
  result: JsonRecord;
  lastError: string | null;
  startedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export class MemorySignalRepository implements SignalRepository {
  readonly tenants = new Map<string, SignalTenant>();
  readonly agentCredentials = new Map<string, AgentCredential & { tokenHash: string }>();
  readonly sources = new Map<string, SignalSource>();
  readonly jobs = new Map<string, MemoryJob>();
  readonly items = new Map<string, SourceItem>();
  readonly candidates = new Map<string, PublicSignal>();
  readonly sourceFeeds = new Map<string, SourceFeed>();
  readonly sourceFeedSources = new Map<string, SourceFeedSource[]>();
  readonly sourceFeedRuns = new Map<string, SourceFeedRun>();
  readonly attempts: FetchAttemptInput[] = [];
  readonly heartbeats: HeartbeatInput[] = [];

  private sequence = 0;

  async checkReadiness(): Promise<void> {}

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

  async createAutonomousTenant(input: { slug: string; name: string }): Promise<SignalTenant | null> {
    if (await this.getTenantBySlug(input.slug)) return null;
    return this.upsertTenant({ ...input, config: { autonomous: true } });
  }

  async getTenantBySlug(slug: string): Promise<SignalTenant | null> {
    return Array.from(this.tenants.values()).find((tenant) => tenant.slug === slug) ?? null;
  }

  async getTenantById(tenantId: string): Promise<SignalTenant | null> {
    return this.tenants.get(tenantId) ?? null;
  }

  async createAgentCredential(input: {
    tenantId: string;
    label: string;
    tokenHash: string;
    tokenPrefix: string;
  }): Promise<AgentCredential> {
    const credential: AgentCredential & { tokenHash: string } = {
      id: this.id('credential'),
      tenantId: input.tenantId,
      label: input.label,
      tokenHash: input.tokenHash,
      tokenPrefix: input.tokenPrefix,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    this.agentCredentials.set(credential.id, credential);
    return credential;
  }

  async createAutonomousEnrollment(input: { slug: string; name: string; label: string; tokenHash: string; tokenPrefix: string; maxEnrollmentsPerDay: number }): Promise<{ tenant: SignalTenant; credential: AgentCredential } | { limited: true } | null> {
    const since = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    if (Array.from(this.agentCredentials.values()).filter((credential) => Date.parse(credential.createdAt) >= since).length >= input.maxEnrollmentsPerDay) {
      return { limited: true };
    }
    const tenant = await this.createAutonomousTenant({ slug: input.slug, name: input.name });
    if (!tenant) return null;
    const credential = await this.createAgentCredential({ tenantId: tenant.id, label: input.label, tokenHash: input.tokenHash, tokenPrefix: input.tokenPrefix });
    return { tenant, credential };
  }

  async findActiveAgentCredential(tokenHash: string): Promise<AgentCredential | null> {
    return Array.from(this.agentCredentials.values()).find(
      (credential) => credential.tokenHash === tokenHash && credential.revokedAt === null,
    ) ?? null;
  }

  async countAgentCredentialsSince(since: Date): Promise<number> {
    return Array.from(this.agentCredentials.values()).filter((credential) => Date.parse(credential.createdAt) >= since.getTime()).length;
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
    for (const source of this.sources.values()) {
      if (source.tenantId === input.tenantId && source.url === input.url) {
        const updated: SignalSource = {
          ...source,
          name: input.name,
          sourceType: input.sourceType,
          reliability: input.reliability ?? 0.7,
          intervalMinutes: input.intervalMinutes ?? 60,
          maxItemsPerFetch: input.maxItemsPerFetch ?? 30,
          timeoutSeconds: input.timeoutSeconds ?? 20,
          agentManaged: source.agentManaged || input.agentManaged === true,
          metadata: input.metadata ?? {},
        };
        this.sources.set(updated.id, updated);
        return updated;
      }
    }
    if (input.agentManaged && input.maxAgentManagedSources !== undefined) {
      const count = Array.from(this.sources.values()).filter((source) => source.tenantId === input.tenantId && source.agentManaged).length;
      if (count >= input.maxAgentManagedSources) throw new Error('Autonomous workspace source limit reached');
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
      timeoutSeconds: input.timeoutSeconds ?? 20,
      etag: null,
      lastModified: null,
      failureCount: 0,
      agentManaged: input.agentManaged === true,
      metadata: input.metadata ?? {},
    };
    this.sources.set(source.id, source);
    return source;
  }

  async getSourceByTenantAndUrl(tenantId: string, url: string): Promise<SignalSource | null> {
    return Array.from(this.sources.values()).find((source) => source.tenantId === tenantId && source.url === url) ?? null;
  }

  async countSourcesForTenant(tenantId: string): Promise<number> {
    return Array.from(this.sources.values()).filter((source) => source.tenantId === tenantId).length;
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

  async upsertSourceFeed(input: {
    tenantId: string;
    idempotencyKey: string;
    name: string;
    purpose: string;
    everyMinutes: number;
    maxItemsPerRun: number;
    maxCandidatesPerRun: number;
  }): Promise<SourceFeed> {
    const existing = Array.from(this.sourceFeeds.values()).find(
      (feed) => feed.tenantId === input.tenantId && feed.idempotencyKey === input.idempotencyKey,
    );
    const now = new Date().toISOString();
    const feed: SourceFeed = {
      id: existing?.id ?? this.id('feed'),
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      name: input.name,
      purpose: input.purpose,
      status: existing?.status ?? 'active',
      everyMinutes: input.everyMinutes,
      maxItemsPerRun: input.maxItemsPerRun,
      maxCandidatesPerRun: input.maxCandidatesPerRun,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.sourceFeeds.set(feed.id, feed);
    return feed;
  }

  async replaceSourceFeedSources(sourceFeedId: string, sources: SourceFeedSource[]): Promise<void> {
    this.sourceFeedSources.set(sourceFeedId, sources.map((source) => ({ ...source })));
  }

  async getSourceFeed(sourceFeedId: string): Promise<SourceFeed | null> {
    return this.sourceFeeds.get(sourceFeedId) ?? null;
  }

  async listSourceFeedSources(sourceFeedId: string): Promise<Array<SourceFeedSource & { source: SignalSource }>> {
    return (this.sourceFeedSources.get(sourceFeedId) ?? []).flatMap((membership) => {
      const source = this.sources.get(membership.sourceId);
      return source ? [{ ...membership, source }] : [];
    });
  }

  async createSourceFeedRun(input: { tenantId: string; sourceFeedId: string; jobIds: string[] }): Promise<SourceFeedRun> {
    const run: SourceFeedRun = {
      id: this.id('feed_run'),
      tenantId: input.tenantId,
      sourceFeedId: input.sourceFeedId,
      status: 'queued',
      jobIds: [...new Set(input.jobIds)],
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    this.sourceFeedRuns.set(run.id, run);
    return run;
  }

  async getActiveSourceFeedRun(sourceFeedId: string): Promise<SourceFeedRun | null> {
    const runs = Array.from(this.sourceFeedRuns.values())
      .filter((run) => run.sourceFeedId === sourceFeedId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    for (const stored of runs) {
      const run = await this.getSourceFeedRun(stored.id);
      if (run?.status === 'queued' || run?.status === 'collecting') return run;
    }
    return null;
  }

  async getSourceFeedRun(runId: string): Promise<SourceFeedRun | null> {
    const run = this.sourceFeedRuns.get(runId);
    if (!run) return null;
    const statuses = run.jobIds.map((id) => this.jobs.get(id)?.status ?? 'failed');
    const terminal = statuses.every((status) => status === 'completed' || status === 'failed');
    const completed = statuses.filter((status) => status === 'completed').length;
    const failed = statuses.filter((status) => status === 'failed').length;
    return {
      ...run,
      status: statuses.some((status) => status === 'running') ? 'collecting'
        : !terminal ? 'queued'
          : failed === 0 ? 'completed'
            : completed > 0 ? 'partial' : 'failed',
      completedAt: terminal ? new Date().toISOString() : null,
    };
  }

  async getSourceFeedHealth(sourceFeedId: string): Promise<SourceFeedHealth | null> {
    if (!this.sourceFeeds.has(sourceFeedId)) return null;
    const memberships = await this.listSourceFeedSources(sourceFeedId);
    const latestStored = Array.from(this.sourceFeedRuns.values())
      .filter((run) => run.sourceFeedId === sourceFeedId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const lastRun = latestStored ? await this.getSourceFeedRun(latestStored.id) : null;
    const sourceIds = new Set(memberships.map((membership) => membership.sourceId));
    const newestCandidateAt = Array.from(this.candidates.values())
      .filter((candidate) => sourceIds.has(candidate.source.id))
      .map((candidate) => candidate.generatedAt)
      .sort().at(-1) ?? null;
    const degraded = memberships.some((membership) => membership.required && membership.source.failureCount > 0)
      || lastRun?.status === 'partial' || lastRun?.status === 'failed';
    return {
      sourceFeedId,
      status: !lastRun ? 'never_run' : degraded ? 'degraded' : 'healthy',
      newestCandidateAt,
      lastRun,
      sources: memberships.map((membership) => ({
        source: membership.source,
        required: membership.required,
        lastSuccessAt: null,
        lastFailureAt: null,
        nextFetchAt: null,
      })),
    };
  }

  async enqueueSourceFetch(
    input: EnqueueSourceJobInput & { agentRunBudget?: { perTenantPerDay: number; serviceTotalPerDay: number } },
  ): Promise<{ jobId: string; created: boolean; limited?: 'tenant_daily' | 'service_daily' }> {
    const active = Array.from(this.jobs.values()).find(
      (job) =>
        job.tenantId === input.tenantId &&
        job.jobType === 'fetch_source' &&
        job.entityId === input.sourceId &&
        (job.status === 'queued' || job.status === 'running'),
    );
    if (active) return { jobId: active.id, created: false };

    const source = this.sources.get(input.sourceId);
    if (source?.agentManaged && input.agentRunBudget) {
      const since = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
      const agentJobs = Array.from(this.jobs.values()).filter((job) => {
        const jobSource = job.entityId ? this.sources.get(job.entityId) : undefined;
        return job.jobType === 'fetch_source' && jobSource?.agentManaged && Date.parse(job.createdAt) >= since;
      });
      if (agentJobs.filter((job) => job.tenantId === input.tenantId).length >= input.agentRunBudget.perTenantPerDay) {
        return { jobId: '', created: false, limited: 'tenant_daily' };
      }
      if (agentJobs.length >= input.agentRunBudget.serviceTotalPerDay) {
        return { jobId: '', created: false, limited: 'service_daily' };
      }
    }

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
      createdAt: new Date().toISOString(),
    });
    return { jobId: id, created: true };
  }

  async countAgentManagedJobsSince(since: Date): Promise<number> {
    return Array.from(this.jobs.values()).filter((job) => {
      const source = job.entityId ? this.sources.get(job.entityId) : undefined;
      return job.jobType === 'fetch_source'
        && source?.agentManaged === true
        && Date.parse(job.createdAt) >= since.getTime();
    }).length;
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

  async claimJobById(input: { jobId: string; maxAttempts: number }): Promise<SignalJob | null> {
    const job = this.jobs.get(input.jobId);
    if (
      !job
      || job.jobType !== 'fetch_source'
      || job.status !== 'queued'
      || Date.parse(job.runAfter) > Date.now()
      || job.attemptCount >= Math.min(job.maxAttempts, input.maxAttempts)
    ) return null;

    job.status = 'running';
    job.attemptCount += 1;
    job.startedAt = new Date().toISOString();
    job.updatedAt = job.startedAt;
    return { ...job };
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
    if (existing) {
      if (objectValue(objectValue(input.rawPayload).raw).observationMode === 'enrichment') {
        const richerContent = input.title.length + input.summary.length > existing.title.length + existing.summary.length;
        const merged: SourceItem = {
          ...existing,
          title: richerContent ? input.title : existing.title,
          summary: richerContent ? input.summary : existing.summary,
          author: existing.author || input.author,
          publishedAt: existing.publishedAt ?? input.publishedAt,
          contentHash: richerContent ? input.contentHash : existing.contentHash,
          rawPayload: { ...existing.rawPayload, enrichment: input.rawPayload },
          relevanceScore: Math.max(existing.relevanceScore, input.relevanceScore),
          sourceReliability: Math.max(existing.sourceReliability, input.sourceReliability),
        };
        this.items.set(key, merged);
        return { item: merged, inserted: false };
      }
      return { item: existing, inserted: false };
    }

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
    const item = Array.from(this.items.values()).find((candidate) => candidate.id === input.sourceItemId);
    if (!item) throw new Error(`source item not found: ${input.sourceItemId}`);
    const source = this.sources.get(item.sourceId);
    if (!source) throw new Error(`source not found: ${item.sourceId}`);
    const generatedAt = new Date().toISOString();
    const provider = String(source.metadata.provider ?? source.sourceType);
    const rawDiscovery = item.rawPayload.raw && typeof item.rawPayload.raw === 'object' && !Array.isArray(item.rawPayload.raw)
      ? item.rawPayload.raw as JsonRecord
      : {};
    const providerRaw = rawDiscovery.raw && typeof rawDiscovery.raw === 'object' && !Array.isArray(rawDiscovery.raw)
      ? rawDiscovery.raw as JsonRecord
      : {};
    const query = typeof rawDiscovery.query === 'string' ? rawDiscovery.query : null;
    const existing = this.candidates.get(key);
    if (existing) {
      if (input.metadata.observationMode !== 'enrichment') return;
      const richerContent = input.title.length + input.summary.length > existing.title.length + existing.summary.length;
      const updated: PublicSignal = {
        ...existing,
        title: richerContent ? input.title : existing.title,
        summary: richerContent ? input.summary : existing.summary,
        url: input.url,
        score: Math.max(existing.score, input.score),
        tags: [...new Set([...existing.tags, ...input.tags])],
        publishedAt: item.publishedAt,
        provenance: {
          ...existing.provenance,
          author: item.author || existing.provenance.author,
          contentHash: item.contentHash,
        },
        freshness: {
          ...existing.freshness,
          publishedAt: item.publishedAt,
          ageSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(item.publishedAt ?? item.createdAt)) / 1000)),
        },
        completeness: {
          title: item.title.trim().length > 0,
          summary: item.summary.trim().length > 0,
          author: item.author.trim().length > 0,
          publishedAt: item.publishedAt !== null,
        },
        ...conversationField(item.rawPayload),
      };
      this.candidates.set(key, updated);
      return;
    }
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
        discovery: {
          trustLevel: provider === 'x' ? 'authoritative' : source.metadata.mode === 'discovery' ? 'indexed' : 'unknown',
          creatorHandle: typeof providerRaw.creator_username === 'string' ? providerRaw.creator_username : null,
          externalUrls: Array.isArray(providerRaw.external_urls)
            ? providerRaw.external_urls.filter((value): value is string => typeof value === 'string') : [],
        },
      },
      ...conversationField(item.rawPayload),
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
    sourceFeedId?: string;
    since?: string;
    statuses: string[];
    limit: number;
  }): Promise<PublicSignal[]> {
    const tenantId =
      input.tenantId ??
      Array.from(this.tenants.values()).find((tenant) => tenant.slug === input.tenantSlug)?.id;
    const sourceIds = input.sourceFeedId
      ? new Set((this.sourceFeedSources.get(input.sourceFeedId) ?? []).map((membership) => membership.sourceId))
      : null;
    return aggregatePublicSignals(
      Array.from(this.candidates.values())
        .filter((candidate) => candidate.tenantId === tenantId
          && input.statuses.includes(candidate.status)
          && (!sourceIds || sourceIds.has(candidate.source.id))
          && (!input.since || candidate.generatedAt > input.since)),
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

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function conversationField(rawPayload: JsonRecord): { conversation?: NonNullable<PublicSignal['conversation']> } {
  const conversation = conversationFromPayload(rawPayload);
  return conversation ? { conversation } : {};
}
