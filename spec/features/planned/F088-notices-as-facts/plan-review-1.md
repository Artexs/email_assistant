FAIL 116299d295e8ce5279468c39b6f4eaa7ff0fe4a9

Verdict: FAIL. 2 major findings, 10 minor findings. HEAD is 116299d295e8ce5279468c39b6f4eaa7ff0fe4a9, which matches the candidate. The tree is clean: `git status --short` printed nothing. I did not edit any repository file. The same review is saved as `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-13-f088-plan-review-98a1788c/review.md`.

## Major findings

**M1. Rollback: the sender learns to read null-text rows only in the same stage that starts to write them. On rollback, pending notices are lost, approval requests included. Proven by reading the code.**
- How it breaks:
  - Stage 02 adds a sender guard: `if (row.text === null) { await fail(row, "bad_view"); … }` (`stages/stage-02-migration-and-repo.md:275`).
  - Stage 04 first creates rows whose text is null (`stage-04:118–137`).
  - The house rule is "Roll back the code, not the migration" (`deploy/README.md:228`, `:287`, `:307`, `:394`). It applies after checkpoint C1 (`plan.md:162`).
  - Under that rule, a rollback to stage 03 or stage 02 code makes every pending stage-04 row `failed` / `bad_view`. These rows include `approval` and `approval_set`: the owner never gets the request, and the send waits until it expires.
  - A rollback to code from before stage 02 sends `text: null` (`sender.ts:138` today), and Telegram refuses it with 400 / `bad_request`.
- The deploy note is wrong for the most likely rollback target. It says only that rows "fail with `bad_request`" (`plan.md:163`); with stage 02/03 code they fail as `bad_view`, and nothing is sent.
- The note does not give the order of the code rollback and the down migration. It also recommends `db:rollback`, against the house rule.
- No stage adds the Update / Rollback paragraph to `deploy/README.md`, which every earlier migration has. Stage 06 (`stage-06:173`) touches only `architecture.md`, `modules.md` and ADR 0032.
- Proper design (the sender learns to read before producers write):
  - In stage 03, the sender renders a null-text row with `renderNotice` (the registry exists from stage 01), in place of the stage 02 `fail` guard. No producer writes null text yet, so behaviour does not change.
  - Stage 04 then changes only the producers and `markOutboxSent`. A code rollback to stage 03 is safe.
  - Add a `deploy/README.md` paragraph: deploy the migration first, roll back the code only.
- Stage that lets it through: 02 (the guard), then 04 (deploy).

**M2. Stage size: stage 01 is far above the limit of about 300 changed lines, and the plan's own rule says so. Plausible: these are estimates, not measured.**
- `plan.md:80` (D9) splits the "sender renders" work because "about 450 changed lines" is too big for one job.
- Stage 01 is still one job (`stage-01:5–179`). It adds:
  - 6 new core files: `kinds.ts`; `views.ts` with 11 strict schemas, a 6-variant discriminated union and 2 type guards; `encode.ts`; `renderers.ts` with 11 entries; `render.ts`; `index.ts`.
  - 2 test files. One holds an 11-case byte-identical fixture table, where each case needs today's input and the matching view.
  - My estimate is 600–700 lines.
- Split it in two:
  - 01a: kinds, views, encode, `WouldDoAction`, and the encode tests.
  - 01b: renderers, `renderNotice`, `renderNoticeEdit`, and the registry tests.
- Other stages, from my estimates: 02 is about 400 lines, 03 about 420, 04 about 370. Stage 05 moves all 745 lines of `notices.ts` into 10 files, which is a diff of about 1,500 lines. It is mechanical, but the plan gives it no size note and no rename-only review hint.

## Minor findings

