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

function stringOption(name) {
  const prefix = `--${name}=`;
  const values = process.argv.filter((arg) => arg.startsWith(prefix)).map((arg) => arg.slice(prefix.length).trim());
  if (values.length > 1) throw new Error(`${name} may be provided only once`);
  return values[0] ?? '';
}

const xProvider = providerOption('x-provider', 'tavily');
const youtubeProvider = providerOption('youtube-provider', 'tavily');
const linkedinEnrichment = stringOption('linkedin-enrichment') || 'none';
if (linkedinEnrichment !== 'none' && linkedinEnrichment !== 'apify') {
  throw new Error('linkedin-enrichment must be none or apify');
}
const linkedinApifyActorId = stringOption('linkedin-apify-actor-id');
const linkedinApifyInputField = stringOption('linkedin-apify-input-field');
if (linkedinEnrichment === 'apify') {
  if (!/^[A-Za-z0-9._-]+~[A-Za-z0-9._-]+$/.test(linkedinApifyActorId)) {
    throw new Error('linkedin-apify-actor-id must be the reviewed owner~actor identifier');
  }
  if (!['postUrls', 'urls', 'startUrls'].includes(linkedinApifyInputField)) {
    throw new Error('linkedin-apify-input-field must be postUrls, urls, or startUrls');
  }
}
const officialProviderRequirements = [
  ...(xProvider === 'official' ? [{ platform: 'x', workerEnvironmentVariable: 'X_API_BEARER_TOKEN' }] : []),
  ...(youtubeProvider === 'official' ? [{ platform: 'youtube', workerEnvironmentVariable: 'YOUTUBE_API_KEY' }] : []),
];
const enrichmentProviderRequirements = linkedinEnrichment === 'apify'
  ? [{ platform: 'linkedin', provider: 'apify', workerEnvironmentVariable: 'APIFY_API_TOKEN' }]
  : [];
const providerArguments = [
  ...(linkedinEnrichment !== 'none' ? [
    `--linkedin-enrichment=${linkedinEnrichment}`,
    `--linkedin-apify-actor-id=${linkedinApifyActorId}`,
    `--linkedin-apify-input-field=${linkedinApifyInputField}`,
  ] : []),
  ...(xProvider !== 'tavily' ? [`--x-provider=${xProvider}`] : []),
  ...(youtubeProvider !== 'tavily' ? [`--youtube-provider=${youtubeProvider}`] : []),
];

function apifyRequestTemplate(inputField) {
  if (inputField === 'startUrls') return { startUrls: [{ url: '$query' }] };
  return { [inputField]: ['$query'] };
}

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

const linkedinEnrichmentSource = linkedinEnrichment === 'apify' ? {
  name: 'Talvinder LinkedIn shortlisted-post enrichment',
  url: `https://api.apify.com/v2/acts/${linkedinApifyActorId}/run-sync-get-dataset-items`,
  reliability: 0.68,
  intervalMinutes: 360,
  maxItemsPerFetch: 5,
  timeoutSeconds: 90,
  metadata: {
    mode: 'enrichment', provider: 'apify', platform: 'linkedin',
    upstream_statuses: ['published', 'approved', 'ready_for_review'],
    upstream_min_score: 0.65,
    reenrich_after_hours: 24,
    max_results_per_query: 1,
    max_total_charge_usd: 0.25,
    max_run_charge_usd: 1.25,
    actor_timeout_seconds: 60,
    request_template: apifyRequestTemplate(linkedinApifyInputField),
    relevance_terms: ['ai', 'agent', 'product', 'founder', 'evidence', 'reliability', 'judgment', 'approval'],
  },
} : null;

const sourceSpecs = [linkedinSource, xSource, youtubeSource, ...(linkedinEnrichmentSource ? [linkedinEnrichmentSource] : [])];

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
      linkedinEnrichment,
      enrichmentProviderRequirements,
    },
    sources: sourceSpecs.map((source) => ({
      ...source,
      sourceType: 'web',
      intervalMinutes: source.intervalMinutes ?? 360,
      maxItemsPerFetch: source.maxItemsPerFetch ?? 24,
      timeoutSeconds: source.timeoutSeconds ?? 20,
    })),
    nextCommand: [
      'npm run bootstrap:attention -- --confirm=create-attention-sources',
      ...providerArguments,
      ...((officialProviderRequirements.length > 0 || enrichmentProviderRequirements.length > 0) ? ['--confirm-worker-provider-secrets-configured'] : []),
    ].join(' '),
  }, null, 2));
  process.exit(0);
}

if (!confirmed) {
  throw new Error('Creating and enqueueing production Attention sources requires --confirm=create-attention-sources; use --dry-run first');
}
if ((officialProviderRequirements.length > 0 || enrichmentProviderRequirements.length > 0) && !workerSecretsConfirmed) {
  throw new Error('Selected providers require --confirm-worker-provider-secrets-configured after their named worker secrets have been verified');
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
    intervalMinutes: spec.intervalMinutes ?? 360,
    maxItemsPerFetch: spec.maxItemsPerFetch ?? 24,
    timeoutSeconds: spec.timeoutSeconds ?? 20,
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
  providerPlan: { linkedin: 'tavily', linkedinEnrichment, x: xProvider, youtube: youtubeProvider },
  sources,
  enqueued,
  alreadyActive,
}, null, 2));
