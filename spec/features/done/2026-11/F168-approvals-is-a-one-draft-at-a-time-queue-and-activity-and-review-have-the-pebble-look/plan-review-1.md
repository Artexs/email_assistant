# F168 plan review 1

Job `2026-11-23-f168-plan-review-3286eb47`, Opus 5.5 at high thinking, on the plan at commit 45426ec9b. Its final message, whole:

FAIL 45426ec9bfd91c4ff4048d1531df273defa91757

HEAD matches the candidate (`git rev-parse HEAD` = 45426ec9…, clean tree). The plan folder is `spec/features/planned/F168-…-pebble-look/`. Below, `stage-NN` means `stages/stage-NN-*.md` in that folder.

## Blocking findings

**B1. Stage 07 cannot meet its own Done-when. Its emoji rule conflicts with an existing test that ties Activity texts to the Telegram texts. Proven by test.**
- `stage-07:14` strips the emoji from `act_tag_*`, `act_toast_right`, `act_toast_picked` and `undo_started`.
- `stage-07:16` says "(2) The existing feedback-toast tests pass with the new values."
- `stage-07:36` puts "The Telegram texts in `packages/core`" out of scope.
- `apps/web/src/lib/activity-text.test.ts` has a block "words tied to the Telegram source (U6)". It asserts that `feedbackToast`, `undoToast` and `categoryTagText` equal the core Telegram answers (`rightAnswer`, `pickedText`, `texts.answers.undo`, `categoryTag`). Those core texts keep their emoji (`packages/core/src/texts/answers.ts:15,21`, `digest/labels.ts:15`).
- Proof: I removed the emoji from three `en-activity.ts` values and ran `bun test apps/web/src/lib/activity-text.test.ts`. Three tests failed: "en: undo toasts equal the core undo texts", "en: category names and tags equal the core texts", "en: right and pick toasts equal the Telegram answers". I then reverted the file.
- Missing decision: either drop the web-to-Telegram tie (a rule exception: add it to `questions.md`), or change the core texts too (scope). D7 (`plan.md:81`) also misses the tie.

**B2. P7 breaks a spec that F169 owns, and D5 promises that spec passes unchanged. Proven by reading.**
- P7 (`plan.md:64`) and `stage-04:26` say: when a list reload lacks the focused draft, read its detail, show the closed text and move on. Neither has an exception for an open edit dialog.
- Today's island skips this jump while the dialog is open (`ApprovalsPage.tsx:115-125`).
- `open-loops.spec.ts` S11 ("drop" case, lines 541-570) does this: open Edit, drop the loop (the send expires and leaves the list), fire `visibilitychange`. It then expects the dialog to stay with the typed text, and the closed text on the status line after Save.
- Under P7 as written, the page moves on under the dialog. That breaks D5 (`plan.md:79`) and the Done-when at `stage-04:49`.
- The same gap reaches `approvals.spec.ts` S13-N1 and S13-TG2. It also covers D9 expiry (`plan.md:83`) and an open reason picker or Sheet.
- Missing rule: while the edit dialog (and the reason picker) is open, P7 and D9 wait. The dialog's own 409 path decides.

**B3. `vanished()` treats a held focus as gone, but P1 and P6 let the user open a held send. Proven by reading.**
- P1 (`plan.md:58`) and P6 (`plan.md:63`) open a held send with only "No". `stage-04:10` lists a `focus` mode for "waiting or held".
- `stage-03:15` defines `vanished` as "the focus is no longer a `waiting` item". Test 6 (`stage-03:25`) fixes "with `b` present as held → `true`".
- So the first 30 s poll after a held pick or a held `?id=` link shows a closed text for a send that is not closed, and moves on.
- Fix: `vanished` means the focus is absent from the list, or its state changed from the state it was opened in. Add a test for a held focus that stays held.

**B4. Stage 05 user docs conflict with the flagged-text rule for user docs pages. Proven by reading.**
- `approvals_page` is default off (`packages/core/src/features.ts:16-17`).
- `docs/code-patterns.md:345` and `apps/docs/src/flagged-text.ts:1-3,16` say a docs page must not hold a default-off flag's user-visible strings, also through `<UiText>`. They also say "A stage that meets a new flagged string adds it here."
- `stage-05:11-12` adds an "Approve in the panel" section with `<UiText k="…">` button keys.
- If the worker follows the rule and lists the new keys, `docs:test` fails. That is the stage 05 Proof (`stage-05:33`). If the worker skips the rule, the page breaks it.
- Missing decision: drop step 1 until the flag is removed, or record a rule exception in `questions.md`.

## Unverified checks

- No e2e, `check:job`, lint or typecheck ran: this is a review job (project rule). The F166 tools the Proof needs (`web:build:dev`, `ui:sheet`, `patterns.spec.ts`) do not exist at HEAD yet. They are F166 deliverables.

