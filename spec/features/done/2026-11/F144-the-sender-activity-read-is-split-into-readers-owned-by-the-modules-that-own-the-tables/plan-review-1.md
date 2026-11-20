FAIL f04c127f26ed80039218943940d55943a7ef5967

HEAD matches the candidate. `git rev-parse HEAD` returned `f04c127f26ed80039218943940d55943a7ef5967`. The tree was clean apart from the `node_modules` that `bun install --frozen-lockfile` added (rc 0).

## Blocking

**B1. The equivalence test's statement counter conflicts with the D3 window interface. Proven by reproduction.**
- Stage 01 test 4 (`stages/stage-01-characterization.md:27`) counts statements with "the `withPlugin` counter of `contacts-refresh.test.ts` test 16". That counter increments in `transformQuery` (`apps/server/test/integration/contacts-refresh.test.ts:765-770`).
- In Kysely 0.29.8, `SelectQueryBuilder.toOperationNode()` calls `executor.transformQuery` (`node_modules/kysely/dist/query-builder/select-query-builder.js:310-311`). A builder made from the counted db therefore runs the plugin again each time it is embedded.
- D3 (`plan.md:61`, `stages/stage-02-mail-window.md:16`) defines `senderWindow(db, ctx, options)` as a select built from `db` and embedded as the CTE `win`.
- Scratch script `/tmp/f144-review/count.ts` (DummyDriver, no DB) shows the gap. Log `/tmp/f144-review/count-transformQuery.log`:
  - a raw CTE statement, as at HEAD, counts 1;
  - `counted.with("win", window(counted))` counts 2;
  - a Kysely window inside a raw template counts 2;
  - a CTE built through the `(qc) => …` callback counts 1.
- Effect: the stage 02, 03 and 04 readers raise the golden count while the database still runs the same statements. Plan rule `plan.md:101` says "Never edit the stage 01 characterization test … If it fails, your reader is wrong", so the worker is stuck or must break D3.
- Fix: decide one of two options.
  - Count executed statements: increment in `transformResult`. Log `/tmp/f144-review/count-transformResult.log` shows 1 for every shape.
  - Give `senderWindow` no `db`: build it from `expressionBuilder` or a query creator with no executor, and change the D3 signature.

**B2. One new reader has no second-organization test. Proven by reading.**
- Ticket acceptance (`ticket.md:29`): "Each new reader has an integration test with fixed values and a test that a second organization's rows never count."
- `ownAddressesOf` (`stages/stage-02-mail-window.md:34-35`) has only tests 8 and 9: another mailbox, and `maxAliases`.
- No test checks that org B's mailbox addresses or org B's Sent From aliases stay out of org A's set.
- Fix: add test 10 to stage 02. Org B has a mailbox `me2@example.com` and a Sent alias, and neither is in org A's set.

## Unverified checks

- No DB run. I did not run `scripts/limen-prepare.sh`, because it creates job DBs. N1 and N2 are proven by reading the SQL, not by a test run.
- `bun run lint`, `typecheck`, `test:unit:ci` and `test:int:ci` were not run. A plan-only diff gives them nothing to discriminate.

## Notes

**N1. The `org_id` guard checks in four stages cannot fail. Proven by reading, not blocking.**
- The checks are at `stage-01:31` (`emails.org_id`, test 5), `stage-02:28` (window `org_id`, test 4), `stage-03:27` (`s.org_id` in the their-delay read, test 6) and `stage-05:19` (`dn.org_id`, test 4).
- Each statement also filters on the mailbox: `activity.ts:225`, `:402` and `:436`. `mailboxes.id` is a uuid primary key (`db/migrations/20261103100001_mail.sql:3`), and `newOrg` makes a fresh mailbox for each organization.
- So org B's rows drop out with the `org_id` filter removed, and plan rule `plan.md:103` ("see it fail") cannot be followed. Stage 04 (`stage-04:30`) names this case; the other four stages do not.
- The tenant test that can fail calls each reader with org A's `ctx` and org B's `mailboxId`, and expects no rows. Write that form into the plan rule and into each tenant test.

