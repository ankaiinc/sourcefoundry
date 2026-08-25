import { describe, expect, it } from 'vitest';
import { buildSourceFeed, enqueueSourceFeedRun } from '../src/source-feeds.js';
import { MemorySignalRepository } from '../src/testing/memory-repository.js';

describe('source feeds', () => {
  it('idempotently groups exact and discovery sources over the existing pipeline', async () => {
    const repo = new MemorySignalRepository();
    const tenant = await repo.upsertTenant({ slug: 'pl', name: 'Pragmatic Leaders' });
    const request = {
      tenantId: tenant.id,
      idempotencyKey: 'product-stories-v1',
      name: 'Product story supply',
      purpose: 'Supply consequential external product stories.',
      sources: [
        { kind: 'feed' as const, label: 'Publisher', url: 'https://example.com/feed.xml', required: true },
        { kind: 'discovery' as const, label: 'Discovery', queries: ['product launch trust failure'], excludeDomains: ['msn.com'] },
      ],
      everyMinutes: 720,
      maxItemsPerRun: 10,
      maxCandidatesPerRun: 5,
    };
    const policy = { agentManaged: true, minIntervalMinutes: 720, maxItemsPerFetch: 10, maxSources: 3 };

    const first = await buildSourceFeed(repo, request, policy);
    const repeated = await buildSourceFeed(repo, { ...request, name: 'Updated product story supply' }, policy);

    expect(repeated.sourceFeed.id).toBe(first.sourceFeed.id);
    expect(repeated.sourceFeed.name).toBe('Updated product story supply');
    expect(repo.sources.size).toBe(2);
    expect(first.sourcePlan).toMatchObject({ sourceCount: 2, requiredSourceCount: 1, discoverySourceCount: 1 });
    const memberships = await repo.listSourceFeedSources(first.sourceFeed.id);
    expect(memberships[1]?.source.metadata).toMatchObject({ provider: 'tavily', queries: ['product launch trust failure'] });
  });

  it('creates one feed run that reuses active low-level source jobs', async () => {
    const repo = new MemorySignalRepository();
    const tenant = await repo.upsertTenant({ slug: 'pl', name: 'Pragmatic Leaders' });
    const built = await buildSourceFeed(repo, {
      tenantId: tenant.id,
      idempotencyKey: 'one-feed',
      name: 'One feed',
      purpose: 'Supply source candidates.',
      sources: [{ kind: 'feed', label: 'Publisher', url: 'https://example.com/feed.xml' }],
      everyMinutes: 60,
      maxItemsPerRun: 20,
      maxCandidatesPerRun: 10,
    }, { agentManaged: false, minIntervalMinutes: 5, maxItemsPerFetch: 100 });

    const first = await enqueueSourceFeedRun(repo, built.sourceFeed);
    const retry = await enqueueSourceFeedRun(repo, built.sourceFeed);

    expect(first.jobIds).toHaveLength(1);
    expect(retry.jobIds).toEqual(first.jobIds);
    expect(retry.reusedJobs).toBe(1);
    expect(repo.jobs.size).toBe(1);
  });

  it('rejects unsupported page extraction instead of pretending an HTML page is a feed', async () => {
    const repo = new MemorySignalRepository();
    const tenant = await repo.upsertTenant({ slug: 'pl', name: 'Pragmatic Leaders' });
    await expect(buildSourceFeed(repo, {
      tenantId: tenant.id,
      idempotencyKey: 'page',
      name: 'Page',
      purpose: 'Supply candidates.',
      sources: [{ kind: 'page', label: 'Page', url: 'https://example.com/article' }],
      everyMinutes: 60,
      maxItemsPerRun: 20,
      maxCandidatesPerRun: 10,
    }, { agentManaged: false, minIntervalMinutes: 5, maxItemsPerFetch: 100 }))
      .rejects.toThrow('page sources are not supported');
  });
});
