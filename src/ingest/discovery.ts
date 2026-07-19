import { sha256 } from '../hash.js';
import type { JsonRecord, SignalConversation, SignalConversationParticipant, SignalSource, SourceEntry } from '../types.js';
import { canonicalizeUrl } from '../url.js';

type DiscoveryProvider = 'firecrawl' | 'tavily' | 'x' | 'youtube' | 'youtube-comments' | 'apify' | 'generic';

type DiscoveryItem = {
  title: string;
  url: string;
  summary: string;
  author: string;
  publishedAt: string | null;
  conversation?: SignalConversation;
  raw: JsonRecord;
};

export interface DiscoveryFetchResult {
  entries: SourceEntry[];
  httpStatus: number | null;
}

export async function fetchDiscoveryEntries(
  source: SignalSource,
  fetchFn: typeof fetch,
  signal: AbortSignal,
  queryOverride?: string[],
): Promise<DiscoveryFetchResult> {
  const provider = discoveryProvider(source.metadata.provider);
  const queries = queryOverride ?? discoveryQueries(source);
  if (queries.length === 0) {
    if (queryOverride !== undefined) return { entries: [], httpStatus: null };
    throw new Error(`Discovery source ${source.id} has no metadata.queries`);
  }
  if (provider === 'apify') validateApifyRun(source, queries);
  const limit = positiveInt(source.metadata.max_results_per_query, 5);
  const entries: SourceEntry[] = [];
  let httpStatus: number | null = null;

  for (const query of queries) {
    const init: RequestInit = {
      method: requestMethod(source),
      headers: requestHeaders(source),
      signal,
    };
    const body = requestBody(source, provider, query, limit);
    if (body !== undefined) init.body = body;

    const response = await fetchFn(requestUrl(source, query, limit), init);
    httpStatus = response.status;
    if (!response.ok) throw new Error(`Discovery fetch failed: HTTP ${response.status}`);

    const json = (await response.json()) as unknown;
    for (const item of normalizeDiscoveryItems(json, provider)) {
      const entry = sourceEntryFromDiscoveryItem(item, source, query, provider);
      if (entry) entries.push(entry);
    }
  }

  return { entries: dedupeEntries(entries).slice(0, source.maxItemsPerFetch), httpStatus };
}

function requestUrl(source: SignalSource, query: string, limit: number): string {
  const url = new URL(source.url);
  const provider = discoveryProvider(source.metadata.provider);
  if (provider === 'apify') {
    url.searchParams.delete('token');
    url.searchParams.set('format', 'json');
    url.searchParams.set('clean', '1');
    url.searchParams.set('maxItems', String(limit));
    url.searchParams.set('maxTotalChargeUsd', String(requiredPositiveNumber(source.metadata.max_total_charge_usd, 'max_total_charge_usd')));
    url.searchParams.set('timeout', String(apifyTimeoutSeconds(source)));
    return url.toString();
  }
  if (requestMethod(source) !== 'GET') return source.url;
  if (provider === 'x') {
    url.searchParams.set('query', query);
    url.searchParams.set('max_results', String(Math.min(100, Math.max(10, limit))));
    url.searchParams.set('tweet.fields', 'author_id,created_at,conversation_id,public_metrics');
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set('user.fields', 'id,name,username');
    return url.toString();
  }
  if (provider === 'youtube') {
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('order', firstString(source.metadata.order) || 'date');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', String(Math.min(50, limit)));
    const publishedAfter = firstString(source.metadata.published_after);
    if (publishedAfter) url.searchParams.set('publishedAfter', publishedAfter);
    return url.toString();
  }
  if (provider === 'youtube-comments') {
    url.searchParams.set('part', 'snippet,replies');
    url.searchParams.set('videoId', query);
    url.searchParams.set('order', firstString(source.metadata.order) || 'time');
    url.searchParams.set('textFormat', 'plainText');
    url.searchParams.set('maxResults', String(Math.min(100, limit)));
    return url.toString();
  }
  const queryParam = typeof source.metadata.query_param === 'string' ? source.metadata.query_param : 'q';
  const limitParam = typeof source.metadata.limit_param === 'string' ? source.metadata.limit_param : 'limit';
  url.searchParams.set(queryParam, query);
  url.searchParams.set(limitParam, String(limit));
  return url.toString();
}

function discoveryQueries(source: SignalSource): string[] {
  const queries = source.metadata.queries;
  return Array.isArray(queries)
    ? queries.filter((query): query is string => typeof query === 'string' && query.trim().length > 0)
    : [];
}

