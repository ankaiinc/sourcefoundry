import { sha256 } from '../hash.js';
import type { JsonRecord, SignalSource, SourceEntry } from '../types.js';
import { canonicalizeUrl } from '../url.js';

type DiscoveryProvider = 'firecrawl' | 'tavily' | 'x' | 'youtube' | 'youtube-comments' | 'apify' | 'generic';

type DiscoveryItem = {
  title: string;
  url: string;
  summary: string;
  author: string;
  publishedAt: string | null;
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
): Promise<DiscoveryFetchResult> {
  const queries = discoveryQueries(source);
  if (queries.length === 0) {
    throw new Error(`Discovery source ${source.id} has no metadata.queries`);
  }

  const provider = discoveryProvider(source.metadata.provider);
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
  if (requestMethod(source) !== 'GET') return source.url;
  const url = new URL(source.url);
  const provider = discoveryProvider(source.metadata.provider);
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
    const replace = (value: unknown): unknown => {
      if (value === '$query') return query;
      if (value === '$limit') return limit;
      if (Array.isArray(value)) return value.map(replace);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as JsonRecord).map(([key, child]) => [key, replace(child)]));
      }
      return value;
    };
    return JSON.stringify(Object.keys(template).length > 0
      ? replace(template)
      : { searchQueries: [query], maxItems: limit });
  }

  return JSON.stringify({ query, limit });
}

function normalizeDiscoveryItems(body: unknown, provider: DiscoveryProvider): DiscoveryItem[] {
  if (provider === 'x') return normalizeXItems(body);
  if (provider === 'youtube') return normalizeYouTubeItems(body);
  if (provider === 'youtube-comments') return normalizeYouTubeCommentItems(body);
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
  const canonicalUrl = canonicalizeUrl(item.url);
  return {
    title: cleanText(item.title),
    url: item.url,
    canonicalUrl,
    summary: cleanText(item.summary),
    author: cleanText(item.author),
    publishedAt: item.publishedAt,
    raw: {
      provider,
      query,
      sourceUrl: source.url,
      rawHash: sha256(JSON.stringify(item.raw)),
      raw: item.raw,
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

function parseDate(input: string): string | null {
  if (!input) return null;
  const timestamp = Date.parse(input);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
