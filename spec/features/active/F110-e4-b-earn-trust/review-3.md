# F110 stage 03 review (Opus 5.5, PASS 51474cb7)

Model: Opus 5.5, because the stage is [risky] (migration, tenant isolation, data delete and export). No BLOCKING. Proven by the reviewer: RLS with committed rows on a second app connection (org B sees nothing of A, inserts for A refused 42501, moving a row to another org refused, `delete_mailbox` cleans checks, items and trips and keeps the membership with `report_mailbox_id` null); real dbmate up/down/up; outbox kind and channel lists only widen; `-- contract: v0.1.0` is needed and works; repository org filters, status guards and `ON CONFLICT` targets right; no LLM call; owner decisions accepted: counts in `history_checks.result` stay after a DSR erase of one mail (counts only); `SET NULL (report_mailbox_id)` is what the stage prescribes.

Fixed in a Sonnet continue (no re-review): TG (`historyResultFor` orders `finished_at desc`: Postgres puts NULLs first, so a `done` check with `finished_at` NULL shadows a newer finished one: use NULLS LAST, plus a test and a mutation); the stale migration header comment (it says no release has shipped; v0.1.0 runs on the VPS).

Carry-over:
- Stage 07: no `done`/`no_result` check may keep `finished_at` NULL (write both together, or add the CHECK `(status in ('done','no_result')) = (finished_at is not null)` if a later migration is open).
- Stage 26 (rollback step 0): fail rows of the new kinds and of channel `mail` with the pattern `status in ('pending','sending')` and `locked_at = null` (as deploy/README.md:169), not `pending` only: the old `claimDueOutbox` claims the whole batch, then throws in `noticeKindSchema.parse`, and the same bad row blocks the sender for all orgs. Name this stuck batch in the stage text.
- Stages 10 and 19: `telegram-schema.test.ts` holds pending lists (`autonomy_paused`, `trust_report_ready`, `mail`); delete those lines when the kinds get their renderers and detectors (the test fails until then).
