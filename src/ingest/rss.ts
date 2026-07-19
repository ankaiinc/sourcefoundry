import { sha256 } from '../hash.js';
import type { JsonRecord, SourceEntry } from '../types.js';
import { canonicalizeUrl } from '../url.js';

interface XmlEntry {
  block: string;
  kind: 'rss' | 'atom';
}

export function parseFeed(xml: string, feedUrl: string): SourceEntry[] {
  const entries = extractEntries(xml);
  const out: SourceEntry[] = [];

  for (const entry of entries) {
    const title = cleanText(extractTag(entry.block, 'title'));
    const summary = cleanText(
      extractTag(entry.block, 'description') ||
        extractTag(entry.block, 'summary') ||
        extractTag(entry.block, 'content:encoded') ||
        extractTag(entry.block, 'content'),
    );
    const url = entry.kind === 'atom' ? extractAtomLink(entry.block) : cleanText(extractTag(entry.block, 'link'));
    const guid = cleanText(extractTag(entry.block, 'guid') || extractTag(entry.block, 'id'));
    const publishedAt = parseDate(
      extractTag(entry.block, 'pubDate') ||
        extractTag(entry.block, 'published') ||
        extractTag(entry.block, 'updated'),
    );
    const author = cleanText(
      extractTag(entry.block, 'dc:creator') || extractTag(entry.block, 'author') || extractTag(entry.block, 'name'),
    );

    const resolvedUrl = absolutize(url || guid, feedUrl);
    if (!title || !resolvedUrl) continue;

    const canonicalUrl = canonicalizeUrl(resolvedUrl);
    out.push({
      title,
      url: resolvedUrl,
      canonicalUrl,
      summary,
      author,
      publishedAt,
      raw: {
        guid,
        feedUrl,
        rawHash: sha256(entry.block),
      },
    });
  }

  return out;
}

function extractEntries(xml: string): XmlEntry[] {
  const entries: XmlEntry[] = [];
  for (const block of matchBlocks(xml, 'item')) entries.push({ block, kind: 'rss' });
  for (const block of matchBlocks(xml, 'entry')) entries.push({ block, kind: 'atom' });
  return entries;
}

function matchBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    if (match[1]) blocks.push(match[1]);
  }
  return blocks;
}

function extractTag(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<${escaped}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${escaped}>`,
    'i',
  );
  const match = xml.match(re);
  return (match?.[1] ?? match?.[2] ?? '').trim();
}

function extractAtomLink(xml: string): string {
  const hrefMatch = xml.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (hrefMatch?.[1]) return cleanText(hrefMatch[1]);
  return cleanText(extractTag(xml, 'link'));
}

function cleanText(input: string): string {
  return decodeEntities(stripHtml(input)).replace(/\s+/g, ' ').trim();
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function parseDate(input: string): string | null {
  if (!input.trim()) return null;
  const timestamp = Date.parse(cleanText(input));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function absolutize(input: string, baseUrl: string): string {
  if (!input.trim()) return '';
  try {
    return new URL(input.trim(), baseUrl).toString();
  } catch {
    return input.trim();
  }
}

export function sourceItemHash(entry: Pick<SourceEntry, 'title' | 'summary' | 'canonicalUrl'>): string {
  return sha256(`${entry.canonicalUrl}\n${entry.title}\n${entry.summary}`);
}

export function entryPayload(entry: SourceEntry): JsonRecord {
  return {
    title: entry.title,
    url: entry.url,
    canonicalUrl: entry.canonicalUrl,
    summary: entry.summary,
    author: entry.author,
    publishedAt: entry.publishedAt,
    ...(entry.conversation ? { conversation: entry.conversation } : {}),
    raw: entry.raw,
  };
}