**N2. The `hours > 0` guard in stage 03 cannot fail. Proven by reading.**
- The guard is at `stage-03:27`, with test 3 at `stage-03:22`.
- The user-delay lateral already requires `s.sent_at > w.received_at` (`activity.ts:360`), and the their-delay join requires `s.sent_at < n.received_at` (`:421`). So `hours` is always above 0.
- The "−1 h" reply drops out at the lateral, not at the `hours > 0` filter.
- Fix: name a guard that can fail, for example `s.sent_at > w.received_at`. Or state that `hours > 0` is redundant and has no guard check.

**N3. No test covers two Sent replies to one mail. Plausible.** Pre-mortem: a stage 03 Kysely rewrite drops `ORDER BY s.sent_at, s.id LIMIT 1` (`activity.ts:366-367`), or turns the `EXISTS` (`:380`) into a join. Then each extra reply becomes a delay sample, or the replied count doubles. The golden fixture has one reply per mail (`stage-01:14-15`). No existing contacts test has two replies to one parent (I grepped "first" and "second reply" in `contacts-*.test.ts`). Stage 03 tests 2-4 do not cover it either. Add one test: a mail with replies at +2 h and +5 h gives one sample of 2 h and `repliedBySent90` 1.

**N4. Two edge rules in stage 03 are left for the worker to guess. Plausible.**
- The replied and user-delay reads have no upper bound on `sent_at` (`activity.ts:361`, `:387`), but the readers take `SenderWindowOptions` with `until` (`stage-03:14-15`).
- `own_sent` in the their-delay read has no Auto-Submitted filter (`:402`).
- A worker who "aligns" these rules changes counts, and no test pins either one. State both rules in the stage 03 interfaces.

**N5. The stage 03 Sent-count reader has no scope helper.** Proven by reading. `sentCountsByRecipient` takes `only` (`stage-03:13`). Stage 02's "Writes for later stages" (`stage-02:6`) lists no mail-internal helper for the scope condition: `escapeLike` / `scopeCondition` (`activity.ts:86-95`). Stage 05 (`stage-05:25`) expects those helpers to be gone from contacts. Stage 02 should write the helper inside mail.

