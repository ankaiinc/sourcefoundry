-- Autonomous agent workspaces receive tenant-scoped credentials. Token values
-- are never stored: only a SHA-256 hash and a short display prefix persist.

ALTER TABLE public.sourcefoundry_sources
  ADD COLUMN IF NOT EXISTS agent_managed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS sourcefoundry_sources_agent_managed_idx
  ON public.sourcefoundry_sources (agent_managed)
  WHERE agent_managed = true;

CREATE TABLE IF NOT EXISTS public.sourcefoundry_agent_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.sourcefoundry_tenants(id) ON DELETE CASCADE,
  label text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS sourcefoundry_agent_credentials_active_token_idx
  ON public.sourcefoundry_agent_credentials (token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS sourcefoundry_agent_credentials_created_idx
  ON public.sourcefoundry_agent_credentials (created_at DESC);

ALTER TABLE public.sourcefoundry_agent_credentials ENABLE ROW LEVEL SECURITY;
