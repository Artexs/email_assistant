# F080 plan

- Gate: `backfillRefusal` in `apps/server/src/scripts/mailbox-backfill-gate.ts` uses `isOrgSuspended` from the `tenancy` index. `mailbox-backfill.ts` calls it right after `assertAppRole`, before the secret box and any IMAP call. A missing organization is not refused here (as `isOrgSuspended` answers false); the backfill fails on it as before.
- Other CLIs: `mailbox:rescan` only resets folder cursors (no IMAP call, no mail stored), so it gets no gate. `mailbox:settings` changes settings only; the operator may set them while a customer is paused. Both are named in `deploy/README.md`.
- Test: `apps/server/test/integration/mailbox-backfill-cli.test.ts` (needs the DB, so it is an integration test). It spawns the script for a committed suspended org and compares mailbox, folder and email rows before and after. It also tests the helper for `active`, `suspended` and unknown. With the gate disabled the spawn test fails.
