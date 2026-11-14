-- migrate:up
-- Row-level security as a safety net under the tenant filter in code (ADR 0011, docs/architecture.md §5 Tenancy).
-- The policies apply to `app` only. `migrator` owns the tables and bypasses them (no FORCE), and so do the
-- SECURITY DEFINER functions it owns. An unset or empty `app.org_id` admits every row: jobs, CLIs, operator routes.

CREATE FUNCTION app_current_org() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION app_current_org() TO app;

ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON actions FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON audit_log FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE chat_link_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON chat_link_tokens FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE chat_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON chat_links FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE delegates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON delegates FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE delegations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON delegations FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE digests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON digests FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON emails FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE mailbox_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON mailbox_credentials FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE mailbox_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON mailbox_folders FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE mailbox_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON mailbox_settings FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE mailboxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON mailboxes FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON memberships FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE org_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON org_features FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON outbox FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE sender_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON sender_rules FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE triage_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON triage_feedback FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE triage_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON triage_results FOR ALL TO app
  USING (app_current_org() IS NULL OR org_id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR org_id = app_current_org());

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON organizations FOR ALL TO app
  USING (app_current_org() IS NULL OR id = app_current_org())
  WITH CHECK (app_current_org() IS NULL OR id = app_current_org());

-- The definer bypasses RLS: it checks the scope itself (spec/features/active/F092-rls-safety-net/plan.md D12). Same error as an unknown mailbox.
CREATE OR REPLACE FUNCTION delete_mailbox(p_org_id uuid, p_mailbox_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF public.app_current_org() IS NOT NULL AND p_org_id <> public.app_current_org() THEN
    RAISE EXCEPTION 'mailbox not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.mailboxes WHERE id = p_mailbox_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mailbox not found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM public.audit_log WHERE org_id = p_org_id AND data->>'mailbox_id' = p_mailbox_id::text;
  -- Digests mix mailboxes: a pending one is dropped (the next slot covers the period), a sent one loses its text and view.
  DELETE FROM public.outbox WHERE org_id = p_org_id AND kind = 'digest' AND status IN ('pending', 'sending');
  UPDATE public.outbox SET text = '[removed]', view = '{}'
    WHERE org_id = p_org_id AND kind = 'digest' AND status IN ('sent', 'failed');
  DELETE FROM public.mailboxes WHERE id = p_mailbox_id AND org_id = p_org_id;
END;
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION delete_mailbox(p_org_id uuid, p_mailbox_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.mailboxes WHERE id = p_mailbox_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mailbox not found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM public.audit_log WHERE org_id = p_org_id AND data->>'mailbox_id' = p_mailbox_id::text;
  -- Digests mix mailboxes: a pending one is dropped (the next slot covers the period), a sent one loses its text and view.
  DELETE FROM public.outbox WHERE org_id = p_org_id AND kind = 'digest' AND status IN ('pending', 'sending');
  UPDATE public.outbox SET text = '[removed]', view = '{}'
    WHERE org_id = p_org_id AND kind = 'digest' AND status IN ('sent', 'failed');
  DELETE FROM public.mailboxes WHERE id = p_mailbox_id AND org_id = p_org_id;
END;
$$;

DROP POLICY tenant_rows ON actions;
ALTER TABLE actions DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON audit_log;
ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON chat_link_tokens;
ALTER TABLE chat_link_tokens DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON chat_links;
ALTER TABLE chat_links DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON delegates;
ALTER TABLE delegates DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON delegations;
ALTER TABLE delegations DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON digests;
ALTER TABLE digests DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON emails;
ALTER TABLE emails DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON mailbox_credentials;
ALTER TABLE mailbox_credentials DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON mailbox_folders;
ALTER TABLE mailbox_folders DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON mailbox_settings;
ALTER TABLE mailbox_settings DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON mailboxes;
ALTER TABLE mailboxes DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON memberships;
ALTER TABLE memberships DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON org_features;
ALTER TABLE org_features DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON outbox;
ALTER TABLE outbox DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON sender_rules;
ALTER TABLE sender_rules DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON triage_feedback;
ALTER TABLE triage_feedback DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON triage_results;
ALTER TABLE triage_results DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_rows ON organizations;
ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;

DROP FUNCTION app_current_org();
