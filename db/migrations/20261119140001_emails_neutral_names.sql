-- migrate:up
-- Expand step of F062: two columns with neutral names for the two mail columns that carry INBOX-era names.
--   `emails.source_uid`      = `emails.inbox_uid`       (the last known UID in `source_folder`)
--   `emails.move_pending_at` = `emails.undo_pending_at` (a system move into a synced folder is in flight)
-- The old columns stay until a later release (contract). A trigger keeps each pair equal for every writer, so the code of
-- the previous release (old names only) and the code of this release (new names only) both stay correct, across a rollback
-- and a roll forward. A rollback of this release is `deploy/rollback.sh` alone: no SQL before or after. Never `db:rollback`
-- on the VPS.
--
-- The migration runs while the previous release is live. With a lock timeout it fails fast instead of queueing every
-- `emails` query behind a long transaction. On that failure run `deploy/rollback.sh`, then the release again.
SET LOCAL lock_timeout = '10s';

-- Both columns stay nullable with no default, as the old ones: old mail outside INBOX has no source UID.
ALTER TABLE emails
  ADD COLUMN source_uid bigint,
  ADD COLUMN move_pending_at timestamptz;

-- The copy runs before the trigger exists, so the trigger does not run on it.
UPDATE emails SET source_uid = inbox_uid, move_pending_at = undo_pending_at;

-- Rule, per pair. INSERT: the new name takes `COALESCE(new, old)`, then the old name takes that value. UPDATE: when the new
-- name changed, it is copied to the old one; else when the old name changed, it is copied to the new one. When both
-- changed, the new name wins. Null is a value: clearing one name clears the other.
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

-- migrate:down
-- The old columns still hold every value (the trigger kept them equal), so the down step only removes the new objects.
DROP TRIGGER emails_copy_renamed_columns ON emails;
DROP FUNCTION emails_copy_renamed_columns();
ALTER TABLE emails
  DROP COLUMN source_uid,
  DROP COLUMN move_pending_at;
