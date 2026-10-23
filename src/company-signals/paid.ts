import { fetchDiscoveryEntries } from '../ingest/discovery.js';
import type { SignalSource } from '../types.js';
import type { CompanyInput, CostEntry } from './types.js';

/**
 * Paid web search, used only after free sources come back weak or empty.
 * Hard cap of three queries per company; every call is costed in the record
 * and in the batch ledger. Prices are list prices per query (estimated, not
 * read from a bill) and should be revisited when a provider changes plans.
 */

export type PaidProvider = 'tavily' | 'brave' | 'serper' | 'exa';
export const MAX_PAID_QUERIES_PER_COMPANY = 3;

export const ESTIMATED_USD_PER_QUERY: Record<PaidProvider, number> = {
  tavily: 0.008,
  brave: 0.005,
  serper: 0.001,
  exa: 0.005,
};

const ENDPOINT: Record<PaidProvider, string> = {
  tavily: 'https://api.tavily.com/search',
  brave: 'https://api.search.brave.com/res/v1/web/search',
  serper: 'https://google.serper.dev/search',
  exa: 'https://api.exa.ai/search',
};

export interface PaidSearchOptions { provider: PaidProvider; maxQueries: number }

export function paidQueries(company: CompanyInput, max: number): string[] {
  const n = Math.max(0, Math.min(MAX_PAID_QUERIES_PER_COMPANY, Math.floor(max)));
  return [
    `"${company.name}" engineering blog cloud cost OR infrastructure`,
    `"${company.name}" kubernetes OR terraform OR aws site:${company.domain}`,
    `"${company.name}" founder cloud bill OR GPU costs`,
  ].slice(0, n);
}

export interface PaidResult {
  items: Array<{ title: string; url: string; date: string | null; text: string; provider: string }>;
  cost: CostEntry;
}

export async function paidSearch(company: CompanyInput, options: PaidSearchOptions, fetchFn: typeof fetch): Promise<PaidResult> {
  const queries = paidQueries(company, options.maxQueries);
  const cost: CostEntry = { provider: options.provider, queries: 0, estimated_usd: 0 };
  if (!queries.length) return { items: [], cost };
  const source: SignalSource = {
    id: `company-signals:${company.domain}`,
    tenantId: 'company-signals',
    name: company.name,
    sourceType: 'web',
    url: ENDPOINT[options.provider],
    enabled: true,
    reliability: 0.5,
    intervalMinutes: 0,
    maxItemsPerFetch: 15,
    timeoutSeconds: 20,
    failureCount: 0,
    metadata: { provider: options.provider, mode: 'discovery', queries, max_results_per_query: 5 },
  };
  // Billed per query attempted, whether or not it returned anything useful.
  cost.queries = queries.length;
  cost.estimated_usd = Number((queries.length * ESTIMATED_USD_PER_QUERY[options.provider]).toFixed(4));
  const result = await fetchDiscoveryEntries(source, fetchFn, AbortSignal.timeout(90_000));
  return {
    cost,
    items: result.entries.map((e) => ({ title: e.title, url: e.canonicalUrl || e.url, date: e.publishedAt, text: e.summary, provider: options.provider })),
  };
}