function discoveryProvider(value: unknown): DiscoveryProvider {
  if (value === 'firecrawl') return 'firecrawl';
  if (value === 'tavily') return 'tavily';
  if (value === 'x') return 'x';
  if (value === 'youtube') return 'youtube';
  if (value === 'youtube-comments') return 'youtube-comments';
  if (value === 'apify') return 'apify';
  return 'generic';
}

function requestMethod(source: SignalSource): 'GET' | 'POST' {
  if (source.metadata.provider === 'x' || source.metadata.provider === 'youtube' || source.metadata.provider === 'youtube-comments') return 'GET';
  return source.metadata.method === 'GET' ? 'GET' : 'POST';
}

function requestHeaders(source: SignalSource): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (source.metadata.provider === 'tavily') return headers;
  const token = discoveryToken(source);
  if (source.metadata.provider === 'youtube' || source.metadata.provider === 'youtube-comments') {
    if (!token) throw new Error('YouTube discovery source is missing YOUTUBE_API_KEY');
    headers['x-goog-api-key'] = token;
  } else if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

function discoveryToken(source: SignalSource): string {
  const envName = typeof source.metadata.api_token_env === 'string'
    ? source.metadata.api_token_env
    : source.metadata.provider === 'tavily'
      ? 'TAVILY_API_KEY'
      : source.metadata.provider === 'x'
        ? 'X_API_BEARER_TOKEN'
        : source.metadata.provider === 'youtube' || source.metadata.provider === 'youtube-comments'
          ? 'YOUTUBE_API_KEY'
          : source.metadata.provider === 'apify'
            ? 'APIFY_API_TOKEN'
            : 'FIRECRAWL_API_KEY';
  return process.env[envName] ?? process.env.SOURCEFOUNDRY_DISCOVERY_API_TOKEN ?? '';
}

function requestBody(
  source: SignalSource,
  provider: DiscoveryProvider,
  query: string,
  limit: number,
): string | undefined {
  if (requestMethod(source) === 'GET') return undefined;

  if (provider === 'firecrawl') {
    return JSON.stringify({
      query,
      limit,
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: true,
      },
    });
  }

  if (provider === 'tavily') {
    const token = discoveryToken(source);
    if (!token) throw new Error('Tavily discovery source is missing TAVILY_API_KEY');
    const body: JsonRecord = {
      api_key: token,
      query,
      topic: firstString(source.metadata.topic) || 'news',
      search_depth: firstString(source.metadata.search_depth) || 'advanced',
      max_results: limit,
      include_answer: false,
      include_raw_content: true,
    };
    const includeDomains = stringArray(source.metadata.include_domains);
    const excludeDomains = stringArray(source.metadata.exclude_domains);
    if (includeDomains.length > 0) body.include_domains = includeDomains;
    if (excludeDomains.length > 0) body.exclude_domains = excludeDomains;
    return JSON.stringify(body);
  }

  if (provider === 'apify') {
    if (!discoveryToken(source)) throw new Error('Apify discovery source is missing APIFY_API_TOKEN');
    const template = objectValue(source.metadata.request_template);
    if (Object.keys(template).length === 0) {
      throw new Error('Apify enrichment source requires metadata.request_template');
    }
    const replace = (value: unknown): unknown => {
      if (value === '$query') return query;
      if (value === '$limit') return limit;
      if (Array.isArray(value)) return value.map(replace);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as JsonRecord).map(([key, child]) => [key, replace(child)]));
      }
      return value;
    };
    return JSON.stringify(replace(template));
  }

  return JSON.stringify({ query, limit });
}

function normalizeDiscoveryItems(body: unknown, provider: DiscoveryProvider): DiscoveryItem[] {
  if (provider === 'x') return normalizeXItems(body);
  if (provider === 'youtube') return normalizeYouTubeItems(body);
  if (provider === 'youtube-comments') return normalizeYouTubeCommentItems(body);
  if (provider === 'apify') return normalizeApifyItems(body);
  const records = candidateArrays(body)
    .find((items) => items.length > 0) ?? [];

  return records
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      title: firstString(item.title, item.name, item.metadata && objectValue(item.metadata).title),
      url: firstString(item.url, item.link, item.sourceUrl),
      summary: firstString(
        item.summary,
        item.description,
        item.raw_content,
        item.content,
        item.text,
        item.markdown,
        item.snippet,
      ),
      author: firstString(item.author, item.byline, item.source),
      publishedAt: parseDate(firstString(
        item.publishedAt,
        item.published_at,
        item.publishedDate,
        item.published_date,
        item.published_date_utc,
        objectValue(item.metadata).publishedTime,
      )),
      raw: item,
    }))
    .filter((item) => item.title && item.url);
}

