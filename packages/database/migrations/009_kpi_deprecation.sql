CREATE OR REPLACE FUNCTION protect_published_kpi() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    IF OLD.deprecated_at IS NULL AND NEW.deprecated_at IS NOT NULL AND
       ROW(OLD.id, OLD.tenant_id, OLD.slug, OLD.number, OLD.name, OLD.description, OLD.model_version_id, OLD.dataset_version_id, OLD.formula, OLD.ast, OLD.unit, OLD.precision, OLD.dimensions, OLD.actor_id, OLD.creation_key, OLD.published_at, OLD.created_at, OLD.target_direction, OLD.targets, OLD.dependencies)
       IS NOT DISTINCT FROM
       ROW(NEW.id, NEW.tenant_id, NEW.slug, NEW.number, NEW.name, NEW.description, NEW.model_version_id, NEW.dataset_version_id, NEW.formula, NEW.ast, NEW.unit, NEW.precision, NEW.dimensions, NEW.actor_id, NEW.creation_key, NEW.published_at, NEW.created_at, NEW.target_direction, NEW.targets, NEW.dependencies) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'PUBLISHED_VERSION_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS immutable_kpi ON kpi_versions;
CREATE TRIGGER immutable_kpi BEFORE UPDATE ON kpi_versions FOR EACH ROW EXECUTE FUNCTION protect_published_kpi();
