-- Legacy rows remain explicitly unbound. Never infer or rewrite historical policy.
ALTER TABLE indexer_streams ADD COLUMN deployment_policy jsonb
 CHECK (deployment_policy IS NULL OR jsonb_typeof(deployment_policy)='object');
CREATE FUNCTION reject_indexer_binding_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.stream_id IS DISTINCT FROM OLD.stream_id
 OR NEW.binding_hash IS DISTINCT FROM OLD.binding_hash
 OR NEW.source IS DISTINCT FROM OLD.source
 OR NEW.deployment_policy IS DISTINCT FROM OLD.deployment_policy THEN
  RAISE EXCEPTION 'Indexer stream binding is immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER indexer_binding_immutable BEFORE UPDATE ON indexer_streams
 FOR EACH ROW EXECUTE FUNCTION reject_indexer_binding_change();
