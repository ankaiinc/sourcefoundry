# SourceFoundry public source supply v0

Status: proposed product and interface contract
Date: 2026-08-25
Supersedes: the on-demand evidence-request shape drafted earlier on 2026-08-25

SourceFoundry is the public and technical product name. Existing environment variables, compatibility headers, and API identifiers remain unchanged.

## Founding purpose

SourceFoundry exists to solve a product supply problem:

> Continuously turn external sources into fresh, reliable, deduplicated
> candidate inventory that different products can consume and interpret in
> their own way.

It was first created because Pragmatic Leaders Signals had too little fresh
story inventory. A daily ingest producing at most one candidate could not make
the product feel fresh. Fetching and generating during page load would have
made the customer experience slow, expensive, and unreliable.

The ingestion machinery was separated so Pragmatic Leaders, Ostronaut, a future
Gurbani/Sikhi news product, and other applications would not each rebuild the
same source registry, scheduler, retries, deduplication, and source-health
system.

This founding purpose is the product boundary. Agent enrollment, MCP, and a
public API are ways to configure and consume SourceFoundry; they are not a new
reason for the service to exist.

## Public promise

> Give your agent a source feed that stays fresh.

SourceFoundry checks RSS feeds and approved search providers on a schedule, removes duplicate results, keeps the original links, and reports source failures. The consuming agent decides what to use, rank, write, or publish.

Suggested agent prompt:

> Build a source feed for product-leadership stories. Use these six RSS feeds,
> add approved web discovery for product launches and trust failures, exclude
> syndication domains, refresh every hour, and return the newest neutral
> candidates with links and dates.

The first visible result is a working source feed with current items and source health—not a generated research answer.

## The product boundary

| SourceFoundry owns | The consuming product owns |
| --- | --- |
| Tenant-scoped source registry | Product taxonomy and meaning |
| Source schedules and execution policy | Prompts and editorial rubrics |
| Fetching, retries, backoff, and checkpoints | Judgment, synthesis, and written copy |
| Source health and reliability | User-specific ranking and personalization |
| Raw item normalization | Preferences and seen state |
| URL/content deduplication | Review, publication, and product workflow |
| Neutral relevance and candidate inventory | UI, notifications, and customer delivery |
| Operational history and heartbeats | The final customer promise |

SourceFoundry can determine whether an item matches the source-feed purpose and
can rank neutral candidates by freshness, source reliability, and bounded
relevance. It must not generate PL's hidden judgment, Ostronaut's coaching
interpretation, or a Gurbani product's religious/editorial framing.

Search, extraction, and research providers are adapters underneath
SourceFoundry. SourceFoundry does not compete by claiming to be a better answer
engine. Its job is to keep the upstream supply dependable even when an adapter,
feed, or publisher changes.

## The v0 experience

1. An agent discovers SourceFoundry through `/llms.txt`, `/agent.md`, OpenAPI,
   or the MCP package.
2. The agent describes one durable source feed: its purpose, exact sources,
   allowed discovery, exclusions, cadence, and limits.
3. SourceFoundry validates the plan and creates or updates the tenant-scoped
   feed idempotently.
4. The worker operates that feed continuously: fetch, normalize, deduplicate,
   score, persist, retry, and report health.
5. The application or agent reads neutral candidates from the authenticated
   feed endpoint.
6. The consuming application transforms those candidates according to its own
   intelligence and serves customers from its own reliable runtime.

The consumer should normally sync useful candidates into its own database.
SourceFoundry must not become a page-load dependency for a customer-facing
feed.

## Core resource: source feed

A source feed is a durable supply contract, not an RSS document and not a
one-time search query. It records:

- what external material the consumer wants supplied;
- the exact and discovery sources SourceFoundry may operate;
- hard inclusions and exclusions;
- cadence and per-run limits;
- the effective source plan;
- source health and execution history;
- the resulting neutral candidate inventory.

Recurring operation is part of v0 because it is the original product value.
One-time runs exist to test or backfill a feed, not as the primary product.

## Public REST contract

### Create or update a source feed

`POST /v1/source-feeds`

Authentication uses the existing tenant-scoped Bearer credential. An
`Idempotency-Key` header is required. Repeating the same tenant, idempotency key,
and logical feed updates or returns the intended feed without duplicating
sources, schedules, jobs, or provider spend.