## Pre-mortem: which stage let each bug through

- **A second mail from a double tap.** Not reachable as planned. The server locks the row and answers `already_approved`, or 409 `closed sending` (`actions/approvals.ts:186-191`, `approval-routes.ts:118`). `singleFlight` plus ARM in stage 04 cover taps on the next card. Note on fact D3 (`plan.md:77`): "A second approve answers 200" is incomplete. With a fresh lock (<10 min) it answers 409 `closed`/`sending`. The table row at `stage-04:20` then replaces "Sent to" with a closed text and starts a second hold. That is harmless but untested.
- **Wrong draft approved: stage 04. Plausible.**
  - (a) `stage-04:28` says a redraft moves "the focus to the new id". The redraft answer arrives up to 60 s later (`waitForReply`). If the user tapped "Later" or picked another draft meanwhile, the focus jumps back. No rule says whether "Later" and list picks are off while `reply.waiting` is on.
  - (b) `stage-04:24` gives no definition of "a new card" for `armed()`. In-place version swaps (409 `changed`, P7 superseded, edit, redraft) must count, so that a version the user never saw cannot be approved within 500 ms. Name it and test it.
- **Decided draft shown as open: stage 03. Plausible.** `nextFocus` (`stage-03:13`) excludes only `leaving` and `skipped`, not `ownIds`. When a list reload fails or lags, the queue can land on a draft this page already decided. P5's end card then never shows. D2 forbids the island from adding the filter. Give `nextFocus` the `ownIds` set and add a test. Stage 04 also has no mode for a queue focus whose fresh detail is closed (only `?id=` gets `closed`).
- **Button hidden under the tab bar: stage 04. Plausible.** `StickyActions` adds its own spacer (F166 `stage-10:14`), so the three buttons are safe. But the plan never says where the outcome line, the reason picker (P4), "Next draft" (P3) and "Show them again" (P5) sit on a phone. After "No" on a long draft, the picker can sit off-screen while every bar button is off. Q7 (`stage-04:37`) checks only the three buttons.
- **Broken spec of another ticket: stage 04 (B2).**
  - Stage 07 says demo step 8 must pass unchanged (`stage-07:32`), but its Proof does not run `demo:record`, and CI does not run it either (`.github/workflows/ci.yml` has no demo job).
  - Plan fact `plan.md:90` misses `loops-panel.spec.ts:62` (an href check only, low risk).

## Notes

1. **Two rules conflict, stage 04 (plausible).** `stage-04:24` says "During a request and the hold every button is off". The reject row (`stage-04:22`) needs the reason picker and "Skip" on during the hold, and row 3 needs "Next draft" on. Also, D6 (`plan.md:80`) moves the focus to the next title after the hold. Existing `approvals.spec.ts` S13-T6 ("Reject and Skip put the focus on the result line") and T7 expect status focus. Say which earlier tests change.
2. **Outcome table gaps, `stage-04:16-22`.** "approve 200 with detail `rejected`, `expired`, `waiting` or `superseded`" has no row. `approveMessage` returns `appr_closed_*` or `appr_done_unknown` there (`approvals-view.ts:147-153`).
3. **Missing tests, stage 04.**
   - Ticket acceptance 3 (`ticket.md:29`) names sent, rejected, expired, failed and superseded. Q4 covers only rejected and superseded.
   - No test covers D9 expiry, approve → failed/unknown → "Next draft", 409 `closed`/404 after approve, the P5 end card and "Show them again", a held pick showing only "No", or an unknown `?id=`.
   - The outcome table is pure mapping logic. It could sit in `lib/approvals-queue.ts` or `approvals-view.ts` with unit tests rather than e2e only.
