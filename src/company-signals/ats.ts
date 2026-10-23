import type { AtsBoard, AtsJob, AtsProvider } from './types.js';

/**
 * Public ATS job-board readers. Parsers are adapted from pl-app hunt/scan.ts
 * (Greenhouse, Ashby, Lever) and open-jobs backend/src/ats (Workable,
 * Recruitee). Hosts are fixed per provider, so the caller's slug never picks
 * where we connect.
 */

const USER_AGENT = 'SourceFoundry/0.1 (+https://sourcefoundry.4agents.fyi)';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 20_000;

export type BoardFetch = { status: 'ok'; board: AtsBoard } | { status: 'gone' };

export function boardApiUrl(provider: AtsProvider, slug: string): string {
  const s = encodeURIComponent(slug);
  switch (provider) {
    case 'greenhouse': return `https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`;
    case 'ashby': return `https://api.ashbyhq.com/posting-api/job-board/${s}`;
    case 'lever': return `https://api.lever.co/v0/postings/${s}?mode=json`;
    case 'workable': return `https://apply.workable.com/api/v1/widget/accounts/${s}?details=true`;
    case 'recruitee': return `https://${s}.recruitee.com/api/offers/`;
  }
}

export function plainText(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const text = value
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  return text ? text.slice(0, MAX_TEXT_CHARS) : null;
}

function iso(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value).toISOString() : null;
  if (typeof value !== 'string' || !value) return null;
  const normalised = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/, '$1T$2Z');
  const time = Date.parse(normalised);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

type Rec = Record<string, unknown>;
const records = (value: unknown): Rec[] => (Array.isArray(value) ? value.filter((v): v is Rec => !!v && typeof v === 'object') : []);

export function parseGreenhouse(json: unknown): AtsJob[] {
  return records((json as Rec | null)?.jobs).flatMap((j) => {
    const title = str(j.title); const url = str(j.absolute_url);
    if (!title || !url) return [];
    const location = j.location && typeof j.location === 'object' ? str((j.location as Rec).name) : null;
    return [{ id: String(j.id ?? url), title, url, location, postedAt: iso(j.first_published ?? j.updated_at), text: plainText(j.content) }];
  });
}

export function parseAshby(json: unknown): AtsJob[] {
  return records((json as Rec | null)?.jobs).flatMap((j) => {
    const title = str(j.title); const url = str(j.jobUrl);
    if (!title || !url || j.isListed === false) return [];
    return [{ id: String(j.id ?? url), title, url, location: str(j.location), postedAt: iso(j.publishedAt), text: plainText(j.descriptionPlain ?? j.descriptionHtml) }];
  });
}

export function parseLever(json: unknown): AtsJob[] {
  return records(json).flatMap((j) => {
    const title = str(j.text); const url = str(j.hostedUrl);
    if (!title || !url) return [];
    const categories = j.categories && typeof j.categories === 'object' ? j.categories as Rec : {};
    const lists = records(j.lists).map((l) => `${str(l.text) ?? ''}\n${plainText(l.content) ?? ''}`).join('\n');
    const text = [plainText(j.descriptionPlain ?? j.description), lists.trim() || null].filter(Boolean).join('\n') || null;
    return [{ id: String(j.id ?? url), title, url, location: str(categories.location), postedAt: iso(j.createdAt), text }];
  });
}

export function parseWorkable(json: unknown): AtsJob[] {
  return records((json as Rec | null)?.jobs).flatMap((j) => {
    const title = str(j.title); const shortcode = str(j.shortcode);
    if (!title || !shortcode) return [];
    const location = [str(j.city), str(j.state), str(j.country)].filter(Boolean).join(', ') || null;
    return [{ id: shortcode, title, url: str(j.url) ?? `https://apply.workable.com/j/${shortcode}`, location, postedAt: iso(j.published_on ?? j.created_at), text: plainText(j.description) }];
  });
}

