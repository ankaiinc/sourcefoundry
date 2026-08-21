import { describe, expect, it } from 'vitest';
import { MemorySignalRepository } from '../src/testing/memory-repository.js';

describe('MemorySignalRepository', () => {
  it('lists only the sources belonging to the requested tenant', async () => {
    const repo = new MemorySignalRepository();
    const alpha = await repo.upsertTenant({ slug: 'alpha', name: 'Alpha' });
    const beta = await repo.upsertTenant({ slug: 'beta', name: 'Beta' });
    const alphaSource = await repo.createSource({ tenantId: alpha.id, name: 'Alpha source', sourceType: 'web', url: 'https://example.com/alpha' });
    await repo.createSource({ tenantId: beta.id, name: 'Beta source', sourceType: 'web', url: 'https://example.com/beta' });

    expect(await repo.listSources({ tenantSlug: 'alpha' })).toEqual([alphaSource]);
    expect(await repo.listSources({ tenantId: beta.id })).toHaveLength(1);
    expect(await repo.listSources({ tenantSlug: 'missing' })).toEqual([]);
  });

  it('reuses one active fetch job and permits a new job after completion', async () => {
    const repo = new MemorySignalRepository();
    const tenant = await repo.upsertTenant({ slug: 'pl', name: 'Pragmatic Leaders' });
    const source = await repo.createSource({
      tenantId: tenant.id,
      name: 'A',
      sourceType: 'rss',
      url: 'https://example.com/a.xml',
    });

    const first = await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: source.id });
    const duplicate = await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: source.id });

    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ jobId: first.jobId, created: false });
    expect(repo.jobs.size).toBe(1);

    const claimed = await repo.claimNextJob({ jobTypes: ['fetch_source'], maxAttempts: 5 });
    expect(claimed?.id).toBe(first.jobId);
    await repo.markJobCompleted(first.jobId, {});

    const next = await repo.enqueueSourceFetch({ tenantId: tenant.id, sourceId: source.id });
    expect(next.created).toBe(true);
    expect(next.jobId).not.toBe(first.jobId);
    expect(repo.jobs.size).toBe(2);
  });

  it('enforces tenant and service daily budgets after an agent job completes', async () => {
    const repo = new MemorySignalRepository();
    const alpha = await repo.upsertTenant({ slug: 'alpha', name: 'Alpha' });
    const beta = await repo.upsertTenant({ slug: 'beta', name: 'Beta' });
    const alphaSource = await repo.createSource({ tenantId: alpha.id, name: 'Alpha', sourceType: 'rss', url: 'https://example.com/alpha.xml', agentManaged: true });
    const betaSource = await repo.createSource({ tenantId: beta.id, name: 'Beta', sourceType: 'rss', url: 'https://example.com/beta.xml', agentManaged: true });
    const budget = { perTenantPerDay: 1, serviceTotalPerDay: 2 };

    const first = await repo.enqueueSourceFetch({ tenantId: alpha.id, sourceId: alphaSource.id, agentRunBudget: budget });
    await repo.markJobCompleted(first.jobId, {});
    expect(await repo.enqueueSourceFetch({ tenantId: alpha.id, sourceId: alphaSource.id, agentRunBudget: budget })).toMatchObject({ limited: 'tenant_daily' });

    const second = await repo.enqueueSourceFetch({ tenantId: beta.id, sourceId: betaSource.id, agentRunBudget: budget });
    await repo.markJobCompleted(second.jobId, {});
    const betaSecond = await repo.enqueueSourceFetch({ tenantId: beta.id, sourceId: betaSource.id, agentRunBudget: { perTenantPerDay: 2, serviceTotalPerDay: 2 } });
    expect(betaSecond).toMatchObject({ limited: 'service_daily' });
  });

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
