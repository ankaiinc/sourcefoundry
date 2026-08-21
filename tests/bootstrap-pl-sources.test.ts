import { describe, expect, it } from 'vitest';
import { pragmaticLeadersMonthlyCostPlan, pragmaticLeadersSourcePlan } from '../src/bootstrap-pl-sources.js';
import { validateDiscoverySourceConfiguration } from '../src/ingest/discovery.js';

describe('Pragmatic Leaders provider plan', () => {
  it('keeps every discovery provider behind a bounded, valid SourceFoundry source', () => {
    const webSources = pragmaticLeadersSourcePlan.filter((source) => source.sourceType === 'web');
    expect(webSources.map((source) => source.metadata.provider)).toEqual([
      'github', 'tavily', 'exa', 'serper',
    ]);
    expect(new Set(webSources.map((source) => source.url)).size).toBe(webSources.length);
    for (const source of webSources) {
      const isFreeGitHub = source.metadata.provider === 'github';
      expect(source.intervalMinutes).toBeGreaterThanOrEqual(isFreeGitHub ? 360 : 720);
      const isExa = source.metadata.provider === 'exa';
      expect(source.maxItemsPerFetch).toBeLessThanOrEqual(isFreeGitHub ? 60 : isExa ? 20 : 10);
      expect(source.metadata.max_results_per_query).toBeLessThanOrEqual(isFreeGitHub ? 15 : 5);
      expect((source.metadata.queries as unknown[]).length).toBeLessThanOrEqual(isFreeGitHub || isExa ? 4 : 2);
      expect(() => validateDiscoverySourceConfiguration({
        id: 'pending', tenantId: 'tenant', enabled: true, failureCount: 0, ...source,
      })).not.toThrow();
    }
  });

  it('stays below the approved monthly provider budget', () => {
    expect(pragmaticLeadersMonthlyCostPlan.estimatedMonthlyUsd).toBeLessThanOrEqual(5);
    expect(pragmaticLeadersMonthlyCostPlan.exa.monthlyCalls).toBe(240);
    expect(pragmaticLeadersMonthlyCostPlan.github.estimatedUsd).toBe(0);
    expect(pragmaticLeadersMonthlyCostPlan.serper.monthlyCalls).toBe(120);
    expect(pragmaticLeadersMonthlyCostPlan.tavily.monthlyCredits).toBeLessThanOrEqual(1_000);
  });
});