**N6. The scan test misses typed and raw `sql` forms.** Proven by reading. The patterns (`plan.md:70`, `stage-05:27`) look for `` sql` ``. At HEAD the file uses `` sql<{ address: string }>` `` (`activity.ts:137`, `:256` and others) and `sql.raw(` (`:101`), and the pattern matches neither. Fix: ban the `sql` import from `kysely` in the file, or match `\bsql\s*[<`.]`.

**N7. Address columns stay untyped. Plausible.** `normalizedAddress(column: string)` is `sql.raw` over a string (`contacts/address-sql.ts:16-17`), and F142 moves it unchanged. So a rename of `from_address_lower`, `to_addresses` or `delegates.email` still passes the typecheck, which contradicts the outcome claim (`ticket.md:9`). D5 (`plan.md:63`) leaves the choice open. Decide whether the readers wrap it with a typed ref.

**N8. Stage 01 has two conflicting rules. Plausible.** `stage-01:12` says to reuse the `contacts-fixtures.ts` helpers, and `stage-01:13` fixes `NOW = 2026-06-15`. But `ago`, `mails`, `mailsAt` and `spamMails` are fixed to `NOW = 2026-11-18` (`contacts-fixtures.ts:17-23`, `:59`, `:143-153`). Mails made with them fall after the June `NOW` and drop out of the window. Say to use `seedSenderActivity` with explicit dates, or use the fixture `NOW`.

**N9. The stage 01 guard on `since30` may not fail.** `stage-01:31` changes `since30` to 31 days, but the fixture fixes no mail between 30 and 31 days (`stage-01:14`). Pin one mail of `a` at 30 days + 1 h.

**N10. Three facts are wrong or have no source. Proven by reading.** None of them changes a decision.
- `plan.md:82` says "Ten statements plus four list reads". At HEAD there are 9 `sql` statements (`activity.ts:137, 256, 294, 303, 327, 347, 376, 398, 431`) and 3 list reads (`:136, 251, 253`).
- `stage-01:7` says "F142 stage 01 renames imports only". F142 stage 01 step 3 also changes the `matchSender` and no-reply folds (F142 `stage-01-one-name-one-sql-home.md:31`). The golden test stays valid only because its fixture is ASCII (F142 01-T2).
- `stage-01:12` says the helper cannot write `imap_move`, `in_reply_to`, `parent_message_id` or an automatic Sent mail. `seedSenderActivity` writes all four (`fixtures.ts:660, 670, 684, 686`). Only delegations are missing.

**N11. Ticket and board drift.** `ticket.md:41` says F143 "must leave `contacts/activity.ts` to this ticket". The F143 ticket is an empty stub that records no such rule. The coordinator should write the rule into F143.

**N12. Plan size.** `plan.md` is 1,501 words (`wc -w`); the limit is 1,500 (`.agents/limen/planner.md` § Plan size). Stage 03 (696 words) holds four readers, including the two hardest statements. If B1 and N2-N4 make it grow, split the delays from the counts.

**N13. Needs lines match F142 stage 01.** F142 stage 01 "Writes for later stages" lists `normalizeAddress` (`@ea/core`) and `normalizedAddress` (`platform/db`) (F142 `stage-01…:6`). F144 stage 02 (`:5`) and stage 05 (`:5`) need exactly these. Stages 03 and 04 reach them through stage 02. F142 stage 01 has not landed (`git log`), so the gate holds. The other checks found no problem:
- The new layer edge from contacts to triage makes no cycle: `rg "from \"\.\./contacts"` over triage, delegation, actions and mail finds nothing.
- Kysely 0.29.8 has `innerJoinLateral` and `CTEBuilder.materialized()` (`node_modules/kysely/dist/query-builder/cte-builder.d.ts:9`).
- The fixed values hold against HEAD SQL: stage 02 tests 1, 6 and 7; stage 03 tests 1, 2, 3 and 5; stage 04 tests 1 and 4; stage 05 tests 1 and 5.
- Stage 03 test 5 ("naming two own mails") must use another address, or `samples` becomes 3.

## Checks run

- `git rev-parse HEAD`: `f04c127f…` (match).
- `bun install --frozen-lockfile`: rc 0, 991 packages.
- `bun /tmp/f144-review/count.ts`, Kysely counter reproduction, two runs:
  - `transformQuery` counter: 1 / 2 / 1 / 1 / 2 (`/tmp/f144-review/count-transformQuery.log`).
  - `transformResult` counter: 1 / 1 / 1 / 1 / 1 (`/tmp/f144-review/count-transformResult.log`).
- Reads and greps: the code at HEAD, the fixtures, `layers.json`, the migrations, F142 stage 01, the F143 ticket and `planner.md`.
- `wc -w` on the plan files.

## Note check

- HEAD is the candidate: proven. `git rev-parse HEAD && bun /tmp/f144-review/count.ts > /tmp/f144-review/count-transformResult.log 2>&1 && …` printed `f04c127f26ed80039218943940d55943a7ef5967`.
- Each finding quotes file and line, checked against HEAD code: proven. Evidence: the cited reads, plus `/tmp/f144-review/count-transformQuery.log` and `/tmp/f144-review/count-transformResult.log` for B1.
- Needs lines checked against F142 stage 01: not proven by command. I read `spec/features/active/F142-loops-delegation-and-the-send-limit-compare-addresses-with-the-one-address-rule-and-a-scan-test-keeps-it-so/stages/stage-01-one-name-one-sql-home.md` lines 5-7 against F144 `stage-02:5` and `stage-05:5` (see N13). That was a read, with no saved log.
- First line is `PASS <sha>` or `FAIL <sha>`: proven. Evidence: this message opens with `FAIL f04c127f26ed80039218943940d55943a7ef5967`.
- Easy-to-miss rule (no code-detail findings): followed. Each finding names a decision, edge case, test or interface: B1 interface/test, B2 test, N1-N4 tests and edge rules, N5 interface, N6 test, N7 decision, N8 conflicting rules. None asks for line numbers or edit text.
- Reminder (merge master and run checks before the final message, for jobs that commit product code): not applicable. This is a review job and committed nothing.
