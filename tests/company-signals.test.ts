import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { atsLinksIn, fetchBoard, parseAshby, parseGreenhouse, parseLever, parseRecruitee, parseWorkable } from '../src/company-signals/ats.js';
import { completedDomains, MAX_BATCH_COMPANIES, parseCompanies, parseCsv, runBatch } from '../src/company-signals/batch.js';
import { collectCompanySignals } from '../src/company-signals/collect.js';
import { deriveRegions, deriveStack, evidenceStrength, hiringSignal, isInfraRole } from '../src/company-signals/derive.js';
import { MAX_PAID_QUERIES_PER_COMPANY, paidQueries } from '../src/company-signals/paid.js';
import { indexedCandidates, loadSlugIndex, normalizeDomain, slugCandidates, verifyBoard, type SlugIndex } from '../src/company-signals/resolve.js';
import { parseStatuspageIncidents } from '../src/company-signals/site.js';
import type { AtsBoard, CompanyInput } from '../src/company-signals/types.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/company-signals/${name}`, import.meta.url), 'utf8');
const json = (name: string) => JSON.parse(fixture(name)) as unknown;
const NOW = new Date('2026-10-23T00:00:00Z');
const emptyIndex = (): SlugIndex => ({ greenhouse: new Set(), ashby: new Set(), lever: new Set(), workable: new Set(), recruitee: new Set() });

describe('ATS parsers', () => {
  it('reads Greenhouse, decoding escaped HTML and dropping jobs without URLs', () => {
    const jobs = parseGreenhouse(json('greenhouse.json'));
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ id: '101', title: 'Senior Platform Engineer', location: 'Remote, US', postedAt: '2026-09-20T13:00:00.000Z' });
    expect(jobs[0]!.text).toContain('FinOps discipline');
    expect(jobs[0]!.text).not.toContain('<p>');
  });
  it('reads Ashby and skips unlisted postings', () => {
    const jobs = parseAshby(json('ashby.json'));
    expect(jobs.map((j) => j.id)).toEqual(['a1']);
    expect(jobs[0]!.text).toContain('cost optimization');
  });
  it('reads Lever including requirement lists and epoch dates', () => {
    const jobs = parseLever(json('lever.json'));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.postedAt).toBe('2025-10-01T00:00:00.000Z');
    expect(jobs[0]!.text).toContain('Pulumi');
  });
  it('reads Workable and Recruitee', () => {
    expect(parseWorkable(json('workable.json'))[0]).toMatchObject({ id: 'ABC123', location: 'London, United Kingdom', postedAt: '2026-10-05T00:00:00.000Z' });
    expect(parseRecruitee(json('recruitee.json'), 'fixture')[0]).toMatchObject({ url: 'https://fixture.recruitee.com/o/cloud-engineer', postedAt: '2026-10-07T10:00:00.000Z' });
  });
  it('treats 404 as no board and other failures as errors', async () => {
    await expect(fetchBoard('ashby', 'nope', (async () => new Response('', { status: 404 })) as typeof fetch)).resolves.toEqual({ status: 'gone' });
    await expect(fetchBoard('ashby', 'busy', (async () => new Response('', { status: 429 })) as typeof fetch)).rejects.toThrow('rate limited');
    await expect(fetchBoard('ashby', '../etc', (async () => { throw new Error('must not fetch'); }) as typeof fetch)).resolves.toEqual({ status: 'gone' });
  });
  it('reads the Greenhouse board name for verification', async () => {
    const fake = (async (url: string | URL | Request) => String(url).includes('/jobs')
      ? new Response(fixture('greenhouse.json'))
      : new Response(JSON.stringify({ name: 'Deepgram' }))) as typeof fetch;
    const result = await fetchBoard('greenhouse', 'deepgram', fake);
    expect(result.status === 'ok' && result.board.boardName).toBe('Deepgram');
  });
});

