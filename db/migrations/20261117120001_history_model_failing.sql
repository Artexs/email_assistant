-- migrate:up
-- F110 stage 07: a history check that stops because every model call fails (a broken prompt or schema) ends `no_result` with the new
-- reason `model_failing`. The list only grows: the code of the previous release never writes the new value, so every row it writes passes.
-- contract: v0.1.0
ALTER TABLE history_checks DROP CONSTRAINT history_checks_no_result_reason_check;
ALTER TABLE history_checks ADD CONSTRAINT history_checks_no_result_reason_check CHECK (
  no_result_reason IN ('no_history', 'uidvalidity', 'cost_unknown', 'stopped', 'key_changed', 'auth_refused', 'model_failing'));

-- migrate:down
-- The old list refuses the value: the rows that carry it read `stopped` (the check ended without a result), then the list shrinks.
UPDATE history_checks SET no_result_reason = 'stopped' WHERE no_result_reason = 'model_failing';
ALTER TABLE history_checks DROP CONSTRAINT history_checks_no_result_reason_check;
ALTER TABLE history_checks ADD CONSTRAINT history_checks_no_result_reason_check CHECK (
  no_result_reason IN ('no_history', 'uidvalidity', 'cost_unknown', 'stopped', 'key_changed', 'auth_refused'));
