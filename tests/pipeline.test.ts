import { describe, expect, it } from 'vitest';
import { drainOnce } from '../src/pipeline.js';
import { MemorySignalRepository } from '../src/testing/memory-repository.js';

describe('signal pipeline', () => {
  it('dedupes source items and candidates across repeated fetch jobs', async () => {
    const repo = new MemorySignalRepository();
    const tenant = await repo.upsertTenant({ slug: 'pl', name: 'Pragmatic Leaders' });
    const source = await repo.createSource({
      tenantId: tenant.id,
      name: 'Feed',
      sourceType: 'rss',
      url: 'https://example.com/feed.xml',
      reliability: 0.9,
      metadata: { relevance_terms: ['product', 'leadership'] },
    });

    const feed = `<?xml version="1.0"?>
      <rss><channel><item>
        <title>Product leadership strategy</title>
        <link>https://example.com/post?utm_source=newsletter</link>
        <description>Leadership decision for a product team.</description>
        <pubDate>Sat, 13 Jun 2026 10:00:00 GMT</pubDate>
      </item></channel></rss>`;
    const fetchFn = async () =>
      new Response(feed, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml' },
      });

    await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: source.id });
    await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: source.id });

    const first = await drainOnce(repo, { maxAttempts: 5, fetchFn });
    const second = await drainOnce(repo, { maxAttempts: 5, fetchFn });

    expect(first.itemsProcessed).toBe(1);
    expect(second.itemsProcessed).toBe(0);
    expect(repo.items.size).toBe(1);
    expect(repo.candidates.size).toBe(1);
    expect(repo.attempts).toHaveLength(2);
  });

  it('normalizes targeted discovery results into source items and candidates', async () => {
    const repo = new MemorySignalRepository();
    const tenant = await repo.upsertTenant({ slug: 'pl', name: 'Pragmatic Leaders' });
    const source = await repo.createSource({
      tenantId: tenant.id,
      name: 'PL targeted discovery',
      sourceType: 'web',
      url: 'https://discovery.example.test/search',
      reliability: 0.9,
      maxItemsPerFetch: 5,
      metadata: {
        mode: 'discovery',
        provider: 'firecrawl',
        queries: ['AI product trust failure launch'],
        max_results_per_query: 3,
        relevance_terms: ['ai', 'product', 'trust', 'launch'],
      },
    });

    const requestedBodies: unknown[] = [];
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      requestedBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        success: true,
        data: [
          {
            title: 'AI product launch delayed after trust failure',
            url: 'https://example.com/ai-launch?utm_source=search',
            description: 'A product team delayed launch after customer trust concerns.',
            publishedAt: '2026-06-13T10:00:00Z',
          },
          {
            title: 'AI product launch delayed after trust failure',
            url: 'https://example.com/ai-launch?utm_medium=referral',
            description: 'Duplicate result with another tracking URL.',
            publishedAt: '2026-06-13T10:00:00Z',
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: source.id });
    const result = await drainOnce(repo, { maxAttempts: 5, fetchFn });

    expect(requestedBodies).toEqual([{
      query: 'AI product trust failure launch',
      limit: 3,
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: true,
      },
    }]);
    expect(result.itemsProcessed).toBe(1);
    expect(repo.items.size).toBe(1);
    expect(repo.candidates.size).toBe(1);
    expect([...repo.candidates.values()][0]).toMatchObject({
      title: 'AI product launch delayed after trust failure',
      status: 'published',
    });
    expect(repo.attempts[0]).toMatchObject({
      status: 'success',
      httpStatus: 200,
      itemsSeen: 1,
      itemsInserted: 1,
    });
  });

  it('supports Tavily-style targeted discovery requests', async () => {
    const previousKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = 'test-tavily-key';
    try {
      const repo = new MemorySignalRepository();
      const tenant = await repo.upsertTenant({ slug: 'pl', name: 'Pragmatic Leaders' });
      const source = await repo.createSource({
        tenantId: tenant.id,
        name: 'PL Tavily discovery',
        sourceType: 'web',
        url: 'https://api.tavily.com/search',
        reliability: 0.9,
        metadata: {
          mode: 'discovery',
          provider: 'tavily',
          queries: ['pricing backlash product decision'],
          max_results_per_query: 2,
          exclude_domains: ['aol.com', 'yahoo.com'],
          relevance_terms: ['pricing', 'product', 'decision'],
        },
      });

      const requestedBodies: unknown[] = [];
      const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
        requestedBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          results: [
            {
              title: 'Company changes pricing after product backlash',
              url: 'https://example.com/pricing-backlash',
              content: 'The product team changed pricing after customer trust concerns.',
              published_date: '2026-06-13',
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };

      await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: source.id });
      const result = await drainOnce(repo, { maxAttempts: 5, fetchFn });

      expect(requestedBodies).toEqual([{
        api_key: 'test-tavily-key',
        query: 'pricing backlash product decision',
        topic: 'news',
        search_depth: 'advanced',
        max_results: 2,
        include_answer: false,
        include_raw_content: true,
        exclude_domains: ['aol.com', 'yahoo.com'],
      }]);
      expect(result.itemsProcessed).toBe(1);
      expect(repo.items.size).toBe(1);
      expect(repo.candidates.size).toBe(1);
    } finally {
      if (previousKey === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = previousKey;
      }
    }
  });
});
