# F116 stage 09 review (Opus 5.5, FAIL cd01b847 on one mechanical finding)

Model: Opus 5.5, because the stage is [risky]: a migration on `actions`, the committer's table.

BLOCKING B1 (proven; repaired in a Sonnet continue, verified by my landcheck, no second review): `bun run db:check-migrations` (F114 stage 06, on master after the worker started) reports 4 `add_constraint` findings in `20261115170001_action_loop_anchor.sql` (lines 10, 12, 13, 21), so CI (`db:check-migrations` and the unit test "the migrations of this repository pass with the default cutoff") goes red. The constraints touch only the new `loop_id` column or are always true for current rows: add a `-- contract: v<x.y.z>` line with the reason ("the constraints are on a new column; old code never writes `loop_id`").

Everything else holds: additive; Down refuses while a loop row exists (no data loss); Up, Down, Up dumps equal; composite FKs; no reader of `actions` or `outbox` crashes on a loop row (a real committer tick with loop pairs leaves them untouched; notices queue no card for them; the outbox sender, expiry and retention run clean); the `coalesce` fix makes an open follow-up stop the erase (probe P5); no production path creates a loop row yet.

Carry-over for stage 10 (also in its stage file):
- `findChains` in the privacy code uses `not (email_id = any(goes))`, NULL for a loop row: check it.
- Mailbox removal or delete paths that look for sends in flight through `emails`.
- The `audit_log_action_id_org_id_fkey ON DELETE CASCADE`: deleting a loop deletes its actions and their audit rows (no code deletes loops today).
- The outbox sender sends any loop row of a card kind that has text; no database rule limits the kinds: stage 11 enforces it in code.
- Closed loop-anchored payloads: erase changes `actions.payload` and `outbox.text` to `[removed]`; keep a regression test.
- A test that commits a loop-anchored row in the shared test DB makes the stage 07 test fail on the Down guard: roll back every loop-row test.

Notes: the ALTERs take ACCESS EXCLUSIVE with a full scan (small tables on the VPS; NOT VALID then VALIDATE would shorten the lock); the `MESSAGE_TABLES` comment in `address-map.ts` ("go with the mail") is now partly true; `docs/architecture.md` outbox row still says "the four S4 kinds need `email_id`": it must say "`email_id` or `loop_id`" (fixed in the continue). Undo and digest read by mail id only (code reading, not probed).
