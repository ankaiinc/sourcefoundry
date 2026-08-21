import { describe, expect, it } from 'vitest';
import { agentGuide, agentServiceDescriptor, openApiDocument } from '../src/agent-discovery.js';

const config = {
  publicBaseUrl: 'https://sources.4agents.fyi',
  releaseSha: 'a'.repeat(40),
  selfService: {
    enabled: true,
    maxSources: 3,
    minIntervalMinutes: 720,
    maxItemsPerFetch: 10,
    maxEnrollmentsPerDay: 50,
    maxRunsPerDay: 24,
  },
};

describe('SourceFoundry agent discovery', () => {
  it('publishes a stable, canonical tool-discovery descriptor', () => {
    const descriptor = agentServiceDescriptor(config);
    expect(descriptor).toMatchObject({
      schemaVersion: 1,
      release: 'a'.repeat(40),
      baseUrl: 'https://sources.4agents.fyi',
      authentication: { type: 'http-bearer', environmentVariable: 'SOURCEFOUNDRY_API_TOKEN' },
      discovery: {
        openapi: 'https://sources.4agents.fyi/openapi.json',
        agentGuide: 'https://sources.4agents.fyi/agent.md',
        llms: 'https://sources.4agents.fyi/llms.txt',
      },
    });
  });

  it('describes the full safe agent workflow in OpenAPI', () => {
    const document = openApiDocument(config) as { openapi: string; servers: Array<{ url: string }>; paths: Record<string, unknown> };
    expect(document.openapi).toBe('3.1.0');
    expect(document.servers[0]?.url).toBe('https://sources.4agents.fyi');
    expect(document.paths).toHaveProperty('/v1/tenants');
    expect(document.paths).toHaveProperty('/v1/agent-enrollments');
    expect(document.paths).toHaveProperty('/llms.txt');
    expect(document.paths).toHaveProperty('/v1/sources');
    expect(document.paths).toHaveProperty('/v1/ingest/source');
    expect(document.paths).toHaveProperty('/v1/signals');
  });

  it('makes safe boundaries explicit for autonomous agents', () => {
    const guide = agentGuide(config);
    expect(guide).toContain('SOURCEFOUNDRY_API_TOKEN');
    expect(guide).toContain('/v1/agent-enrollments');
    expect(guide).toContain('First useful source');
    expect(guide).toContain('Do not\ninvent a publisher URL');
    expect(guide).toContain('Never include them in a source request');
    expect(guide).toContain('run-once');
  });
});
