# SourceFoundry

Standalone multi-tenant ingestion service for external sources.

The service is intentionally generic. It owns ingestion mechanics, source
health, durable jobs, dedupe, scoring, candidates, and operational heartbeats.
Consuming apps own taxonomy, prompts, presentation, user preferences, and
impression-aware serving.

## Product and open-source boundary

SourceFoundry should remain a separate service. Its product promise is one
provider-neutral evidence API for agents and applications; Attention OS is one
consumer, not its organizing domain.

The recommended open-source boundary is the portable ingestion engine: the
versioned signal contract, repository interfaces, source adapters, migrations,
conformance tests, local runner, and example client. Keep the hosted control
plane private: production credentials, tenant configuration, provider billing,
rate-limit policy, live queue/backlog data, and operational access.

The repository is currently private. Before changing its visibility, choose a
license, scan the full history for credentials and tenant data, replace live
configuration with examples, document the authentication/rate-limit threat
model, and publish a tagged contract version. Repository visibility is a public
release decision; the Attention OS activation does not depend on making it
public.

`GET /v1/signals` is the versioned consumer boundary. Each signal includes the
canonical URL, source item identity, provider, query when available, content
hash, fetched/published timestamps, age, field-completeness flags, source
reliability, and consecutive-failure state. Consumers should lower confidence
for incomplete or degraded results instead of reconstructing missing evidence.
When a bounded social enrichment source succeeds, the same contract can also
include observed comment totals, returned-comment count, partial/truncated
state, and at most ten named participants with short excerpts and public links.
This is conversation evidence, not a contact database or action permission.
Candidates with the same stable signal key are returned as one bounded evidence
bundle. A source contributes at most one observation, each bundle retains at
most three observations, and repetition never increases the representative
candidate score.

## Runtime shape

- API process: `src/server.ts`
- Worker process: `src/worker.ts`
- Durable state: dedicated Supabase Postgres
- Queue claim: `claim_next_sourcefoundry_job()` with `FOR UPDATE SKIP LOCKED`
- Zombie reaping: `reap_zombie_sourcefoundry_jobs()`
- Active fetch idempotency: one queued/running job per tenant and source. The
  production reconciliation command is dry-run by default; applying it cancels
  duplicate active jobs with an audit reason and installs the database guard.

```bash
npm run reconcile:jobs
npm run reconcile:jobs -- --apply --confirm=cancel-duplicate-active-jobs \
  --expect-duplicate-jobs=<dry-run-count> \
  --expect-duplicate-groups=<dry-run-count>
```

Before any reconciliation apply, inspect the hosted Supabase backup contract
through the read-only Management API. Supply `SUPABASE_ACCESS_TOKEN` through
secret storage and `SUPABASE_PROJECT_REF` through the environment or the
non-secret `--project-ref=` argument:

```bash
npm run build
npm run backup:readiness -- --maximum-age-hours=36
```

The verifier issues one GET request, reports `mutationRequests: 0`, never emits
the token or backup IDs, and exits non-zero unless it finds a completed hosted
backup or physical restore point within the chosen freshness window. It proves
that Supabase advertises a recoverable restore point; it does not perform or
simulate a restore.

Authenticated operational inspection is available at
`GET /v1/sources?tenant=:slug` and `GET /v1/sources/:sourceId`. The list route
lets consumers discover canonical source IDs after an idempotent bootstrap
instead of pinning cross-service UUIDs. Both return configuration and failure
counters but never resolve or return provider secret values.

## First job type

- `fetch_source`: fetches an RSS/Atom source, normalizes entries, dedupes by
  canonical URL, writes source items, and creates reviewable candidates.

## Targeted discovery sources

Use `sourceType: "web"` with `metadata.mode: "discovery"` when a tenant needs
filtered discovery instead of broad RSS ingestion. SourceFoundry stays generic:
the tenant owns the briefs, and SourceFoundry normalizes provider results into
neutral source items.

Example source metadata:

```json
{
  "mode": "discovery",
  "provider": "firecrawl",
  "queries": [
    "AI product trust failure launch",
    "pricing backlash product decision",
    "developer platform policy change"
  ],
  "max_results_per_query": 5,
  "relevance_terms": ["ai", "product", "trust", "launch"]
}
```

The discovery adapter accepts Firecrawl-like responses (`data`), Tavily-like
responses (`results`), or simple JSON arrays. Set `FIRECRAWL_API_KEY`,
`TAVILY_API_KEY`, or `SOURCEFOUNDRY_DISCOVERY_API_TOKEN` in the worker
environment depending on the provider.

Official social discovery adapters use the same neutral candidate contract:

