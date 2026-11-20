-- migrate:up
-- Contract step of the rename `emails_neutral_names` and of the move of the INBOX cursor into `mailbox_folders`.
-- contract: v0.4.3
-- v0.4.3 is the release that stopped every read and write of these columns, and the release you roll back to.
-- A rollback of the release that carries this migration is `deploy/rollback.sh` alone, to v0.4.3: no SQL. A rollback to an
-- older release is not possible after this migration; it needs a restore from the backup that `deploy/release.sh` took
-- before the migration (`deploy/README.md` § Synced folders). Never `db:rollback` on the VPS.
--
-- The migration runs while the previous release is live. With a lock timeout it fails fast instead of queueing every
-- `emails` query behind a long transaction. On that failure run `deploy/rollback.sh`, then the release again.
SET LOCAL lock_timeout = '10s';

-- A mailbox that has no INBOX folder row gets one from its old cursor. Either unique key (`mailbox_id, key` or
-- `mailbox_id, path`) means the INBOX row exists, so no conflict target: that row keeps its own cursor.
INSERT INTO mailbox_folders (org_id, mailbox_id, key, path, role, enabled, uidvalidity, last_uid)
SELECT org_id, id, 'inbox', 'INBOX', 'inbox', true, uidvalidity, last_uid FROM mailboxes
ON CONFLICT DO NOTHING;

DROP TRIGGER emails_copy_renamed_columns ON emails;
DROP FUNCTION emails_copy_renamed_columns();

ALTER TABLE emails
  DROP COLUMN inbox_uid,
  DROP COLUMN undo_pending_at;

ALTER TABLE mailboxes
  DROP COLUMN uidvalidity,
  DROP COLUMN last_uid;

-- migrate:down
-- Dev database only. Back to the state of the expand release: the four old columns (nullable) hold the current values and
-- the trigger keeps each old and new pair equal.
ALTER TABLE mailboxes
  ADD COLUMN uidvalidity bigint,
  ADD COLUMN last_uid bigint;

UPDATE mailboxes m
SET uidvalidity = f.uidvalidity, last_uid = f.last_uid
FROM mailbox_folders f
WHERE f.mailbox_id = m.id AND f.key = 'inbox';

ALTER TABLE emails
  ADD COLUMN inbox_uid bigint,
  ADD COLUMN undo_pending_at timestamptz;

UPDATE emails SET inbox_uid = source_uid, undo_pending_at = move_pending_at;

CREATE FUNCTION emails_copy_renamed_columns() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.source_uid := COALESCE(NEW.source_uid, NEW.inbox_uid);
    NEW.inbox_uid := NEW.source_uid;
    NEW.move_pending_at := COALESCE(NEW.move_pending_at, NEW.undo_pending_at);
    NEW.undo_pending_at := NEW.move_pending_at;
  ELSE
    IF NEW.source_uid IS DISTINCT FROM OLD.source_uid THEN
      NEW.inbox_uid := NEW.source_uid;
    ELSIF NEW.inbox_uid IS DISTINCT FROM OLD.inbox_uid THEN
      NEW.source_uid := NEW.inbox_uid;
    END IF;
    IF NEW.move_pending_at IS DISTINCT FROM OLD.move_pending_at THEN
      NEW.undo_pending_at := NEW.move_pending_at;
    ELSIF NEW.undo_pending_at IS DISTINCT FROM OLD.undo_pending_at THEN
      NEW.move_pending_at := NEW.undo_pending_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER emails_copy_renamed_columns
  BEFORE INSERT OR UPDATE ON emails
  FOR EACH ROW EXECUTE FUNCTION emails_copy_renamed_columns();
