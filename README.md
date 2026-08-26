# SourceFoundry

Dependable, recurring source supply for agents and applications.

Describe the material you need once. SourceFoundry keeps collecting it, normalizes every result into one evidence contract, removes repetition, records provenance, and tells you when a source is stale or failing. Your agent or product remains responsible for interpretation, ranking, writing, workflow, and publication.

[Hosted service](https://sources.4agents.fyi) · [Agent guide](https://sources.4agents.fyi/agent.md) · [OpenAPI](https://sources.4agents.fyi/openapi.json) · [Self-hosting](docs/self-hosting.md) · [Operations](docs/operations.md) · [MCP package](mcp/README.md)

## Why this exists

SourceFoundry was created because every consuming product was rebuilding the same fragile source plumbing: feed polling, provider calls, scheduling, retries, deduplication, freshness checks, provenance, and source-health tracking. That work does not make an agent smarter. It makes its evidence supply dependable.

SourceFoundry is not an answer engine and it does not decide what is true or important. It separates source operations from judgment so the same neutral evidence can support a research agent, newsroom, policy monitor, competitive-intelligence product, or internal workflow without forcing each one to run a second ingestion system.

## When to use it

- A market-intelligence agent needs the same competitor, industry, and regulatory evidence every morning.
- A policy monitor must combine official feeds with bounded web discovery and show where every item came from.
- A research workflow needs an incremental stream rather than starting a new search from zero each time.
- Several products need the same collected evidence but apply different rankings or conclusions.
- A team needs to know that a source failed, went stale, or returned incomplete data instead of silently treating an empty response as “nothing happened.”

Do not use SourceFoundry for a one-off question, for final editorial judgment, or as permission to scrape or resell material you are not authorized to use.

## What is different

| Alternative | What it does well | What SourceFoundry adds |
|---|---|---|
| Tavily, Exa, Serper | Search now | Recurring feeds, provider choice, durable runs, deduplication, provenance, health, and one stable output contract |
| RSS reader | Follows known feeds | Search discovery, multi-tenant operation, API/MCP access, evidence normalization, retries, and source health |
| Scraping tool | Fetches or extracts pages | Scheduling, cross-source identity, durable candidate supply, and consumer-neutral delivery |
| Agent framework | Orchestrates an agent | A source-supply service the agent can rely on without owning ingestion mechanics |
| Custom cron jobs | Solve one narrow collection task | Reusable contracts, idempotency, tenant isolation, bounded costs, and operational evidence |

The useful difference is not “we search too.” It is that search, feeds, and future authorized connectors become one operated supply that an agent can build once and read incrementally.

## Run it yourself

Self-hosting is the default open-source path. You own the infrastructure and bring any search-provider account you choose to use.

```bash
cp .env.example .env
# Replace SOURCEFOUNDRY_API_TOKEN in .env with a long random value.
docker compose up --build
```

Then open <http://localhost:8080>, read <http://localhost:8080/agent.md>, or check:

```bash
curl -fsS http://localhost:8080/ready
```

Feed-only installations need no search-provider key. For bounded discovery, set `TAVILY_API_KEY`, `EXA_API_KEY`, or `SERPER_API_KEY` in the worker environment and select that provider on the discovery source. See [Self-hosting SourceFoundry](docs/self-hosting.md) and [Provider keys and licensing](docs/provider-keys.md).

## The high-level API

1. `POST /v1/agent-enrollments` creates a bounded tenant workspace and returns its secret once.
2. `POST /v1/source-feeds` creates or updates a durable feed. Retries use `Idempotency-Key`.
3. `POST /v1/source-feeds/:sourceFeedId/runs` starts collection and reuses active work.
4. `GET /v1/source-feeds/:sourceFeedId/candidates?since=...` incrementally reads neutral candidates.
5. `GET /v1/source-feeds/:sourceFeedId/health` explains freshness and source failures.

Example discovery source:

```json
{
  "kind": "discovery",
  "label": "Policy discovery",
  "provider": "exa",
  "queries": ["India AI policy consultation regulation"],
  "includeDomains": ["meity.gov.in"]
}
```

The provider key is never sent in this request. It stays in the SourceFoundry worker's secret environment.

## MCP

The `@sourcefoundry/mcp` package exposes two high-level tools: `build_source_feed` and `read_source_feed`.

The REST API is the stable product boundary; MCP is the agent-friendly adapter. See [mcp/README.md](mcp/README.md) for hosted and self-hosted configuration.

## Provider and licensing boundary

The SourceFoundry code is MIT licensed. Tavily, Exa, Serper, publishers, and other upstream sources keep their own terms, quotas, and content rights. Open source does not transfer those rights or make a shared commercial provider key safe to redistribute.

For self-hosting, the operator supplies keys for accounts they are authorized to use and is responsible for the upstream terms. A hosted SourceFoundry service should use provider lanes covered by its own commercial agreements or an encrypted customer-managed provider connection. Raw provider keys must never enter prompts, feed definitions, logs, or returned candidates.

## Architecture

- API: `src/server.ts`
- Worker: `src/worker.ts`
- Durable state: PostgreSQL and `migrations/`
- Portable migration runner: `npm run migrate`
- Safe outbound fetch: public HTTPS only, pre-resolved public IPs, same-origin redirects, and a 2 MB response cap
- Candidate contract: versioned `PublicSignal` records with canonical URL, source identity, timestamps, completeness, reliability, and failure state
- Deployment example: `compose.yaml`; hosted Fly configuration remains in `fly.toml`

The API and worker share the same image but run as separate processes. The worker owns provider calls. Consumers never receive or submit provider secrets.

## Development

```bash
npm ci
npm run type-check
npm test
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [MIT license](LICENSE).
