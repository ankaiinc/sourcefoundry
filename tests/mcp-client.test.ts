import { describe, expect, it, vi } from 'vitest';
import { buildSourceFeed, readSourceFeed } from '../mcp/sourcefoundry-client.mjs';

describe('SourceFoundry MCP API client', () => {
  it('uses a stable idempotency key and enqueues the first run', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(calls.length === 1
        ? { sourceFeed: { id: 'feed-id' }, sourcePlan: { sourceCount: 1 } }
        : { run: { id: 'run-id', status: 'queued' } }), { status: calls.length === 1 ? 200 : 202, headers: { 'content-type': 'application/json' } });
    });
    const sourceFeed = { name: 'Supply', purpose: 'Supply evidence', sources: [], cadence: { everyMinutes: 60 } };

    const result = await buildSourceFeed({ sourceFeed, apiToken: 'secret', base: 'https://sources.example', fetchImpl });

    expect(result.run).toMatchObject({ id: 'run-id' });
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: 'Bearer secret' });
    expect((calls[0]?.init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^mcp-[0-9a-f]{32}$/);
    expect(calls[1]?.url).toBe('https://sources.example/v1/source-feeds/feed-id/runs');
  });

  it('reads candidates and optional health from the same feed', async () => {
    const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith('/health') ? { health: { status: 'healthy' } } : { candidates: [{ id: 'candidate' }] },
    ), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await readSourceFeed({
      sourceFeedId: 'feed-id', since: '2026-08-25T00:00:00Z', includeHealth: true,
      apiToken: 'secret', base: 'https://sources.example', fetchImpl,
    });

    expect(result).toMatchObject({ candidates: [{ id: 'candidate' }], health: { status: 'healthy' } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