4. **Interface ambiguity, stage 03.** `progress({ done, waiting })` (`stage-03:14`) does not say whether `waiting` counts skipped drafts. After "Later" the label is either "1 of 5" or "1 of 4". Q3 does not check it. It also does not say whether a draft that vanished (decided on another device) counts as `done`.
5. **Interface mismatch, stage 01.** `stage-01:14` says "`FactBox` titled 'About this draft'". F166 `interfaces.md:82` defines `FactBox({ icon?, children })` with no title prop. Name the heading level and its markup.
6. **Stages that run together and edit one file.**
   - 02 and 07 both edit `*-reply-panel.ts` (`stage-02:20`, `stage-07:9`). This breaks programme rule 1 (`docs/product/pebble-ui/README.md:95`).
   - 07 and 08 may both delete `categoryTagText` and `act_tag_*` (D7; `stage-08:27` edits stage 07's files).
   - D7 also misses a reader: `ActivityFilterBar.tsx:60` reads `act_tag_${category}` by template (a stage 06 file).
   - 01 changes `AddressList.tsx`, and `ReplyControls.tsx` (stage 02) imports it. The edit dialog keys `appr_edit_*` live in `en-approvals.ts`, which stage 01 edits (plausible).
   - Stages 04, 06, 07 and 08 (and F167, F169, F170) all edit rule 9 of `docs/capabilities/web-panel.md:59`. It is one line of 16,599 characters, so every land conflicts. A frame stage could split it per page.
7. **Fact without a source, stage 06.** The lead (`stage-06:11`) says each change "shows its reason". `act_no_reason` ("No reason given.") exists for rows without `aiText`. PB-8 (`README.md:35`) needs a promise that is true today.
8. **Missing source, stage 04.** Q7 needs "a long draft" (`stage-04:37`). The seed drafts are short. Say whether it comes from a seed send or a route mock.
9. **Size, stage 04.** 698 of 700 words, and it holds an island rewrite, 5 modes, a 7-row outcome table, 3 events, the Sheet, a seed change and 8 e2e tests on two projects. Rule 7 (`README.md:101`) forbids splitting the decision flow. P6 (closed card) and P9 (phone Sheet) could still be a stage before or after it (plausible).
10. **Owner question Q1 (`questions.md:5`).** It omits a cost of the one-tap correction. A review label after a grant feeds the tripwire (`docs/capabilities/trust.md:25`), so one mis-tap can pause automatic moves for a category, and the card then locks. Name that in Q1.
11. **Doc drift, stage 08.** It renames the page to "Was I right?" but updates only `web-panel.md`. `docs/capabilities/trust.md:7,25,37` and `triage.md:45` still say "Check 10 decisions".

## Checks I ran

- `git rev-parse HEAD`: 45426ec9bfd91c4ff4048d1531df273defa91757 (matches). `git status --short`: empty, before and after.
- `bun install --frozen-lockfile`: 991 packages installed.
- `bun test apps/web/src/lib/activity-text.test.ts` before the edit: 14 pass, 0 fail.
- The same test after removing the emoji from three `en-activity.ts` values: 3 fail (the en U6 tests). Reverted with `git checkout`. This ran in one bash call joined with `;`, so for Limen it is a session observation, not a proof command.
- `wc -w`: plan 1466 words; stages 699, 562, 456, 698, 397, 630, 644, 637 (all within § Plan size).
- Read: `approval-routes.ts`, `actions/approvals.ts`, `approvals-view.ts`, `ApprovalsPage.tsx`, `poll.ts`, `args-approvals.ts`, `open-loops.spec.ts`, `approvals.spec.ts`, `delegations.spec.ts`, `record.spec.ts`, `flagged-text.ts`, `features.ts`, `i18n.test.ts`, F166 `interfaces.md` and `stage-10`, and the programme page.
- Confirmed facts: list order and cap, the poll rerun on visible, the seed counts (5 waiting to the self address, 1 held), `labelCategories` has 5 values, `UNDO_WINDOW_MS` is 7 days.

Decisions for the owner: none.

## Note check

- **Each finding quotes file and line: proven.** Every finding above cites a path with a line in the F168 folder, or a repo file with a line. Evidence: this message and `spec/features/planned/F168-approvals-is-a-one-draft-at-a-time-queue-and-activity-and-review-have-the-pebble-look/stages/stage-04-queue-flow.md`.
- **Pre-mortem names a stage per bug class: proven.** All five classes are in § Pre-mortem above. Evidence: this message.
- **Facts checked against repo sources: proven.** Evidence: `apps/server/src/modules/channels/approval-routes.ts`, `apps/server/src/modules/actions/approvals.ts`, `apps/web/src/lib/approvals-view.ts`, `apps/web/e2e/tests/open-loops.spec.ts`, `apps/web/src/lib/activity-text.test.ts`, `apps/docs/src/flagged-text.ts`, `packages/core/src/features.ts`. The B1 test run was a `;`-joined call, so it is not a Limen proof command. B1 also rests on the files `apps/web/src/lib/activity-text.test.ts` and `packages/core/src/texts/answers.ts`.
- **Easy-to-miss rule (code detail is not a finding): followed.** Each finding names a missing decision, edge case, test or interface. None asks only for line numbers, edit text or file lists. Evidence: this message.
- **Reminder, tests run once per job and only single files: followed.** I ran one file, `apps/web/src/lib/activity-text.test.ts`, to prove B1. No suite ran.
- **Reminder, `check:job` before the final message for product-code jobs: followed (not applicable).** This review job commits no code.
- **Reminder, a review job runs no suite, lint or typecheck: followed.** No suite, lint or typecheck ran.
- **Reminder, never delete `node_modules/.cache/`: followed.** Nothing was deleted. `bun install` only created `node_modules`.