describe('slug resolution', () => {
  it('normalises domains and builds candidates from domain and name', () => {
    expect(normalizeDomain('https://www.Alpaca.markets/')).toBe('alpaca.markets');
    expect(slugCandidates({ name: 'Weights & Biases', domain: 'wandb.ai' })).toEqual(expect.arrayContaining(['wandb', 'weightsbiases', 'weights-biases']));
    expect(slugCandidates({ name: 'Acme Labs Inc', domain: 'acme.dev' })).toContain('acme');
  });
  it('ranks slugs the open-jobs fleet saw live', () => {
    const index = emptyIndex();
    index.ashby.add('roboflow');
    index.lever.add('roboflow');
    expect(indexedCandidates({ name: 'Roboflow', domain: 'roboflow.com' }, index)).toEqual([{ provider: 'ashby', slug: 'roboflow' }, { provider: 'lever', slug: 'roboflow' }]);
  });
  it('ships a slug index built from open-jobs', () => {
    const index = loadSlugIndex();
    expect(index.greenhouse.size).toBeGreaterThan(1000);
    expect(index.ashby.size).toBeGreaterThan(1000);
  });
  it('finds ATS links on a company site', () => {
    const html = '<a href="https://jobs.ashbyhq.com/Roboflow">Jobs</a><script src="https://boards.greenhouse.io/embed/job_board/js?for=deepgram"></script><a href="https://jobs.lever.co/acme/123">x</a>';
    expect(atsLinksIn(html)).toEqual([{ provider: 'ashby', slug: 'Roboflow' }, { provider: 'greenhouse', slug: 'deepgram' }, { provider: 'lever', slug: 'acme' }]);
  });
});

describe('board ownership verification', () => {
  const board = (over: Partial<AtsBoard>): AtsBoard => ({ provider: 'ashby', slug: 'alpaca', boardName: null, jobs: [], ...over });
  const alpaca: CompanyInput = { name: 'Alpaca', domain: 'alpaca.markets' };
  it('accepts a board whose postings name the company domain', () => {
    const v = verifyBoard(alpaca, board({ jobs: [{ id: '1', title: 'SRE', url: 'u', location: null, postedAt: null, text: 'Join us at alpaca.markets' }] }));
    expect(v).toEqual({ verified: true, method: 'domain' });
  });
  it('rejects a namesake that advertises a different domain', () => {
    const v = verifyBoard(alpaca, board({ jobs: [{ id: '1', title: 'SRE', url: 'u', location: null, postedAt: null, text: 'Alpaca (alpaca.ai) builds pet insurance. Alpaca is hiring.' }] }));
    expect(v.verified).toBe(false);
    expect(v.rejected).toContain('alpaca.ai');
  });
  it('rejects a board whose provider name is a different company', () => {
    expect(verifyBoard(alpaca, board({ provider: 'greenhouse', boardName: 'Alpaca Real Estate Partners' })).verified).toBe(false);
    expect(verifyBoard(alpaca, board({ provider: 'greenhouse', boardName: 'Alpaca' }))).toEqual({ verified: true, method: 'board_name' });
  });
  it('trusts the company site and explicit hints, and refuses empty unverifiable boards', () => {
    expect(verifyBoard(alpaca, board({}), { fromSite: true }).method).toBe('site_link');
    expect(verifyBoard(alpaca, board({}), { fromHint: true }).method).toBe('hint');
    expect(verifyBoard(alpaca, board({})).verified).toBe(false);
  });
});

