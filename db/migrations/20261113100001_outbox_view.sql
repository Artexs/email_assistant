-- migrate:up
-- A notice is stored as facts and rendered when it is sent (ADR 0032 point 5). `text` and `buttons` become the cache
-- of the sent message: null until the send.
ALTER TABLE outbox
  ADD COLUMN view jsonb NOT NULL DEFAULT '{}' CONSTRAINT outbox_view_check CHECK (jsonb_typeof(view) = 'object'),
  ADD COLUMN channel text NOT NULL DEFAULT 'telegram' CONSTRAINT outbox_channel_check CHECK (channel IN ('telegram')),
  ADD COLUMN locale text NOT NULL DEFAULT 'en' CONSTRAINT outbox_locale_check CHECK (locale IN ('pl', 'en')),
  ADD COLUMN detail text NOT NULL DEFAULT 'full' CONSTRAINT outbox_detail_check CHECK (detail IN ('full')),
  ALTER COLUMN text DROP NOT NULL;

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

-- migrate:down
-- Rows without text cannot go back to NOT NULL: a waiting one fails as outdated, every one gets the removed marker.
UPDATE outbox SET status = 'failed', error_code = 'outdated', locked_at = NULL
  WHERE text IS NULL AND status IN ('pending', 'sending');
UPDATE outbox SET text = '[removed]' WHERE text IS NULL;
ALTER TABLE outbox ALTER COLUMN text SET NOT NULL;
CREATE OR REPLACE FUNCTION delete_mailbox(p_org_id uuid, p_mailbox_id uuid) RETURNS void
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
ALTER TABLE outbox DROP COLUMN detail, DROP COLUMN locale, DROP COLUMN channel, DROP COLUMN view;
