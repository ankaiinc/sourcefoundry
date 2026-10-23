import { safeFetch } from '../safe-fetch.js';
import { atsLinksIn, fetchBoard } from './ats.js';
import { deriveRegions, deriveStack, evidenceStrength, hiringSignal, matchTerms, rankHiring, recentIncidents, REGULATED_TERMS, relevantWriting } from './derive.js';
import { paidSearch, type PaidSearchOptions } from './paid.js';
import { indexedCandidates, loadSlugIndex, normalizeDomain, normalizeName, slugCandidates, verifyBoard, type SlugIndex } from './resolve.js';
import { fetchBlogItems, fetchSitePages, fetchStatusIncidents, visibleText } from './site.js';
import type { AtsBoard, AtsProvider, CompanyInput, CompanySignals, EvidenceRecord, ResolvedAts } from './types.js';

export interface CollectOptions {
  /** Fetch for fixed-host ATS APIs. */
  atsFetch?: typeof fetch;
  /** Fetch for company-controlled hosts; defaults to safeFetch (public HTTPS only). */
  siteFetch?: typeof fetch;
  /** Fetch for paid search providers. */
  paidFetch?: typeof fetch;
  slugIndex?: SlugIndex;
  /** Paid search runs only when set and free evidence is weak or none. */
  paid?: PaidSearchOptions;
  /** Max boards fetched while resolving one company. */
  maxBoardProbes?: number;
  timeoutMs?: number;
  now?: () => Date;
}

const RELIABILITY = { hiring: 0.9, incident: 0.9, writing: 0.8, site: 0.7, paid: 0.5 } as const;
const BLIND_PROBE_PROVIDERS: AtsProvider[] = ['ashby', 'greenhouse', 'lever'];

function evidence(kind: EvidenceRecord['kind'], title: string, url: string, provider: string, reliability: number, fetchedAt: string, publishedAt: string | null, summary: string | null): EvidenceRecord {
  let canonicalUrl = url;
  try { const u = new URL(url); u.hash = ''; canonicalUrl = u.toString(); } catch { /* keep as given */ }
  return { kind, title, url, canonicalUrl, provider, reliability, fetchedAt, publishedAt, completeness: { title: !!title, summary: !!summary, publishedAt: !!publishedAt } };
}

interface Resolution { board: AtsBoard | null; resolved: ResolvedAts | null }