Example:

```http
POST /v1/source-feeds HTTP/1.1
Authorization: Bearer $SOURCEFOUNDRY_API_TOKEN
Idempotency-Key: pragmatic-leaders-product-stories-v1
Content-Type: application/json
```

```json
{
  "name": "Product leadership story supply",
  "purpose": "Supply external stories involving consequential product, strategy, trust, distribution, or execution decisions.",
  "sources": [
    {
      "kind": "feed",
      "url": "https://stratechery.com/feed/",
      "label": "Stratechery",
      "required": true
    },
    {
      "kind": "feed",
      "url": "https://www.lennysnewsletter.com/feed",
      "label": "Lenny's Newsletter",
      "required": true
    },
    {
      "kind": "discovery",
      "label": "Approved product-news discovery",
      "queries": [
        "product launch trust failure",
        "platform policy distribution change"
      ],
      "includeDomains": [],
      "excludeDomains": [
        "aol.com",
        "yahoo.com",
        "msn.com"
      ]
    }
  ],
  "cadence": {
    "everyMinutes": 60
  },
  "limits": {
    "maxItemsPerRun": 20,
    "maxCandidatesPerRun": 10
  }
}
```

Request rules:

- `name` identifies the durable feed for operators and consumers.
- `purpose` records why the supply exists and helps operators inspect the plan.
  Discovery relevance comes from the caller's explicit bounded queries; the
  first implementation does not secretly turn purpose prose into a new rubric.
- `feed` sources identify exact public RSS or Atom material. The first
  implementation rejects `page` rather than pretending arbitrary HTML has
  reliable extraction; `page` enters the contract only with a bounded HTML
  extractor and fixtures.
- `discovery` sources declare bounded queries and domain policy. SourceFoundry
  chooses only from registered, approved adapters.
- v0 accepts one discovery entry per feed; callers combine its queries and
  domain policy so the hosted provider lane cannot be duplicated accidentally.
- A required source that fails stays visibly degraded. A fallback may add
  supply but cannot erase the failure.
- Credentials, cookies, arbitrary headers, private-network addresses, and
  provider API keys are never accepted in a public source description.
- Cadence and limits are capped by the tenant plan and server-side policy.
- The service stores the effective normalized plan so later changes cannot
  rewrite the meaning of past runs.

Response:

```json
{
  "schemaVersion": 1,
  "release": "<immutable-deploy-sha>",
  "sourceFeed": {
    "id": "sf_01K...",
    "tenantId": "<tenant-uuid>",
    "name": "Product leadership story supply",
    "status": "active",
    "createdAt": "2026-08-25T08:00:00Z",
    "updatedAt": "2026-08-25T08:00:00Z",
    "nextRunAt": "2026-08-25T09:00:00Z",
    "candidatesUrl": "https://sourcefoundry.4agents.fyi/v1/source-feeds/sf_01K.../candidates",
    "healthUrl": "https://sourcefoundry.4agents.fyi/v1/source-feeds/sf_01K.../health"
  },
  "sourcePlan": {
    "sourceCount": 3,
    "requiredSourceCount": 2,
    "discoverySourceCount": 1,
    "everyMinutes": 60,
    "maximumItemsPerRun": 20,
    "maximumCandidatesPerRun": 10
  }
}
```

### Run a feed now

`POST /v1/source-feeds/{sourceFeedId}/runs`

This enqueues one bounded run and returns an existing active run when an agent
retries. It never executes arbitrary provider work in the API process.

```json
{
  "schemaVersion": 1,
  "release": "<immutable-deploy-sha>",
  "run": {
    "id": "sfr_01K...",
    "sourceFeedId": "sf_01K...",
    "status": "queued",
    "statusUrl": "https://sourcefoundry.4agents.fyi/v1/source-feed-runs/sfr_01K...",
    "retryAfterSeconds": 5
  }
}
```

Run states:

`queued -> collecting -> normalizing -> completed | partial | failed | cancelled`

`partial` means usable candidates exist but a required source failed, an
explicit constraint could not be satisfied, or a policy limit truncated the
run. It is never silently presented as a clean success.

### Read neutral candidates

`GET /v1/source-feeds/{sourceFeedId}/candidates`

Supported filters:

