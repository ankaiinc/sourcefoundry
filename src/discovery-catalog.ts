export type DiscoverySurfaceId = 'web' | 'x' | 'youtube' | 'linkedin' | 'reddit' | 'github' | 'hacker-news' | 'product-hunt' | 'rss' | 'podcasts' | 'instagram-tiktok';
export type CostTier = 'free' | 'quota' | 'paid' | 'enterprise';
export type ReliabilityTier = 'high' | 'medium' | 'low';
export type AccessKind = 'official-api' | 'public-feed' | 'search-index' | 'managed-crawler' | 'self-hosted-crawler';

export interface DiscoveryMethod {
  id: string; surface: DiscoverySurfaceId; provider: string; name: string; accessKind: AccessKind;
  costTier: CostTier; reliability: ReliabilityTier; coverage: 'recent' | 'archive' | 'known-entities' | 'broad';
  authoritative: boolean; search: boolean; requiresApproval: boolean; credentialEnv?: string; adapter?: string;
  endpoint?: string; caveat: string;
}
export interface DiscoveryBundle { id: string; name: string; intent: string; maxCostTier: CostTier; allowCrawlers: boolean; requireAuthoritative: boolean; preferredAccessKinds: AccessKind[] }
export interface DiscoveryPlanRequest {
  surfaces?: DiscoverySurfaceId[]; bundle?: string; maxCostTier?: CostTier; allowCrawlers?: boolean;
  requireAuthoritative?: boolean; preferredProviders?: Partial<Record<DiscoverySurfaceId, string[]>>;
  excludedProviders?: string[]; fallbacksPerSurface?: number;
}

