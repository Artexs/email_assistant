-- migrate:up
-- Contract step of the move of the organization signature into the mailbox profiles.
-- contract: v0.4.4
-- v0.4.4 is the release that copied the old text into `mailbox_profiles.signature`, emptied the column and stopped every
-- read and write of it, and the release you roll back to. A rollback of the release that carries this migration is
-- `deploy/rollback.sh` alone, to v0.4.4: no SQL. A rollback to an older release is not possible after this migration; it
-- needs a restore from the backup that `deploy/release.sh` took before the migration. Never `db:rollback` on the VPS.
--
-- The migration runs while the previous release is live. With a lock timeout it fails fast instead of queueing every
-- `organizations` query behind a long transaction. On that failure run `deploy/rollback.sh`, then the release again.
SET LOCAL lock_timeout = '10s';

ALTER TABLE organizations DROP COLUMN style_text;

-- migrate:down
-- Dev database only. The column comes back empty: the text it held moved into the mailbox profiles and is not copied back.
ALTER TABLE organizations ADD COLUMN style_text text;
