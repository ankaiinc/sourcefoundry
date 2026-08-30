<div align="center">
  <a href="https://sourcefoundry.4agents.fyi">
    <img src="public/favicon.svg" width="72" height="72" alt="SourceFoundry" />
  </a>

  <h1>SourceFoundry</h1>

  <p><strong>Give your coding agent a source feed that stays fresh.</strong></p>

  <p>
    <a href="https://github.com/ankaiinc/sourcefoundry/actions/workflows/ci.yml"><img src="https://github.com/ankaiinc/sourcefoundry/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
    <a href="https://github.com/ankaiinc/sourcefoundry/releases/latest"><img src="https://img.shields.io/github/v/release/ankaiinc/sourcefoundry?display_name=tag&amp;sort=semver" alt="Latest release" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/ankaiinc/sourcefoundry" alt="MIT license" /></a>
    <a href="https://github.com/orgs/ankaiinc/packages/container/package/sourcefoundry"><img src="https://img.shields.io/badge/container-ghcr.io-2496ED?logo=docker&amp;logoColor=white" alt="GitHub Container Registry" /></a>
  </p>

  <p>
    <a href="https://sourcefoundry.4agents.fyi">Hosted service</a>
    · <a href="https://sourcefoundry.4agents.fyi/agent.md">Agent guide</a>
    · <a href="https://sourcefoundry.4agents.fyi/openapi.json">OpenAPI</a>
    · <a href="docs/self-hosting.md">Self-hosting</a>
    · <a href="mcp/README.md">MCP</a>
  </p>
</div>

SourceFoundry continuously checks RSS feeds and search providers, removes duplicate results, keeps the original links, and reports source failures. Coding agents use those results to build news feeds, market trackers, daily briefs, policy monitors, and research streams.

> **Public beta:** `v0.1.x` keeps the source-feed REST contract stable while self-hosting and provider integrations are hardened through real use.

## Why this exists

SourceFoundry was created because every news feed and tracking product was rebuilding the same fragile source operation: checking feeds, calling search providers, scheduling runs, retrying failures, removing duplicates, preserving links, and noticing stale sources. That work does not make the product better. It only keeps its inputs available.

SourceFoundry is not an answer engine and it does not decide what is true or important. It keeps sources running; the consuming agent decides what to use, rank, write, or publish.

## When to use it

- A market-intelligence agent needs the same competitor, industry, and regulatory evidence every morning.
- A policy monitor must combine official feeds with bounded web discovery and show where every item came from.
- A research workflow needs an incremental stream rather than starting a new search from zero each time.
- Several products need the same collected evidence but apply different rankings or conclusions.
- A team needs to know that a source failed, went stale, or returned incomplete data instead of silently treating an empty response as “nothing happened.”

Do not use SourceFoundry for a one-off question, for final editorial judgment, or as permission to collect or resell content you are not authorized to use.

## What is different

| Alternative | What it does well | What SourceFoundry adds |
|---|---|---|
| Tavily, Exa, Serper | Search now | Recurring feeds, provider choice, durable runs, deduplication, provenance, health, and one stable output contract |
| RSS reader | Follows known feeds | Search discovery, multi-tenant operation, API/MCP access, evidence normalization, retries, and source health |
| Scraping tool | Fetches or extracts pages | Scheduling, duplicate removal, recurring delivery, and visible source failures |
| Agent framework | Orchestrates an agent | A source-supply service the agent can rely on without owning ingestion mechanics |
| Custom cron jobs | Solve one narrow collection task | Reusable feeds, safe retries, tenant isolation, bounded costs, and visible failures |

The useful difference is not “we search too.” It is that feeds and search providers become one recurring source feed that an agent can set up once and read incrementally.

## Run it yourself

Self-hosting gives you the same REST and MCP workflow on your own infrastructure. You bring any search-provider account you choose to use.

```bash
cp .env.example .env
# Replace SOURCEFOUNDRY_API_TOKEN in .env with a long random value.
docker compose up --build
```

Then open <http://localhost:8080>, read <http://localhost:8080/agent.md>, or check:

```bash
curl -fsS http://localhost:8080/ready
```

Feed-only installations need no search-provider key. For search discovery, set `TAVILY_API_KEY`, `EXA_API_KEY`, or `SERPER_API_KEY` in the worker environment and select that provider on the discovery source. See [Self-hosting SourceFoundry](docs/self-hosting.md) and [Provider keys and licensing](docs/provider-keys.md).

Versioned container images are published at `ghcr.io/ankaiinc/sourcefoundry`. Pin a release tag in production instead of using `latest`.

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

## Choose discovery sources by policy

Consumer apps can ask SourceFoundry which discovery options exist instead of hard-coding one provider. `GET /v1/discovery-options` lists 11 source surfaces, their official APIs, public feeds, search indexes, and reviewed crawler options, plus cost, reliability, coverage, authority, credentials, and practical caveats. Secret values are never returned.

`POST /v1/discovery-plans/resolve` turns a consumer’s preferences into a ranked, provider-neutral plan. Choose a reusable bundle, select surfaces such as X, YouTube, LinkedIn, GitHub, Reddit, RSS, or podcasts, cap the cost tier, prohibit crawlers, require authoritative evidence, or prefer and exclude specific providers.

```json
{
  "bundle": "reliable-balanced",
  "surfaces": ["x", "youtube", "linkedin", "github"],
  "preferredProviders": {
    "x": ["x"],
    "youtube": ["youtube"],
    "linkedin": ["web-index"]
  },
  "fallbacksPerSurface": 2
}
```

Built-in bundles are `official-first`, `reliable-balanced`, `free-and-owned`, `broad-discovery`, and `creator-attribution`. Plan resolution is read-only. Creating recurring sources and approving paid-provider spend remain explicit actions.

## MCP

The MCP adapter exposes two high-level tools: `build_source_feed` and `read_source_feed`.

The REST API is the stable product boundary; MCP is the agent-friendly adapter. Use the versioned MCP tarball attached to each [GitHub release](https://github.com/ankaiinc/sourcefoundry/releases), or run the adapter from a checked-out release. See [mcp/README.md](mcp/README.md) for hosted and self-hosted configuration.

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

See [CONTRIBUTING.md](CONTRIBUTING.md), [SUPPORT.md](SUPPORT.md), [SECURITY.md](SECURITY.md), the [changelog](CHANGELOG.md), and the [MIT license](LICENSE).
