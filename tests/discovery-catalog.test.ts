import { describe, expect, it } from 'vitest';
import { discoveryCatalog, resolveDiscoveryPlan } from '../src/discovery-catalog.js';

describe('consumer discovery catalogue', () => {
  it('lists major surfaces, provider methods, and reusable bundles', () => {
    const catalog = discoveryCatalog();
    expect(catalog.surfaces.map((item) => item.id)).toEqual(expect.arrayContaining(['x','youtube','linkedin','reddit','github','web']));
    expect(catalog.methods.length).toBeGreaterThanOrEqual(25);
    expect(catalog.bundles.map((item) => item.id)).toEqual(expect.arrayContaining(['official-first','reliable-balanced','free-and-owned','broad-discovery']));
  });

  it('honors per-surface provider preferences', () => {
    const plan = resolveDiscoveryPlan({ surfaces:['x','youtube','linkedin'], bundle:'reliable-balanced', preferredProviders:{ x:['x'], youtube:['youtube'], linkedin:['web-index'] } });
    expect(plan.selections.map((item) => [item.surface,item.primary?.provider])).toEqual([['x','x'],['youtube','youtube'],['linkedin','web-index']]);
    expect(plan.requiredCredentials).toEqual(expect.arrayContaining(['X_API_BEARER_TOKEN','YOUTUBE_API_KEY','TAVILY_API_KEY']));
  });

  it('keeps the free bundle authoritative and exposes coverage gaps', () => {
    const plan = resolveDiscoveryPlan({ surfaces:['rss','x','instagram-tiktok'], bundle:'free-and-owned' });
    expect(plan.selections.find((item) => item.surface === 'rss')?.primary?.provider).toBe('rss');
    expect(plan.uncoveredSurfaces).toEqual(['x','instagram-tiktok']);
    expect(plan.selections.flatMap((item) => [item.primary,...item.fallbacks]).filter(Boolean).every((item) => item?.costTier === 'free' && item.authoritative)).toBe(true);
  });

  it('rejects unknown intent instead of silently changing it', () => {
    expect(() => resolveDiscoveryPlan({ bundle:'mystery' })).toThrow('Unknown discovery bundle');
    expect(() => resolveDiscoveryPlan({ surfaces:['unknown' as 'x'] })).toThrow('Unknown discovery surface');
    expect(() => resolveDiscoveryPlan({ maxCostTier:'mystery' as 'free' })).toThrow('Unknown cost tier');
  });
});
