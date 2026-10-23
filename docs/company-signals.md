# Company signals

A company-scoped research source for outbound. Give it companies (name + domain);
get back one `company_signals/v1` record per company: what they are hiring for,
what they run on, which compliance regimes they name, recent outages, and what
they have written about cost or infrastructure — each item with its source URL.

Plan: [`plans/2026-10-23-company-signals.md`](plans/2026-10-23-company-signals.md).

## Run it

```bash
npm run build
npm run company-signals -- --in companies.csv --out signals.jsonl
```

Input: CSV or JSON with `name` and `domain` (or `website`); optional `ats_provider`
and `ats_slug` when you already know the jobs board. At most 2,000 companies per
batch; duplicates by domain are dropped. Re-running the same command resumes —
domains already in `--out` are skipped.

Paid search is off unless asked for:

```bash
npm run company-signals -- --in companies.csv --out signals.jsonl \
  --paid-provider serper --paid-queries 2 --paid-budget-usd 5
```

It runs only for companies whose free evidence came back `weak` or `none`, at most
three queries per company, and stops starting new paid lookups once the estimated
batch spend reaches the budget. Each call is logged to `<out>.costs.jsonl`.
Costs are estimated from list prices in `src/company-signals/paid.ts`.

## Where the evidence comes from (free first)

| Source | What it gives | Cost |
|---|---|---|
| Company site (`/`, `/careers`, `/jobs`, `/security`, `/trust`) | links to the jobs board, compliance badges | free |
| Public ATS APIs: Greenhouse, Ashby, Lever, Workable, Recruitee | open roles, full descriptions | free |
| `status.<domain>` (Atlassian Statuspage) | incidents in the last 90 days | free |
| Blog RSS/Atom feed | posts in the last year about cost, infra or scale | free |
| Tavily / Brave / Serper / Exa (opt-in) | company-authored pages the free pass missed | paid, capped |

## Jobs-board ownership

A board called `alpaca` may belong to a different Alpaca. A board is used only when
something ties it to this company, in this order:

1. `hint` — the caller supplied provider + slug
2. `site_link` — the company's own site links to it
3. `domain` — the postings mention the company's domain
4. `board_name` — the provider's board name equals the company name
5. `name_in_postings` — at least half the postings name the company, and no
   posting names a look-alike domain (e.g. `alpaca.ai` when we want `alpaca.markets`)

An unverified board is reported in `resolved_ats` with `verified: false` and the
reason, and its jobs are not used. Candidate slugs come from the domain and name,
ranked by `data/ats-slugs.json` (live boards seen by the open-jobs fleet, 2026-09).

## Evidence strength

- **strong** — a verified infra role that asks for cost work, or the company writing about cost
- **medium** — a verified infra role or any role mentioning cost, a recent outage on a known stack, or the company writing about infra/scale
- **weak** — something true but not tied to cloud pain: an open board, a stack, a compliance regime
- **none** — nothing verified

A source that failed is listed in `errors`; a failure never reads as "no signal".

## Out of scope

No people, emails or contact enrichment; no Apollo. Records are written as JSON
Lines for the `zopdev-cold-email` skill to read. Serving them through the hosted
`/v1/signals` API (and storing them in Postgres) is a follow-up; each evidence item
already carries that contract's provenance fields.
