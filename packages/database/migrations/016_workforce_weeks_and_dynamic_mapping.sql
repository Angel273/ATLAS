-- 1. Tabla de Semanas Operativas (Lunes a Domingo) con soporte de atributos libres
CREATE TABLE workforce_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  week_code varchar(10) NOT NULL, -- Ej: '2026-W36'
  year_number integer NOT NULL,
  week_number integer NOT NULL CHECK (week_number BETWEEN 1 AND 53),
  start_date date NOT NULL, -- Siempre Lunes
  end_date date NOT NULL,   -- Siempre Domingo
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'current')),
  custom_attributes jsonb NOT NULL DEFAULT '{}', -- Columna libre para agregar cualquier dato de la semana
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, week_code),
  CHECK (end_date = start_date + INTERVAL '6 days')
);

-- 2. Empleados con soporte de identificación flexible
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS normalized_name varchar(255) GENERATED ALWAYS AS (
    UPPER(TRIM(regexp_replace(first_name || ' ' || last_name, '\s+', ' ', 'g')))
  ) STORED,
  ADD COLUMN IF NOT EXISTS wave varchar(63),
  ADD COLUMN IF NOT EXISTS bms_id varchar(63),
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_employees_normalized_name ON employees(tenant_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_employees_bms_id ON employees(tenant_id, bms_id);

-- 3. Asignaciones Laborales Semanales con metadatos libres
ALTER TABLE employment_assignments
  ADD COLUMN IF NOT EXISTS week_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}',
  ADD CONSTRAINT fk_employment_assignments_week 
    FOREIGN KEY (tenant_id, week_id) REFERENCES workforce_weeks(tenant_id, id);

-- 4. Ampliar relaciones de jerarquía con soporte de FM y Semanas
ALTER TABLE employee_relationships 
  DROP CONSTRAINT IF EXISTS employee_relationships_relation_type_check;

ALTER TABLE employee_relationships
  ADD CONSTRAINT employee_relationships_relation_type_check 
  CHECK (relation_type IN ('supervisor', 'mentor', 'manager', 'coach', 'floor_manager', 'operations_manager'));

ALTER TABLE employee_relationships
  ADD COLUMN IF NOT EXISTS week_id uuid,
  ADD CONSTRAINT fk_employee_relationships_week 
    FOREIGN KEY (tenant_id, week_id) REFERENCES workforce_weeks(tenant_id, id);

-- 5. Capa Semántica y KPIs: Mapeo y Columnas Dinámicas
ALTER TABLE kpi_versions
  ADD COLUMN IF NOT EXISTS workforce_mapping jsonb NOT NULL DEFAULT '{
    "enabled": false,
    "matchKey": "code",
    "datasetField": "",
    "selectedColumns": ["supervisor", "floor_manager", "wave", "tenure"]
  }';

-- RLS para workforce_weeks
ALTER TABLE workforce_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_weeks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON workforce_weeks TO atlas_app
  USING (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON workforce_weeks TO atlas_app;
