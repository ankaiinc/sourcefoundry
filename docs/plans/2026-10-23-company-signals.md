# Company signals for outbound research (brief for Claude Code)

Owner: Talvinder. Written 2026-10-23 by Claude (Cowork) for a Claude Code session to implement.
Status: proposed, not started. Do not deploy to production without Talvinder's go-ahead.

## Why
ZopDev cold outreach (YC founders now, enterprise later) needs a per-company evidence pack so each
email's pain line is tied to something real and recent, with a source URL. A pilot on 10 YC companies
(2026-10-23) showed open job postings on public ATS APIs are the strongest free signal (e.g. Deepgram's
platform-engineer posting asks for FinOps and Terraform; Roboflow's infra posting asks someone to find
cost-optimisation opportunities). ~30% of companies had no usable signal.

## What to build
A company-scoped source type in SourceFoundry. Input: company {name, domain, optional ats hints}.
Output via the existing `/v1/signals` contract (canonical URL, provider, fetched/published timestamps,
completeness flags, reliability), grouped per company, plus a derived summary record:

```
company_signals {
  domain, resolved_ats: {provider, slug, verified},
  hiring: [{title, url, posted_at, infra_role: bool, stack_terms: [...], cost_terms: [...], quote}],
  stack: {clouds: [], kubernetes: bool, iac: [terraform|pulumi|opentofu], data: [databricks|snowflake], gpu: bool},
  regulated: [soc2|hipaa|pci|rbi|...], regions: [],
  incidents: [{title, url, date}],            # status page, last 90 days
  public_writing: [{title, url, date, quote}],# eng blog / founder posts mentioning cost, infra, scale
  evidence_strength: strong|medium|weak|none,
  fetched_at
}
```

## Reuse, don't rebuild
1. ATS parsers: `~/Projects/pragmaticleaders.io/pl-app/src/lib/hunt/scan.ts` (detectApi + parseGreenhouse/
   parseAshby/parseLever, tested) and `pl-app/src/lib/sources/probe.ts`.
2. ATS slug resolution across 36 providers: `~/Projects/open-jobs/slugs.json` (75k live slugs; ashby,
   greenhouse, lever, workable, recruitee, smartrecruiters, teamtailor, personio, workday, ...) and
   `open-jobs/backend/src/{ats,registry,probe,jd}.ts`. Open Jobs is shut down; its code is reusable.
3. Search/discovery providers already in `src/ingest/discovery.ts` (Tavily, Brave, Serper, Firecrawl)
   for blog/founder/news lookups — max 2-3 queries per company.
4. Status pages: try `status.<domain>` and Atlassian Statuspage `/history.json`.

## Rules
- Free sources first (ATS APIs, status pages, company site). Paid search capped per company; log cost.
- Verify the ATS board belongs to the company (domain or name in postings) before using it; the pilot
  hit a name collision risk (e.g. generic slugs like "alpaca").
- No people data, no emails, no Apollo calls in this service.
- Tests: fixtures for each ATS parser, slug resolution, verification, and the summary derivation.
- Batch: accept a list (CSV/JSON) of up to 2,000 companies; idempotent; resumable.

## Consumer
The `zopdev-cold-email` skill reads `company_signals` to choose angle + pain line and to show evidence
next to each email. Skill changes are out of scope for this repo.

## Reference run
A throwaway ATS scan of 1,346 YC companies was run from Cowork on 2026-10-23 (output in
~/Projects/zopdev/signals/data/out/yc_research_*). Use it as a fixture/benchmark, not as source of truth.
