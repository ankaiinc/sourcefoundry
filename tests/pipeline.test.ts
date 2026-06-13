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
});
