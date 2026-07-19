const baseUrl = (process.env.SOURCEFOUNDRY_BASE_URL ?? '').replace(/\/+$/, '');
const apiToken = process.env.SOURCEFOUNDRY_API_TOKEN ?? '';
const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--confirm=create-attention-sources');
const workerSecretsConfirmed = process.argv.includes('--confirm-worker-provider-secrets-configured');

function providerOption(name, fallback) {
  const prefix = `--${name}=`;
  const values = process.argv.filter((arg) => arg.startsWith(prefix)).map((arg) => arg.slice(prefix.length));
  if (values.length > 1) throw new Error(`${name} may be provided only once`);
  const value = values[0] ?? fallback;
  if (value !== 'tavily' && value !== 'official') {
    throw new Error(`${name} must be tavily or official`);
  }
  return value;
}

const xProvider = providerOption('x-provider', 'tavily');
const youtubeProvider = providerOption('youtube-provider', 'tavily');
const officialProviderRequirements = [
  ...(xProvider === 'official' ? [{ platform: 'x', workerEnvironmentVariable: 'X_API_BEARER_TOKEN' }] : []),
  ...(youtubeProvider === 'official' ? [{ platform: 'youtube', workerEnvironmentVariable: 'YOUTUBE_API_KEY' }] : []),
];
const providerArguments = [
  ...(xProvider !== 'tavily' ? [`--x-provider=${xProvider}`] : []),
  ...(youtubeProvider !== 'tavily' ? [`--youtube-provider=${youtubeProvider}`] : []),
];

async function request(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}: ${String(payload.error ?? 'unknown error')}`);
  }
  return payload;
}

const linkedinSource = {
    name: 'Talvinder LinkedIn public conversations',
    url: 'https://api.tavily.com/search#linkedin-attention',
    reliability: 0.72,
    metadata: {
      mode: 'discovery', provider: 'tavily', topic: 'general', search_depth: 'advanced',
      queries: [
        'AI agents product reliability evidence founder product leader',
        'product judgment AI adoption organizational change',
        'human approval AI agent production failure',
      ],
      include_domains: ['linkedin.com'], max_results_per_query: 8,
      relevance_terms: ['ai', 'agent', 'product', 'founder', 'evidence', 'reliability', 'judgment', 'approval'],
    },
};

const xSource = xProvider === 'official' ? {
    name: 'Talvinder X official recent conversations',
    url: 'https://api.x.com/2/tweets/search/recent#talvinder-attention',
    reliability: 0.9,
    metadata: {
      mode: 'discovery', provider: 'x',
      queries: [
        '("AI agent" OR "AI agents") (product OR reliability OR evaluation) -is:retweet lang:en',
        '("product judgment" OR "product leadership") (evidence OR founder) -is:retweet lang:en',
        '("human approval" OR "human in the loop") (agent OR production) -is:retweet lang:en',
      ],
      max_results_per_query: 10,
      relevance_terms: ['ai', 'agent', 'product', 'founder', 'evidence', 'reliability', 'judgment'],
    },
  } : {
    name: 'Talvinder X public conversations',
    url: 'https://api.tavily.com/search#x-attention',
    reliability: 0.62,
    metadata: {
      mode: 'discovery', provider: 'tavily', topic: 'general', search_depth: 'advanced',
      queries: [
        'AI agent product reliability founder',
        'product judgment evidence AI startup',
        'human approval agent production failure',
      ],
      include_domains: ['x.com'], max_results_per_query: 8,
      relevance_terms: ['ai', 'agent', 'product', 'founder', 'evidence', 'reliability', 'judgment'],
    },
  };

const youtubeSource = youtubeProvider === 'official' ? {
    name: 'Talvinder YouTube official videos',
    url: 'https://www.googleapis.com/youtube/v3/search#talvinder-attention',
    reliability: 0.9,
    metadata: {
      mode: 'discovery', provider: 'youtube', order: 'date',
      queries: [
        'AI agents production reliability product leaders',
        'product judgment AI founder evidence',
        'agent evaluation human approval operating model',
      ],
      max_results_per_query: 10,
      relevance_terms: ['ai', 'agent', 'product', 'evidence', 'reliability', 'evaluation', 'approval'],
    },
  } : {
    name: 'Talvinder YouTube public conversations',
    url: 'https://api.tavily.com/search#youtube-attention',
    reliability: 0.7,
    metadata: {
      mode: 'discovery', provider: 'tavily', topic: 'general', search_depth: 'advanced',
      queries: [
        'AI agents production reliability product leaders',
        'product judgment AI founder evidence',
        'agent evaluation human approval operating model',
      ],
      include_domains: ['youtube.com'], max_results_per_query: 6,
      relevance_terms: ['ai', 'agent', 'product', 'evidence', 'reliability', 'evaluation', 'approval'],
    },
  };

const sourceSpecs = [linkedinSource, xSource, youtubeSource];

if (dryRun) {
  console.log(JSON.stringify({
    dryRun: true,
    mutationPerformed: false,
    tenant: {
      slug: 'talvinder-attention',
      name: 'Talvinder Attention OS',
      config: { consumer: 'content-os', contract: 'attention-opportunity-v1' },
    },
    providerPlan: {
      linkedin: 'tavily',
      x: xProvider,
      youtube: youtubeProvider,
      officialProviderRequirements,
    },
    sources: sourceSpecs.map((source) => ({
      ...source,
      sourceType: 'web',
      intervalMinutes: 360,
      maxItemsPerFetch: 24,
    })),
    nextCommand: [
      'npm run bootstrap:attention -- --confirm=create-attention-sources',
      ...providerArguments,
      ...(officialProviderRequirements.length > 0 ? ['--confirm-worker-provider-secrets-configured'] : []),
    ].join(' '),
  }, null, 2));
  process.exit(0);
}

if (!confirmed) {
  throw new Error('Creating and enqueueing production Attention sources requires --confirm=create-attention-sources; use --dry-run first');
}
if (officialProviderRequirements.length > 0 && !workerSecretsConfirmed) {
  throw new Error('Official providers require --confirm-worker-provider-secrets-configured after their named worker secrets have been verified');
}
if (!baseUrl || !apiToken) {
  throw new Error('SOURCEFOUNDRY_BASE_URL and SOURCEFOUNDRY_API_TOKEN are required');
}

const tenantResult = await request('/v1/tenants', {
  slug: 'talvinder-attention',
  name: 'Talvinder Attention OS',
  config: { consumer: 'content-os', contract: 'attention-opportunity-v1' },
});
const tenant = tenantResult.tenant;

const sources = [];
let enqueued = 0;
let alreadyActive = 0;
for (const spec of sourceSpecs) {
  const result = await request('/v1/sources', {
    tenantId: tenant.id,
    sourceType: 'web',
    intervalMinutes: 360,
    maxItemsPerFetch: 24,
    ...spec,
  });
  const source = result.source;
  sources.push({ id: source.id, name: source.name });
  const queued = await request('/v1/ingest/source', { tenantId: tenant.id, sourceId: source.id, priority: 20 });
  if (queued.created) enqueued++;
  else alreadyActive++;
}

console.log(JSON.stringify({
  tenantId: tenant.id,
  providerPlan: { linkedin: 'tavily', x: xProvider, youtube: youtubeProvider },
  sources,
  enqueued,
  alreadyActive,
}, null, 2));
