-- 017_account_scoping_and_clean_slate.sql
-- 1. Desactivar temporalmente triggers de inmutabilidad para permitir el reseteo limpio solicitado
ALTER TABLE public.datasets DISABLE TRIGGER ALL;
ALTER TABLE public.dataset_versions DISABLE TRIGGER ALL;
ALTER TABLE public.dataset_rows DISABLE TRIGGER ALL;
ALTER TABLE public.kpi_versions DISABLE TRIGGER ALL;
ALTER TABLE public.dashboards DISABLE TRIGGER ALL;
ALTER TABLE public.dashboard_versions DISABLE TRIGGER ALL;

-- Romper referencias circulares (current_version_id) antes de purgar
UPDATE public.dashboards SET current_version_id = NULL;
UPDATE public.datasets SET current_version_id = NULL;

-- Purga limpia de datos operacionales previos respetando llaves foráneas, preservando al usuario administrador
DELETE FROM public.conversation_tool_executions;
DELETE FROM public.conversation_messages;
DELETE FROM public.conversations;
DELETE FROM public.dashboard_publications;
DELETE FROM public.dashboard_versions;
DELETE FROM public.dashboards;
DELETE FROM public.kpi_versions;
DELETE FROM public.semantic_relationships;
DELETE FROM public.semantic_model_versions;
DELETE FROM public.dataset_issues;
DELETE FROM public.dataset_publications;
DELETE FROM public.dataset_rows;
DELETE FROM public.dataset_versions;
DELETE FROM public.datasets;
DELETE FROM public.employee_relationships;
DELETE FROM public.employment_assignments;
DELETE FROM public.employee_attribute_values;
DELETE FROM public.employee_attribute_definitions;
DELETE FROM public.employees;
DELETE FROM public.teams;
DELETE FROM public.employee_types;
DELETE FROM public.workforce_weeks;
DELETE FROM public.audit_events;
DELETE FROM identity.sessions;

-- Eliminar usuarios de prueba no administradores si existen
DELETE FROM identity.memberships WHERE role <> 'admin';
DELETE FROM identity.users WHERE id NOT IN (SELECT user_id FROM identity.memberships WHERE role = 'admin');

-- Purgar cuentas previas para iniciar limpias desde el Portal
DELETE FROM public.accounts;

-- Reactivar triggers de inmutabilidad
ALTER TABLE public.datasets ENABLE TRIGGER ALL;
ALTER TABLE public.dataset_versions ENABLE TRIGGER ALL;
ALTER TABLE public.dataset_rows ENABLE TRIGGER ALL;
ALTER TABLE public.kpi_versions ENABLE TRIGGER ALL;
ALTER TABLE public.dashboards ENABLE TRIGGER ALL;
ALTER TABLE public.dashboard_versions ENABLE TRIGGER ALL;

-- 2. Alterar tabla accounts para ciclo de vida dual (archivo lógico)
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT NULL;