1. **False fact about the safety net (stage 03). Proven by reading the code.**
   - `stage-03:80` says a `NoticeViewError` "rolls back the mark and the producer's `catch` warns once (`warnSkipped`)". D15 (`plan.md:86`) depends on the same claim.
   - Only `detectApprovals`, `detectApprovalSets`, `detectSendResults` and `detectDelegationAnswered` have a `try/catch` (`notices.ts:401–413`, `:453–473`, `:602–637`, `:650–676`).
   - `detectUrgent`, `detectActionFailed` (which calls `markNotified` with no catch, `notices.ts:220–252`), `detectAuthError` and `detectSync` have none.
   - In those four, a throw leaves `detectForOrg` (`notices.ts:679–697`). It stops the approval, send-result and delegation detectors of that organization on every tick. For `action_failed` this lasts until its 24 h lookback ends.
   - The strict schemas add a new way to throw. I found no realistic trigger: the views come from typed rows. The plan should state the real behaviour, or require a per-event catch in these four.
2. **Stage 02 "old cases pass unchanged" cannot hold. Proven by reading the tests.**
   - `channels-linking.test.ts:201` and `:270–271` call `toEqual` / `toContainEqual` with exact `LinkedChat` objects. A new `locale` field makes them fail at runtime, and typecheck does not show it.
   - The stage 02 list of `LinkedChat` object literals (`stage-02:264`) is also wrong:
     - the real lines are `channels-callbacks.test.ts:64,354,764` and `channels-commands.test.ts:~92`;
     - `actions-end-to-end.test.ts:99` is missing.
3. **`apps/server/test/integration/mailbox-rows.ts:61,70` calls `insertOutbox` with `message`. Proven by reading the file.** Stage 03 (`stage-03:40`) and stage 04 (`stage-04:122`) do not list it. Rule `plan.md:138` says "change a test only where the stage file says so", so the worker must guess.
4. **The migration body check in stage 02 sends the worker down the wrong branch. Proven by reading the files.**
   - `stage-02:243` says the only change from the old body is `, view = '{}'` and a line break.
   - The old body has a comment inside the function (`20261111000001_delete_mailbox.sql:16`). The new SQL puts the comment outside and rewords it (`stage-02:205`).
   - A literal line-by-line compare therefore takes the "differs, copy the newest body" branch.
5. **Tap edit window after stage 04. Plausible.**
   - After stage 04, `outbox.text` is written only by `markOutboxSent`.
   - If a database error follows a successful send (`sender.ts:202–206`), the row stays `sending` with `text` null until the stale claim sends it again, after up to 5 minutes.
   - A tap in that window gives no edit (`stage-04:216`). The card keeps its buttons. Today the text exists from queue time.
6. **The new standard conflicts with existing code. Proven by grep.**
   - `stage-06:152` (§ Avoid) says "Channel text … built outside a renderer in `packages/core/src/notices/`". `stage-06:131` says the same in code-patterns.
   - Many existing channel texts are built outside that folder:
     - the command replies and link texts (`channels/texts.ts`);
     - the tap answers in `callbacks.ts`;
     - the operator notices (`telegram/runtime.ts:69`);
     - `accountPausedText`.
   - Limit the rule to outbox notices.
7. **Ticket drift. Report only; I did not fix it.**
   - `ticket.md:9` says "one detector file and one renderer file". The design (D10) puts renderers in one `renderers.ts`, and a new kind also needs `kinds.ts`, `views.ts` and a migration (`stage-06:143–147`).
   - `ticket.md:17` says "with the status in the view". D17 puts the status in the edit input and keeps the stored bytes. `questions.md` item 6 covers it.
   - `ticket.md:29` says the tests pass "unchanged except for the queue shape". `stage-04:145` changes two `channels-sender` assertions (`toStartWith(SECRET)` and `"OK"`).
8. **`OrgRun` differs between plan and stage. Proven by reading both.** D21 (`plan.md:92`) has no `db` field; `stage-05:30–41` has `db: DbOrTrx`. Trivial, but a worker must pick one.
9. **New comments name `spec/features/active/…` paths (`stage-02:274`, `:275`). Plausible.** These paths go stale when F082 and F088 move to `done/`.
10. **Mailbox delete keeps text from another mailbox. Plausible, not checked.**
    - `delete_mailbox` clears only `digest` rows (`stage-02:214–216`).
    - An `approval_set` row is tied to the email of its first item (`notices.ts:461`) but prints the subjects of every item.
    - If a reminder set can span mailboxes, those subjects outlive the delete: in `text` today, and now also in `view`.
    - This existed before F088; the plan copies it into `view`. I did not check whether `listSetsToNotify` can mix mailboxes.