- X: `provider: "x"`, `url: "https://api.x.com/2/tweets/search/recent"`,
  and `X_API_BEARER_TOKEN`. Queries are sent through recent search with author,
  creation time, conversation, and public metric fields.
- YouTube: `provider: "youtube"`,
  `url: "https://www.googleapis.com/youtube/v3/search"`, and
  `YOUTUBE_API_KEY`. Search is video-only and ordered by recency by default.
- YouTube own-video comments: `provider: "youtube-comments"`,
  `url: "https://www.googleapis.com/youtube/v3/commentThreads"`, and put the
  tracked video IDs in `metadata.queries`. Returned comment permalinks retain
  author, publication time, video thread, and comment identity.
- LinkedIn: use Tavily with `include_domains: ["linkedin.com"]`, or a capped
  Apify public-data canary. LinkedIn does not provide an equivalent broad
  official post-search API; SourceFoundry records the provider so consumers can
  lower confidence accordingly.
- Apify: `provider: "apify"`, `mode: "enrichment"`, and `APIFY_API_TOKEN`.
  SourceFoundry automatically selects the highest-ranked concrete LinkedIn post
  URLs that do not have fresh enrichment evidence; profiles, feeds, searches,
  login pages, and non-LinkedIn URLs are rejected before a request. The source
  URL must be the HTTPS `api.apify.com` synchronous Actor dataset endpoint with
  no token in the URL. `metadata.request_template` must contain `$query` and may
  use `$limit`. Cookie, `li_at`, and session-token fields are rejected before
  source configuration can be stored. Each source declares both a per-request
  and whole-run spend ceiling; the batch is rejected before its first request
  when its mathematical maximum exceeds policy. Fresh evidence is not fetched
  again until `reenrich_after_hours` elapses. Use this only for bounded
  public-data enrichment; an Actor can never create a public action through
  SourceFoundry.

For Tavily, use `url: "https://api.tavily.com/search"` and
`metadata.provider: "tavily"`. SourceFoundry sends `topic: "news"`,
`search_depth: "advanced"`, and requests raw content so downstream consumers
receive fuller story context.

## Environment

```bash
SOURCEFOUNDRY_DATABASE_URL=postgresql://...
SOURCEFOUNDRY_API_TOKEN=...
SOURCEFOUNDRY_PORT=8080
SOURCEFOUNDRY_WORKER_ENABLED=1
FIRECRAWL_API_KEY=... # optional, only for Firecrawl-backed discovery sources
TAVILY_API_KEY=... # optional, only for Tavily-backed discovery sources
X_API_BEARER_TOKEN=... # optional, official X recent-search discovery
YOUTUBE_API_KEY=... # optional, official YouTube video discovery
APIFY_API_TOKEN=... # optional, capped public-data enrichment only
```

## Local verification

From this repo:

```bash
npm run type-check
npm test
```

After a verified deployment, preview the bounded Tavily-backed LinkedIn, X, and
YouTube sources with `npm run bootstrap:attention -- --dry-run`. The preview
requires no credentials and performs no network request. After explicit
production approval, run
`npm run bootstrap:attention -- --confirm=create-attention-sources`. The
confirmed operation is idempotent by tenant and source URL, immediately
enqueues one fetch per source, and prints identifiers but never secret values.
Running without either flag fails before any request. Official X/YouTube
sources can replace the lower-confidence Tavily lanes when their API
credentials are added.

Choose those official read lanes explicitly in the dry-run plan:

```bash
npm run bootstrap:attention -- --dry-run \
  --x-provider=official \
  --youtube-provider=official
```

The preview names `X_API_BEARER_TOKEN` and `YOUTUBE_API_KEY` as worker
requirements but never reads or prints their values. Its `nextCommand` retains
the reviewed provider choices. A production bootstrap using either official
lane also requires `--confirm-worker-provider-secrets-configured`; this is an
operator acknowledgement that the named secrets were verified in the worker,
not permission to expose them. LinkedIn remains on the provider-neutral Tavily
lane until the separately bounded no-cookie enrichment canary is reviewed.

Preview that additive lane only after selecting and reviewing an Actor's input
and output contract:

```bash
npm run bootstrap:attention -- --dry-run \
  --linkedin-enrichment=apify \
  --linkedin-apify-actor-id=reviewed-owner~reviewed-actor \
  --linkedin-apify-input-field=postUrls
```

The preview performs no network call and reads no token. It fixes the maximum
batch at five shortlisted post URLs, one paid dataset item per request, $0.25
maximum per request, and $1.25 maximum for the run. A confirmed bootstrap also
requires `--confirm-worker-provider-secrets-configured`; deploying code or
having an Apify account does not approve provider spend or the canary.
