CREATE TABLE dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id),
  name varchar(120) NOT NULL,
  slug varchar(63) NOT NULL,
  description text NOT NULL DEFAULT '',
  current_version_id uuid,
  creation_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, slug),
  UNIQUE(tenant_id, creation_key)
);

CREATE TABLE dashboard_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  dashboard_id uuid NOT NULL,
  number integer NOT NULL,
  title varchar(120) NOT NULL,
  description text NOT NULL DEFAULT '',
  layout jsonb NOT NULL DEFAULT '[]',
  global_filters jsonb NOT NULL DEFAULT '{}',
  actor_id uuid NOT NULL,
  creation_key uuid NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, dashboard_id, id),
  UNIQUE(tenant_id, dashboard_id, number),
  UNIQUE(tenant_id, dashboard_id, creation_key),
  FOREIGN KEY(tenant_id, dashboard_id) REFERENCES dashboards(tenant_id, id)
);

ALTER TABLE dashboards ADD CONSTRAINT dashboard_current_version
  FOREIGN KEY(tenant_id, id, current_version_id) REFERENCES dashboard_versions(tenant_id, dashboard_id, id);

CREATE TABLE dashboard_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  dashboard_id uuid NOT NULL,
  version_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  creation_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, dashboard_id, creation_key),
  FOREIGN KEY(tenant_id, dashboard_id, version_id) REFERENCES dashboard_versions(tenant_id, dashboard_id, id)
);

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['dashboards','dashboard_versions','dashboard_publications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY tenant_scope ON %I TO atlas_app USING (tenant_id = NULLIF(current_setting(''atlas.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''atlas.tenant_id'', true), '''')::uuid)', tbl);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON dashboards, dashboard_versions TO atlas_app;
GRANT SELECT, INSERT ON dashboard_publications TO atlas_app;

CREATE TRIGGER immutable_dashboard_version BEFORE UPDATE ON dashboard_versions FOR EACH ROW EXECUTE FUNCTION protect_published_version();
