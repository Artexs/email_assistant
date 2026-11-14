-- migrate:up
-- Labels from the Telegram /review page (a random sample) get their own source, so metrics can tell them from digest taps.
ALTER TABLE triage_feedback DROP CONSTRAINT triage_feedback_source_check;
ALTER TABLE triage_feedback ADD CONSTRAINT triage_feedback_source_check
  CHECK (source IN ('cli', 'telegram', 'undo', 'imap_move', 'web', 'review'));

-- migrate:down
DELETE FROM triage_feedback WHERE source = 'review';
ALTER TABLE triage_feedback DROP CONSTRAINT triage_feedback_source_check;
ALTER TABLE triage_feedback ADD CONSTRAINT triage_feedback_source_check
  CHECK (source IN ('cli', 'telegram', 'undo', 'imap_move', 'web'));
