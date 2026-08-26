-- Durable high-level source supply contracts over the existing ingestion pipeline.

CREATE TABLE IF NOT EXISTS public.sourcefoundry_source_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.sourcefoundry_tenants(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  name text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  every_minutes integer NOT NULL CHECK (every_minutes >= 5 AND every_minutes <= 10080),
  max_items_per_run integer NOT NULL CHECK (max_items_per_run >= 1 AND max_items_per_run <= 100),
  max_candidates_per_run integer NOT NULL CHECK (max_candidates_per_run >= 1 AND max_candidates_per_run <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.sourcefoundry_source_feed_sources (
  source_feed_id uuid NOT NULL REFERENCES public.sourcefoundry_source_feeds(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.sourcefoundry_sources(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('feed', 'page', 'discovery')),
  required boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_feed_id, source_id)
);

CREATE TABLE IF NOT EXISTS public.sourcefoundry_source_feed_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.sourcefoundry_tenants(id) ON DELETE CASCADE,
  source_feed_id uuid NOT NULL REFERENCES public.sourcefoundry_source_feeds(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sourcefoundry_source_feed_run_jobs (
  source_feed_run_id uuid NOT NULL REFERENCES public.sourcefoundry_source_feed_runs(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.sourcefoundry_jobs(id) ON DELETE CASCADE,
  PRIMARY KEY (source_feed_run_id, job_id)
);

CREATE INDEX IF NOT EXISTS sourcefoundry_source_feed_runs_feed_created_idx
  ON public.sourcefoundry_source_feed_runs (source_feed_id, created_at DESC);

ALTER TABLE public.sourcefoundry_source_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcefoundry_source_feed_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcefoundry_source_feed_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcefoundry_source_feed_run_jobs ENABLE ROW LEVEL SECURITY;