- `since`: ISO timestamp for incremental consumer sync;
- `cursor`: reserved for stable pagination after cursor membership is persisted;
  the first implementation rejects it and supports `since` for incremental sync;
- `limit`: bounded result count;
- `statuses`: candidate lifecycle filters supported by the current contract.

Response:

```json
{
  "schemaVersion": 1,
  "release": "<immutable-deploy-sha>",
  "sourceFeedId": "sf_01K...",
  "generatedAt": "2026-08-25T08:00:10Z",
  "candidates": [
    "<existing PublicSignal objects; no second candidate schema>"
  ],
  "page": {
    "nextCursor": null,
    "truncated": false
  }
}
```

The existing versioned `PublicSignal` contract remains the candidate boundary:
canonical URL, source identity, author when available, fetched and published
times, content hash, neutral score, completeness, reliability, failure state,
and bounded corroborating observations.

SourceFoundry does not add product-specific `whyItMatters`, `hiddenJudgment`,
coaching advice, religious interpretation, or publication copy. The consumer
adds those after syncing the candidate.

### Inspect feed health

`GET /v1/source-feeds/{sourceFeedId}/health`

The health response includes:

- last successful and failed run;
- freshness of the newest candidate;
- per-source last success, last failure, failure count, and next attempt;
- items seen, inserted, deduplicated, and promoted to candidates;
- declared degradation and retry state;
- effective release and policy snapshot.

This endpoint is operational evidence, not a generic `200 OK` liveness check.

## MCP shape

The MCP server exposes the same single product capability without making agents
operate low-level tenants, sources, and jobs.

Primary tool:

```text
build_source_feed({
  name,
  purpose,
  sources,
  cadence,
  limits?
})
```

It creates or updates the durable feed idempotently, validates the source plan,
optionally enqueues the first bounded run, and returns the feed ID, source plan,
candidate endpoint, and health.

Companion tool:

```text
read_source_feed({
  source_feed_id,
  since?,
  limit?,
  include_health?
})
```

It returns neutral candidate inventory and, when requested, source-health
evidence. It does not turn those candidates into a report or answer.

The MCP package reads `SOURCEFOUNDRY_API_TOKEN` from the runtime secret store.
Credentials are never tool arguments. Low-level source creation, provider
selection, and job execution remain behind the MCP boundary.

## How consumers use the output

The intended production flow is:

```text
SourceFoundry operates external source supply continuously
  -> consumer syncs new neutral candidates with since
  -> consumer stores them in its own database
  -> consumer applies its taxonomy, prompts, judgment, and review rules
  -> consumer serves its own customer experience locally
```

Examples:

- Pragmatic Leaders turns candidate stories into Signals with product judgment,
  practice prompts, and personalized feed ranking.
- Ostronaut can turn selected material into a coaching or operational context
  according to Ostronaut's own rubric.
- A Gurbani/Sikhi product can select sources and apply its own editorial,
  historical, and religious-context standards.

One consumer must never receive another consumer's source configuration,
candidates, scoring state, or operational history.

## Durable model

The public source-feed layer should orchestrate the existing source and job
system rather than replace it:

```text
source-feed description
  -> validated tenant source plan
  -> existing idempotent sources and schedules
  -> existing deduplicated jobs and worker
  -> normalized source items and candidate scoring
  -> existing PublicSignal contract
  -> consumer-owned sync and interpretation
```

The additional durable concepts are deliberately small:

- `source_feeds`: tenant ownership, purpose, cadence, limits, lifecycle, and
  idempotency.
- `source_feed_sources`: membership and the effective per-source policy.
- `source_feed_runs`: a durable record for each bounded fan-out.
- `source_feed_run_jobs`: membership connecting a high-level run to the existing
  durable source jobs.

Candidate membership is derived through `source_feed_sources` and the canonical
source item. A separate cursor table is deferred until true cursor pagination is
added; the first release uses timestamp-based incremental sync.

Existing source items, fetch attempts, candidates, jobs, and heartbeats remain
canonical.

## Structural guardrails

- Every feed, source, run, item, and candidate is tenant-scoped at the database
  boundary.
- Natural-language purpose guides relevance but cannot create an arbitrary HTTP
  request or provider call.
