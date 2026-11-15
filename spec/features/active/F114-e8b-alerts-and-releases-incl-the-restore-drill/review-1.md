# F114 stage 01 review 1

Opus review (job `2026-11-15-f114-review-s01-opus-ops-alerts-86a48996`) of commit dbf00961: **PASS**, no blocking finding. Notes 1–9:

1. **Old release with the new table:** on a scratch tree, master code with one `ops_alerts` row: 95 pass, 1 fail. The fail is the `EXPORT_MAP` completeness test (the old map lacks the table); it runs in CI only, not at runtime. Runtime catalog walks (DSR erase, find, org delete, export routes) pass. A rollback image does not block.
2. **Migration:** timestamp after the newest on master; CHECKs, partial unique index and grants as planned; `db:rollback` then `db:migrate` twice exit 0. No `IF NOT EXISTS` (same as other migrations).
3. **No `org_id`:** only codes, timestamps, counts, numeric facts; `factsJson` refuses text, NaN, bad keys, over 20 keys; table in `NO_PERSONAL_TABLES`, `EXPORT_MAP` and the skip list.
4. **Concurrent open:** two real transactions: the second `openAlert` waits and returns the first id; after a silent resolve it inserts a new row. A crash between send and mark sends one more open notice.
5. **`nextAlertStep`:** each table row has one branch; the 6 h boundary is `>=`. `openSentAt` null with `resolvedAt` set returns `resolve`; the job never makes that state.
6. **`markAlertSent` has no state guard:** a second `resolved` mark overwrites `resolved_sent_at`. Stage 03 must follow `nextAlertStep` (carry-over in stage 03).
7. **Layers:** `packages/core/src/ops` imports nothing outside itself; `alerts-repo.ts` imports `@ea/core` types and `platform` only.
8. **`db:types`:** a fresh run differs only in the formatting of `Generated<T>`; `OpsAlerts` is the same.
9. **Test 6** runs `rollback to savepoint s1` twice in a row (cosmetic).

Test gaps TG1 (`last_sent_at` after an open mark) and TG2 (`resolveAlert` on a closed row) are closed by tests 3 and 3d in `apps/server/test/integration/ops-alerts-repo.test.ts`; mutations r3 and r2 each fail them.
