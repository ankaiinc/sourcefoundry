import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseCompanies, runBatch } from './company-signals/batch.js';
import { MAX_PAID_QUERIES_PER_COMPANY, type PaidProvider } from './company-signals/paid.js';

/**
 * Usage:
 *   npm run company-signals -- --in companies.csv --out signals.jsonl
 *     [--limit 50] [--concurrency 4]
 *     [--paid-provider tavily --paid-queries 2 --paid-budget-usd 5]
 *
 * Free sources only unless --paid-provider is given. Re-running the same
 * command resumes: domains already in --out are skipped.
 */
const { values } = parseArgs({
  options: {
    in: { type: 'string' },
    out: { type: 'string' },
    limit: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    'paid-provider': { type: 'string' },
    'paid-queries': { type: 'string', default: '2' },
    'paid-budget-usd': { type: 'string', default: '5' },
  },
});

if (!values.in || !values.out) {
  console.error('company-signals: --in and --out are required');
  process.exit(2);
}

const format = values.in.endsWith('.json') ? 'json' : 'csv';
const parsed = parseCompanies(readFileSync(values.in, 'utf8'), format);
const companies = values.limit ? parsed.companies.slice(0, Number(values.limit)) : parsed.companies;
const provider = values['paid-provider'] as PaidProvider | undefined;
if (provider && !['tavily', 'brave', 'serper', 'exa'].includes(provider)) {
  console.error(`company-signals: unknown paid provider ${provider}`);
  process.exit(2);
}

const summary = await runBatch(companies, {
  outPath: values.out,
  costLedgerPath: `${values.out}.costs.jsonl`,
  concurrency: Number(values.concurrency),
  ...(provider ? { paid: { provider, maxQueries: Math.min(MAX_PAID_QUERIES_PER_COMPANY, Number(values['paid-queries'])) }, paidBudgetUsd: Number(values['paid-budget-usd']) } : {}),
  onRecord: (record, progress) => console.error(`[${progress.done}/${progress.total}] ${record.domain} ${record.evidence_strength}${record.resolved_ats?.verified ? ` (${record.resolved_ats.provider}/${record.resolved_ats.slug})` : ''}`),
});
console.log(JSON.stringify({ ...summary, inputRowsSkipped: parsed.skipped }, null, 2));
