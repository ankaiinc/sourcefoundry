import { validateAgentSourcePolicy, validatePublicHttpsUrl } from './agent-access.js';
import { validateDiscoverySourceConfiguration } from './ingest/discovery.js';
import type { SignalRepository } from './repository.js';
import type { JsonRecord, SourceFeed, SourceFeedRun, SourceFeedSourceKind } from './types.js';

export type SourceFeedSourceRequest = {
  kind: SourceFeedSourceKind;
  url?: string;
  label: string;
  required?: boolean;
  queries?: string[];
  includeDomains?: string[];
  excludeDomains?: string[];
};

export type SourceFeedRequest = {
  tenantId: string;
  idempotencyKey: string;
  name: string;
  purpose: string;
  sources: SourceFeedSourceRequest[];
  everyMinutes: number;
  maxItemsPerRun: number;
  maxCandidatesPerRun: number;
};

export type SourceFeedPolicy = {
  agentManaged: boolean;
  minIntervalMinutes: number;
  maxItemsPerFetch: number;
  maxSources?: number;
};

export async function buildSourceFeed(
  repo: SignalRepository,
  input: SourceFeedRequest,
  policy: SourceFeedPolicy,
): Promise<{ sourceFeed: SourceFeed; sourcePlan: Record<string, number> }> {
  if (input.sources.length === 0) throw new Error('sources must contain at least one source');
  if (policy.maxSources !== undefined && input.sources.length > policy.maxSources) {
    throw new Error(`source feed may configure at most ${policy.maxSources} sources`);
  }
  if (input.everyMinutes < policy.minIntervalMinutes) {
    throw new Error(`cadence.everyMinutes must be at least ${policy.minIntervalMinutes}`);
  }
  if (input.maxItemsPerRun > policy.maxItemsPerFetch) {
    throw new Error(`limits.maxItemsPerRun must be at most ${policy.maxItemsPerFetch}`);
  }
  if (input.sources.filter((source) => source.kind === 'discovery').length > 1) {
    throw new Error('v0 supports one discovery source per feed; combine its queries and domain rules into one entry');
  }
  const boundedRunItems = Math.min(input.maxItemsPerRun, input.maxCandidatesPerRun);
  if (boundedRunItems < input.sources.length) {
    throw new Error('limits must allow at least one item and candidate per configured source');
  }

  const baseBudget = Math.floor(boundedRunItems / input.sources.length);
  const remainder = boundedRunItems % input.sources.length;
  const plans = input.sources.map((requested, position) => normalizeSource(
    requested,
    input,
    policy,
    baseBudget + (position < remainder ? 1 : 0),
  ));
  if (new Set(plans.map((plan) => plan.source.url)).size !== plans.length) {
    throw new Error('each source in a feed must resolve to a unique URL');
  }

  const configured = [];
  for (const [position, requested] of input.sources.entries()) {
    const normalized = plans[position]!;
    const source = await repo.createSource({
      tenantId: input.tenantId,
      ...normalized.source,
      agentManaged: policy.agentManaged,
      ...(policy.agentManaged && policy.maxSources !== undefined ? { maxAgentManagedSources: policy.maxSources } : {}),
    });
    configured.push({
      sourceId: source.id,
      kind: requested.kind,
      required: requested.required === true,
      position,
      config: normalized.config,
    });
  }

  const sourceFeed = await repo.upsertSourceFeed({
    tenantId: input.tenantId,
    idempotencyKey: input.idempotencyKey,
    name: input.name,
    purpose: input.purpose,
    everyMinutes: input.everyMinutes,
    maxItemsPerRun: input.maxItemsPerRun,
    maxCandidatesPerRun: input.maxCandidatesPerRun,
  });
  await repo.replaceSourceFeedSources(sourceFeed.id, configured.map((membership) => ({
    sourceFeedId: sourceFeed.id,
    ...membership,
  })));

  return {
    sourceFeed,
    sourcePlan: {
      sourceCount: configured.length,
      requiredSourceCount: configured.filter((source) => source.required).length,
      discoverySourceCount: configured.filter((source) => source.kind === 'discovery').length,
      everyMinutes: input.everyMinutes,
      maximumItemsPerRun: input.maxItemsPerRun,
      maximumCandidatesPerRun: input.maxCandidatesPerRun,
    },
  };
}

