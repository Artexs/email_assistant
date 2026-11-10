-- migrate:up
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered', 'mailbox_removed'));

-- One privileged path for the delete (docs/architecture.md §7): `app` may not delete audit rows.
CREATE FUNCTION delete_mailbox(p_org_id uuid, p_mailbox_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.mailboxes WHERE id = p_mailbox_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mailbox not found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM public.audit_log WHERE org_id = p_org_id AND data->>'mailbox_id' = p_mailbox_id::text;
  -- Digests mix mailboxes: a pending one is dropped (the next slot covers the period), a sent one loses its text.
  DELETE FROM public.outbox WHERE org_id = p_org_id AND kind = 'digest' AND status IN ('pending', 'sending');
  UPDATE public.outbox SET text = '[removed]' WHERE org_id = p_org_id AND kind = 'digest' AND status IN ('sent', 'failed');
  DELETE FROM public.mailboxes WHERE id = p_mailbox_id AND org_id = p_org_id;
END;
$$;
REVOKE ALL ON FUNCTION delete_mailbox(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_mailbox(uuid, uuid) TO app;

-- migrate:down
DROP FUNCTION delete_mailbox(uuid, uuid);
DELETE FROM outbox WHERE kind = 'mailbox_removed';
ALTER TABLE outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_kind_check CHECK (kind IN (
  'digest', 'urgent', 'auth_error', 'sync_stale', 'sync_ok', 'action_failed',
  'approval', 'approval_set', 'send_result', 'delegation_answered'));
