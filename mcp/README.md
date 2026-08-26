# SourceFoundry MCP

Expose SourceFoundry's durable source-supply API to MCP clients with two tools:

- `build_source_feed` creates or updates a recurring source feed and can enqueue its first run.
- `read_source_feed` returns neutral candidates and optional operational health.

Configure `SOURCEFOUNDRY_API_TOKEN`. Set `SOURCEFOUNDRY_BASE` when using a self-hosted deployment.

After the first public package release:

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

Discovery sources may select `tavily`, `exa`, or `serper`. Provider keys remain in the SourceFoundry worker environment; they are never MCP arguments. Feed-only source supplies need no commercial search provider.

SourceFoundry supplies fresh, deduplicated candidates with provenance. The consuming application or agent remains responsible for product-specific judgment, writing, ranking, and publication.
