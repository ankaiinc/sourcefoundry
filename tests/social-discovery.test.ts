import { afterEach, describe, expect, it } from 'vitest';
import { fetchDiscoveryEntries } from '../src/ingest/discovery.js';
import type { SignalSource } from '../src/types.js';

const originalX = process.env.X_API_BEARER_TOKEN;
const originalYouTube = process.env.YOUTUBE_API_KEY;
const originalApify = process.env.APIFY_API_TOKEN;

afterEach(() => {
  if (originalX === undefined) delete process.env.X_API_BEARER_TOKEN;
  else process.env.X_API_BEARER_TOKEN = originalX;
  if (originalYouTube === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = originalYouTube;
  if (originalApify === undefined) delete process.env.APIFY_API_TOKEN;
  else process.env.APIFY_API_TOKEN = originalApify;
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

  it('enriches only concrete LinkedIn posts through a bounded token-safe Apify Actor call', async () => {
    process.env.APIFY_API_TOKEN = 'apify-test-token';
    const apifySource = source('apify', 'https://api.apify.com/v2/acts/reviewed~linkedin-posts/run-sync-get-dataset-items');
    apifySource.timeoutSeconds = 90;
    apifySource.maxItemsPerFetch = 5;
    apifySource.metadata = {
      mode: 'enrichment',
      provider: 'apify',
      max_results_per_query: 1,
      max_total_charge_usd: 0.25,
      max_run_charge_usd: 1.25,
      actor_timeout_seconds: 60,
      request_template: { postUrls: ['$query'], limitPerSource: '$limit' },
    };
    const postUrl = 'https://www.linkedin.com/posts/operator_activity-1234567890';
    const calls: Array<{ url: URL; headers: Headers; body: unknown }> = [];
    const result = await fetchDiscoveryEntries(
      apifySource,
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: new URL(input.toString()),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(JSON.stringify([{
          postUrl,
          text: 'A production field note on agent reliability and human approval.',
          postedAtISO: '2026-07-19T11:00:00Z',
          author: { name: 'Operator Founder', profileUrl: 'https://www.linkedin.com/in/operator-founder' },
          numComments: 12,
          commentsTruncated: true,
          comments: [{
            text: 'The missing piece is evaluation after a failed tool call.',
            author: { name: 'Product Leader', publicIdentifier: 'product-leader', profileUrl: 'https://www.linkedin.com/in/product-leader' },
            commentUrl: `${postUrl}?comment=1`,
            publishedAt: '2026-07-19T12:00:00Z',
          }],
          privateActorDebug: 'must-not-leave-the-provider-boundary',
        }]));
      }) as typeof fetch,
      new AbortController().signal,
      [postUrl],
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.searchParams.has('token')).toBe(false);
    expect(calls[0]?.url.searchParams.get('maxItems')).toBe('1');
    expect(calls[0]?.url.searchParams.get('maxTotalChargeUsd')).toBe('0.25');
    expect(calls[0]?.url.searchParams.get('timeout')).toBe('60');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer apify-test-token');
    expect(calls[0]?.body).toEqual({ postUrls: [postUrl], limitPerSource: 1 });
    expect(result.entries[0]).toMatchObject({
      url: postUrl,
      author: 'Operator Founder',
      publishedAt: '2026-07-19T11:00:00.000Z',
      conversation: {
        provider: 'apify',
        commentsReturned: 1,
        commentsTotal: 12,
        partial: true,
        participants: [{ displayName: 'Product Leader', handle: 'product-leader' }],
      },
      raw: { provider: 'apify', observationMode: 'enrichment', query: postUrl },
    });
    expect(JSON.stringify(result.entries[0]?.raw)).not.toContain('must-not-leave-the-provider-boundary');
  });

  it('normalizes the reviewed direct-post Actor comment and identity fields', async () => {
    process.env.APIFY_API_TOKEN = 'apify-test-token';
    const actorSource = source(
      'apify',
      'https://api.apify.com/v2/acts/pratikdani~linkedin-posts-scraper/run-sync-get-dataset-items',
    );
    actorSource.metadata = {
      mode: 'enrichment',
      provider: 'apify',
      max_results_per_query: 1,
      max_total_charge_usd: 0.25,
      max_run_charge_usd: 1.25,
      request_template: { url: '$query' },
    };
    const postUrl = 'https://www.linkedin.com/posts/operator_activity-1234567890';
    let requestBody: unknown;
    const result = await fetchDiscoveryEntries(
      actorSource,
      (async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify([{
          url: postUrl,
          title: 'Operator Founder on LinkedIn: Why agent reliability needs operating evidence',
          post_text: 'Why agent reliability needs operating evidence and human approval.',
          date_posted: '2026-07-19T11:00:00Z',
          num_comments: 2,
          top_visible_comments: [{
            comment: 'The hard part is measuring recovery after a failed tool call.',
            comment_date: '2026-07-19T12:00:00Z',
            user_name: 'Product Leader',
            user_id: 'product-leader',
            use_url: 'https://www.linkedin.com/in/product-leader',
          }],
        }]));
      }) as typeof fetch,
      new AbortController().signal,
      [postUrl],
    );

    expect(requestBody).toEqual({ url: postUrl });
    expect(result.entries[0]).toMatchObject({
      url: postUrl,
      author: 'Operator Founder',
      publishedAt: '2026-07-19T11:00:00.000Z',
      conversation: {
        provider: 'apify',
        commentsReturned: 1,
        commentsTotal: 2,
        partial: true,
        participants: [{
          displayName: 'Product Leader',
          handle: 'product-leader',
          profileUrl: 'https://www.linkedin.com/in/product-leader',
          excerpt: 'The hard part is measuring recovery after a failed tool call.',
          publishedAt: '2026-07-19T12:00:00.000Z',
        }],
      },
    });
  });

  it('rejects unsafe Apify destinations, session credentials, and over-budget batches before fetch', async () => {
    process.env.APIFY_API_TOKEN = 'apify-test-token';
    const postUrl = 'https://www.linkedin.com/feed/update/urn:li:activity:1234567890';
    const apifySource = source('apify', 'https://api.apify.com/v2/acts/reviewed~linkedin-posts/run-sync-get-dataset-items');
    apifySource.metadata = {
      mode: 'enrichment', provider: 'apify', max_results_per_query: 1,
      max_total_charge_usd: 0.25, max_run_charge_usd: 0.25,
      request_template: { postUrls: ['$query'] },
    };
    const neverFetch = (() => { throw new Error('fetch must not run'); }) as typeof fetch;

    await expect(fetchDiscoveryEntries(
      { ...apifySource, url: 'https://collector.invalid/run-sync-get-dataset-items' },
      neverFetch,
      new AbortController().signal,
      [postUrl],
    )).rejects.toThrow('token may be sent only');
    await expect(fetchDiscoveryEntries(
      { ...apifySource, metadata: { ...apifySource.metadata, request_template: { postUrls: ['$query'], liAt: 'forbidden' } } },
      neverFetch,
      new AbortController().signal,
      [postUrl],
    )).rejects.toThrow('must not contain cookies');
    await expect(fetchDiscoveryEntries(
      apifySource,
      neverFetch,
      new AbortController().signal,
      [postUrl, 'https://www.linkedin.com/posts/operator_activity-9876543210'],
    )).rejects.toThrow('charge caps exceed');
  });

  it('drops an Actor result that does not correspond to the shortlisted LinkedIn post', async () => {
    process.env.APIFY_API_TOKEN = 'apify-test-token';
    const requested = 'https://www.linkedin.com/posts/operator_activity-1234567890';
    const sourceConfig = source('apify', 'https://api.apify.com/v2/acts/reviewed~linkedin-posts/run-sync-get-dataset-items');
    sourceConfig.metadata = {
      mode: 'enrichment', provider: 'apify', max_results_per_query: 1,
      max_total_charge_usd: 0.25, max_run_charge_usd: 0.25,
      request_template: { postUrls: ['$query'] },
    };
    const result = await fetchDiscoveryEntries(
      sourceConfig,
      (async () => new Response(JSON.stringify([{
        postUrl: 'https://www.linkedin.com/posts/someone-else_activity-9876543210',
        text: 'A valid-looking but unrelated post must not be attached to the requested evidence.',
      }]))) as typeof fetch,
      new AbortController().signal,
      [requested],
    );
    expect(result.entries).toEqual([]);
  });
});
