CREATE TABLE datasets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES organizations(id),
 name varchar(120) NOT NULL, slug varchar(63) NOT NULL, current_version_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), creation_key uuid NOT NULL,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,slug), UNIQUE(tenant_id,creation_key)
);
CREATE TABLE dataset_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
 dataset_id uuid NOT NULL, number integer NOT NULL, actor_id uuid NOT NULL,
 filename varchar(200) NOT NULL, bytes bigint NOT NULL CHECK(bytes BETWEEN 1 AND 262144000),
 format varchar(10) NOT NULL CHECK(format IN ('csv','xlsx')),
 object_key text NOT NULL, object_version text, sha256 char(64),
 state varchar(30) NOT NULL DEFAULT 'uploaded' CHECK(state IN ('uploaded','profiling','awaiting_mapping','validating','importing','ready','failed','cancelled')),
 regional jsonb NOT NULL, profile jsonb, mapping jsonb, row_count bigint NOT NULL DEFAULT 0,
 issues jsonb NOT NULL DEFAULT '[]', issue_count integer NOT NULL DEFAULT 0, error_code varchar(80), progress integer NOT NULL DEFAULT 0,
 base_version_id uuid, creation_key uuid NOT NULL, published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,dataset_id,id), UNIQUE(tenant_id,dataset_id,number), UNIQUE(tenant_id,dataset_id,creation_key),
 FOREIGN KEY(tenant_id,dataset_id) REFERENCES datasets(tenant_id,id),
 FOREIGN KEY(tenant_id,dataset_id,base_version_id) REFERENCES dataset_versions(tenant_id,dataset_id,id)
);
ALTER TABLE datasets ADD CONSTRAINT dataset_current_version FOREIGN KEY(tenant_id,id,current_version_id) REFERENCES dataset_versions(tenant_id,dataset_id,id);
CREATE TABLE dataset_rows (
 tenant_id uuid NOT NULL, version_id uuid NOT NULL, row_number bigint NOT NULL,
 values jsonb NOT NULL, key_hash text, source_version_id uuid NOT NULL, source_row bigint NOT NULL, source_sheet varchar(200) NOT NULL,
 PRIMARY KEY(tenant_id,version_id,row_number), UNIQUE(tenant_id,version_id,key_hash),
 FOREIGN KEY(tenant_id,version_id) REFERENCES dataset_versions(tenant_id,id),
 FOREIGN KEY(tenant_id,source_version_id) REFERENCES dataset_versions(tenant_id,id)
);
CREATE TABLE dataset_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, dataset_id uuid NOT NULL, version_id uuid NOT NULL,
 actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), creation_key uuid NOT NULL,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,dataset_id,creation_key),
 FOREIGN KEY(tenant_id,dataset_id,version_id) REFERENCES dataset_versions(tenant_id,dataset_id,id)
);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['datasets','dataset_versions','dataset_rows','dataset_publications'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tbl);
 EXECUTE format('CREATE POLICY tenant_scope ON %I TO atlas_app USING (tenant_id = NULLIF(current_setting(''atlas.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''atlas.tenant_id'',true),'''')::uuid)',tbl);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON datasets,dataset_versions TO atlas_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON dataset_rows TO atlas_app;
GRANT SELECT,INSERT ON dataset_publications TO atlas_app;
CREATE FUNCTION protect_published_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM dataset_versions WHERE tenant_id = COALESCE(NEW.tenant_id,OLD.tenant_id) AND id = COALESCE(NEW.version_id,OLD.version_id) AND published_at IS NOT NULL) THEN
  RAISE EXCEPTION 'PUBLISHED_VERSION_IMMUTABLE' USING ERRCODE = '23514';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER immutable_rows BEFORE INSERT OR UPDATE OR DELETE ON dataset_rows FOR EACH ROW EXECUTE FUNCTION protect_published_rows();
CREATE FUNCTION protect_published_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.published_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'PUBLISHED_VERSION_IMMUTABLE' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_version BEFORE UPDATE ON dataset_versions FOR EACH ROW EXECUTE FUNCTION protect_published_version();