async function resolveBoard(company: CompanyInput, siteLinks: Array<{ provider: AtsProvider; slug: string }>, options: Required<Pick<CollectOptions, 'atsFetch' | 'maxBoardProbes' | 'timeoutMs'>> & { slugIndex: SlugIndex }, errors: CompanySignals['errors']): Promise<Resolution> {
  const queue: Array<{ provider: AtsProvider; slug: string; fromHint?: boolean; fromSite?: boolean }> = [];
  if (company.ats) queue.push({ ...company.ats, fromHint: true });
  queue.push(...siteLinks.map((l) => ({ ...l, fromSite: true })));
  queue.push(...indexedCandidates(company, options.slugIndex));
  const firstSlugs = slugCandidates(company).slice(0, 2);
  for (const provider of BLIND_PROBE_PROVIDERS) for (const slug of firstSlugs) queue.push({ provider, slug });

  const tried = new Set<string>();
  let firstRejected: ResolvedAts | null = null;
  let probes = 0;
  for (const candidate of queue) {
    const key = `${candidate.provider}:${candidate.slug.toLowerCase()}`;
    if (tried.has(key)) continue;
    tried.add(key);
    if (probes++ >= options.maxBoardProbes) break;
    let fetched;
    try {
      fetched = await fetchBoard(candidate.provider, candidate.slug, options.atsFetch, options.timeoutMs);
    } catch (error) {
      errors.push({ source: `ats:${key}`, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (fetched.status === 'gone') continue;
    const verdict = verifyBoard(company, fetched.board, candidate);
    const resolved: ResolvedAts = { provider: candidate.provider, slug: candidate.slug, verified: verdict.verified, method: verdict.method, ...(verdict.rejected ? { rejected: verdict.rejected } : {}) };
    if (verdict.verified) return { board: fetched.board, resolved };
    firstRejected ??= resolved;
  }
  return { board: null, resolved: firstRejected };
}

/** Collects one company's signals. Never throws for a source failure; failures land in `errors`. */
export async function collectCompanySignals(input: CompanyInput, options: CollectOptions = {}): Promise<CompanySignals> {
  const now = options.now?.() ?? new Date();
  const fetchedAt = now.toISOString();
  const domain = normalizeDomain(input.domain);
  const company: CompanyInput = { ...input, domain };
  const siteFetch = options.siteFetch ?? safeFetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const errors: CompanySignals['errors'] = [];
  const evidenceRecords: EvidenceRecord[] = [];

  const pages = domain ? await fetchSitePages(siteFetch, domain, timeoutMs) : [];
  if (domain && !pages.length) errors.push({ source: 'site', error: `https://${domain}/ unreachable` });
  const siteLinks = pages.flatMap((p) => atsLinksIn(p.text));

  const { board, resolved } = await resolveBoard(company, siteLinks, {
    atsFetch: options.atsFetch ?? fetch,
    maxBoardProbes: options.maxBoardProbes ?? 10,
    timeoutMs,
    slugIndex: options.slugIndex ?? loadSlugIndex(),
  }, errors);

  const allHiring = board ? board.jobs.map(hiringSignal) : [];
  const hiring = rankHiring(allHiring);
  for (const h of hiring) evidenceRecords.push(evidence('hiring', h.title, h.url, board!.provider, RELIABILITY.hiring, fetchedAt, h.posted_at, h.quote));

  const [status, blog] = await Promise.all([
    domain ? fetchStatusIncidents(siteFetch, domain, timeoutMs) : Promise.resolve(null),
    domain ? fetchBlogItems(siteFetch, domain, pages[0]?.text ?? null, timeoutMs) : Promise.resolve(null),
  ]);
  const incidents = status ? recentIncidents(status.incidents, now) : [];
  for (const i of incidents) evidenceRecords.push(evidence('incident', i.title, i.url, 'statuspage', RELIABILITY.incident, fetchedAt, i.date, null));

  let writing = blog ? relevantWriting(blog.items, now).slice(0, 5) : [];
  for (const w of writing) evidenceRecords.push(evidence('writing', w.title, w.url, 'company-feed', RELIABILITY.writing, fetchedAt, w.date, w.quote));

  const siteText = pages.map((p) => visibleText(p.text)).join('\n');
  const regulated = matchTerms(siteText, REGULATED_TERMS);
  if (regulated.length) {
    const page = pages.find((p) => matchTerms(visibleText(p.text), REGULATED_TERMS).length) ?? pages[0]!;
    evidenceRecords.push(evidence('site', `Compliance named on site: ${regulated.join(', ')}`, page.url, 'company-site', RELIABILITY.site, fetchedAt, null, null));
  }

  const boardVerified = !!resolved?.verified;
  const jobTexts = boardVerified && board ? board.jobs.map((j) => `${j.title}\n${j.text ?? ''}`) : [];
  const writingTexts = writing.map((w) => `${w.title}\n${w.quote ?? ''}`);
  let stack = deriveStack([...jobTexts, ...writingTexts]);
  const regions = deriveRegions([...jobTexts, siteText]);

  const costs: CompanySignals['costs'] = [];
  let strength = evidenceStrength({ hiring: allHiring, stack, regulated, incidents, writing, boardVerified });
  if (options.paid && (strength === 'none' || strength === 'weak') && options.paid.maxQueries > 0) {
    try {
      const paid = await paidSearch(company, options.paid, options.paidFetch ?? fetch);
      costs.push(paid.cost);
      const name = normalizeName(company.name);
      const own = paid.items.filter((item) => {
        try {
          const host = new URL(item.url).hostname.replace(/^www\./, '');
          return host === domain || host.endsWith(`.${domain}`) || normalizeName(item.title).includes(name);
        } catch { return false; }
      });
      const paidWriting = relevantWriting(own, now).slice(0, 3);
      for (const w of paidWriting) evidenceRecords.push(evidence('writing', w.title, w.url, options.paid.provider, RELIABILITY.paid, fetchedAt, w.date, w.quote));
      writing = [...writing, ...paidWriting];
      stack = deriveStack([...jobTexts, ...writing.map((w) => `${w.title}\n${w.quote ?? ''}`)]);
      strength = evidenceStrength({ hiring: allHiring, stack, regulated, incidents, writing, boardVerified });
    } catch (error) {
      errors.push({ source: `paid:${options.paid.provider}`, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    schema: 'company_signals/v1',
    name: company.name,
    domain,
    resolved_ats: resolved,
    hiring: boardVerified ? hiring : [],
    stack,
    regulated,
    regions,
    incidents,
    public_writing: writing,
    evidence_strength: strength,
    evidence: boardVerified ? evidenceRecords : evidenceRecords.filter((e) => e.kind !== 'hiring'),
    errors,
    costs,
    fetched_at: fetchedAt,
  };
}
