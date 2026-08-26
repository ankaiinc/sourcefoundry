# Provider keys and licensing

Feedline can operate public feeds without a commercial search provider. When search discovery is useful, the current high-level source-feed API supports Tavily, Exa, and Serper.

## Bring your own key

In a self-hosted installation, set the chosen key only in the worker environment:

| Provider | Environment variable | Approved endpoint |
|---|---|---|
| Tavily | `TAVILY_API_KEY` | `https://api.tavily.com/search` |
| Exa | `EXA_API_KEY` | `https://api.exa.ai/search` |
| Serper | `SERPER_API_KEY` | `https://google.serper.dev/news` or `/search` |

Then set `provider` to `tavily`, `exa`, or `serper` on the discovery source. Feedline chooses the official endpoint, applies a result cap, strips provider-specific response fields, and emits the same source-item contract.

Never place a provider key in an API request, source URL, feed purpose, query, prompt, or metadata. The API actively rejects credential-shaped metadata on autonomous workspaces.

## What open source changes

Open source lets operators run Feedline themselves and connect accounts they already control. It removes the need for Feedline to pay for every self-hosted search call.

It does not cancel an upstream provider's terms, grant content rights, or permit reselling provider access. Each operator remains responsible for its provider agreement, quotas, collected content, retention, and downstream use.

## Hosted Feedline

A hosted service has two safe models:

1. Feedline uses its own keys only for provider lanes covered by an agreement that permits the hosted customer use.
2. The customer creates an encrypted provider connection. The hosted control plane resolves that credential at execution time and never stores it in the feed definition or exposes it to the agent.

At small scale the first model may appear simpler, but provider rights and variable cost become a real release gate before paid or broad customer use. The portable self-hosted core is not dependent on that commercial decision.
