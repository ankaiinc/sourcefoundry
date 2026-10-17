CREATE TABLE public.sourcefoundry_job_postings (
  source text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'removed')),
  PRIMARY KEY (source, id)
);
CREATE TABLE public.sourcefoundry_job_source_status (
  source text PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  complete boolean NOT NULL,
  has_success boolean NOT NULL,
  error text
);
ALTER TABLE public.sourcefoundry_job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcefoundry_job_source_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sourcefoundry_job_postings, public.sourcefoundry_job_source_status FROM PUBLIC;
