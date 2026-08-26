# Contributing to SourceFoundry

SourceFoundry is built around one boundary: it supplies durable, neutral source candidates; consuming products own judgment, ranking, writing, and publication.

## Before opening a change

1. Open an issue for a new provider, public contract change, or database migration.
2. Keep provider-specific fields behind the normalization boundary. Public candidates must retain the versioned `PublicSignal` shape.
3. Never commit provider keys, tenant exports, production URLs containing credentials, or copied customer data.

## Local verification

```bash
npm ci
npm run type-check
npm test
npm run build
docker compose config
```

For the complete self-hosted journey, follow [Self-hosting SourceFoundry](docs/self-hosting.md).

Pull requests should explain the user-visible change, the trust or cost boundary affected, and the evidence used to verify it. Contract changes need tests and documentation in the same pull request.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