function normalizeXItems(body: unknown): DiscoveryItem[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const record = body as JsonRecord;
  const includes = objectValue(record.includes);
  const users = Array.isArray(includes.users) ? includes.users : [];
  const userById = new Map(users.flatMap((value) => {
    const user = objectValue(value);
    const id = firstString(user.id);
    return id ? [[id, user] as const] : [];
  }));
  const tweets = Array.isArray(record.data) ? record.data : [];
  return tweets.flatMap((value) => {
    const tweet = objectValue(value);
    const id = firstString(tweet.id);
    const text = firstString(tweet.text);
    if (!id || !text) return [];
    const user = userById.get(firstString(tweet.author_id)) ?? {};
    const username = firstString(user.username);
    return [{
      title: cleanText(text).slice(0, 180),
      url: username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`,
      summary: cleanText(text),
      author: firstString(user.name, username, tweet.author_id),
      publishedAt: parseDate(firstString(tweet.created_at)),
      raw: tweet,
    }];
  });
}

function normalizeYouTubeItems(body: unknown): DiscoveryItem[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const items = Array.isArray((body as JsonRecord).items) ? (body as JsonRecord).items as unknown[] : [];
  return items.flatMap((value) => {
    const item = objectValue(value);
    const id = objectValue(item.id);
    const snippet = objectValue(item.snippet);
    const videoId = firstString(id.videoId, item.videoId);
    const title = firstString(snippet.title, item.title);
    if (!videoId || !title) return [];
    return [{
      title: cleanText(title),
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      summary: cleanText(firstString(snippet.description, item.description)),
      author: cleanText(firstString(snippet.channelTitle, item.author)),
      publishedAt: parseDate(firstString(snippet.publishedAt, item.publishedAt)),
      raw: item,
    }];
  });
}

function normalizeYouTubeCommentItems(body: unknown): DiscoveryItem[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const items = Array.isArray((body as JsonRecord).items) ? (body as JsonRecord).items as unknown[] : [];
  return items.flatMap((value) => {
    const item = objectValue(value);
    const topLevel = objectValue(objectValue(objectValue(item.snippet).topLevelComment).snippet);
    const topLevelComment = objectValue(objectValue(item.snippet).topLevelComment);
    const commentId = firstString(topLevelComment.id, item.id);
    const videoId = firstString(topLevel.videoId);
    const text = firstString(topLevel.textDisplay, topLevel.textOriginal);
    if (!commentId || !videoId || !text) return [];
    return [{
      title: cleanText(text).slice(0, 180),
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(commentId)}`,
      summary: cleanText(text),
      author: cleanText(firstString(topLevel.authorDisplayName, topLevel.authorChannelId)),
      publishedAt: parseDate(firstString(topLevel.publishedAt, topLevel.updatedAt)),
      raw: item,
    }];
  });
}

