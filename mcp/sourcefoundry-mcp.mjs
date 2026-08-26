#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildSourceFeed, DEFAULT_SOURCEFOUNDRY_BASE, readSourceFeed } from './sourcefoundry-client.mjs';

const API_TOKEN = process.env.SOURCEFOUNDRY_API_TOKEN;
const BASE = (process.env.SOURCEFOUNDRY_BASE || DEFAULT_SOURCEFOUNDRY_BASE).replace(/\/$/, '');
const server = new Server({ name: 'sourcefoundry', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'build_source_feed',
      description: 'Create or update a recurring source feed. SourceFoundry checks the sources; the consuming agent decides what to use or publish.',
      inputSchema: {
        type: 'object',
        properties: {
          tenant_id: { type: 'string', description: 'Required only when using an operator credential; autonomous credentials infer their workspace.' },
          idempotency_key: { type: 'string', description: 'Optional stable key. When omitted, the source-feed description determines the key.' },
          name: { type: 'string' },
          purpose: { type: 'string', description: 'What the source feed should track, without asking SourceFoundry to write the final answer.' },
          sources: {
            type: 'array', minItems: 1, items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['feed', 'discovery'] },
                label: { type: 'string' },
                url: { type: 'string', description: 'Required for feed sources.' },
                provider: { type: 'string', enum: ['tavily', 'exa', 'serper'], description: 'Optional provider for discovery: tavily, exa, or serper.' },
                required: { type: 'boolean' },
                queries: { type: 'array', items: { type: 'string' }, description: 'Required for discovery sources.' },
                includeDomains: { type: 'array', items: { type: 'string' } },
                excludeDomains: { type: 'array', items: { type: 'string' } },
              },
              required: ['kind', 'label'],
            },
          },
          cadence: { type: 'object', properties: { everyMinutes: { type: 'integer' } }, required: ['everyMinutes'] },
          limits: { type: 'object', properties: { maxItemsPerRun: { type: 'integer' }, maxCandidatesPerRun: { type: 'integer' } } },
          run_now: { type: 'boolean', default: true },
        },
        required: ['name', 'purpose', 'sources', 'cadence'],
      },
    },
    {
      name: 'read_source_feed',
      description: 'Read new source items from a SourceFoundry feed, optionally with source and run health.',
      inputSchema: {
        type: 'object',
        properties: {
          source_feed_id: { type: 'string' },
          since: { type: 'string', description: 'ISO timestamp for incremental sync.' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          statuses: { type: 'array', items: { type: 'string' } },
          include_health: { type: 'boolean', default: false },
        },
        required: ['source_feed_id'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments || {};
  try {
    const result = request.params.name === 'build_source_feed'
      ? await buildSourceFeed({
          sourceFeed: {
            ...(args.tenant_id ? { tenantId: args.tenant_id } : {}),
            name: args.name, purpose: args.purpose, sources: args.sources, cadence: args.cadence,
            ...(args.limits ? { limits: args.limits } : {}),
          },
          idempotencyKey: args.idempotency_key,
          runNow: args.run_now !== false,
          apiToken: API_TOKEN,
          base: BASE,
        })
      : request.params.name === 'read_source_feed'
        ? await readSourceFeed({
            sourceFeedId: args.source_feed_id, since: args.since, limit: args.limit,
            statuses: args.statuses, includeHealth: args.include_health === true,
            apiToken: API_TOKEN, base: BASE,
          })
        : null;
    if (!result) throw new Error(`Unknown tool: ${request.params.name}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `SourceFoundry error: ${error?.message || error}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
