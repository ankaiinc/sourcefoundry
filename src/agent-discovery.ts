import { SOURCEFOUNDRY_SCHEMA_VERSION } from './public-contract.js';
import type { SourceFoundryConfig } from './config.js';

export const SOURCEFOUNDRY_AGENT_GUIDE_PATH = '/agent.md';
export const SOURCEFOUNDRY_OPENAPI_PATH = '/openapi.json';
export const SOURCEFOUNDRY_DISCOVERY_PATH = '/.well-known/sourcefoundry.json';

export function agentServiceDescriptor(config: Pick<SourceFoundryConfig, 'publicBaseUrl' | 'releaseSha' | 'selfService'>): Record<string, unknown> {
  return {
    schemaVersion: SOURCEFOUNDRY_SCHEMA_VERSION,
    release: config.releaseSha,
    service: 'sourcefoundry',
    purpose: 'Configure provider-neutral sources and retrieve normalized evidence for agents and applications.',
    baseUrl: config.publicBaseUrl,
    discovery: {
      openapi: absoluteUrl(config.publicBaseUrl, SOURCEFOUNDRY_OPENAPI_PATH),
      agentGuide: absoluteUrl(config.publicBaseUrl, SOURCEFOUNDRY_AGENT_GUIDE_PATH),
      capabilities: `${config.publicBaseUrl}/v1/meta`,
    },
    authentication: {
      type: 'http-bearer',
      environmentVariable: 'SOURCEFOUNDRY_API_TOKEN',
      header: 'Authorization: Bearer $SOURCEFOUNDRY_API_TOKEN',
      note: 'Use a token supplied through the agent runtime secret store. Never put it in source configuration or prompts.',
    },
    workflow: [
      'Read /v1/meta or the OpenAPI document.',
      'Create an autonomous workspace and one-time tenant-scoped credential with POST /v1/agent-enrollments.',
      'Upsert each source with POST /v1/sources.',
      'Enqueue a fetch with POST /v1/ingest/source and let the worker process it.',
      'Read normalized evidence with GET /v1/signals.',
    ],
    guardrails: [
      'Source upserts are idempotent by tenant and source URL.',
      'Active source-fetch jobs are deduplicated by tenant and source.',
      'Provider API keys, cookies, and session tokens are managed by SourceFoundry and must never be sent in an API request.',
      'Run-once jobs may trigger provider usage; use only when the caller explicitly requests immediate execution.',
      `Autonomous workspaces are limited to ${config.selfService.maxSources} sources, a ${config.selfService.minIntervalMinutes}-minute minimum interval, and ${config.selfService.maxItemsPerFetch} items per fetch.`,
    ],
  };
}

