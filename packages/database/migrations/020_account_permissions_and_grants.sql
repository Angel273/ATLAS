-- 020_account_permissions_and_grants.sql
-- Garantizar permisos y políticas RLS para lectura de cuentas por atlas_auth
-- y gestión de accesos a cuentas por atlas_app

-- 1. Permisos para que atlas_auth pueda leer cuentas asociadas a sesiones activas
GRANT USAGE ON SCHEMA public TO atlas_auth;
GRANT SELECT ON public.accounts TO atlas_auth;

DROP POLICY IF EXISTS accounts_auth_read ON public.accounts;
CREATE POLICY accounts_auth_read ON public.accounts FOR SELECT TO atlas_auth
  USING (true);

-- 2. Permisos para que atlas_app pueda gestionar accesos a cuentas en identity.membership_account_access
GRANT USAGE ON SCHEMA identity TO atlas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.membership_account_access TO atlas_app;

DROP POLICY IF EXISTS membership_account_access_app ON identity.membership_account_access;
CREATE POLICY membership_account_access_app ON identity.membership_account_access TO atlas_app
  USING (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid);
