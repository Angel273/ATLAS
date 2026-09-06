CREATE SCHEMA IF NOT EXISTS identity;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'atlas_app') THEN CREATE ROLE atlas_app NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'atlas_auth') THEN CREATE ROLE atlas_auth NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
END $$;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  timezone varchar(80) NOT NULL DEFAULT 'America/Guatemala',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  name varchar(120) NOT NULL,
  timezone varchar(80) NOT NULL DEFAULT 'America/Guatemala',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, name)
);
CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  actor_id uuid NOT NULL,
  event varchar(80) NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX audit_tenant_time ON public.audit_events (tenant_id, created_at DESC);

CREATE TABLE identity.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(254) NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  mfa_secret text,
  mfa_enabled boolean NOT NULL DEFAULT false,
  last_totp_step bigint NOT NULL DEFAULT -1,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT mfa_enabled OR mfa_secret IS NOT NULL)
);
CREATE TABLE identity.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES identity.users(id),
  role varchar(40) NOT NULL CHECK (role IN ('admin', 'supervisor', 'floor_manager', 'quality_coordinator', 'operations_manager', 'ceo')),
  capabilities text[] NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX memberships_user ON identity.memberships (user_id);
CREATE TABLE identity.sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id),
  tenant_id uuid REFERENCES public.organizations(id),
  stage varchar(20) NOT NULL CHECK (stage IN ('mfa_setup', 'mfa_verify', 'authenticated')),
  pending_mfa_secret text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (stage <> 'authenticated' OR tenant_id IS NOT NULL)
);
CREATE INDEX sessions_user ON identity.sessions (user_id);
CREATE INDEX sessions_expiry ON identity.sessions (expires_at);
CREATE TABLE identity.rate_limits (
  key_hash char(64) PRIMARY KEY,
  attempts integer NOT NULL,
  reset_at timestamptz NOT NULL
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_tenant ON public.organizations TO atlas_app
  USING (id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid);
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY accounts_tenant ON public.accounts TO atlas_app
  USING (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid);
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_tenant ON public.audit_events TO atlas_app
  USING (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid);
ALTER TABLE identity.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.memberships FORCE ROW LEVEL SECURITY;
-- Only the identity service can discover memberships of a password/session-verified user.
CREATE POLICY membership_identity ON identity.memberships TO atlas_auth
  USING (user_id = NULLIF(current_setting('atlas.user_id', true), '')::uuid);

GRANT USAGE ON SCHEMA public TO atlas_app;
GRANT SELECT ON public.organizations TO atlas_app;
GRANT SELECT, INSERT, UPDATE ON public.accounts TO atlas_app;
GRANT SELECT, INSERT ON public.audit_events TO atlas_app;
GRANT USAGE ON SCHEMA identity TO atlas_auth;
GRANT SELECT, INSERT, UPDATE ON identity.users TO atlas_auth;
GRANT SELECT ON identity.memberships TO atlas_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.sessions, identity.rate_limits TO atlas_auth;
REVOKE ALL ON SCHEMA identity FROM PUBLIC;
