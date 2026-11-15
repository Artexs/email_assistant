# F032 stage 03 — Edge-case tests

Part of [`../plan.md`](../plan.md). Needs stage 02. Read D2–D5, D11 and § Edge cases. Lands on the worker's proof when it changes only tests.

## Step 1 — Integration tests of the skip cases and the numbering

**Goal.** Each skip rule and the copy numbering of the stored copy has a sync test.

**Files.** `apps/server/test/integration/mail-sync.test.ts` (describes "returned mail below the cursor" for INBOX, "sync folders" for `Oferty`). Tests 3.2, 3.5 and 3.6 use the Interia shape with `globalUids: true` (the `folderSetup` options), so that UIDs do not collide across folders by chance.

**Decisions.** A test that fails because the code deviates from D2–D5 or D11: fix the code in `mail/sync.ts` or `mail/sync-rules.ts` within those decisions and say so in the final message (the coordinator then runs the stage 02 review). A test that fails because a decision cannot hold: stop and report.

**Test.**

- 3.1 Move in flight: the moved row has `undo_pending_at` = the clock − 1 h → nothing stored, `copiesBelowCursor` 1, `copiesStored` 0; with − 25 h → stored as `#2`.
- 3.2 Held: a second row of the identity in `Oferty` with `uid` = the hit UID → nothing stored; that row unchanged; debug kind `held`.
- 3.3 Cross copy: the moved row's source is `Oferty`; in the same run INBOX gets an identical mail above its cursor (stored `#2` by the INBOX pass) → `offers`: `copiesBelowCursor` 1, `copiesStored` 0. A second run stores the `Oferty` copy as `#3` (the chunk path does the same for a cross copy in a later run).
- 3.4 Key conflict: a second row of the identity, not moved (`folder` = `source_folder` = `AI/Spam`, another UID), with its key set to `#3` by SQL. The count is 2, so the key `#3` conflicts: no error, `copiesStored` 0, two rows, debug kind `not_inserted`.
- 3.5 Rows `#1` and `#2` of one identity, both moved from INBOX to `AI/Info` (each row's `uid` = its own `AI/Info` UID), both originals still in INBOX → one sync stores `#3` and `#4`.
- 3.6 Across chunks: as 3.5, but 100 other moved rows sit between `#1` and `#2` by `moved_at` (as the existing 120-row test builds them), so the two hits fall in two chunks → `#3` and `#4`, no `#5`.
- 3.7 "a cursor moved during the check ends it …" with a copy instead of a return: nothing stored, the warning; the next run stores it.
- 3.8 Per-folder UIDs (the describe's `interia()` fake without `globalUids`): a second row of the identity in `AI/Spam` whose `uid` has the same number as the hit UID → nothing stored, kind `held` (accepted, plan D2 and Q5).
- 3.9 Uncertain: the moved row's `uid` points at a UID in `AI/Info` where no mail is, and an identical untracked mail sits in `AI/Info` at another UID; the copy sits in INBOX at the row's `inbox_uid` → nothing stored, `copiesBelowCursor` 1, kind `uncertain`, the row unchanged.

**Check.** `cd apps/server/test/integration && bun test mail-sync.test.ts`

**Done when.** 3.1–3.9 pass, and every stage 02 test still passes. Then the Proof of `plan.md` with `NN` = `03` ends `PROOF_OK`.

**Out of scope.** New rules; docs (stage 02 wrote them; a code fix that changes a documented rule is a question, not a fix).