export function openApiDocument(config: Pick<SourceFoundryConfig, 'publicBaseUrl' | 'releaseSha' | 'selfService'>): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'SourceFoundry API',
      version: `1 (${config.releaseSha})`,
      description: 'Provider-neutral source configuration and normalized evidence retrieval for agents.',
    },
    servers: [{ url: config.publicBaseUrl, description: 'Canonical SourceFoundry service' }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/health': { get: operation('Process liveness', 'Returns public service identity and release.', { security: [] }) },
      '/ready': { get: operation('Service readiness', 'Returns readiness after a database connectivity check.', { security: [] }) },
      '/v1/meta': { get: operation('Discover agent capabilities', 'Returns the supported agent workflow and authentication boundary.', { security: [] }) },
      '/v1/agent-enrollments': {
        post: operation('Create an autonomous workspace', 'Creates a tenant-scoped credential and returns its secret exactly once. No authentication is required.', {
          security: [],
          requestBody: jsonBody({
            type: 'object', required: ['slug', 'name'], properties: {
              slug: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$', example: 'acme-research' },
              name: { type: 'string', example: 'Acme Research' },
              agentLabel: { type: 'string', example: 'research-agent' },
            },
          }),
          responses: {
            '201': { description: 'Workspace and one-time agent credential created.' },
            '400': { '$ref': '#/components/responses/Error' },
            '403': { '$ref': '#/components/responses/Error' },
            '409': { '$ref': '#/components/responses/Error' },
            '429': { '$ref': '#/components/responses/Error' },
            '500': { '$ref': '#/components/responses/Error' },
          },
        }),
      },
      '/v1/tenants': {
        post: operation('Upsert a tenant', 'Safe to repeat for the same slug.', {
          requestBody: jsonBody({
            type: 'object', required: ['slug', 'name'], properties: {
              slug: { type: 'string', example: 'acme-research' },
              name: { type: 'string', example: 'Acme Research' },
              config: { type: 'object', additionalProperties: true },
            },
          }),
        }),
      },
      '/v1/sources': {
        get: operation('List a tenant’s sources', 'Provide exactly one tenant or tenantId query parameter.', {
          parameters: [tenantParameter(), tenantIdParameter()],
        }),
        post: operation('Upsert a source', 'Safe to repeat for the same tenant and canonical source URL. Configure provider intent in metadata; never provide provider credentials.', {
          requestBody: jsonBody({
            type: 'object', required: ['tenantId', 'name', 'sourceType', 'url'], properties: {
              tenantId: { type: 'string', format: 'uuid' },
              name: { type: 'string', example: 'AI policy discovery' },
              sourceType: { type: 'string', enum: ['rss', 'atom', 'web'] },
              url: { type: 'string', format: 'uri', example: 'https://api.tavily.com/search' },
              reliability: { type: 'number', minimum: 0, maximum: 1, default: 0.7 },
              intervalMinutes: { type: 'integer', minimum: 1, maximum: 10080, default: 60 },
              maxItemsPerFetch: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
              timeoutSeconds: { type: 'integer', minimum: 1, maximum: 300, default: 20 },
              metadata: {
                type: 'object',
                description: 'Provider-neutral source policy, such as mode, provider, queries, and domain filters. Do not include secrets.',
                additionalProperties: true,
              },
            },
          }),
        }),
      },
      '/v1/sources/{sourceId}': {
        get: operation('Get one source', 'Returns stored source configuration and health counters.', {
          parameters: [{ name: 'sourceId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        }),
      },
      '/v1/ingest/source': {
        post: operation('Enqueue a source fetch', 'Returns an existing active job rather than creating duplicate work.', {
          requestBody: jsonBody({
            type: 'object', required: ['tenantId', 'sourceId'], properties: {
              tenantId: { type: 'string', format: 'uuid' },
              sourceId: { type: 'string', format: 'uuid' },
              priority: { type: 'integer', minimum: -100, maximum: 100, default: 0 },
            },
          }),
        }),
      },
      '/v1/jobs/{jobId}/run-once': {
        post: operation('Run one queued job now', 'This may trigger a provider request. Use only with an explicit request for immediate execution.', {
          parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        }),
      },
      '/v1/signals': {
        get: operation('Read normalized evidence', 'Returns the versioned, provider-neutral signal contract.', {
          parameters: [tenantParameter(), tenantIdParameter(), {
            name: 'statuses', in: 'query', schema: { type: 'string', example: 'published,approved' },
          }, {
            name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          }],
        }),
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'API token' } },
      responses: {
        Unauthorized: { description: 'A valid SourceFoundry API token is required.' },
        Error: { description: 'Versioned error response with code and retryable flag.' },
      },
    },
  };
}

export function agentGuide(config: Pick<SourceFoundryConfig, 'publicBaseUrl' | 'selfService'>): string {
  return `# SourceFoundry agent guide

SourceFoundry turns RSS, Atom, web discovery, and approved provider searches into one normalized evidence contract. It is a source-management utility, not a reader-facing news product.

## Connect

- Base URL: ${config.publicBaseUrl}
- OpenAPI: ${absoluteUrl(config.publicBaseUrl, SOURCEFOUNDRY_OPENAPI_PATH)}
- Capability discovery: ${config.publicBaseUrl}/v1/meta
- Create a workspace: \`POST /v1/agent-enrollments\` with a unique \`slug\`, \`name\`, and optional \`agentLabel\`. The returned token is shown once; store it as \`SOURCEFOUNDRY_API_TOKEN\`.
- Authentication: send \`Authorization: Bearer $SOURCEFOUNDRY_API_TOKEN\` from the agent runtime secret store.

## Configure and use

1. Read \`/v1/meta\` to confirm the service contract.
2. Create an autonomous workspace with \`POST /v1/agent-enrollments\`; keep the returned \`tenant.id\` and token.
3. Create or update sources with \`POST /v1/sources\`. Repeating the same tenant and URL updates the source rather than duplicating it.
4. Enqueue a fetch with \`POST /v1/ingest/source\`. If an active job already exists, reuse its job ID.
5. Retrieve normalized evidence with \`GET /v1/signals?tenant=<slug>\`.

## First useful source

If the caller gives you a public RSS or Atom feed, create it directly. Do not
invent a publisher URL or a topic source that the caller did not request.

\`POST /v1/sources\`

\`\`\`json
{
  "tenantId": "$SOURCEFOUNDRY_TENANT_ID",
  "name": "Caller-provided policy feed",
  "sourceType": "rss",
  "url": "https://publisher.example/feed.xml",
  "intervalMinutes": ${config.selfService.minIntervalMinutes},
  "maxItemsPerFetch": ${config.selfService.maxItemsPerFetch}
}
\`\`\`

Save the returned \`source.id\`, then enqueue it with \`POST /v1/ingest/source\`:

\`\`\`json
{
  "tenantId": "$SOURCEFOUNDRY_TENANT_ID",
  "sourceId": "<source.id returned above>"
}
\`\`\`

For hosted search lanes, use only a provider and endpoint explicitly allowed by
the current source policy. Do not send a provider key. If no approved lane is
available, return that limitation to the caller instead of silently selecting a
provider or substituting an untrusted source.

## Safety rules

- Treat provider credentials, cookies, and session tokens as hosted infrastructure. Never include them in a source request, source URL, or prompt.
- Configure only the tenant and sources the caller asked for.
- Autonomous workspaces can configure at most ${config.selfService.maxSources} sources, with at least ${config.selfService.minIntervalMinutes} minutes between fetches and at most ${config.selfService.maxItemsPerFetch} items per fetch.
- Enqueue work; autonomous credentials cannot call \`run-once\`, because direct execution can make an unbounded provider request.
- Use the returned \`schemaVersion\`, \`release\`, error code, and \`retryable\` flag to make decisions. Do not silently treat an error as an empty feed.
`;
}

function operation(summary: string, description: string, options: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary,
    description,
    responses: {
      '200': { description: 'Successful response' },
      '202': { description: 'Accepted for processing' },
      '400': { '$ref': '#/components/responses/Error' },
      '401': { '$ref': '#/components/responses/Unauthorized' },
      '500': { '$ref': '#/components/responses/Error' },
    },
    ...options,
  };
}

function jsonBody(schema: Record<string, unknown>): Record<string, unknown> {
  return { required: true, content: { 'application/json': { schema } } };
}

function tenantParameter(): Record<string, unknown> {
  return { name: 'tenant', in: 'query', schema: { type: 'string', example: 'acme-research' } };
}

function tenantIdParameter(): Record<string, unknown> {
  return { name: 'tenantId', in: 'query', schema: { type: 'string', format: 'uuid' } };
}

function absoluteUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl}/`).toString();
}
