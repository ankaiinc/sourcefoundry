# Self-hosting Feedline

Self-hosting gives an individual, team, or agent its own Feedline service, database, source policy, and provider accounts. The result is the same REST and MCP contract as the hosted service without depending on Feedline's hosted provider keys.

## Fast path with Docker Compose

Requirements: Docker with Compose support and an available local port 8080.

```bash
cp .env.example .env
# Edit .env and replace SOURCEFOUNDRY_API_TOKEN with a long random value.
docker compose up --build
```

Compose starts PostgreSQL, applies migrations exactly once, starts the API on `127.0.0.1:8080`, and starts the worker. Data remains in the `sourcefoundry-data` Docker volume.

Verify the real service:

```bash
curl -fsS http://localhost:8080/health
curl -fsS http://localhost:8080/ready
curl -fsS http://localhost:8080/.well-known/sourcefoundry.json
```

Open <http://localhost:8080> for the human introduction or <http://localhost:8080/agent.md> for the agent operating guide.

## Use MCP against the self-hosted service

Until the npm package is published, run the adapter from the repository root:

```bash
npm ci --prefix mcp
SOURCEFOUNDRY_BASE='http://localhost:8080' \
SOURCEFOUNDRY_API_TOKEN='from-your-secret-store' \
  node mcp/sourcefoundry-mcp.mjs
```

After the first npm package release:

```json
{
  "mcpServers": {
    "sourcefoundry": {
      "command": "npx",
      "args": ["-y", "@sourcefoundry/mcp"],
      "env": {
        "SOURCEFOUNDRY_BASE": "http://localhost:8080",
        "SOURCEFOUNDRY_API_TOKEN": "${SOURCEFOUNDRY_API_TOKEN}"
      }
    }
  }
}
```

## Search providers are optional

Known RSS or Atom feeds work without Tavily, Exa, or Serper. A discovery source needs exactly one provider key in the worker environment:

```env
TAVILY_API_KEY=
EXA_API_KEY=
SERPER_API_KEY=
```

Select the matching provider in the discovery source. The API rejects unknown providers, and official adapters send keys only to their approved HTTPS endpoint.

## Run without Docker

Use Node.js 20 or newer and PostgreSQL with `pgcrypto` available.

```bash
npm ci
npm run build
SOURCEFOUNDRY_DATABASE_URL='postgresql://...' npm run migrate
SOURCEFOUNDRY_DATABASE_URL='postgresql://...' \
SOURCEFOUNDRY_API_TOKEN='...' \
SOURCEFOUNDRY_PUBLIC_BASE_URL='http://localhost:8080' \
npm run api
```

Start the worker in a second process with the same database URL and provider keys plus `SOURCEFOUNDRY_WORKER_ENABLED=1 npm run worker`.

Remote PostgreSQL certificates are verified by default. If the database uses a private certificate authority, mount its PEM file and set `SOURCEFOUNDRY_DATABASE_CA_FILE`. Use `sslmode=disable` only for a trusted local database.

## Production checklist

- Put the operator token and provider keys in a secret manager, not an image or repository.
- Terminate public traffic with HTTPS and set `SOURCEFOUNDRY_PUBLIC_BASE_URL` to the public origin.
- Keep the API and worker on a private database network where possible.
- Back up PostgreSQL and test restoration.
- Decide whether public autonomous enrollment should remain enabled; set `SOURCEFOUNDRY_SELF_SERVICE_ENABLED=0` to disable it.
- Set source, cadence, result, and daily-run limits that match your provider quotas.
- Review each upstream provider's terms and the rights of every source you collect.
- Publish an immutable release SHA in `SOURCEFOUNDRY_RELEASE_SHA` so clients can identify the exact service build.

## Updating

Pull the release you intend to run, build the image, and run `npm run migrate` before replacing API and worker processes. Migrations are ordered, transactional, checksum-verified in `sourcefoundry_schema_migrations`, and protected by a PostgreSQL advisory lock.
