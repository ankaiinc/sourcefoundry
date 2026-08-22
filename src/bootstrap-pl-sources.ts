import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { validateDiscoverySourceConfiguration } from './ingest/discovery.js';
import { PostgresSourceFoundryRepository } from './postgres-repository.js';
import type { JsonRecord, SignalSource } from './types.js';

const CONFIRMATION = 'configure-pragmatic-leaders-sources';
const RUNS_PER_MONTH = 60;

type SourceSpec = {
  name: string;
  sourceType: 'rss' | 'web';
  url: string;
  reliability: number;
  intervalMinutes: number;
  maxItemsPerFetch: number;
  timeoutSeconds: number;
  metadata: JsonRecord;
};

export const pragmaticLeadersSourcePlan: SourceSpec[] = [
  {
    name: 'OpenAI product news', sourceType: 'rss', url: 'https://openai.com/news/rss.xml',
    reliability: 0.9, intervalMinutes: 120, maxItemsPerFetch: 25, timeoutSeconds: 25,
    metadata: { relevance_terms: ['product', 'launch', 'agent', 'developer', 'enterprise', 'safety', 'policy', 'pricing'] },
  },
  {
    name: 'GitHub Changelog', sourceType: 'rss', url: 'https://github.blog/changelog/feed/',
    reliability: 0.88, intervalMinutes: 120, maxItemsPerFetch: 25, timeoutSeconds: 25,
    metadata: { relevance_terms: ['developer', 'platform', 'copilot', 'agent', 'security', 'enterprise', 'workflow', 'api'] },
  },
  {
    name: 'Cloudflare engineering and product', sourceType: 'rss', url: 'https://blog.cloudflare.com/rss/',
    reliability: 0.84, intervalMinutes: 120, maxItemsPerFetch: 20, timeoutSeconds: 25,
    metadata: { relevance_terms: ['product', 'platform', 'developer', 'ai', 'security', 'outage', 'pricing', 'infrastructure'] },
  },
  {
    name: 'The Pragmatic Engineer', sourceType: 'rss', url: 'https://blog.pragmaticengineer.com/feed',
    reliability: 0.86, intervalMinutes: 180, maxItemsPerFetch: 15, timeoutSeconds: 25,
    metadata: { relevance_terms: ['engineering', 'leadership', 'product', 'organization', 'developer', 'ai', 'career'] },
  },
  {
    name: 'Intercom product and AI', sourceType: 'rss', url: 'https://www.intercom.com/blog/feed/',
    reliability: 0.82, intervalMinutes: 180, maxItemsPerFetch: 15, timeoutSeconds: 25,
    metadata: { relevance_terms: ['product', 'customer', 'support', 'ai', 'agent', 'pricing', 'launch', 'operations'] },
  },
  {
    name: 'Hacker News Best', sourceType: 'rss', url: 'https://hnrss.org/best',
    reliability: 0.7, intervalMinutes: 60, maxItemsPerFetch: 30, timeoutSeconds: 20,
    metadata: { relevance_terms: ['product', 'leadership', 'engineering', 'startup', 'ai'] },
  },
  {
    name: 'Hacker News Newest', sourceType: 'rss', url: 'https://hnrss.org/newest',
    reliability: 0.68, intervalMinutes: 60, maxItemsPerFetch: 40, timeoutSeconds: 20,
    metadata: { relevance_terms: ['product', 'leadership', 'engineering', 'startup', 'ai', 'agent', 'developer'] },
  },
  {
    name: 'Show HN', sourceType: 'rss', url: 'https://hnrss.org/show',
    reliability: 0.72, intervalMinutes: 60, maxItemsPerFetch: 30, timeoutSeconds: 20,
    metadata: { relevance_terms: ['product', 'startup', 'ai', 'agent', 'developer', 'tool', 'open source'] },
  },
  {
    name: 'PL new repositories — GitHub', sourceType: 'web', url: 'https://api.github.com/search/repositories',
    reliability: 0.78, intervalMinutes: 360, maxItemsPerFetch: 60, timeoutSeconds: 20,
    metadata: {
      mode: 'discovery', provider: 'github', lookback_days: 21, sort: 'stars', order: 'desc',
      queries: [
        'AI agent in:name,description stars:>=10',
        'MCP in:name,description stars:>=5',
        'developer tool in:name,description stars:>=10',
        'product analytics in:name,description stars:>=5',
      ],
      max_results_per_query: 15,
      relevance_terms: ['ai', 'agent', 'mcp', 'product', 'developer', 'tool', 'analytics', 'platform', 'open source', 'evaluation', 'workflow'],
    },
  },
  {
    name: 'PL product judgment discovery — Tavily', sourceType: 'web', url: 'https://api.tavily.com/search',
    reliability: 0.82, intervalMinutes: 720, maxItemsPerFetch: 10, timeoutSeconds: 25,
    metadata: {
      mode: 'discovery', provider: 'tavily', topic: 'news', search_depth: 'basic',
      queries: ['AI product launch trust privacy failure customer impact', 'pricing packaging backlash product decision subscription'],
      max_results_per_query: 5,
      relevance_terms: ['ai', 'product', 'launch', 'pricing', 'trust', 'privacy', 'customer', 'subscription'],
    },
  },
  {
    name: 'PL product and agent discovery — Exa', sourceType: 'web', url: 'https://api.exa.ai/search',
    reliability: 0.86, intervalMinutes: 720, maxItemsPerFetch: 20, timeoutSeconds: 25,
    metadata: {
      mode: 'discovery', provider: 'exa', search_type: 'fast', category: 'news',
      queries: [
        'AI agent product reliability evaluation production incident',
        'product leadership judgment AI adoption organizational change',
        'new developer tool open source launch adoption product',
        'product pricing trust privacy launch decision customer backlash',
      ],
      max_results_per_query: 5, max_content_characters: 2_000,
      relevance_terms: ['ai', 'agent', 'product', 'reliability', 'evaluation', 'leadership', 'judgment', 'developer', 'tool', 'open source', 'launch', 'pricing', 'trust', 'privacy', 'customer'],
    },
  },
  {
    name: 'PL developer and governance discovery — Serper', sourceType: 'web', url: 'https://google.serper.dev/news',
    reliability: 0.78, intervalMinutes: 720, maxItemsPerFetch: 10, timeoutSeconds: 25,
    metadata: {
      mode: 'discovery', provider: 'serper', country: 'us', language: 'en', time_range: 'qdr:m',
      queries: ['AI coding developer tool adoption platform API product change', 'enterprise AI governance customer trust product decision'],
      max_results_per_query: 5,
      relevance_terms: ['ai', 'developer', 'platform', 'enterprise', 'governance', 'trust', 'product'],
    },
  },
];

