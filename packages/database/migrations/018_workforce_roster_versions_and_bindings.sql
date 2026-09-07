-- 018_workforce_roster_versions_and_bindings.sql

-- Garantizar claves únicas compuestas necesarias para referencias foráneas
ALTER TABLE public.workforce_weeks DROP CONSTRAINT IF EXISTS workforce_weeks_tenant_account_id_key;
ALTER TABLE public.workforce_weeks ADD CONSTRAINT workforce_weeks_tenant_account_id_key UNIQUE (tenant_id, account_id, id);

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_tenant_account_id_key;
ALTER TABLE public.employees ADD CONSTRAINT employees_tenant_account_id_key UNIQUE (tenant_id, account_id, id);

ALTER TABLE public.datasets DROP CONSTRAINT IF EXISTS datasets_tenant_account_id_key;
ALTER TABLE public.datasets ADD CONSTRAINT datasets_tenant_account_id_key UNIQUE (tenant_id, account_id, id);

ALTER TABLE public.dataset_versions DROP CONSTRAINT IF EXISTS dataset_versions_tenant_account_id_key;
ALTER TABLE public.dataset_versions ADD CONSTRAINT dataset_versions_tenant_account_id_key UNIQUE (tenant_id, account_id, id);

-- 1. Rosters versionados inmutables por semana y cuenta
CREATE TABLE IF NOT EXISTS public.workforce_roster_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  week_id uuid NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  status varchar(30) NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'validating', 'ready', 'published', 'failed')),
  storage_path text,
  sha256 char(64),
  mapping jsonb NOT NULL DEFAULT '{}',
  row_count integer NOT NULL DEFAULT 0,
  issue_count integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES identity.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (tenant_id, account_id, id),
  UNIQUE (tenant_id, account_id, week_id, version_number),
  FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, account_id, week_id) REFERENCES public.workforce_weeks(tenant_id, account_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_roster_versions_week ON public.workforce_roster_versions(tenant_id, account_id, week_id);

-- 2. Entradas del roster congeladas por versión
CREATE TABLE IF NOT EXISTS public.workforce_roster_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  roster_version_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  employee_code varchar(63) NOT NULL,
  bms_id varchar(63),
  wave varchar(63),
  team_id uuid,
  team_name varchar(120),
  employee_type_slug varchar(63),
  supervisor_id uuid,
  supervisor_name varchar(255),
  floor_manager_id uuid,
  floor_manager_name varchar(255),
  metadata jsonb NOT NULL DEFAULT '{}',
  source_sheet varchar(120),
  source_row integer,
  UNIQUE (tenant_id, account_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, account_id, roster_version_id) REFERENCES public.workforce_roster_versions(tenant_id, account_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, account_id, employee_id) REFERENCES public.employees(tenant_id, account_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_roster_entries_version ON public.workforce_roster_entries(tenant_id, account_id, roster_version_id);
CREATE INDEX IF NOT EXISTS idx_roster_entries_code ON public.workforce_roster_entries(tenant_id, account_id, employee_code);
CREATE INDEX IF NOT EXISTS idx_roster_entries_bms ON public.workforce_roster_entries(tenant_id, account_id, bms_id);

-- 3. Bindings semánticos versionados a nivel de dataset
CREATE TABLE IF NOT EXISTS public.dataset_workforce_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  dataset_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  status varchar(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  employee_key_field varchar(63) NOT NULL,
  key_type varchar(30) NOT NULL CHECK (key_type IN ('employee_code', 'bms_id')),
  temporal_strategy varchar(30) NOT NULL CHECK (temporal_strategy IN ('event_date', 'fixed_week')),
  date_field varchar(63),
  fixed_week_id uuid,
  exposed_dimensions text[] NOT NULL DEFAULT '{"supervisor", "floor_manager", "wave", "team"}',
  coverage_threshold decimal(5,2) NOT NULL DEFAULT 85.00,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (tenant_id, account_id, id),
  UNIQUE (tenant_id, account_id, dataset_version_id, version_number),
  FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, account_id, dataset_id) REFERENCES public.datasets(tenant_id, account_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, account_id, dataset_version_id) REFERENCES public.dataset_versions(tenant_id, account_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bindings_dataset ON public.dataset_workforce_bindings(tenant_id, account_id, dataset_version_id);

-- 4. Puente materializado Dataset - Roster para reproducibilidad y velocidad
CREATE TABLE IF NOT EXISTS public.dataset_workforce_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  binding_id uuid NOT NULL,
  dataset_version_id uuid NOT NULL,
  row_number integer NOT NULL,
  week_id uuid,
  roster_version_id uuid,
  roster_entry_id uuid,
  match_status varchar(30) NOT NULL DEFAULT 'matched' CHECK (match_status IN ('matched', 'unmatched', 'ambiguous')),
  matched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_id, id),
  UNIQUE (tenant_id, account_id, binding_id, row_number),
  FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, account_id, binding_id) REFERENCES public.dataset_workforce_bindings(tenant_id, account_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_matches_lookup ON public.dataset_workforce_matches(tenant_id, account_id, binding_id, row_number);

-- 5. RLS para nuevas tablas
DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'workforce_roster_versions', 'workforce_roster_entries',
    'dataset_workforce_bindings', 'dataset_workforce_matches'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
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

GRANT SELECT, INSERT, UPDATE, DELETE ON workforce_roster_versions, workforce_roster_entries, dataset_workforce_bindings, dataset_workforce_matches TO atlas_app;