function normalizeApifyItems(body: unknown): DiscoveryItem[] {
  const records = candidateArrays(body).find((items) => items.length > 0) ?? [];
  const observedAt = new Date().toISOString();
  return records.flatMap((value) => {
    const item = objectValue(value);
    const author = objectValue(item.author);
    const text = cleanText(firstString(
      item.text,
      item.postText,
      item.post_text,
      item.headline,
      item.content,
      item.commentary,
      item.description,
    ));
    const displayAuthor = cleanText(firstString(
      item.authorFullName,
      item.authorName,
      item.profileName,
      item.companyName,
      author.name,
      author.fullName,
    ));
    const url = firstString(item.postUrl, item.url, item.linkedinUrl, item.link);
    if (!url || !text) return [];

    const rawComments = firstArray(
      item.comments,
      objectValue(item.comments).items,
      item.topComments,
      item.commentSnippets,
    );
    const participants = dedupeParticipants(rawComments
      .flatMap((comment): SignalConversationParticipant[] => {
        const record = objectValue(comment);
        const commentAuthor = objectValue(record.author);
        const displayName = cleanText(firstString(
          record.authorName,
          record.authorFullName,
          record.profileName,
          commentAuthor.name,
          commentAuthor.fullName,
        ));
        const excerpt = cleanText(firstString(record.text, record.commentText, record.content, record.commentary));
        if (!displayName || !excerpt) return [];
        return [{
          displayName,
          handle: nullableString(firstString(
            record.authorHandle,
            record.username,
            commentAuthor.publicIdentifier,
            commentAuthor.username,
          )),
          profileUrl: nullableLinkedInUrl(firstString(
            record.authorProfileUrl,
            record.profileUrl,
            commentAuthor.profileUrl,
            commentAuthor.linkedinUrl,
          )),
          commentUrl: nullableLinkedInUrl(firstString(record.commentUrl, record.permalink, record.url)),
          excerpt: excerpt.slice(0, 500),
          publishedAt: parseDateFrom(record.publishedAt, record.postedAt, record.createdAt, record.timestamp),
        }];
      }))
      .slice(0, 10);
    const commentsTotal = firstNonnegativeInt(
      item.numComments,
      item.commentCount,
      item.num_comments,
      objectValue(item.stats).comments,
      objectValue(item.engagement).comments,
    );
    const normalizedCommentsTotal = commentsTotal === null ? null : Math.max(commentsTotal, rawComments.length);
    const explicitPartial = firstBoolean(
      item.commentsTruncated,
      item.comments_truncated,
      item.isPartial,
      item.partial,
    );

    return [{
      title: text.slice(0, 180),
      url,
      summary: text,
      author: displayAuthor,
      publishedAt: parseDateFrom(
        item.postedAtISO,
        item.postedAt,
        item.postedAtTimestamp,
        item.timestamp,
        item.datePublished,
        item.date_posted,
        item.createdAt,
      ),
      conversation: {
        provider: 'apify',
        observedAt,
        commentsReturned: rawComments.length,
        commentsTotal: normalizedCommentsTotal,
        partial: explicitPartial ?? (normalizedCommentsTotal !== null && rawComments.length < normalizedCommentsTotal),
        participants,
      },
      raw: item,
    }];
  });
}

function candidateArrays(body: unknown): Record<string, unknown>[][] {
  if (Array.isArray(body)) return [body as Record<string, unknown>[]];
  if (!body || typeof body !== 'object') return [];
  const record = body as Record<string, unknown>;
  return [record.data, record.results, record.items, record.documents]
    .filter(Array.isArray) as Record<string, unknown>[][];
}

function sourceEntryFromDiscoveryItem(
  item: DiscoveryItem,
  source: SignalSource,
  query: string,
  provider: DiscoveryProvider,
): SourceEntry | null {
  if (!item.title || !item.url) return null;
  if (provider === 'apify' && (!isActionableLinkedInUrl(item.url) || !sameLinkedInPost(query, item.url))) return null;
  const canonicalUrl = canonicalizeUrl(item.url);
  return {
    title: cleanText(item.title),
    url: item.url,
    canonicalUrl,
    summary: cleanText(item.summary),
    author: cleanText(item.author),
    publishedAt: item.publishedAt,
    ...(item.conversation ? { conversation: item.conversation } : {}),
    raw: {
      provider,
      ...(provider === 'apify' ? { observationMode: 'enrichment' } : {}),
      query,
      sourceUrl: source.url,
      rawHash: sha256(JSON.stringify(item.raw)),
      ...(provider === 'apify' ? {} : { raw: item.raw }),
    },
  };
}

function dedupeEntries(entries: SourceEntry[]): SourceEntry[] {
  const seen = new Set<string>();
  const deduped: SourceEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.canonicalUrl)) continue;
    seen.add(entry.canonicalUrl);
    deduped.push(entry);
  }
  return deduped;
}

function cleanText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function firstArray(...values: unknown[]): unknown[] {
  return values.find(Array.isArray) ?? [];
}

function firstBoolean(...values: unknown[]): boolean | null {
  for (const value of values) if (typeof value === 'boolean') return value;
  return null;
}

function firstNonnegativeInt(...values: unknown[]): number | null {
  for (const value of values) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (Number.isFinite(number) && number >= 0) return Math.floor(number);
  }
  return null;
}

function nullableString(value: string): string | null {
  return value || null;
}

function nullableLinkedInUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && (host === 'linkedin.com' || host.endsWith('.linkedin.com'))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function dedupeParticipants(participants: SignalConversationParticipant[]): SignalConversationParticipant[] {
  const seen = new Set<string>();
  return participants.filter((participant) => {
    const key = (participant.handle || participant.profileUrl || participant.displayName).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isActionableLinkedInUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol !== 'https:' || (host !== 'linkedin.com' && !host.endsWith('.linkedin.com'))) return false;
    let path = url.pathname;
    try { path = decodeURIComponent(path); } catch { return false; }
    return /^\/posts\/[^/]+/i.test(path)
      || /^\/feed\/update\/urn:li:(?:activity|share):\d+/i.test(path)
      || /^\/pulse\/[^/]+/i.test(path);
  } catch {
    return false;
  }
}

function linkedInPostIdentity(value: string): string {
  try {
    const url = new URL(value);
    const decoded = decodeURIComponent(`${url.pathname}${url.search}`);
    return decoded.match(/(?:activity|share)[-:](\d{6,})/i)?.[1] ?? canonicalizeUrl(value);
  } catch {
    return '';
  }
}

function sameLinkedInPost(expected: string, observed: string): boolean {
  const left = linkedInPostIdentity(expected);
  const right = linkedInPostIdentity(observed);
  return Boolean(left && right && left === right);
}

function requiredPositiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Apify enrichment source requires positive metadata.${field}`);
  }
  return value;
}

function templateContains(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((child) => templateContains(child, expected));
  if (value && typeof value === 'object') return Object.values(value as JsonRecord).some((child) => templateContains(child, expected));
  return false;
}

function templateContainsCredential(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(templateContainsCredential);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as JsonRecord).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized.includes('cookie')
      || normalized === 'liat'
      || normalized.includes('sessiontoken')
      || templateContainsCredential(child);
  });
}

function apifyTimeoutSeconds(source: SignalSource): number {
  const requested = typeof source.metadata.actor_timeout_seconds === 'number'
    ? source.metadata.actor_timeout_seconds
    : Math.max(1, source.timeoutSeconds - 5);
  return Math.max(1, Math.min(300, Math.floor(requested), Math.max(1, source.timeoutSeconds - 1)));
}

function validateApifyRun(source: SignalSource, queries: string[]): void {
  validateDiscoverySourceConfiguration(source);
  if (!queries.every(isActionableLinkedInUrl)) {
    throw new Error('Apify enrichment accepts only concrete public LinkedIn post URLs');
  }
  const perRequest = requiredPositiveNumber(source.metadata.max_total_charge_usd, 'max_total_charge_usd');
  const perRun = requiredPositiveNumber(source.metadata.max_run_charge_usd, 'max_run_charge_usd');
  if (perRequest * queries.length > perRun + Number.EPSILON) {
    throw new Error('Apify enrichment charge caps exceed the bounded per-request or whole-run policy');
  }
}

export function validateDiscoverySourceConfiguration(source: SignalSource): void {
  if (source.metadata.provider !== 'apify') return;
  let endpoint: URL;
  try {
    endpoint = new URL(source.url);
  } catch {
    throw new Error('Apify enrichment source URL is invalid');
  }
  if (
    endpoint.protocol !== 'https:'
    || endpoint.hostname !== 'api.apify.com'
    || endpoint.username
    || endpoint.password
    || endpoint.searchParams.has('token')
    || !/^\/v2\/(?:acts|actors)\/[^/]+\/run-sync-get-dataset-items\/?$/.test(endpoint.pathname)
  ) {
    throw new Error('Apify token may be sent only to the HTTPS synchronous Actor dataset endpoint without URL credentials');
  }
  const template = objectValue(source.metadata.request_template);
  if (Object.keys(template).length === 0 || !templateContains(template, '$query')) {
    throw new Error('Apify enrichment source requires metadata.request_template containing $query');
  }
  if (templateContainsCredential(template)) {
    throw new Error('Apify enrichment request_template must not contain cookies or LinkedIn session credentials');
  }
  const perRequest = requiredPositiveNumber(source.metadata.max_total_charge_usd, 'max_total_charge_usd');
  const perRun = requiredPositiveNumber(source.metadata.max_run_charge_usd, 'max_run_charge_usd');
  if (perRequest > 2 || perRun > 10) {
    throw new Error('Apify enrichment charge caps exceed the bounded per-request or whole-run policy');
  }
}

function parseDate(input: string): string | null {
  if (!input) return null;
  const timestamp = Date.parse(input);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parseDateFrom(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      const parsed = parseDate(value);
      if (parsed) return parsed;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
      const date = new Date(milliseconds);
      if (Number.isFinite(date.getTime())) return date.toISOString();
    }
  }
  return null;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
