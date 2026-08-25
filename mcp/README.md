# SourceFoundry MCP

Expose SourceFoundry's durable source-supply API to MCP clients with two tools:

- `build_source_feed` creates or updates a recurring source feed and can enqueue its first run.
- `read_source_feed` returns neutral candidates and optional operational health.

Configure `SOURCEFOUNDRY_API_TOKEN`. Set `SOURCEFOUNDRY_BASE` only when using a non-canonical deployment.

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

SourceFoundry supplies fresh, deduplicated candidates with provenance. The consuming application or agent remains responsible for product-specific judgment, writing, ranking, and publication.
