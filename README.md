# SourceFoundry

Standalone multi-tenant ingestion service for external sources.

The service is intentionally generic. It owns ingestion mechanics, source
health, durable jobs, dedupe, scoring, candidates, and operational heartbeats.
Consuming apps own taxonomy, prompts, presentation, user preferences, and
impression-aware serving.

## Runtime shape

- API process: `src/server.ts`
- Worker process: `src/worker.ts`
- Durable state: dedicated Supabase Postgres
- Queue claim: `claim_next_sourcefoundry_job()` with `FOR UPDATE SKIP LOCKED`
- Zombie reaping: `reap_zombie_sourcefoundry_jobs()`

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
```

## Local verification

From this repo:

```bash
npm run type-check
npm test
```