export function parseRecruitee(json: unknown, slug: string): AtsJob[] {
  return records((json as Rec | null)?.offers).flatMap((o) => {
    const title = str(o.title);
    if (!title || o.id === undefined) return [];
    const text = [plainText(o.description), plainText(o.requirements)].filter(Boolean).join('\n') || null;
    return [{ id: String(o.id), title, url: str(o.careers_url) ?? `https://${slug}.recruitee.com/o/${str(o.slug) ?? o.id}`, location: str(o.location), postedAt: iso(o.published_at ?? o.created_at), text }];
  });
}

/** Board-level display name, for providers whose listing reports one. */
export function boardNameFrom(provider: AtsProvider, json: unknown): string | null {
  if (provider === 'workable' && json && typeof json === 'object') return str((json as Rec).name);
  return null;
}

export function parseBoard(provider: AtsProvider, slug: string, json: unknown): AtsJob[] {
  switch (provider) {
    case 'greenhouse': return parseGreenhouse(json);
    case 'ashby': return parseAshby(json);
    case 'lever': return parseLever(json);
    case 'workable': return parseWorkable(json);
    case 'recruitee': return parseRecruitee(json, slug);
  }
}

export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`response too large (${declared} bytes)`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0; let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`response too large (over ${maxBytes} bytes)`);
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

async function getJson(fetchFn: typeof fetch, url: string, timeoutMs: number): Promise<{ status: 'ok'; json: unknown } | { status: 'gone' }> {
  const response = await fetchFn(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404 || response.status === 410) {
    await response.body?.cancel().catch(() => undefined);
    return { status: 'gone' };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`HTTP ${response.status}${response.status === 429 ? ' (rate limited)' : ''}`);
  }
  return { status: 'ok', json: JSON.parse(await readBoundedText(response, MAX_RESPONSE_BYTES)) as unknown };
}

/** Fetches one public board. 404 means "no such board", not an error. */
export async function fetchBoard(provider: AtsProvider, slug: string, fetchFn: typeof fetch = fetch, timeoutMs = 15_000): Promise<BoardFetch> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(slug)) return { status: 'gone' };
  const listing = await getJson(fetchFn, boardApiUrl(provider, slug), timeoutMs);
  if (listing.status === 'gone') return listing;
  // Lever and Ashby answer unknown slugs with an empty/ok body; that is still "no board".
  if (provider === 'lever' && !Array.isArray(listing.json)) return { status: 'gone' };
  let boardName = boardNameFrom(provider, listing.json);
  if (provider === 'greenhouse') {
    const meta = await getJson(fetchFn, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`, timeoutMs).catch(() => null);
    if (meta?.status === 'ok' && meta.json && typeof meta.json === 'object') boardName = str((meta.json as Rec).name);
  }
  return { status: 'ok', board: { provider, slug, boardName, jobs: parseBoard(provider, slug, listing.json) } };
}

/** Finds ATS board links in a company's own web pages. */
export function atsLinksIn(html: string): Array<{ provider: AtsProvider; slug: string }> {
  const patterns: Array<[AtsProvider, RegExp]> = [
    ['ashby', /jobs\.ashbyhq\.com\/([A-Za-z0-9._%-]+)/g],
    ['greenhouse', /(?:job-boards(?:\.eu)?|boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/g],
    ['greenhouse', /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/g],
    ['greenhouse', /greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([A-Za-z0-9_-]+)/g],
    ['lever', /jobs(?:\.eu)?\.lever\.co\/([A-Za-z0-9._-]+)/g],
    ['workable', /apply\.workable\.com\/([A-Za-z0-9_-]+)/g],
    ['workable', /([A-Za-z0-9-]+)\.workable\.com/g],
    ['recruitee', /([A-Za-z0-9-]+)\.recruitee\.com/g],
  ];
  const ignored = new Set(['api', 'www', 'apply', 'embed', 'j', 'jobs', 'careers', 'app']);
  const seen = new Set<string>();
  const out: Array<{ provider: AtsProvider; slug: string }> = [];
  for (const [provider, pattern] of patterns) {
    for (const match of html.matchAll(pattern)) {
      const slug = decodeURIComponent(match[1] ?? '').replace(/[.]+$/, '');
      if (!slug || ignored.has(slug.toLowerCase())) continue;
      const key = `${provider}:${slug.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ provider, slug });
    }
  }
  return out;
}
