import { describe, expect, it } from 'vitest';
import { drainJobOnce, drainOnce, scheduleDueSources } from '../src/pipeline.js';
import { aggregatePublicSignals } from '../src/signals.js';
import { MemorySignalRepository } from '../src/testing/memory-repository.js';
import type { PublicSignal } from '../src/types.js';

describe('signal pipeline', () => {
  it('keeps a fresh signal visible even when an older signal has a higher score', () => {
    const signal = (id: string, score: number, generatedAt: string): PublicSignal => ({
      schemaVersion: 1, id, tenantId: 'tenant-1', title: `Signal ${id} has a distinct title`,
      summary: 'A complete source summary.', url: `https://example.com/${id}`, status: 'published',
      score, tags: ['product'], generatedAt, publishedAt: generatedAt,
      source: { id: `source-${id}`, name: 'Example', type: 'web', provider: 'exa', reliability: 0.9 },
      provenance: { sourceItemId: `item-${id}`, canonicalUrl: `https://example.com/${id}`, fetchedAt: generatedAt, contentHash: id, author: null, query: null },
      freshness: { publishedAt: generatedAt, fetchedAt: generatedAt, ageSeconds: 0 },
      completeness: { title: true, summary: true, author: false, publishedAt: true },
      failureState: { state: 'healthy', consecutiveFailures: 0, lastSuccessAt: generatedAt, lastFailureAt: null },
      aggregation: { signalKey: '', observationCount: 1, sourceCount: 1, capped: false }, observations: [],
    });
    const visible = aggregatePublicSignals([
      signal('old-high', 0.99, '2026-07-30T00:00:00Z'),
      signal('new-lower', 0.72, '2026-08-21T00:00:00Z'),
    ], 1);

    expect(visible[0]?.id).toBe('new-lower');
  });
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

    expect(first.detail).toMatchObject({ dueSources: 1, enqueued: 1, alreadyActive: 0 });
    expect(second.detail).toMatchObject({ dueSources: 1, enqueued: 0, alreadyActive: 1 });
    expect(repo.jobs.size).toBe(1);
  });

  it('caps scheduled work across autonomous sources', async () => {
    const repo = new MemorySignalRepository();
    const tenant = await repo.upsertTenant({ slug: 'autonomous', name: 'Autonomous' });
    await repo.createSource({ tenantId: tenant.id, name: 'One', sourceType: 'rss', url: 'https://example.com/one.xml', agentManaged: true });
    await repo.createSource({ tenantId: tenant.id, name: 'Two', sourceType: 'rss', url: 'https://example.com/two.xml', agentManaged: true });

    const result = await scheduleDueSources(repo, { maxDueSources: 10, maxAgentManagedRunsPerDay: 1 });

    expect(result.detail).toMatchObject({ dueSources: 2, enqueued: 1, agentManagedSkipped: 1, agentManagedRuns: 1 });
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

  it('supplies every new item from an exact source feed without applying product-specific relevance terms', async () => {
    const repo = new MemorySignalRepository();
    const tenant = await repo.upsertTenant({ slug: 'botany', name: 'Botany tracker' });
    const source = await repo.createSource({
      tenantId: tenant.id,
      name: 'Botanical bulletin',
      sourceType: 'rss',
      url: 'https://example.com/botany.xml',
      reliability: 0.7,
      metadata: { sourceFeedPurpose: 'Track newly catalogued alpine plants.' },
    });
    const feed = `<?xml version="1.0"?><rss><channel><item>
      <title>Quarterly botanical index</title>
      <link>https://example.com/alpine-index</link>
      <description>Newly catalogued saxifrages from a high-altitude survey.</description>
      <pubDate>Sat, 13 Jun 2026 10:00:00 GMT</pubDate>
    </item><item>
      <title>AI product leadership strategy</title>
      <link>https://example.com/ai-product</link>
      <description>High-scoring terms still do not give Feedline publication authority.</description>
      <pubDate>Sat, 13 Jun 2026 10:00:00 GMT</pubDate>
    </item></channel></rss>`;

    await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: source.id });
    await drainOnce(repo, { maxAttempts: 5, fetchFn: async () => new Response(feed) });

    expect(repo.items.size).toBe(2);
    expect(repo.candidates.size).toBe(2);
    expect([...repo.candidates.values()].map((candidate) => candidate.status)).toEqual([
      'ready_for_review',
      'ready_for_review',
    ]);
    expect([...repo.candidates.values()].map((candidate) => candidate.title)).toContain('Quarterly botanical index');
  });

  it('runs one exact source job without consuming an unrelated backlog job', async () => {
    const repo = new MemorySignalRepository();
    const tenant = await repo.upsertTenant({ slug: 'attention', name: 'Attention OS' });
    const backlog = await repo.createSource({
      tenantId: tenant.id,
      name: 'Legacy backlog',
      sourceType: 'rss',
      url: 'https://example.com/backlog.xml',
    });
    const target = await repo.createSource({
      tenantId: tenant.id,
      name: 'Targeted attention source',
      sourceType: 'rss',
      url: 'https://example.com/target.xml',
      metadata: { relevance_terms: ['attention'] },
    });
    const backlogJob = await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: backlog.id, priority: 100 });
    const targetJob = await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: target.id, priority: 1 });

    const result = await drainJobOnce(repo, targetJob.jobId, {
      maxAttempts: 5,
      fetchFn: async () => new Response(`<?xml version="1.0"?><rss><channel><item>
        <title>Attention evidence</title><link>https://example.com/attention</link>
        <description>Relevant attention evidence.</description>
      </item></channel></rss>`),
    });

    expect(result).toMatchObject({ itemsProcessed: 1, detail: { sourceId: target.id } });
    expect(repo.jobs.get(targetJob.jobId)?.status).toBe('completed');
    expect(repo.jobs.get(backlogJob.jobId)?.status).toBe('queued');
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
        include_raw_content: false,
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

  it('shortlists existing LinkedIn signals for bounded enrichment and does not re-charge fresh evidence', async () => {
    const previousToken = process.env.APIFY_API_TOKEN;
    process.env.APIFY_API_TOKEN = 'apify-test-token';
    try {
      const repo = new MemorySignalRepository();
      const tenant = await repo.upsertTenant({ slug: 'attention', name: 'Attention OS' });
      const discovery = await repo.createSource({
        tenantId: tenant.id,
        name: 'LinkedIn search',
        sourceType: 'web',
        url: 'https://discovery.example.test/search',
        reliability: 0.9,
        metadata: {
          mode: 'discovery', provider: 'firecrawl', queries: ['AI agent reliability'],
          max_results_per_query: 1, relevance_terms: ['ai', 'agent', 'reliability'],
        },
      });
      const postUrl = 'https://www.linkedin.com/posts/operator_activity-1234567890';
      await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: discovery.id });
      await drainOnce(repo, {
        maxAttempts: 5,
        fetchFn: async () => new Response(JSON.stringify({ data: [{
          title: 'AI agent reliability in production',
          url: postUrl,
          description: 'A field note about AI agent reliability, product judgment, evidence, and human approval.',
          publishedAt: new Date().toISOString(),
        }] })),
      });

      const enrichment = await repo.createSource({
        tenantId: tenant.id,
        name: 'LinkedIn post enrichment',
        sourceType: 'web',
        url: 'https://api.apify.com/v2/acts/reviewed~linkedin-posts/run-sync-get-dataset-items',
        reliability: 0.68,
        maxItemsPerFetch: 5,
        timeoutSeconds: 90,
        metadata: {
          mode: 'enrichment', provider: 'apify', max_results_per_query: 1,
          upstream_statuses: ['published', 'ready_for_review'], upstream_min_score: 0.65,
          reenrich_after_hours: 24, max_total_charge_usd: 0.25, max_run_charge_usd: 1.25,
          actor_timeout_seconds: 60,
          request_template: { postUrls: ['$query'] },
          relevance_terms: ['ai', 'agent', 'reliability'],
        },
      });
      let enrichmentCalls = 0;
      const enrichFetch = async (_url: string | URL | Request, init?: RequestInit) => {
        enrichmentCalls++;
        expect(JSON.parse(String(init?.body))).toEqual({ postUrls: [postUrl] });
        return new Response(JSON.stringify([{
          postUrl,
          text: 'AI agent reliability in production requires explicit failure evidence and human approval.',
          authorFullName: 'Operator Founder',
          postedAtISO: new Date().toISOString(),
          numComments: 8,
          commentsTruncated: true,
          comments: [{ text: 'Measure the recovery path too.', authorName: 'Product Leader' }],
        }]));
      };
      await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: enrichment.id });
      const enriched = await drainOnce(repo, { maxAttempts: 5, fetchFn: enrichFetch });
      expect(enriched).toMatchObject({ itemsProcessed: 0, detail: { itemsSeen: 1, itemsInserted: 0 } });
      expect(repo.items.size).toBe(1);
      const signals = await repo.listSignals({ tenantId: tenant.id, statuses: ['published', 'ready_for_review'], limit: 10 });
      expect(signals[0]).toMatchObject({
        source: { provider: 'firecrawl' },
        provenance: { author: 'Operator Founder' },
        conversation: {
          provider: 'apify', commentsReturned: 1, commentsTotal: 8, partial: true,
          participants: [{ displayName: 'Product Leader', excerpt: 'Measure the recovery path too.' }],
        },
        completeness: { author: true, publishedAt: true },
      });

      await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: enrichment.id });
      const freshReplay = await drainOnce(repo, {
        maxAttempts: 5,
        fetchFn: (() => { throw new Error('fresh enrichment must not call the paid provider'); }) as typeof fetch,
      });
      expect(freshReplay).toMatchObject({ itemsProcessed: 0, detail: { itemsSeen: 0, itemsInserted: 0 } });
      expect(enrichmentCalls).toBe(1);
    } finally {
      if (previousToken === undefined) delete process.env.APIFY_API_TOKEN;
      else process.env.APIFY_API_TOKEN = previousToken;
    }
  });
});
