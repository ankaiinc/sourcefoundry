import { existsSync, readFileSync } from 'node:fs';
import { ATS_PROVIDERS, type AtsBoard, type AtsProvider, type CompanyInput, type VerificationMethod } from './types.js';

/**
 * ATS board resolution and ownership verification.
 *
 * Finding a board called "alpaca" proves nothing about Alpaca the brokerage:
 * generic names collide. A board is only used once something ties it to the
 * company — the company's own site links to it, the postings mention the
 * company's domain, or the provider's board name is the company's name.
 */

export type SlugIndex = Record<AtsProvider, Set<string>>;

let cachedIndex: SlugIndex | null = null;

/** Live slugs per provider, from the open-jobs fleet export (data/ats-slugs.json). */
export function loadSlugIndex(path?: URL | string): SlugIndex {
  if (cachedIndex && !path) return cachedIndex;
  // src/company-signals → ../../data; dist/src/company-signals → ../../../data
  path ??= [new URL('../../data/ats-slugs.json', import.meta.url), new URL('../../../data/ats-slugs.json', import.meta.url)].find((p) => existsSync(p));
  if (!path) throw new Error('data/ats-slugs.json not found');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { ats: Record<string, string[]> };
  const index = {} as SlugIndex;
  for (const provider of ATS_PROVIDERS) index[provider] = new Set((raw.ats[provider] ?? []).map((s) => s.toLowerCase()));
  cachedIndex = index;
  return index;
}

export function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const NAME_SUFFIXES = /\b(inc|llc|ltd|corp|corporation|co|company|technologies|technology|labs|hq|ai|io)\b\.?/gi;

export function normalizeName(name: string): string {
  return name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Plausible board slugs for a company, most likely first. */
export function slugCandidates(company: CompanyInput): string[] {
  const domain = normalizeDomain(company.domain);
  const root = domain.split('.')[0] ?? '';
  const name = normalizeName(company.name);
  const core = normalizeName(company.name.replace(NAME_SUFFIXES, ' '));
  const out = [
    root,
    name.replace(/ /g, ''),
    name.replace(/ /g, '-'),
    core.replace(/ /g, ''),
    core.replace(/ /g, '-'),
    domain.replace(/\./g, ''),
    `${root}hq`,
    `${root}ai`,
    `${root}-ai`,
  ];
  return [...new Set(out.filter((s) => s.length >= 2))];
}

/** Candidates the open-jobs fleet already saw live, ranked by provider then slug order. */
export function indexedCandidates(company: CompanyInput, index: SlugIndex): Array<{ provider: AtsProvider; slug: string }> {
  const slugs = slugCandidates(company);
  return ATS_PROVIDERS.flatMap((provider) => slugs.filter((s) => index[provider].has(s)).map((slug) => ({ provider, slug })));
}

function mentions(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

export interface Verification { verified: boolean; method: VerificationMethod | null; rejected?: string }

/**
 * Decides whether a fetched board belongs to the company.
 * `fromSite` / `fromHint` short-circuit: the company itself pointed at it.
 */
export function verifyBoard(company: CompanyInput, board: AtsBoard, origin: { fromSite?: boolean; fromHint?: boolean } = {}): Verification {
  if (origin.fromHint) return { verified: true, method: 'hint' };
  if (origin.fromSite) return { verified: true, method: 'site_link' };
  const domain = normalizeDomain(company.domain);
  const corpus = board.jobs.map((j) => `${j.url}\n${j.text ?? ''}`).join('\n');
  if (domain && mentions(corpus, domain)) return { verified: true, method: 'domain' };

  const name = normalizeName(company.name);
  if (board.boardName && normalizeName(board.boardName) === name) return { verified: true, method: 'board_name' };
  if (board.boardName && normalizeName(board.boardName) !== name && !normalizeName(board.boardName).startsWith(`${name} `)) {
    return { verified: false, method: null, rejected: `board name "${board.boardName}" is not "${company.name}"` };
  }

  // A namesake usually advertises its own domain: "alpaca.ai" on a board we hoped was alpaca.markets.
  const root = domain.split('.')[0] ?? '';
  const foreign = [...corpus.matchAll(/\b([a-z0-9-]+)\.(com|ai|io|co|dev|app|tech|net|org|xyz|so|sh|inc|markets|health|bio)\b/gi)]
    .map((m) => m[0].toLowerCase())
    .find((d) => d.split('.')[0] === root && d !== domain);
  if (foreign) return { verified: false, method: null, rejected: `postings name ${foreign}, not ${domain}` };

  const texts = board.jobs.filter((j) => j.text);
  if (texts.length && name.length >= 4) {
    const hits = texts.filter((j) => mentions(normalizeName(j.text ?? ''), name)).length;
    if (hits / texts.length >= 0.5) return { verified: true, method: 'name_in_postings' };
  }
  return { verified: false, method: null, rejected: board.jobs.length ? 'nothing in the postings ties this board to the company' : 'board has no postings to verify against' };
}