- Only registered adapters and approved provider endpoints may execute.
- Existing safe-fetch protections remain mandatory: DNS resolution checks,
  private IPv4/IPv6 rejection, same-origin redirect policy, timeouts, and
  response-size limits.
- Provider credentials, cookies, headers, and session tokens are rejected from
  all public source descriptions and redacted from logs.
- Feed upserts and manual runs are idempotent at the database boundary.
- Per-source concurrency, runtime, retries, item count, candidate count, and
  daily spend have hard server-side ceilings.
- A required-source failure stays visible in feed health and makes the run
  partial when usable inventory exists.
- Candidates preserve canonical URLs and bounded excerpts instead of copying
  full source documents.
- Every response includes `schemaVersion` and immutable release identity. An
  unsupported schema is an error, never an empty feed.
- Consumer-specific generated fields are structurally absent from the
  SourceFoundry candidate contract.

## Authentication and beta limits

Retain the existing no-human enrollment path for a bounded tenant-scoped
workspace. The agent receives its credential once and stores it as
`SOURCEFOUNDRY_API_TOKEN`.

Do not offer anonymous execution in v0. Continuous network work has variable
supplier cost and a larger abuse surface than an in-memory utility. Public
discovery documents and examples require no authentication; creating or running
a feed does.

Autonomous beta workspaces remain bounded by configured source, cadence, item,
run, and service-wide limits. Paid packaging should charge for active source
feeds and bounded collection capacity, not raw provider calls.

## What is not in v0

- A general research, answer-writing, or citation-synthesis agent.
- Product-specific judgment, taxonomy, copy, ranking, or publication.
- A public news reader or SourceFoundry-authored editorial feed.
- Customer-facing page-load dependency on SourceFoundry.
- Authenticated scraping, cookies, browser sessions, or private-network sources.
- Arbitrary provider endpoints or caller-supplied provider keys.
- Public-by-default candidate pages or generated share reports.
- Alerts, downstream webhooks, or consumer UI workflows. Consumers can poll or
  sync incrementally with `since` in v0.

## Release slices

### Slice 1: durable source feed

Add the `source-feeds` create/read contract, idempotent mapping to existing
sources, feed runs, timestamp-based incremental sync, and real feed-health response. Prove it
with Pragmatic Leaders as the first consumer.

### Slice 2: agent distribution

Publish the MCP package with `build_source_feed` and `read_source_feed`. Update
`/llms.txt`, `/agent.md`, `/.well-known/sourcefoundry.json`, OpenAPI, homepage,
and installation instructions around the source-supply promise. Keep low-level
source and job routes as advanced operator documentation.

### Slice 3: prove the abstraction

Connect a second consumer with a materially different source set and product
rubric. It must reuse the same service without adding consumer-specific fields
or prompts to SourceFoundry. Until a second consumer works, multi-product reuse
is an architectural intention, not a proven product capability.

## v0 acceptance journey

The release is complete only when production proves the founding job:

1. A clean external agent discovers the contract and creates one source feed
   without calling low-level tenant, source, or job routes.
2. Retrying the same request creates no duplicate sources, schedules, jobs, or
   provider spend.
3. The worker collects from exact feeds and approved discovery, then returns
   deduplicated candidates with canonical links, dates, provenance, source
   quality, and release identity.
4. A failed required source is visible in feed health and produces a `partial`
   run while usable candidates remain available.
5. Pragmatic Leaders incrementally syncs candidates into its own database,
   applies PL-owned interpretation, and serves the customer experience without
   a live SourceFoundry request.
6. A second tenant cannot read the feed, candidates, health, or source plan.
7. Private-network, credential-bearing, oversized, and unapproved-provider
   inputs are rejected without an unsafe network request.
8. A second application consumes neutral candidates and applies a different
   intelligence layer without requiring SourceFoundry schema changes.
9. API and worker production releases report the same merged SHA and preserve
   evidence for the complete journey.

## Success measure

The key measure is not how many agents call an endpoint. It is whether a product
can obtain dependable fresh candidate supply without building and operating its
own ingestion pipeline.

The strongest proof is:

- two different consuming products;
- one shared SourceFoundry service;
- separate tenants and source policies;
- separate interpretation and customer experiences;
- no duplicated ingestion infrastructure;
- visible freshness, deduplication, source health, and recovery evidence.

That is the original reason SourceFoundry was created, made public without
changing its purpose.
