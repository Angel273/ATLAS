CREATE TABLE semantic_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  from_dataset_id uuid NOT NULL,
  from_field varchar(63) NOT NULL,
  to_dataset_id uuid NOT NULL,
  to_field varchar(63) NOT NULL,
  cardinality varchar(20) NOT NULL CHECK (cardinality IN ('one_to_one', 'many_to_one', 'one_to_many')),
  join_type varchar(10) NOT NULL DEFAULT 'left' CHECK (join_type IN ('inner', 'left')),
  is_preferred boolean NOT NULL DEFAULT false,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  creation_key uuid NOT NULL,
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, creation_key),
  UNIQUE(tenant_id, from_dataset_id, from_field, to_dataset_id, to_field),
  FOREIGN KEY(tenant_id, from_dataset_id) REFERENCES datasets(tenant_id, id),
  FOREIGN KEY(tenant_id, to_dataset_id) REFERENCES datasets(tenant_id, id)
);

ALTER TABLE kpi_versions
  ADD COLUMN target_direction varchar(20) NOT NULL DEFAULT 'higher_is_better' CHECK(target_direction IN ('higher_is_better', 'lower_is_better', 'target_match')),
  ADD COLUMN targets jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN dependencies jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN deprecated_at timestamptz;

ALTER TABLE semantic_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE semantic_relationships FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON semantic_relationships TO atlas_app
  USING (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON semantic_relationships TO atlas_app;

CREATE TRIGGER immutable_relationship BEFORE UPDATE ON semantic_relationships FOR EACH ROW EXECUTE FUNCTION protect_published_version();
