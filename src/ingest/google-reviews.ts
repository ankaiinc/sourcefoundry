import type { SignalSource, SourceEntry, JsonRecord } from '../types.js';

/** Bounded Google review pagination through the existing Serper connection.
 * Review URLs, not the place URL, are the deduplication key. No public-review
 * permissions or successful meal verification are inferred from collection.
 */
export async function fetchGoogleReviews(source: SignalSource, fetchFn: typeof fetch, signal: AbortSignal): Promise<{entries: SourceEntry[]; httpStatus: number}> {
  const endpoint = new URL(source.url);
  if (endpoint.origin !== 'https://google.serper.dev' || endpoint.pathname !== '/reviews' || endpoint.search || endpoint.username || endpoint.password) throw new Error('Invalid Google review endpoint');
  const places = source.metadata.queries;
  if (!Array.isArray(places) || places.length !== 1 || typeof places[0] !== 'string' || !/^ChIJ[A-Za-z0-9_-]+$/.test(places[0])) throw new Error('Google reviews require one exact Google place ID');
  const maxPages = Number(source.metadata.max_pages ?? 3);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 5) throw new Error('Google review max_pages must be 1–5');
  if (!process.env.SERPER_API_KEY) throw new Error('Google reviews require SERPER_API_KEY');
  const entries: SourceEntry[] = [];
  const ids = new Set<string>(); const cursors = new Set<string>();
  let cursor: string | undefined; let pages = 0; let received = 0; let excluded = 0;
  let hasMore = false; let truncatedPage = false;
  do {
    const response = await fetchFn(source.url, {method:'POST', signal, headers:{'Content-Type':'application/json','X-API-KEY':process.env.SERPER_API_KEY},
      body:JSON.stringify({placeId:places[0],gl:'in',hl:'en',sortBy:'mostRelevant',...(cursor ? {nextPageToken:cursor} : {})})});
    if (!response.ok) throw new Error(`Google review collection failed: HTTP ${response.status}; no partial run was accepted`);
    const data = await response.json() as Record<string,unknown>;
    if (!Array.isArray(data.reviews)) throw new Error('Google review response missing reviews array');
    pages++; received += data.reviews.length;
    for (const item of data.reviews) {
      if (!item || typeof item !== 'object') {excluded++;continue;}
      const r = item as Record<string,unknown>;
      const text = typeof r.text === 'string' ? r.text : typeof r.snippet === 'string' ? r.snippet : '';
      const url = typeof r.link === 'string' ? r.link : typeof r.reviewUrl === 'string' ? r.reviewUrl : '';
      let parsed: URL; try {parsed=new URL(url);} catch {excluded++;continue;}
      if (!text.trim() || parsed.protocol !== 'https:' || parsed.username || parsed.password || !/^(www\.)?google\.com$/.test(parsed.hostname) || !parsed.pathname.startsWith('/maps/')) {excluded++;continue;}
      if (ids.has(url)) continue;
      if (entries.length >= source.maxItemsPerFetch) {truncatedPage=true;continue;}
      ids.add(url);
      const user = r.user && typeof r.user === 'object' ? r.user as Record<string,unknown> : {};
      const author = typeof user.name === 'string' ? user.name : typeof r.author === 'string' ? r.author : '';
      const date = typeof r.isoDate === 'string' && Number.isFinite(Date.parse(r.isoDate)) ? new Date(r.isoDate).toISOString() : null;
      entries.push({title:`Google review of ${source.name}`,url,canonicalUrl:url,summary:text,author,publishedAt:date,
        raw:{provider:'serper',observationMode:'review',placeId:places[0],reviewId:typeof r.reviewId==='string'?r.reviewId:url,rating:typeof r.rating==='number'?r.rating:null,rightsStatus:'unreviewed',query:places[0]}});
    }
    cursor=typeof data.nextPageToken==='string' && data.nextPageToken ? data.nextPageToken : undefined;
    hasMore=!!cursor;
    if(cursor && cursors.has(cursor)) throw new Error('Google review pagination cursor repeated; run incomplete');
    if(cursor)cursors.add(cursor);
  } while(cursor && pages<maxPages && entries.length<source.maxItemsPerFetch);
  if(received && !entries.length) throw new Error('Google review response contained no usable review text with original links');
  const coverage: JsonRecord={pagesFetched:pages,recordsReceived:received,reviewsReturned:entries.length,excludedRecords:excluded,partial:hasMore||truncatedPage,sort:'mostRelevant'};
  for(const entry of entries) entry.raw.collection=coverage;
  return {entries,httpStatus:200};
}