## Pre-mortem coverage
- **Old rows at deploy:** covered. Rows with text and an empty view are sent as they are (D18; stage 04 test 3). Retention clears them through `IS DISTINCT FROM`.
- **Crash between send and mark:** covered. The stale claim renders again, and the render is deterministic: I found no `Date.now` or random in the render path. A duplicate is possible, as today (stage 04 test 4). The tap-edit window is minor 5.
- **Quiet hours:** covered. The clock uses the queue-time `now` (D12). The sender renders before the quiet-hours release (stage 04 test 6).
- **Suspend and resume:** no gap found. Claim, cancel and resume hooks are unchanged; approval rows wait and are rendered at resume.
- **Retention:** covered (stage 02 step 3, tests 1–5).
- **Mailbox delete:** digest rows covered. FK cascades cover the other kinds (`20261106000001_telegram.sql:68–71`), except minor 10.
- **Rollback:** M1.
- **Mail text in logs:** no gap found. `describeError` never logs the message (`platform/errors.ts:18–25`), and the new log lines hold ids, kinds and codes only.

## Facts I confirmed against the code (no finding)
- `notices.ts` has 745 lines; `queue()` is at line 108.
- The import lines `commands.ts:35`, `runtime.ts:9` and `web.ts:10` are as the plan states.
- `aiTextFor` reads `modelCategory` and `confidence` only for `unsure` (`ai-text.ts:20`).
- `describeActions` reads only `type`, `status`, `folder`, `reverse`, `kind` and `delegateId`.
- `cutText` replaces control characters and lone surrogates.
- `ApprovalView` is at `sender.ts:18`. `QUOTE_PREVIEW_CHARS` is 1500. `quoteCut` returns only `{ text, cut }`.
- P4: `callback.ts:75` throws `bad email id`.
- The `insertOutbox` call counts per test file match the plan.
- The callback assertion is at `channels-callbacks.test.ts:587`.
- `delegations.due_at` is `timestamptz`, so the `isoDate` schema works for `approval_set`.
- The `docs/architecture.md` lines that stage 06 cites (356, 467, 591, 669) match.
- No test imports internal constants of `notices.ts`, so the stage 05 split needs no test change.
- `graph:modules` does not exist at this commit. F086 adds it, and the plan gates the build on F086.

## Checks run
- I only read code and ran `grep` / `sed` / `git` at 116299d.
- No test, lint or typecheck ran. This is a plan review, so there was no candidate code to run.
- `git status --short && git rev-parse HEAD && test -z "$(git status --short)" && echo CLEAN` printed the candidate sha and `CLEAN`.

## Note check
- **Each finding quotes file and line:** proven. Every finding in `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-13-f088-plan-review-98a1788c/review.md` cites a path and line.
- **Facts checked against code at 116299d:** proven. `grep -n "Roll back the code, not the migration" deploy/README.md && grep -n "if (!sent)" apps/server/src/modules/channels/sender.ts && grep -n "toEqual({ orgId, userId, role" apps/server/test/integration/channels-linking.test.ts && grep -n "insertOutbox(trx, ctx" apps/server/test/integration/mailbox-rows.ts && grep -n "Digests mix mailboxes" db/migrations/20261111000001_delete_mailbox.sql && grep -n "export function describeError" apps/server/src/platform/errors.ts` exited 0. The other facts come from reads in this session.
- **Pre-mortem covers the listed gaps and stage size:** proven. See § "Pre-mortem coverage" and M2 in `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-13-f088-plan-review-98a1788c/review.md`.
- **First line is PASS/FAIL with the sha, with major/minor counts:** proven. See the first two lines of `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-13-f088-plan-review-98a1788c/review.md`.
- **Easy-to-miss rule "Read-only: do not edit files":** followed. `git status --short && git rev-parse HEAD && test -z "$(git status --short)" && echo CLEAN` exited 0 and printed `CLEAN`. I wrote only `note.md` and `review.md` in the job folder, which is outside the worktree.
