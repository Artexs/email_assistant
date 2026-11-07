-- migrate:up
ALTER TABLE emails ADD COLUMN undo_pending_at timestamptz;

-- migrate:down
ALTER TABLE emails DROP COLUMN undo_pending_at;