export async function enqueueSourceFeedRun(
  repo: SignalRepository,
  sourceFeed: SourceFeed,
  agentRunBudget?: { perTenantPerDay: number; serviceTotalPerDay: number },
): Promise<SourceFeedRun & { reusedJobs: number }> {
  const sources = await repo.listSourceFeedSources(sourceFeed.id);
  if (sources.length === 0) throw new Error('source feed has no configured sources');
  const jobIds: string[] = [];
  let reusedJobs = 0;
  for (const { source } of sources) {
    const enqueued = await repo.enqueueSourceFetch({
      tenantId: sourceFeed.tenantId,
      sourceId: source.id,
      ...(agentRunBudget ? { agentRunBudget } : {}),
    });
    if (enqueued.limited) throw new SourceFeedRunLimitError(enqueued.limited);
    jobIds.push(enqueued.jobId);
    if (!enqueued.created) reusedJobs += 1;
  }
  const activeRun = await repo.getActiveSourceFeedRun(sourceFeed.id);
  if (activeRun && sameMembers(activeRun.jobIds, jobIds)) return { ...activeRun, reusedJobs };
  const run = await repo.createSourceFeedRun({ tenantId: sourceFeed.tenantId, sourceFeedId: sourceFeed.id, jobIds });
  return { ...run, reusedJobs };
}

export class SourceFeedRunLimitError extends Error {
  constructor(readonly limit: 'tenant_daily' | 'service_daily') {
    super(limit);
    this.name = 'SourceFeedRunLimitError';
  }
}

function normalizeSource(
  requested: SourceFeedSourceRequest,
  feed: SourceFeedRequest,
  policy: SourceFeedPolicy,
  perSourceItemBudget: number,
): {
  source: {
    name: string;
    sourceType: 'rss' | 'atom' | 'web';
    url: string;
    intervalMinutes: number;
    maxItemsPerFetch: number;
    metadata: JsonRecord;
  };
  config: JsonRecord;
} {
  if (requested.kind === 'page') {
    throw new Error('page sources are not supported until HTML extraction is available; provide a feed or discovery source');
  }
  if (requested.kind === 'feed') {
    if (!requested.url) throw new Error('feed source url is required');
    validatePublicHttpsUrl(requested.url);
    const source = {
      name: requested.label,
      sourceType: 'rss' as const,
      url: requested.url,
      intervalMinutes: feed.everyMinutes,
      maxItemsPerFetch: perSourceItemBudget,
      metadata: { sourceFeedPurpose: feed.purpose },
    };
    if (policy.agentManaged) validateAgentSourcePolicy(source, policy);
    return { source, config: { url: requested.url, label: requested.label } };
  }

  const queries = boundedStrings(requested.queries, 'discovery queries', 10);
  if (queries.length === 0) throw new Error('discovery source queries must contain at least one query');
  const includeDomains = boundedDomains(requested.includeDomains);
  const excludeDomains = boundedDomains(requested.excludeDomains);
  const metadata: JsonRecord = {
    mode: 'discovery',
    provider: 'tavily',
    topic: 'news',
    search_depth: 'advanced',
    queries,
    include_domains: includeDomains,
    exclude_domains: excludeDomains,
    max_results_per_query: Math.min(10, perSourceItemBudget),
    sourceFeedPurpose: feed.purpose,
  };
  const source = {
    name: requested.label,
    sourceType: 'web' as const,
    url: 'https://api.tavily.com/search',
    intervalMinutes: feed.everyMinutes,
    maxItemsPerFetch: perSourceItemBudget,
    metadata,
  };
  validateDiscoverySourceConfiguration({
    id: 'pending', tenantId: feed.tenantId, enabled: true, reliability: 0.7,
    timeoutSeconds: 20, failureCount: 0, ...source,
  });
  if (policy.agentManaged) validateAgentSourcePolicy(source, policy);
  return { source, config: { label: requested.label, queries, includeDomains, excludeDomains, selectedProvider: 'tavily' } };
}

function sameMembers(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function boundedStrings(value: string[] | undefined, field: string, maximum: number): string[] {
  if (!value) return [];
  const strings = value.map((item) => item.trim()).filter(Boolean);
  if (strings.length > maximum || strings.some((item) => item.length > 300)) {
    throw new Error(`${field} may contain at most ${maximum} values of 300 characters each`);
  }
  return [...new Set(strings)];
}

function boundedDomains(value: string[] | undefined): string[] {
  const domains = boundedStrings(value, 'domain filters', 50).map((domain) => domain.toLowerCase());
  if (domains.some((domain) => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))) {
    throw new Error('domain filters must contain domain names without schemes or paths');
  }
  return domains;
}
