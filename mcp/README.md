# SourceFoundry MCP

Connect SourceFoundry to MCP clients with two tools:

- `build_source_feed` creates or updates a recurring source feed and can enqueue its first run.
- `read_source_feed` returns neutral candidates and optional operational health.

Configure `SOURCEFOUNDRY_API_TOKEN`. Set `SOURCEFOUNDRY_BASE` when using a self-hosted deployment.

## Install a released package

Use the immutable tarball attached to the GitHub release:

```json
{
  "mcpServers": {
    "sourcefoundry": {
      "command": "npm",
      "args": [
        "exec",
        "--yes",
        "--package=https://github.com/ankaiinc/sourcefoundry/releases/download/v0.1.0/sourcefoundry-mcp-0.1.0.tgz",
        "--",
        "sourcefoundry-mcp"
      ],
      "env": { "SOURCEFOUNDRY_API_TOKEN": "${SOURCEFOUNDRY_API_TOKEN}" }
    }
  }
}
```

Or run it from a checked-out release:

```bash
npm ci --prefix mcp
SOURCEFOUNDRY_API_TOKEN='from-your-secret-store' \
  node mcp/sourcefoundry-mcp.mjs
```

Set `SOURCEFOUNDRY_BASE=http://localhost:8080` to connect to a self-hosted service. Without it, the adapter connects to `https://sourcefoundry.4agents.fyi`.

After npm publication:

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
