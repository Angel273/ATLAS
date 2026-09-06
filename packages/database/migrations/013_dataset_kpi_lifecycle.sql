-- 013_dataset_kpi_lifecycle.sql
-- Añadir columna de archivado en datasets
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Conceder permisos DELETE a la aplicación en tablas gobernadas
GRANT DELETE ON datasets, dataset_versions, dataset_publications, kpi_versions TO atlas_app;

-- Proteger datasets publicados contra borrado físico
CREATE OR REPLACE FUNCTION protect_published_dataset_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM dataset_versions
    WHERE tenant_id = OLD.tenant_id AND dataset_id = OLD.id AND published_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'PUBLISHED_DATASET_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS immutable_dataset_delete ON datasets;
CREATE TRIGGER immutable_dataset_delete
  BEFORE DELETE ON datasets
  FOR EACH ROW
  EXECUTE FUNCTION protect_published_dataset_delete();

-- Proteger versiones publicadas de dataset contra borrado físico
CREATE OR REPLACE FUNCTION protect_published_version_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLISHED_VERSION_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS immutable_version_delete ON dataset_versions;
CREATE TRIGGER immutable_version_delete
  BEFORE DELETE ON dataset_versions
  FOR EACH ROW
  EXECUTE FUNCTION protect_published_version_delete();

-- Proteger KPIs publicados contra borrado físico
CREATE OR REPLACE FUNCTION protect_published_kpi_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLISHED_KPI_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS immutable_kpi_delete ON kpi_versions;
CREATE TRIGGER immutable_kpi_delete
  BEFORE DELETE ON kpi_versions
  FOR EACH ROW
  EXECUTE FUNCTION protect_published_kpi_delete();