const METHODS: DiscoveryMethod[] = [
  m('web-brave','web','brave','Brave Search API','official-api','paid','high','broad',false,true,'BRAVE_SEARCH_API_KEY','brave','https://api.search.brave.com/res/v1/web/search','Independent metered web index.'),
  m('web-exa','web','exa','Exa','search-index','paid','high','broad',false,true,'EXA_API_KEY','exa','https://api.exa.ai/search','Semantic discovery, not an authoritative social archive.'),
  m('web-tavily','web','tavily','Tavily','search-index','paid','medium','broad',false,true,'TAVILY_API_KEY','tavily','https://api.tavily.com/search','Discovery and page context; credits can be exhausted.'),
  m('web-serper','web','serper','Serper Google results','search-index','paid','medium','broad',false,true,'SERPER_API_KEY','serper','https://google.serper.dev/search','Google-index proxy with provider-controlled credits.'),
  m('web-firecrawl','web','firecrawl','Firecrawl Search','managed-crawler','paid','medium','broad',false,true,'FIRECRAWL_API_KEY','firecrawl','https://api.firecrawl.dev/v1/search','Good extraction coverage; not source-authoritative.'),
  m('web-rss','web','rss','Publisher RSS and Atom','public-feed','free','high','known-entities',true,false,undefined,'rss',undefined,'Excellent for known publishers, weak for open discovery.'),
  m('x-official-recent','x','x','X API recent search','official-api','paid','high','recent',true,true,'X_API_BEARER_TOKEN','x','https://api.x.com/2/tweets/search/recent','Official and attributable; pay-per-usage.'),
  m('x-official-archive','x','x-enterprise','X API full-archive search','official-api','enterprise','high','archive',true,true,'X_API_BEARER_TOKEN','x','https://api.x.com/2/tweets/search/all','Best archive fidelity; materially higher access cost.'),
  m('x-search-index','x','web-index','Web-indexed X posts','search-index','paid','medium','archive',false,true,'EXA_API_KEY','exa','https://api.exa.ai/search','Incomplete fallback; canonical X URL must be recovered and verified.'),
  m('x-apify','x','apify','Reviewed public X Actor','managed-crawler','paid','low','broad',false,true,'APIFY_API_TOKEN','apify','https://api.apify.com','Requires a reviewed actor, policy check, and spend caps.',true),
  m('youtube-official','youtube','youtube','YouTube Data API search','official-api','quota','high','broad',true,true,'YOUTUBE_API_KEY','youtube','https://www.googleapis.com/youtube/v3/search','Official search with project quota.'),
  m('youtube-channel-feeds','youtube','youtube-rss','YouTube channel RSS','public-feed','free','high','known-entities',true,false,undefined,'rss',undefined,'Free and stable for known channels, not keyword discovery.'),
  m('youtube-search-index','youtube','web-index','Web search over YouTube','search-index','paid','medium','broad',false,true,'BRAVE_SEARCH_API_KEY','brave',undefined,'Fallback without full YouTube metadata.'),
  m('linkedin-official-owned','linkedin','linkedin','LinkedIn approved/owned content APIs','official-api','enterprise','high','known-entities',true,false,'LINKEDIN_ACCESS_TOKEN',undefined,'https://api.linkedin.com/rest/posts','Permission-gated; no general public-post search equivalent.',true),
  m('linkedin-web-index','linkedin','web-index','Web-indexed LinkedIn posts','search-index','paid','medium','broad',false,true,'TAVILY_API_KEY','tavily','https://api.tavily.com/search','Good leads, incomplete attribution and freshness.'),
  m('linkedin-apify','linkedin','apify','Reviewed LinkedIn public-data Actor','managed-crawler','paid','low','broad',false,true,'APIFY_API_TOKEN','apify','https://api.apify.com','Bounded public-data enrichment only.',true),
  m('reddit-official','reddit','reddit','Reddit OAuth API','official-api','quota','high','recent',true,true,'REDDIT_ACCESS_TOKEN',undefined,'https://oauth.reddit.com/search','Approved application required; broad comment search is limited.'),
  m('reddit-rss','reddit','reddit-rss','Subreddit and search RSS','public-feed','free','medium','recent',true,true,undefined,'rss',undefined,'Useful low-volume fallback; behavior can change.'),
  m('reddit-web-index','reddit','web-index','Web-indexed Reddit posts','search-index','paid','medium','archive',false,true,'BRAVE_SEARCH_API_KEY','brave',undefined,'Coverage and ranking come from the search provider.'),
  m('github-official','github','github','GitHub Search API','official-api','quota','high','broad',true,true,'GITHUB_TOKEN',undefined,'https://api.github.com/search','Strong repository, code, issue, and user search.'),
  m('github-events','github','github-events','GitHub public events','official-api','free','high','recent',true,false,undefined,undefined,'https://api.github.com/events','Recent activity, not historical search.'),
  m('hn-algolia','hacker-news','algolia-hn','Algolia Hacker News Search','official-api','free','high','archive',true,true,undefined,undefined,'https://hn.algolia.com/api/v1/search','Free archive search for stories and comments.'),
  m('hn-firebase','hacker-news','hn-firebase','Hacker News Firebase API','official-api','free','high','known-entities',true,false,undefined,undefined,'https://hacker-news.firebaseio.com/v0','Authoritative lookup and feeds, no keyword search.'),
  m('producthunt-graphql','product-hunt','producthunt','Product Hunt GraphQL API','official-api','quota','high','broad',true,true,'PRODUCT_HUNT_TOKEN',undefined,'https://api.producthunt.com/v2/api/graphql','Official product data; token and policy apply.'),
  m('producthunt-rss','product-hunt','producthunt-rss','Product Hunt feeds','public-feed','free','medium','recent',true,false,undefined,'rss',undefined,'Simple new-product feed with weaker history.'),
  m('rss-direct','rss','rss','Direct RSS/Atom subscription','public-feed','free','high','known-entities',true,false,undefined,'rss',undefined,'Most reliable low-cost option when exposed.'),
  m('rss-discovery','rss','feed-discovery','Website feed autodiscovery','self-hosted-crawler','free','medium','known-entities',true,false,undefined,undefined,undefined,'Inspect publisher feed links; respect robots and rate limits.'),
  m('podcast-index','podcasts','podcast-index','Podcast Index API','official-api','free','high','broad',true,true,'PODCAST_INDEX_KEY',undefined,'https://api.podcastindex.org/api/1.0','Open podcast directory; transcripts not guaranteed.'),
  m('podcast-rss','podcasts','podcast-rss','Podcast RSS feeds','public-feed','free','high','known-entities',true,false,undefined,'rss',undefined,'Authoritative episode metadata for known shows.'),
  m('social-search-index','instagram-tiktok','web-index','Web-indexed Instagram/TikTok','search-index','paid','low','broad',false,true,'BRAVE_SEARCH_API_KEY','brave',undefined,'Partial coverage; pages often require login.'),
  m('social-apify','instagram-tiktok','apify','Reviewed public-data Actor','managed-crawler','paid','low','broad',false,true,'APIFY_API_TOKEN','apify','https://api.apify.com','Reviewed actors, public data, and hard spend caps only.',true),
];

const BUNDLES: DiscoveryBundle[] = [
  { id:'official-first', name:'Official first', intent:'Highest attribution and operational reliability.', maxCostTier:'enterprise', allowCrawlers:false, requireAuthoritative:true, preferredAccessKinds:['official-api','public-feed'] },
  { id:'reliable-balanced', name:'Reliable balanced', intent:'Official sources first, paid indexes as fallbacks.', maxCostTier:'paid', allowCrawlers:false, requireAuthoritative:false, preferredAccessKinds:['official-api','public-feed','search-index'] },
  { id:'free-and-owned', name:'Free and owned', intent:'Feeds and free official APIs for known sources.', maxCostTier:'free', allowCrawlers:false, requireAuthoritative:true, preferredAccessKinds:['public-feed','official-api'] },
  { id:'broad-discovery', name:'Broad discovery', intent:'Maximum recall across web and social indexes.', maxCostTier:'paid', allowCrawlers:true, requireAuthoritative:false, preferredAccessKinds:['official-api','search-index','public-feed','managed-crawler'] },
  { id:'creator-attribution', name:'Creator attribution', intent:'Prioritize original creator posts and canonical evidence.', maxCostTier:'paid', allowCrawlers:false, requireAuthoritative:false, preferredAccessKinds:['official-api','public-feed','search-index'] },
];
const COST = { free:0, quota:1, paid:2, enterprise:3 } as const;
const RELIABILITY = { high:0, medium:1, low:2 } as const;

