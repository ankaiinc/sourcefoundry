# Operating Feedline

This guide covers the service-level jobs that remain important after installation. Product-specific source lists and ranking rules belong in consuming applications, not in Feedline itself.

## Processes and health

Run the API and worker as separate processes from the same image. Route user traffic only to the API.

- `GET /health` proves the process is alive and reports schema and release identity.
- `GET /ready` proves PostgreSQL is reachable.
- Worker heartbeats and source-feed health expose collection failures and candidate freshness.

## Migrations

Run `npm run migrate` once before replacing API and worker processes. The runner serializes concurrent attempts with a PostgreSQL advisory lock, applies each numbered file in a transaction, and records its filename and checksum. If an applied file changes, the runner stops and requires a new migration instead of silently accepting history drift.

The `supabase/migrations/` directory remains the hosted Supabase history. Do not edit an already-applied Supabase migration. Portable self-hosted migrations live in `migrations/`.

## Duplicate-job reconciliation

The reconciliation command is dry-run by default:

```bash
npm run reconcile:jobs
```

Apply only after reviewing the reported counts and confirming a current backup:

```bash
npm run reconcile:jobs -- --apply --confirm=cancel-duplicate-active-jobs \
  --expect-duplicate-jobs=<dry-run-count> \
  --expect-duplicate-groups=<dry-run-count>
```

The apply path cancels duplicate active jobs with an audit reason and installs the active-job uniqueness guard.

## Backup readiness on hosted Supabase

`backup:readiness` performs a read-only Management API check. It does not create or restore a backup.

```bash
npm run build
SUPABASE_ACCESS_TOKEN='from-secret-store' \
SUPABASE_PROJECT_REF='project-ref' \
npm run backup:readiness -- --maximum-age-hours=36
```

It exits non-zero unless Supabase advertises a completed hosted backup or physical restore point inside the chosen window. A real production runbook should also prove restoration in a disposable environment.

## Provider operations

Provider keys are worker-only secrets. Source definitions name the provider policy; they never store the key. Each source should declare a bounded cadence and result cap. Before enabling a paid provider, verify its account terms, quota, and expected monthly ceiling.

The existing `bootstrap:pl` and `bootstrap:attention` commands are operator examples for current internal consumers. Both are dry-run or explicit-confirmation workflows. They are not required for a generic Feedline installation.