-- 3. Tabla de accesos explícitos a cuentas por membresía (identity.membership_account_access)
CREATE TABLE IF NOT EXISTS identity.membership_account_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES identity.memberships(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, account_id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_membership_account_access_member ON identity.membership_account_access(membership_id);
CREATE INDEX IF NOT EXISTS idx_membership_account_access_account ON identity.membership_account_access(account_id);

ALTER TABLE identity.membership_account_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.membership_account_access FORCE ROW LEVEL SECURITY;

CREATE POLICY membership_account_access_identity ON identity.membership_account_access TO atlas_auth
  USING (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON identity.membership_account_access TO atlas_auth;
GRANT SELECT ON identity.membership_account_access TO atlas_app;

-- 4. Soporte de cuenta activa en sesiones (identity.sessions)
ALTER TABLE identity.sessions
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_account ON identity.sessions(account_id);

-- 5. Tabla de invitaciones a la organización (identity.invitations)
CREATE TABLE IF NOT EXISTS identity.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email varchar(254) NOT NULL CHECK (email = lower(email)),
  role varchar(40) NOT NULL CHECK (role IN ('admin', 'supervisor', 'floor_manager', 'quality_coordinator', 'operations_manager', 'ceo')),
  token_hash char(64) NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES identity.users(id),
  account_ids uuid[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_invitations_tenant_email ON identity.invitations(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON identity.invitations(token_hash);

ALTER TABLE identity.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY invitations_identity ON identity.invitations TO atlas_auth
  USING (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON identity.invitations TO atlas_auth;

-- 6. Ámbito de Cuenta (account_id) en Datasets y Modelos Semánticos
ALTER TABLE public.datasets
  ADD COLUMN account_id uuid NOT NULL,
  ADD CONSTRAINT fk_datasets_account FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public.datasets DROP CONSTRAINT IF EXISTS datasets_tenant_id_slug_key;
ALTER TABLE public.datasets ADD CONSTRAINT datasets_tenant_account_slug_key UNIQUE (tenant_id, account_id, slug);

ALTER TABLE public.dataset_versions
  ADD COLUMN account_id uuid NOT NULL,
  ADD CONSTRAINT fk_dataset_versions_account FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public.semantic_model_versions
  ADD COLUMN account_id uuid NOT NULL,
  ADD CONSTRAINT fk_semantic_model_versions_account FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public.semantic_relationships
  ADD COLUMN account_id uuid NOT NULL,
  ADD CONSTRAINT fk_semantic_relationships_account FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public.kpi_versions
  ADD COLUMN account_id uuid NOT NULL,
  ADD CONSTRAINT fk_kpi_versions_account FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public.kpi_versions DROP CONSTRAINT IF EXISTS kpi_versions_tenant_id_slug_number_key;
ALTER TABLE public.kpi_versions ADD CONSTRAINT kpi_versions_tenant_account_slug_number_key UNIQUE (tenant_id, account_id, slug, number);

-- 7. Ámbito de Cuenta (account_id) en Dashboards y Conversaciones
ALTER TABLE public.dashboards
  ADD COLUMN account_id uuid NOT NULL,
  ADD CONSTRAINT fk_dashboards_account FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public.dashboards DROP CONSTRAINT IF EXISTS dashboards_tenant_id_slug_key;
ALTER TABLE public.dashboards ADD CONSTRAINT dashboards_tenant_account_slug_key UNIQUE (tenant_id, account_id, slug);

ALTER TABLE public.dashboard_versions
  ADD COLUMN account_id uuid NOT NULL,
  ADD CONSTRAINT fk_dashboard_versions_account FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public.conversations
  ADD COLUMN account_id uuid NOT NULL,
  ADD CONSTRAINT fk_conversations_account FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE;

-- 8. Workforce con Catálogos Exclusivos por Cuenta
ALTER TABLE public.employee_types
  ADD COLUMN account_id uuid NOT NULL,
  ADD CONSTRAINT fk_employee_types_account FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public.employee_types DROP CONSTRAINT IF EXISTS employee_types_tenant_id_slug_key;
ALTER TABLE public.employee_types ADD CONSTRAINT employee_types_tenant_account_slug_key UNIQUE (tenant_id, account_id, slug);

ALTER TABLE public.teams
  ALTER COLUMN account_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS teams_tenant_id_slug_key,
  ADD CONSTRAINT teams_tenant_account_slug_key UNIQUE (tenant_id, account_id, slug);

ALTER TABLE public.employees
  ADD COLUMN account_id uuid NOT NULL,
  ADD CONSTRAINT fk_employees_account FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_tenant_id_code_key;
ALTER TABLE public.employees ADD CONSTRAINT employees_tenant_account_code_key UNIQUE (tenant_id, account_id, code);

ALTER TABLE public.employee_attribute_definitions
  ADD COLUMN account_id uuid NOT NULL,
  ADD CONSTRAINT fk_employee_attribute_defs_account FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public.employee_attribute_definitions DROP CONSTRAINT IF EXISTS employee_attribute_definitions_tenant_id_slug_key;
ALTER TABLE public.employee_attribute_definitions ADD CONSTRAINT employee_attribute_definitions_tenant_account_slug_key UNIQUE (tenant_id, account_id, slug);

ALTER TABLE public.employment_assignments
  ALTER COLUMN account_id SET NOT NULL;

ALTER TABLE public.workforce_weeks
  ADD COLUMN account_id uuid NOT NULL,
  ADD CONSTRAINT fk_workforce_weeks_account FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public.workforce_weeks DROP CONSTRAINT IF EXISTS workforce_weeks_tenant_id_week_code_key;
ALTER TABLE public.workforce_weeks ADD CONSTRAINT workforce_weeks_tenant_account_week_code_key UNIQUE (tenant_id, account_id, week_code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workforce_weeks_current
  ON public.workforce_weeks (tenant_id, account_id)
  WHERE status = 'current';

-- 9. Trigger de protección contra Hard Delete de cuentas con recursos asociados
CREATE OR REPLACE FUNCTION check_account_deletion_guard()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM datasets WHERE account_id = OLD.id)
     OR EXISTS (SELECT 1 FROM kpi_versions WHERE account_id = OLD.id)
     OR EXISTS (SELECT 1 FROM dashboards WHERE account_id = OLD.id)
     OR EXISTS (SELECT 1 FROM workforce_weeks WHERE account_id = OLD.id)
     OR EXISTS (SELECT 1 FROM employees WHERE account_id = OLD.id) THEN
    RAISE EXCEPTION 'ACCOUNT_HAS_DATA_ARCHIVE_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_account_delete ON public.accounts;
CREATE TRIGGER trg_guard_account_delete
  BEFORE DELETE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION check_account_deletion_guard();

-- 10. Actualización de Políticas RLS para tablas operacionales con account_id
DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'datasets', 'dataset_versions', 'semantic_model_versions', 'semantic_relationships',
    'kpi_versions', 'dashboards', 'dashboard_versions', 'conversations',
    'employee_types', 'teams', 'employees', 'employee_attribute_definitions',
    'employment_assignments', 'workforce_weeks'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_scope ON %I TO atlas_app ' ||
      'USING (tenant_id = NULLIF(current_setting(''atlas.tenant_id'', true), '''')::uuid ' ||
      'AND (account_id = NULLIF(current_setting(''atlas.account_id'', true), '''')::uuid OR NULLIF(current_setting(''atlas.account_id'', true), '''') IS NULL)) ' ||
      'WITH CHECK (tenant_id = NULLIF(current_setting(''atlas.tenant_id'', true), '''')::uuid ' ||
      'AND (account_id = NULLIF(current_setting(''atlas.account_id'', true), '''')::uuid OR NULLIF(current_setting(''atlas.account_id'', true), '''') IS NULL))',
      tbl
    );
  END LOOP;
END $$;
