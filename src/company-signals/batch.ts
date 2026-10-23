import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { collectCompanySignals, type CollectOptions } from './collect.js';
import { normalizeDomain } from './resolve.js';
import { ATS_PROVIDERS, type AtsProvider, type CompanyInput, type CompanySignals } from './types.js';

/**
 * Batch runner. Input is CSV or JSON; output is JSON Lines, one record per
 * domain. Resumable: domains already present in the output are skipped, so a
 * killed run is restarted with the same command. Idempotent: a domain appears
 * once in the input set and once in the output.
 */

export const MAX_BATCH_COMPANIES = 2000;

export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

function companyFrom(record: Record<string, unknown>): CompanyInput | null {
  const name = String(record.name ?? record.company ?? '').trim();
  const domain = normalizeDomain(String(record.domain ?? record.website ?? record.url ?? ''));
  if (!name || !domain) return null;
  const provider = String(record.ats_provider ?? record.ats ?? '').trim().toLowerCase();
  const slug = String(record.ats_slug ?? '').trim();
  return {
    name,
    domain,
    ...(slug && (ATS_PROVIDERS as readonly string[]).includes(provider) ? { ats: { provider: provider as AtsProvider, slug } } : {}),
  };
}

/** Parses and de-duplicates by domain. Rows without a name or domain are reported, not guessed. */
export function parseCompanies(text: string, format: 'csv' | 'json'): { companies: CompanyInput[]; skipped: number } {
  const records: Array<Record<string, unknown>> = format === 'json'
    ? (JSON.parse(text) as unknown[]).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    : parseCsv(text);
  const byDomain = new Map<string, CompanyInput>();
  let skipped = 0;
  for (const record of records) {
    const company = companyFrom(record);
    if (!company) { skipped++; continue; }
    if (!byDomain.has(company.domain)) byDomain.set(company.domain, company);
  }
  const companies = [...byDomain.values()];
  if (companies.length > MAX_BATCH_COMPANIES) throw new Error(`batch has ${companies.length} companies; the limit is ${MAX_BATCH_COMPANIES}`);
  return { companies, skipped };
}

export function completedDomains(outPath: string): Set<string> {
  if (!existsSync(outPath)) return new Set();
  const done = new Set<string>();
  for (const line of readFileSync(outPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as Partial<CompanySignals>;
      if (record.schema === 'company_signals/v1' && record.domain) done.add(record.domain);
    } catch { /* a torn final line from a killed run; that domain is redone */ }
  }
  return done;
}

export interface BatchOptions extends CollectOptions {
  outPath: string;
  costLedgerPath?: string;
  concurrency?: number;
  /** Stop starting paid queries once this much estimated spend is reached. */
  paidBudgetUsd?: number;
  onRecord?: (record: CompanySignals, progress: { done: number; total: number }) => void;
}

export interface BatchSummary {
  total: number;
  skippedAlreadyDone: number;
  processed: number;
  strength: Record<CompanySignals['evidence_strength'], number>;
  estimatedPaidUsd: number;
}

export async function runBatch(companies: CompanyInput[], options: BatchOptions): Promise<BatchSummary> {
  if (companies.length > MAX_BATCH_COMPANIES) throw new Error(`batch has ${companies.length} companies; the limit is ${MAX_BATCH_COMPANIES}`);
  const done = completedDomains(options.outPath);
  // Close off a torn final line from a killed run so the next record starts on its own line.
  if (existsSync(options.outPath) && !readFileSync(options.outPath, 'utf8').endsWith('\n') && readFileSync(options.outPath, 'utf8').length) appendFileSync(options.outPath, '\n');
  const pending = companies.filter((c) => !done.has(normalizeDomain(c.domain)));
  const summary: BatchSummary = { total: companies.length, skippedAlreadyDone: companies.length - pending.length, processed: 0, strength: { strong: 0, medium: 0, weak: 0, none: 0 }, estimatedPaidUsd: 0 };
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const company = pending[next++]!;
      const budgetLeft = options.paidBudgetUsd === undefined || summary.estimatedPaidUsd < options.paidBudgetUsd;
      const { paid, ...rest } = options;
      const record = await collectCompanySignals(company, { ...rest, ...(paid && budgetLeft ? { paid } : {}) });
      // One write per line keeps a killed run's output parseable up to the last whole record.
      appendFileSync(options.outPath, `${JSON.stringify(record)}\n`);
      for (const cost of record.costs) {
        summary.estimatedPaidUsd += cost.estimated_usd;
        if (options.costLedgerPath) appendFileSync(options.costLedgerPath, `${JSON.stringify({ at: record.fetched_at, domain: record.domain, ...cost })}\n`);
      }
      summary.processed++;
      summary.strength[record.evidence_strength]++;
      options.onRecord?.(record, { done: summary.processed, total: pending.length });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, pending.length)) }, worker));
  summary.estimatedPaidUsd = Number(summary.estimatedPaidUsd.toFixed(4));
  return summary;
}