describe('summary derivation', () => {
  it('extracts infra roles, stack and cost terms with a quotable sentence', () => {
    const h = hiringSignal(parseGreenhouse(json('greenhouse.json'))[0]!);
    expect(h.infra_role).toBe(true);
    expect(h.cost_terms).toEqual(expect.arrayContaining(['finops', 'cloud cost']));
    expect(h.stack_terms).toEqual(expect.arrayContaining(['aws', 'terraform', 'kubernetes', 'gpu']));
    expect(h.quote).toMatch(/FinOps discipline/);
    expect(isInfraRole('Account Executive')).toBe(false);
  });
  it('derives stack and regions', () => {
    const texts = parseLever(json('lever.json')).map((j) => j.text ?? '');
    expect(deriveStack(texts)).toMatchObject({ clouds: ['aws'], iac: ['pulumi'] });
    expect(deriveRegions(texts)).toEqual(['eu-west-1', 'multi-region', 'us-east-1']);
    expect(deriveStack(parseRecruitee(json('recruitee.json'), 'x').map((j) => j.text ?? '')).data).toEqual(['databricks', 'snowflake']);
  });
  it('grades evidence strength', () => {
    const emptyStack = { clouds: [], kubernetes: false, iac: [], data: [], gpu: false };
    const base = { hiring: [], stack: emptyStack, regulated: [], incidents: [], writing: [], boardVerified: true };
    const infraCost = hiringSignal(parseGreenhouse(json('greenhouse.json'))[0]!);
    const sales = hiringSignal(parseGreenhouse(json('greenhouse.json'))[1]!);
    expect(evidenceStrength({ ...base, hiring: [infraCost] })).toBe('strong');
    expect(evidenceStrength({ ...base, hiring: [infraCost], boardVerified: false })).toBe('none');
    expect(evidenceStrength({ ...base, hiring: [{ ...infraCost, cost_terms: [] }] })).toBe('medium');
    expect(evidenceStrength({ ...base, hiring: [sales] })).toBe('weak');
    expect(evidenceStrength({ ...base, regulated: ['soc2'] })).toBe('weak');
    expect(evidenceStrength(base)).toBe('none');
  });
  it('parses Atlassian Statuspage incidents', () => {
    expect(parseStatuspageIncidents(json('statuspage.json'), 'status.example.dev')).toEqual([
      { title: 'Elevated API latency', url: 'https://stspg.io/abc', date: '2026-10-15T10:00:00.000Z' },
      { title: 'Old outage', url: 'https://status.example.dev/incidents/inc2', date: '2026-03-01T10:00:00.000Z' },
    ]);
  });
});

/** A fake web: map of URL → body. Anything else is 404. */
function fakeWeb(pages: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    return url in pages ? new Response(pages[url]) : new Response('', { status: 404 });
  }) as typeof fetch;
}

