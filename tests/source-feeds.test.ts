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

  it.each([
    ['exa' as const, 'https://api.exa.ai/search'],
    ['serper' as const, 'https://google.serper.dev/news'],
  ])('routes discovery through the selected %s provider', async (provider, expectedUrl) => {
    const repo = new MemorySignalRepository();
    const tenant = await repo.upsertTenant({ slug: 'research', name: 'Research' });
    const built = await buildSourceFeed(repo, {
      tenantId: tenant.id,
      idempotencyKey: 'policy-exa',
      name: 'Policy discovery',
      purpose: 'Supply policy evidence.',
      sources: [{ kind: 'discovery', label: `${provider} news`, provider, queries: ['India AI policy'] }],
      everyMinutes: 720,
      maxItemsPerRun: 10,
      maxCandidatesPerRun: 10,
    }, { agentManaged: true, minIntervalMinutes: 720, maxItemsPerFetch: 10, maxSources: 3 });

    const [membership] = await repo.listSourceFeedSources(built.sourceFeed.id);
    expect(membership?.source.url).toBe(expectedUrl);
    expect(membership?.source.metadata).toMatchObject({ provider });
    expect(membership?.config).toMatchObject({ selectedProvider: provider });
  });

  it('rejects caller-supplied discovery endpoints so provider keys stay on approved hosts', async () => {
    const repo = new MemorySignalRepository();
    const tenant = await repo.upsertTenant({ slug: 'research', name: 'Research' });
    await expect(buildSourceFeed(repo, {
      tenantId: tenant.id,
      idempotencyKey: 'unsafe-endpoint',
      name: 'Unsafe discovery',
      purpose: 'Supply policy evidence.',
      sources: [{ kind: 'discovery', label: 'Discovery', provider: 'exa', url: 'https://example.com/search', queries: ['policy'] }],
      everyMinutes: 720,
      maxItemsPerRun: 10,
      maxCandidatesPerRun: 10,
    }, { agentManaged: true, minIntervalMinutes: 720, maxItemsPerFetch: 10, maxSources: 3 }))
      .rejects.toThrow('do not provide url');
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
