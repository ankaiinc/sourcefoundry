import { describe, expect, it } from 'vitest';
import { MemorySignalRepository } from '../src/testing/memory-repository.js';

describe('MemorySignalRepository', () => {
  it('claims each queued job once under concurrent claim calls', async () => {
    const repo = new MemorySignalRepository();
    const tenant = await repo.upsertTenant({ slug: 'pl', name: 'Pragmatic Leaders' });
    const sourceA = await repo.createSource({
      tenantId: tenant.id,
      name: 'A',
      sourceType: 'rss',
      url: 'https://example.com/a.xml',
    });
    const sourceB = await repo.createSource({
      tenantId: tenant.id,
      name: 'B',
      sourceType: 'rss',
      url: 'https://example.com/b.xml',
    });
    await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: sourceA.id });
    await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: sourceB.id });

    const claims = await Promise.all([
      repo.claimNextJob({ jobTypes: ['fetch_source'], maxAttempts: 5 }),
      repo.claimNextJob({ jobTypes: ['fetch_source'], maxAttempts: 5 }),
      repo.claimNextJob({ jobTypes: ['fetch_source'], maxAttempts: 5 }),
    ]);

    const claimedIds = claims.filter(Boolean).map((job) => job?.id);
    expect(claimedIds).toHaveLength(2);
    expect(new Set(claimedIds).size).toBe(2);
    expect(claims[2]).toBeNull();
  });
});