export const pragmaticLeadersMonthlyCostPlan = {
  schemaVersion: 1 as const,
  assumptions: { runsPerMonth: RUNS_PER_MONTH, activeExaQueriesPerRun: 4, resultsPerQuery: 5 },
  tavily: { monthlyCalls: 120, monthlyCredits: 120, estimatedUsd: 0, note: 'inside the published 1,000-credit free tier' },
  exa: { monthlyCalls: 240, estimatedUsd: 2.88, note: '$0.007 search plus up to five $0.001 text results' },
  serper: { monthlyCalls: 120, estimatedUsd: 0.12, note: '$1 per 1,000-query starter rate' },
  github: { monthlyCalls: 240, estimatedUsd: 0, note: 'public repository search; no paid key required at this cadence' },
  freeRss: { sourceCount: 8, estimatedUsd: 0, note: 'public publisher feeds; no search-provider calls' },
  estimatedMonthlyUsd: 3,
  maximumApprovedMonthlyUsd: 5,
};

export async function configurePragmaticLeadersSources(options: { databaseUrl: string }): Promise<{
  tenantId: string;
  sources: Array<{ id: string; name: string; jobId: string; jobCreated: boolean }>;
}> {
  const repo = new PostgresSourceFoundryRepository(options.databaseUrl);
  try {
    const tenant = await repo.upsertTenant({
      slug: 'pragmatic-leaders', name: 'Pragmatic Leaders',
      config: { consumer: 'pragmaticleaders.io', contract: 'public-signals-v1' },
    });
    const sources = [];
    for (const spec of pragmaticLeadersSourcePlan) {
      if (spec.sourceType === 'web') validateDiscoverySpec(tenant.id, spec);
      const source = await repo.createSource({ tenantId: tenant.id, ...spec });
      const job = await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: source.id, priority: 20 });
      sources.push({ id: source.id, name: source.name, jobId: job.jobId, jobCreated: job.created });
    }
    return { tenantId: tenant.id, sources };
  } finally {
    await repo.close();
  }
}

function validateDiscoverySpec(tenantId: string, spec: SourceSpec): void {
  validateDiscoverySourceConfiguration({ id: 'pending', tenantId, enabled: true, failureCount: 0, ...spec } satisfies SignalSource);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  if (!apply) {
    console.log(JSON.stringify({
      mode: 'dry-run', mutationPerformed: false, tenant: 'pragmatic-leaders',
      sources: pragmaticLeadersSourcePlan, costPlan: pragmaticLeadersMonthlyCostPlan,
      applyCommand: `npm run bootstrap:pl -- --apply --confirm=${CONFIRMATION}`,
    }, null, 2));
    return;
  }
  if (!args.has(`--confirm=${CONFIRMATION}`)) {
    throw new Error(`Refusing to configure production sources without --confirm=${CONFIRMATION}`);
  }
  if (pragmaticLeadersMonthlyCostPlan.estimatedMonthlyUsd > pragmaticLeadersMonthlyCostPlan.maximumApprovedMonthlyUsd) {
    throw new Error('Projected provider cost exceeds the approved monthly maximum');
  }
  const result = await configurePragmaticLeadersSources({ databaseUrl: loadConfig().databaseUrl });
  console.log(JSON.stringify({ mode: 'applied', costPlan: pragmaticLeadersMonthlyCostPlan, ...result }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Pragmatic Leaders source configuration failed');
    process.exitCode = 1;
  });
}
