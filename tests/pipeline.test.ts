import { describe, expect, it } from 'vitest';
import { drainOnce, scheduleDueSources } from '../src/pipeline.js';
import { MemorySignalRepository } from '../src/testing/memory-repository.js';

describe('signal pipeline', () => {
  it('does not grow the queue when the scheduler sees the same active source again', async () => {
    const repo = new MemorySignalRepository();
    const tenant = await repo.upsertTenant({ slug: 'pl', name: 'Pragmatic Leaders' });
    await repo.createSource({
      tenantId: tenant.id,
      name: 'Feed',
      sourceType: 'rss',
      url: 'https://example.com/feed.xml',
    });

    const first = await scheduleDueSources(repo, { maxDueSources: 10 });
    const second = await scheduleDueSources(repo, { maxDueSources: 10 });

    expect(first.detail).toEqual({ dueSources: 1, enqueued: 1, alreadyActive: 0 });
    expect(second.detail).toEqual({ dueSources: 1, enqueued: 0, alreadyActive: 1 });
    expect(repo.jobs.size).toBe(1);
  });

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
    const first = await drainOnce(repo, { maxAttempts: 5, fetchFn });

    await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: source.id });
    const second = await drainOnce(repo, { maxAttempts: 5, fetchFn });

    expect(first.itemsProcessed).toBe(1);
    expect(second.itemsProcessed).toBe(0);
    expect(repo.items.size).toBe(1);
    expect(repo.candidates.size).toBe(1);
    expect(repo.attempts).toHaveLength(2);
  });

  it('allows one contribution per source and caps a signal at three observations', async () => {
    const repo = new MemorySignalRepository();
    const tenant = await repo.upsertTenant({ slug: 'pl', name: 'Pragmatic Leaders' });
    const sources = await Promise.all([0.65, 0.75, 0.85, 0.95].map((reliability, index) => repo.createSource({
      tenantId: tenant.id,
      name: `Independent source ${index + 1}`,
      sourceType: 'web',
      url: `https://collector-${index + 1}.example.test/search`,
      reliability,
    })));

    const addCandidate = async (sourceIndex: number, itemIndex: number, score: number) => {
      const source = sources[sourceIndex]!;
      const { item } = await repo.upsertSourceItem({
        tenantId: tenant.id,
        sourceId: source.id,
        canonicalUrl: `https://publisher-${sourceIndex + 1}.example.test/story-${itemIndex}`,
        url: `https://publisher-${sourceIndex + 1}.example.test/story-${itemIndex}`,
        title: 'AI product launch delayed after trust failure',
        summary: `Independent observation ${sourceIndex + 1}.${itemIndex}`,
        author: `Reporter ${sourceIndex + 1}`,
        publishedAt: '2026-07-19T10:00:00.000Z',
        contentHash: `content-hash-${sourceIndex}-${itemIndex}`,
        rawPayload: {},
        relevanceScore: score,
        sourceReliability: source.reliability,
      });
      await repo.upsertCandidate({
        tenantId: tenant.id,
        sourceItemId: item.id,
        title: 'AI product launch delayed after trust failure',
        summary: `Independent observation ${sourceIndex + 1}.${itemIndex}`,
        url: item.url,
        score,
        tags: ['ai', 'product', 'trust'],
        status: 'published',
        metadata: {},
      });
    };

    await addCandidate(0, 1, 0.7);
    await addCandidate(0, 2, 0.8); // same source: can replace, never add another vote
    await addCandidate(1, 1, 0.75);
    await addCandidate(2, 1, 0.85);
    await addCandidate(3, 1, 0.9);

    const signals = await repo.listSignals({ tenantSlug: 'pl', statuses: ['published'], limit: 20 });

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      score: 0.9,
      aggregation: {
        observationCount: 3,
        sourceCount: 4,
        capped: true,
      },
    });
    expect(new Set(signals[0]!.observations.map((row) => row.source.id)).size).toBe(3);
    expect(signals[0]!.observations).toHaveLength(3);
    expect(signals[0]!.score).toBe(Math.max(...signals[0]!.observations.map((row) => row.score)));
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
      schemaVersion: 1,
      title: 'AI product launch delayed after trust failure',
      status: 'published',
      source: { id: source.id, provider: 'firecrawl', reliability: 0.9 },
      provenance: {
        canonicalUrl: 'https://example.com/ai-launch',
        query: 'AI product trust failure launch',
      },
      completeness: { title: true, summary: true, publishedAt: true },
      failureState: { state: 'healthy', consecutiveFailures: 0 },
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
