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

## Environment

```bash
SOURCEFOUNDRY_DATABASE_URL=postgresql://...
SOURCEFOUNDRY_API_TOKEN=...
SOURCEFOUNDRY_PORT=8080
SOURCEFOUNDRY_WORKER_ENABLED=1
```

## Local verification

From this repo:

```bash
npm run type-check
npm test
```
