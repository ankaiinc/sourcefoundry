import { parseFeed } from '../ingest/rss.js';
import { readBoundedText } from './ats.js';
import type { DatedLink } from './types.js';

/**
 * Free signals from the company's own web presence: its pages (careers links,
 * compliance badges), its Atlassian Statuspage, and its blog feed. All requests
 * go through the caller's fetch, which in production is safeFetch (public HTTPS
 * only, no cross-origin redirects).
 */

const MAX_PAGE_BYTES = 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (compatible; SourceFoundry/0.1; +https://sourcefoundry.4agents.fyi)';

export async function getText(fetchFn: typeof fetch, url: string, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xml,application/json;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    return await readBoundedText(response, MAX_PAGE_BYTES);
  } catch {
    return null;
  }
}

/** Apex and www are different origins to safeFetch; try both before giving up. */
export async function getSiteText(fetchFn: typeof fetch, domain: string, path: string, timeoutMs: number): Promise<{ url: string; text: string } | null> {
  for (const host of [domain, `www.${domain}`]) {
    const url = `https://${host}${path}`;
    const text = await getText(fetchFn, url, timeoutMs);
    if (text) return { url, text };
  }
  return null;
}

export const SITE_PATHS = ['/', '/careers', '/jobs', '/security', '/trust'];

export async function fetchSitePages(fetchFn: typeof fetch, domain: string, timeoutMs: number): Promise<Array<{ url: string; text: string }>> {
  const pages: Array<{ url: string; text: string }> = [];
  for (const path of SITE_PATHS) {
    const page = await getSiteText(fetchFn, domain, path, timeoutMs);
    if (page) pages.push(page);
    if (path === '/' && !page) break; // site unreachable; don't spend four more misses
  }
  return pages;
}

export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Atlassian Statuspage public incidents. Other status vendors return null. */
export function parseStatuspageIncidents(json: unknown, statusHost: string): DatedLink[] {
  const incidents = (json as { incidents?: unknown } | null)?.incidents;
  if (!Array.isArray(incidents)) return [];
  return incidents.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const i = value as Record<string, unknown>;
    const title = typeof i.name === 'string' ? i.name.trim() : '';
    if (!title) return [];
    const created = typeof i.created_at === 'string' && Number.isFinite(Date.parse(i.created_at)) ? new Date(i.created_at).toISOString() : null;
    const url = typeof i.shortlink === 'string' && i.shortlink.startsWith('https://')
      ? i.shortlink
      : typeof i.id === 'string' ? `https://${statusHost}/incidents/${encodeURIComponent(i.id)}` : `https://${statusHost}/history`;
    return [{ title, url, date: created }];
  });
}

export async function fetchStatusIncidents(fetchFn: typeof fetch, domain: string, timeoutMs: number): Promise<{ host: string; incidents: DatedLink[] } | null> {
  const host = `status.${domain}`;
  const text = await getText(fetchFn, `https://${host}/api/v2/incidents.json`, timeoutMs);
  if (!text) return null;
  try {
    return { host, incidents: parseStatuspageIncidents(JSON.parse(text), host) };
  } catch {
    return null;
  }
}

export const FEED_PATHS = ['/blog/rss.xml', '/rss.xml', '/feed.xml', '/blog/feed', '/feed', '/blog/index.xml', '/atom.xml', '/blog/atom.xml'];

/** First blog feed that parses. Feeds advertised in the homepage <head> are tried first. */
export async function fetchBlogItems(fetchFn: typeof fetch, domain: string, homepage: string | null, timeoutMs: number): Promise<{ feedUrl: string; items: Array<{ title: string; url: string; date: string | null; text: string }> } | null> {
  const advertised = homepage
    ? [...homepage.matchAll(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)]
        .map((m) => /href=["']([^"']+)["']/i.exec(m[0])?.[1])
        .filter((href): href is string => !!href)
    : [];
  const urls = [
    ...advertised.flatMap((href) => { try { return [new URL(href, `https://${domain}/`).toString()]; } catch { return []; } }),
    ...FEED_PATHS.map((p) => `https://${domain}${p}`),
  ];
  for (const feedUrl of [...new Set(urls)].slice(0, 10)) {
    const xml = await getText(fetchFn, feedUrl, timeoutMs);
    if (!xml || !/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) continue;
    const entries = parseFeed(xml, feedUrl);
    if (!entries.length) continue;
    return { feedUrl, items: entries.map((e) => ({ title: e.title, url: e.canonicalUrl || e.url, date: e.publishedAt, text: e.summary })) };
  }
  return null;
}
