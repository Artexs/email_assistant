-- migrate:up
-- F106 stage 01: delete an organization with all its data, and tombstones that stop the re-import of erased mail.

-- One privileged path for the delete (docs/architecture.md §7): `app` may not delete audit rows or users.
-- The definer bypasses RLS: it checks the scope itself, as `delete_mailbox` does. Same error as an unknown organization.
CREATE FUNCTION delete_organization(p_org_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  gone uuid[];
BEGIN
  IF public.app_current_org() IS NOT NULL AND p_org_id <> public.app_current_org() THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = 'P0002';
  END IF;
  -- Users whose only membership is this organization. A user with another membership stays, with its auth rows.
  SELECT coalesce(array_agg(m.user_id), '{}') INTO gone
    FROM public.memberships m
    WHERE m.org_id = p_org_id
      AND NOT EXISTS (
        SELECT 1 FROM public.memberships o WHERE o.user_id = m.user_id AND o.org_id <> p_org_id);
  DELETE FROM public.audit_log WHERE org_id = p_org_id;
  -- Reset and invite tokens and trusted devices: `value` holds the user id and is the only key.
  DELETE FROM public.auth_verifications WHERE value = ANY (SELECT g::text FROM unnest(gone) AS g);
  -- Sessions, accounts, lockouts and second factors go by cascade.
  DELETE FROM public.users WHERE id = ANY (gone);
  -- Every table with `org_id` goes by cascade, also `dsr_tombstones`.
  DELETE FROM public.organizations WHERE id = p_org_id;
END;
$$;
REVOKE ALL ON FUNCTION delete_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_organization(uuid) TO app;

-- A DSR erase writes one row per erased mail: the SHA-256 hex of the base dedup key (no `#<n>` suffix).
CREATE TABLE dsr_tombstones (
  org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, key_hash)
);
ALTER TABLE dsr_tombstones ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON dsr_tombstones FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

-- The base key also blocks a copy `#2` that a sync chunk planned before the erase.
CREATE FUNCTION emails_skip_tombstoned() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.dsr_tombstones t
    WHERE t.org_id = NEW.org_id
      AND t.key_hash = encode(sha256(convert_to(regexp_replace(NEW.dedup_key, '#[0-9]+$', ''), 'UTF8')), 'hex')
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER emails_skip_tombstoned BEFORE INSERT ON emails
  FOR EACH ROW EXECUTE FUNCTION emails_skip_tombstoned();

-- migrate:down
DROP TRIGGER emails_skip_tombstoned ON emails;
DROP FUNCTION emails_skip_tombstoned();
DROP TABLE dsr_tombstones;
DROP FUNCTION delete_organization(uuid);
