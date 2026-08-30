# Changelog

All notable SourceFoundry changes are recorded here. The project follows semantic versioning while the public REST and MCP contracts stabilize.

## [Unreleased]

### Added

- Consumer apps can list 11 discovery surfaces and compare official, free, indexed, and crawler-backed access methods by cost, reliability, coverage, authority, and credential requirements.
- Consumer apps can resolve reusable discovery policies into ranked primary and fallback methods without creating sources, exposing secrets, or silently approving provider spend.

## [0.1.0] - 2026-08-26

### Added

- Durable source feeds combining RSS/Atom and bounded search-provider discovery.
- Incremental, provenance-preserving candidate reads with source health.
- High-level REST and MCP interfaces for coding agents.
- Docker Compose self-hosting with PostgreSQL, ordered migrations, API, and worker processes.
- Tavily, Exa, and Serper bring-your-own-key provider adapters.
- Public agent guide, OpenAPI document, service descriptor, `llms.txt`, and branded landing site.

### Security

- Tenant isolation, bounded autonomous enrollment, SSRF protections, provider-secret separation, and repeatable migration checks.

[Unreleased]: https://github.com/ankaiinc/sourcefoundry/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ankaiinc/sourcefoundry/releases/tag/v0.1.0