export function discoveryCatalog() { return { schemaVersion:1, surfaces:surfaceSummaries(), methods:METHODS, bundles:BUNDLES }; }
export function resolveDiscoveryPlan(input: DiscoveryPlanRequest = {}) {
  const bundle = BUNDLES.find((item) => item.id === (input.bundle ?? 'reliable-balanced'));
  if (!bundle) throw new Error(`Unknown discovery bundle: ${input.bundle}`);
  const known = surfaceSummaries();
  const surfaces = input.surfaces?.length ? [...new Set(input.surfaces)] : known.map((item) => item.id);
  for (const surface of surfaces) if (!known.some((item) => item.id === surface)) throw new Error(`Unknown discovery surface: ${surface}`);
  const maxCostTier = input.maxCostTier ?? bundle.maxCostTier;
  if (!(maxCostTier in COST)) throw new Error(`Unknown cost tier: ${String(maxCostTier)}`);
  const allowCrawlers = input.allowCrawlers ?? bundle.allowCrawlers;
  const requireAuthoritative = input.requireAuthoritative ?? bundle.requireAuthoritative;
  const excluded = new Set(input.excludedProviders ?? []);
  const fallbackCount = Math.min(4, Math.max(0, input.fallbacksPerSurface ?? 2));
  const selections = surfaces.map((surface) => {
    const preferred = input.preferredProviders?.[surface] ?? [];
    const candidates = METHODS.filter((item) => item.surface === surface && COST[item.costTier] <= COST[maxCostTier])
      .filter((item) => !excluded.has(item.provider) && (allowCrawlers || !['managed-crawler','self-hosted-crawler'].includes(item.accessKind)) && (!requireAuthoritative || item.authoritative))
      .sort((a,b) => {
        const pa=preferred.indexOf(a.provider), pb=preferred.indexOf(b.provider);
        if (pa>=0 || pb>=0) return (pa<0?999:pa)-(pb<0?999:pb);
        const ka=bundle.preferredAccessKinds.indexOf(a.accessKind), kb=bundle.preferredAccessKinds.indexOf(b.accessKind);
        return (ka<0?999:ka)-(kb<0?999:kb) || RELIABILITY[a.reliability]-RELIABILITY[b.reliability] || COST[a.costTier]-COST[b.costTier];
      });
    return { surface, primary:candidates[0] ?? null, fallbacks:candidates.slice(1,fallbackCount+1) };
  });
  const requiredCredentials = [...new Set(selections.flatMap((item) => [item.primary,...item.fallbacks].flatMap((candidate) => candidate?.credentialEnv ?? [])))];
  return { schemaVersion:1, bundle, constraints:{ maxCostTier, allowCrawlers, requireAuthoritative }, selections, requiredCredentials, uncoveredSurfaces:selections.filter((item)=>!item.primary).map((item)=>item.surface) };
}

function surfaceSummaries(): Array<{id:DiscoverySurfaceId;name:string;value:string}> { return [
  {id:'web',name:'Open web',value:'Sites, news, blogs, and project pages.'},{id:'x',name:'X',value:'First-person launches and creator attribution.'},
  {id:'youtube',name:'YouTube',value:'Video launches, demos, and channel activity.'},{id:'linkedin',name:'LinkedIn',value:'Professional launches and practitioner posts.'},
  {id:'reddit',name:'Reddit',value:'Niche communities and early product feedback.'},{id:'github',name:'GitHub',value:'Projects, releases, code, and developer activity.'},
  {id:'hacker-news',name:'Hacker News',value:'Technical launches and historical discussion.'},{id:'product-hunt',name:'Product Hunt',value:'Structured launches and maker metadata.'},
  {id:'rss',name:'RSS and newsletters',value:'Publisher-owned monitoring for known sources.'},{id:'podcasts',name:'Podcasts',value:'Long-form creator and industry conversations.'},
  {id:'instagram-tiktok',name:'Instagram and TikTok',value:'Visual creator work with restricted programmatic access.'},
]; }
function m(id:string,surface:DiscoverySurfaceId,provider:string,name:string,accessKind:AccessKind,costTier:CostTier,reliability:ReliabilityTier,coverage:DiscoveryMethod['coverage'],authoritative:boolean,search:boolean,credentialEnv:string|undefined,adapter:string|undefined,endpoint:string|undefined,caveat:string,requiresApproval=false):DiscoveryMethod { return {id,surface,provider,name,accessKind,costTier,reliability,coverage,authoritative,search,requiresApproval,...(credentialEnv?{credentialEnv}:{}),...(adapter?{adapter}:{}),...(endpoint?{endpoint}:{}),caveat}; }