describe('collectCompanySignals', () => {
  const site = fakeWeb({
    'https://example.dev/': '<html><head><link rel="alternate" type="application/rss+xml" href="/blog/rss.xml"></head><body>SOC 2 Type II. <a href="https://jobs.ashbyhq.com/exampledev">Careers</a></body></html>',
    'https://example.dev/blog/rss.xml': fixture('feed.xml'),
    'https://status.example.dev/api/v2/incidents.json': fixture('statuspage.json'),
  });
  const ats = fakeWeb({ 'https://api.ashbyhq.com/posting-api/job-board/exampledev': fixture('ashby.json') });

  it('builds a full record from free sources only', async () => {
    const record = await collectCompanySignals({ name: 'Example', domain: 'https://www.example.dev' }, { siteFetch: site, atsFetch: ats, slugIndex: emptyIndex(), now: () => NOW });
    expect(record.resolved_ats).toEqual({ provider: 'ashby', slug: 'exampledev', verified: true, method: 'site_link' });
    expect(record.hiring[0]).toMatchObject({ title: 'Infrastructure Engineer', infra_role: true });
    expect(record.regulated).toEqual(['soc2']);
    expect(record.incidents.map((i) => i.title)).toEqual(['Elevated API latency']);
    expect(record.public_writing.map((w) => w.title)).toEqual(['How we cut our AWS bill by 40%']);
    expect(record.evidence_strength).toBe('strong');
    expect(record.costs).toEqual([]);
    expect(record.evidence.every((e) => e.canonicalUrl && e.fetchedAt === NOW.toISOString())).toBe(true);
  });

  it('does not use an unverified namesake board', async () => {
    const namesake = fakeWeb({ 'https://api.ashbyhq.com/posting-api/job-board/alpaca': JSON.stringify({ jobs: [{ id: '1', title: 'Platform Engineer', jobUrl: 'https://jobs.ashbyhq.com/alpaca/1', descriptionPlain: 'Alpaca (alpaca.ai) is hiring. FinOps on AWS.' }] }) });
    const record = await collectCompanySignals({ name: 'Alpaca', domain: 'alpaca.markets' }, { siteFetch: fakeWeb({}), atsFetch: namesake, slugIndex: emptyIndex(), now: () => NOW });
    expect(record.resolved_ats).toMatchObject({ slug: 'alpaca', verified: false });
    expect(record.hiring).toEqual([]);
    expect(record.evidence_strength).toBe('none');
    expect(record.errors.map((e) => e.source)).toContain('site');
  });

  it('runs capped, costed paid search only when free evidence is weak', async () => {
    const original = process.env.SERPER_API_KEY;
    process.env.SERPER_API_KEY = 'test';
    const bodies: unknown[] = [];
    const paidFetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ organic: [{ title: 'Example engineering: taming our cloud costs', link: 'https://example.dev/eng/costs', snippet: 'We reduced cloud spend with rightsizing.', date: '2026-09-01' }] }));
    }) as typeof fetch;
    try {
      const record = await collectCompanySignals({ name: 'Example', domain: 'example.dev' }, { siteFetch: fakeWeb({}), atsFetch: fakeWeb({}), paidFetch, slugIndex: emptyIndex(), now: () => NOW, paid: { provider: 'serper', maxQueries: 9 } });
      expect(bodies).toHaveLength(MAX_PAID_QUERIES_PER_COMPANY);
      expect(record.costs).toEqual([{ provider: 'serper', queries: 3, estimated_usd: 0.003 }]);
      expect(record.evidence_strength).toBe('strong');
    } finally {
      if (original === undefined) delete process.env.SERPER_API_KEY; else process.env.SERPER_API_KEY = original;
    }
    expect(paidQueries({ name: 'X', domain: 'x.dev' }, 0)).toEqual([]);
  });
});

describe('batch', () => {
  it('parses quoted CSV, dedupes by domain and skips rows without a domain', () => {
    expect(parseCsv('name,website\n"Acme, Inc",https://acme.dev\n')).toEqual([{ name: 'Acme, Inc', website: 'https://acme.dev' }]);
    const { companies, skipped } = parseCompanies('name,website,ats_provider,ats_slug\nAcme,https://acme.dev,lever,acme\nAcme again,www.acme.dev,,\nNo site,,,\n', 'csv');
    expect(companies).toEqual([{ name: 'Acme', domain: 'acme.dev', ats: { provider: 'lever', slug: 'acme' } }]);
    expect(skipped).toBe(1);
  });
  it('refuses more than the batch limit', () => {
    const rows = Array.from({ length: MAX_BATCH_COMPANIES + 1 }, (_, i) => ({ name: `C${i}`, domain: `c${i}.dev` }));
    expect(() => parseCompanies(JSON.stringify(rows), 'json')).toThrow('limit is 2000');
  });
  it('resumes without redoing finished domains and tolerates a torn last line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'company-signals-'));
    const out = join(dir, 'out.jsonl');
    const companies = [{ name: 'A', domain: 'a.dev' }, { name: 'B', domain: 'b.dev' }];
    const options = { outPath: out, siteFetch: fakeWeb({}), atsFetch: fakeWeb({}), slugIndex: emptyIndex(), now: () => NOW, concurrency: 1 };
    await runBatch(companies.slice(0, 1), options);
    writeFileSync(out, `${readFileSync(out, 'utf8')}{"schema":"company_signals/v1","dom`);
    const second = await runBatch(companies, options);
    expect(second).toMatchObject({ total: 2, skippedAlreadyDone: 1, processed: 1 });
    expect([...completedDomains(out)].sort()).toEqual(['a.dev', 'b.dev']);
    const third = await runBatch(companies, options);
    expect(third.processed).toBe(0);
  });
});
