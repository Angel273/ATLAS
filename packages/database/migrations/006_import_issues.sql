CREATE TABLE dataset_issues (
 tenant_id uuid NOT NULL, version_id uuid NOT NULL, ordinal bigint NOT NULL,
 source_row bigint NOT NULL, field varchar(200) NOT NULL, code varchar(80) NOT NULL,
 PRIMARY KEY(tenant_id,version_id,ordinal),
 FOREIGN KEY(tenant_id,version_id) REFERENCES dataset_versions(tenant_id,id)
);
ALTER TABLE dataset_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON dataset_issues TO atlas_app USING(tenant_id = NULLIF(current_setting('atlas.tenant_id',true),'')::uuid) WITH CHECK(tenant_id = NULLIF(current_setting('atlas.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,DELETE ON dataset_issues TO atlas_app;
