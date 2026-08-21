import { describe, expect, it } from 'vitest';
import { pragmaticLeadersMonthlyCostPlan, pragmaticLeadersSourcePlan } from '../src/bootstrap-pl-sources.js';
import { validateDiscoverySourceConfiguration } from '../src/ingest/discovery.js';

describe('Pragmatic Leaders provider plan', () => {
  it('keeps every paid provider behind a bounded, valid SourceFoundry source', () => {
    const webSources = pragmaticLeadersSourcePlan.filter((source) => source.sourceType === 'web');
    expect(webSources.map((source) => source.metadata.provider)).toEqual(['tavily', 'exa', 'serper']);
    for (const source of webSources) {
      expect(source.intervalMinutes).toBeGreaterThanOrEqual(720);
      expect(source.maxItemsPerFetch).toBeLessThanOrEqual(10);
      expect(source.metadata.max_results_per_query).toBeLessThanOrEqual(5);
      expect((source.metadata.queries as unknown[]).length).toBeLessThanOrEqual(2);
      expect(() => validateDiscoverySourceConfiguration({
        id: 'pending', tenantId: 'tenant', enabled: true, failureCount: 0, ...source,
      })).not.toThrow();
    }
  });

  it('stays below the approved monthly provider budget', () => {
    expect(pragmaticLeadersMonthlyCostPlan.estimatedMonthlyUsd).toBeLessThanOrEqual(5);
    expect(pragmaticLeadersMonthlyCostPlan.exa.monthlyCalls).toBe(120);
    expect(pragmaticLeadersMonthlyCostPlan.serper.monthlyCalls).toBe(120);
    expect(pragmaticLeadersMonthlyCostPlan.tavily.monthlyCredits).toBeLessThanOrEqual(1_000);
  });
});
