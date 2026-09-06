CREATE OR REPLACE FUNCTION protect_published_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' AND EXISTS(SELECT 1 FROM dataset_versions WHERE tenant_id=OLD.tenant_id AND id=OLD.version_id AND published_at IS NOT NULL) THEN
  RAISE EXCEPTION 'PUBLISHED_VERSION_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_OP <> 'DELETE' AND EXISTS(SELECT 1 FROM dataset_versions WHERE tenant_id=NEW.tenant_id AND id=NEW.version_id AND published_at IS NOT NULL) THEN
  RAISE EXCEPTION 'PUBLISHED_VERSION_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TABLE semantic_model_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, dataset_version_id uuid NOT NULL,
 fields jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,dataset_version_id),
 FOREIGN KEY(tenant_id,dataset_version_id) REFERENCES dataset_versions(tenant_id,id)
);
CREATE TABLE kpi_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, slug varchar(63) NOT NULL, number integer NOT NULL,
 name varchar(120) NOT NULL, description text NOT NULL, model_version_id uuid NOT NULL, dataset_version_id uuid NOT NULL,
 formula text NOT NULL, ast jsonb NOT NULL, unit text NOT NULL, precision integer NOT NULL CHECK(precision BETWEEN 0 AND 12),
 dimensions jsonb NOT NULL, actor_id uuid NOT NULL, creation_key uuid NOT NULL,
 published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,slug,number), UNIQUE(tenant_id,creation_key),
 FOREIGN KEY(tenant_id,model_version_id) REFERENCES semantic_model_versions(tenant_id,id),
 FOREIGN KEY(tenant_id,dataset_version_id) REFERENCES dataset_versions(tenant_id,id)
);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['semantic_model_versions','kpi_versions'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tbl);
 EXECUTE format('CREATE POLICY tenant_scope ON %I TO atlas_app USING(tenant_id=NULLIF(current_setting(''atlas.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''atlas.tenant_id'',true),'''')::uuid)',tbl);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON semantic_model_versions TO atlas_app;
GRANT SELECT,INSERT,UPDATE ON kpi_versions TO atlas_app;
CREATE TRIGGER immutable_kpi BEFORE UPDATE ON kpi_versions FOR EACH ROW EXECUTE FUNCTION protect_published_version();
