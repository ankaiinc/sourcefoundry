import { afterEach, describe, expect, it } from 'vitest';
import { fetchDiscoveryEntries } from '../src/ingest/discovery.js';
import type { SignalSource } from '../src/types.js';

const originalX = process.env.X_API_BEARER_TOKEN;
const originalYouTube = process.env.YOUTUBE_API_KEY;

afterEach(() => {
  if (originalX === undefined) delete process.env.X_API_BEARER_TOKEN;
  else process.env.X_API_BEARER_TOKEN = originalX;
  if (originalYouTube === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = originalYouTube;
});

function source(provider: string, url: string): SignalSource {
  return {
    id: `source-${provider}`,
    tenantId: 'tenant-1',
    name: `${provider} discovery`,
    sourceType: 'web',
    url,
    enabled: true,
    reliability: 0.9,
    intervalMinutes: 60,
    maxItemsPerFetch: 10,
    timeoutSeconds: 10,
    failureCount: 0,
    metadata: { mode: 'discovery', provider, queries: ['AI product evidence'], max_results_per_query: 5 },
  };
}

describe('official social discovery adapters', () => {
  it('normalizes X recent-search posts with author identity and provenance', async () => {
    process.env.X_API_BEARER_TOKEN = 'x-test-token';
    const calls: Array<{ url: URL; headers: Headers }> = [];
    const result = await fetchDiscoveryEntries(
      source('x', 'https://api.x.com/2/tweets/search/recent'),
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: new URL(input.toString()), headers: new Headers(init?.headers) });
        return new Response(JSON.stringify({
          data: [{ id: '123', author_id: 'u1', text: 'AI product evidence needs a production failure boundary.', created_at: '2026-07-19T10:00:00Z' }],
          includes: { users: [{ id: 'u1', name: 'Product Founder', username: 'productfounder' }] },
        }), { status: 200 });
      }) as typeof fetch,
      new AbortController().signal,
    );
    expect(calls[0]?.url.searchParams.get('query')).toBe('AI product evidence');
    expect(calls[0]?.url.searchParams.get('max_results')).toBe('10');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer x-test-token');
    expect(result.entries[0]).toMatchObject({
      url: 'https://x.com/productfounder/status/123',
      author: 'Product Founder',
      publishedAt: '2026-07-19T10:00:00.000Z',
    });
    expect(result.entries[0]?.raw).toMatchObject({ provider: 'x', query: 'AI product evidence' });
  });

  it('normalizes official YouTube search results without placing the key in the URL', async () => {
    process.env.YOUTUBE_API_KEY = 'youtube-test-key';
    const calls: Array<{ url: URL; headers: Headers }> = [];
    const result = await fetchDiscoveryEntries(
      source('youtube', 'https://www.googleapis.com/youtube/v3/search'),
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: new URL(input.toString()), headers: new Headers(init?.headers) });
        return new Response(JSON.stringify({ items: [{
          id: { videoId: 'video-1' },
          snippet: { title: 'Testing AI agents in production', description: 'A field guide to evidence.', channelTitle: 'Operator TV', publishedAt: '2026-07-19T11:00:00Z' },
        }] }), { status: 200 });
      }) as typeof fetch,
      new AbortController().signal,
    );
    expect(calls[0]?.url.searchParams.get('q')).toBe('AI product evidence');
    expect(calls[0]?.url.searchParams.has('key')).toBe(false);
    expect(calls[0]?.headers.get('x-goog-api-key')).toBe('youtube-test-key');
    expect(result.entries[0]).toMatchObject({
      url: 'https://www.youtube.com/watch?v=video-1',
      author: 'Operator TV',
      publishedAt: '2026-07-19T11:00:00.000Z',
    });
  });

  it('normalizes official YouTube comment threads into attributable comment permalinks', async () => {
    process.env.YOUTUBE_API_KEY = 'youtube-test-key';
    const commentSource = source('youtube-comments', 'https://www.googleapis.com/youtube/v3/commentThreads');
    commentSource.metadata.queries = ['video-1'];
    const result = await fetchDiscoveryEntries(
      commentSource,
      (async (input: RequestInfo | URL) => {
        const url = new URL(input.toString());
        expect(url.searchParams.get('videoId')).toBe('video-1');
        return new Response(JSON.stringify({ items: [{
          id: 'thread-1',
          snippet: { topLevelComment: { id: 'comment-1', snippet: {
            videoId: 'video-1',
            textDisplay: 'How do you measure agent reliability?',
            authorDisplayName: 'Curious Operator',
            publishedAt: '2026-07-19T12:00:00Z',
          } } },
        }] }), { status: 200 });
      }) as typeof fetch,
      new AbortController().signal,
    );
    expect(result.entries[0]).toMatchObject({
      url: 'https://www.youtube.com/watch?v=video-1&lc=comment-1',
      author: 'Curious Operator',
      summary: 'How do you measure agent reliability?',
    });
  });
});
