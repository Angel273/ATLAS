CREATE TABLE employee_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  name varchar(120) NOT NULL,
  slug varchar(63) NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id uuid,
  name varchar(120) NOT NULL,
  slug varchar(63) NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug),
  FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id)
);

CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  code varchar(63) NOT NULL,
  first_name varchar(120) NOT NULL,
  last_name varchar(120) NOT NULL,
  email varchar(255),
  status varchar(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'on_leave')),
  hire_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE employee_attribute_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  name varchar(120) NOT NULL,
  slug varchar(63) NOT NULL,
  data_type varchar(30) NOT NULL DEFAULT 'string' CHECK (data_type IN ('string', 'number', 'boolean', 'date')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE employee_attribute_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  employee_id uuid NOT NULL,
  attribute_definition_id uuid NOT NULL,
  value text NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, id),
  FOREIGN KEY (tenant_id, attribute_definition_id) REFERENCES employee_attribute_definitions(tenant_id, id)
);

CREATE TABLE employment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  employee_id uuid NOT NULL,
  employee_type_id uuid NOT NULL,
  team_id uuid,
  account_id uuid,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, id),
  FOREIGN KEY (tenant_id, employee_type_id) REFERENCES employee_types(tenant_id, id),
  FOREIGN KEY (tenant_id, team_id) REFERENCES teams(tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id)
);

CREATE TABLE employee_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id),
  employee_id uuid NOT NULL,
  manager_id uuid NOT NULL,
  relation_type varchar(30) NOT NULL DEFAULT 'supervisor' CHECK (relation_type IN ('supervisor', 'mentor', 'manager', 'coach')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, id),
  FOREIGN KEY (tenant_id, manager_id) REFERENCES employees(tenant_id, id)
);

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['employee_types', 'teams', 'employees', 'employee_attribute_definitions', 'employee_attribute_values', 'employment_assignments', 'employee_relationships'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY tenant_scope ON %I TO atlas_app USING (tenant_id = NULLIF(current_setting(''atlas.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''atlas.tenant_id'', true), '''')::uuid)', tbl);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON employee_types, teams, employees, employee_attribute_definitions, employee_attribute_values, employment_assignments, employee_relationships TO atlas_app;
