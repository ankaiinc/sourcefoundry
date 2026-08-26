# SourceFoundry MCP

Connect SourceFoundry to MCP clients with two tools:

- `build_source_feed` creates or updates a recurring source feed and can enqueue its first run.
- `read_source_feed` returns neutral candidates and optional operational health.

Configure `SOURCEFOUNDRY_API_TOKEN`. Set `SOURCEFOUNDRY_BASE` when using a self-hosted deployment.

## Run from this repository

The npm package has not been published yet. From a public clone:

```bash
npm ci --prefix mcp
SOURCEFOUNDRY_API_TOKEN='from-your-secret-store' \
  node mcp/sourcefoundry-mcp.mjs
```

Set `SOURCEFOUNDRY_BASE=http://localhost:8080` to connect to a self-hosted service. Without it, the adapter connects to `https://feedline.4agents.fyi`.

After the first npm package release:

```json
{
  "mcpServers": {
    "sourcefoundry": {
      "command": "npx",
      "args": ["-y", "@sourcefoundry/mcp"],
      "env": { "SOURCEFOUNDRY_API_TOKEN": "${SOURCEFOUNDRY_API_TOKEN}" }
    }
  }
}
```

For a local self-hosted service, add:

```json
"SOURCEFOUNDRY_BASE": "http://localhost:8080"
```

Discovery sources may select `tavily`, `exa`, or `serper`. Provider keys remain in the SourceFoundry worker environment; they are never MCP arguments. Feed-only source feeds need no commercial search provider.

SourceFoundry supplies fresh source items with duplicate results removed and original links preserved. The consuming application or agent remains responsible for judgment, writing, ranking, and publication.
