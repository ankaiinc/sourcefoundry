-- SourceFoundry initial schema.
--
-- Multi-tenant ingestion state, durable jobs, source attempts, deduped items,
-- reviewable candidates, and worker heartbeats.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.sourcefoundry_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sourcefoundry_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.sourcefoundry_tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('rss', 'atom', 'web')),
  url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  reliability numeric NOT NULL DEFAULT 0.7 CHECK (reliability >= 0 AND reliability <= 1),
  interval_minutes integer NOT NULL DEFAULT 60 CHECK (interval_minutes >= 5),
  max_items_per_fetch integer NOT NULL DEFAULT 30 CHECK (max_items_per_fetch >= 1),
  timeout_seconds integer NOT NULL DEFAULT 20 CHECK (timeout_seconds >= 1),
  requests_per_second numeric NOT NULL DEFAULT 1 CHECK (requests_per_second >= 0),
  etag text,
  last_modified text,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  next_fetch_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, url)
);

CREATE INDEX IF NOT EXISTS sourcefoundry_sources_due_idx
  ON public.sourcefoundry_sources (next_fetch_at, enabled)
  WHERE enabled = true;

CREATE TABLE IF NOT EXISTS public.sourcefoundry_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.sourcefoundry_tenants(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  entity_type text NOT NULL DEFAULT '',
  entity_id uuid,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'dead_lettered')),
  priority integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sourcefoundry_jobs_lifecycle_check CHECK (
    (status = 'queued' AND started_at IS NULL AND completed_at IS NULL)
    OR status <> 'queued'
  )
);

CREATE INDEX IF NOT EXISTS sourcefoundry_jobs_claim_idx
  ON public.sourcefoundry_jobs (status, run_after, priority DESC)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS sourcefoundry_jobs_tenant_status_idx
  ON public.sourcefoundry_jobs (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sourcefoundry_fetch_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.sourcefoundry_tenants(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.sourcefoundry_sources(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.sourcefoundry_jobs(id) ON DELETE SET NULL,
  status text NOT NULL,
  http_status integer,
  error text,
  duration_ms integer NOT NULL DEFAULT 0,
  items_seen integer NOT NULL DEFAULT 0,
  items_inserted integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sourcefoundry_fetch_attempts_source_started_idx
  ON public.sourcefoundry_fetch_attempts (source_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.sourcefoundry_source_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.sourcefoundry_tenants(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.sourcefoundry_sources(id) ON DELETE SET NULL,
  canonical_url text NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  author text NOT NULL DEFAULT '',
  published_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  content_hash text NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  relevance_score numeric NOT NULL DEFAULT 0 CHECK (relevance_score >= 0 AND relevance_score <= 1),
  source_reliability numeric NOT NULL DEFAULT 0.7 CHECK (source_reliability >= 0 AND source_reliability <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, canonical_url)
);

CREATE INDEX IF NOT EXISTS sourcefoundry_source_items_freshness_idx
  ON public.sourcefoundry_source_items (tenant_id, published_at DESC NULLS LAST, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sourcefoundry_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.sourcefoundry_tenants(id) ON DELETE CASCADE,
  source_item_id uuid NOT NULL REFERENCES public.sourcefoundry_source_items(id) ON DELETE CASCADE,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  url text NOT NULL,
  status text NOT NULL DEFAULT 'ready_for_review'
    CHECK (status IN ('draft', 'ready_for_review', 'approved', 'published', 'rejected')),
  score numeric NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 1),
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  model_version text NOT NULL DEFAULT 'heuristic-v1',
  generated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_item_id)
);

CREATE INDEX IF NOT EXISTS sourcefoundry_candidates_feed_idx
  ON public.sourcefoundry_candidates (tenant_id, status, generated_at DESC);

CREATE TABLE IF NOT EXISTS public.sourcefoundry_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  items_processed integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  error text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sourcefoundry_heartbeats_stage_started_idx
  ON public.sourcefoundry_heartbeats (stage, started_at DESC);

CREATE INDEX IF NOT EXISTS sourcefoundry_heartbeats_status_idx
  ON public.sourcefoundry_heartbeats (status)
  WHERE status <> 'ok';

CREATE OR REPLACE FUNCTION public.claim_next_sourcefoundry_job(
  p_max_attempts integer DEFAULT 5,
  p_job_types text[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  job_type text,
  entity_type text,
  entity_id uuid,
  attempt_count integer,
  payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_id uuid;
BEGIN
  SELECT j.id
    INTO claimed_id
    FROM public.sourcefoundry_jobs j
   WHERE j.status = 'queued'
     AND j.run_after <= now()
     AND j.attempt_count < LEAST(j.max_attempts, p_max_attempts)
     AND (p_job_types IS NULL OR j.job_type = ANY(p_job_types))
   ORDER BY j.priority DESC, j.run_after ASC, j.created_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF claimed_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.sourcefoundry_jobs j
     SET status = 'running',
         attempt_count = j.attempt_count + 1,
         started_at = now(),
         completed_at = NULL,
         last_error = NULL,
         updated_at = now()
   WHERE j.id = claimed_id
   RETURNING j.id, j.tenant_id, j.job_type, j.entity_type, j.entity_id, j.attempt_count, j.payload;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_sourcefoundry_job(integer, text[]) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.claim_next_sourcefoundry_job(integer, text[]) TO service_role';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reap_zombie_sourcefoundry_jobs(p_stale_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reaped_count integer;
BEGIN
  WITH updated AS (
    UPDATE public.sourcefoundry_jobs
       SET status = 'queued',
           started_at = NULL,
           completed_at = NULL,
           updated_at = now()
     WHERE status = 'running'
       AND updated_at < now() - make_interval(mins => p_stale_minutes)
    RETURNING 1
  )
  SELECT count(*) INTO reaped_count FROM updated;

  RETURN reaped_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_zombie_sourcefoundry_jobs(integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.reap_zombie_sourcefoundry_jobs(integer) TO service_role';
  END IF;
END;
$$;

ALTER TABLE public.sourcefoundry_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcefoundry_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcefoundry_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcefoundry_fetch_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcefoundry_source_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcefoundry_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcefoundry_heartbeats ENABLE ROW LEVEL SECURITY;

-- No anon/auth policies yet. The service connects with a dedicated database URL.
