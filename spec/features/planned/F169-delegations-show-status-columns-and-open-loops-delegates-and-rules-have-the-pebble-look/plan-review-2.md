FAIL 2454ad1edb0764f1158183391d350a9cd05793dc

HEAD is `2454ad1edb0764f1158183391d350a9cd05793dc` and matches the candidate. This was a review job, so I ran no test suite, lint or typecheck. All evidence comes from reading and grepping the plan, F166 and the code at HEAD. Paths below are relative to the F169 folder `spec/features/planned/F169-…/` unless they start with `apps/`, `docs/` or `spec/`.

Pre-mortem answer:
- **CI break:** the most likely break on master comes through stage 08 (see B2).
- **User-visible bug:** the most likely bug that reaches a user comes through stage 03. It shows a false "No delegations yet" when only closed delegations exist (N1).

## Blocking

**B1. The Needs lines miss F166 stage 04, which adds the Button variants `soft` and `destructive-soft`.** Proven by reading the code and the F166 plan.
- At HEAD, `apps/web/src/components/ui/button.tsx:10-20` has no `soft` or `destructive-soft` variant.
- F166 `stages/stage-04-primitives-a.md:7` owns `button.tsx`, and `interfaces.md:57` marks `soft` as "(new)".
- F166 stages 06 and 10 need only 03 and 08 (F166 `plan.md:82-83`). So F166 03, 06, 09 and 10 can all land before 04.
- These F169 stages use the new variants:
  - stage 03 line 12 (Remind is `soft`)
  - stage 04 line 17 (Draft follow-up is `soft`)
  - stage 09 line 14 (`soft` and `destructive-soft`)
  - stage 10 lines 12 and 22
- Stage 07 line 39 and stage 09 line 14 also rely on the 48 px field and select sizes, which F166 04 sets (its line 13).
- `ticket.md:40` and the `plan.md` Stages table repeat the same gate.
- Effect: the coordinator starts stages whose Needs are met. A stage started before F166 04 lands fails typecheck on `variant="soft"`, or the worker guesses another variant.
- Fix: add "F166 stage 04: Button `soft`/`destructive-soft`, 48 px fields" to the Needs of stages 03, 04, 07, 09 and 10, and to the ticket gate. The programme page `docs/product/pebble-ui/README.md:89` has the same gap. That fix is for the coordinator; the planner must not edit that page.

**B2. When stages 07 and 08 both land, `rules-form.spec.ts` fails on master.** Proven by reading the cited lines.
- Stage 06 lines 21-22 move "add, a duplicate, a bad pattern" into `rules-form.spec.ts`, owned by stage 07, "with no change of a step or an assertion".
- That part of `apps/web/e2e/tests/rules.spec.ts` checks the VIP list, not only the form. Line 49 checks the chip text. Line 50 checks `vip.getByText(en.rules_all_mailboxes)`.
- Stage 08 test 2 (line 31) says "a rule for all mailboxes shows no scope line". After stage 08, line 50 cannot pass.
- Neither proof runs the other stage's spec:
  - stage 08 Proof B runs only `rules-lists.spec.ts` (line 47)
  - stage 07 Proof B runs `rules-form.spec.ts suggestions.spec.ts` (line 61)
  - `check:job` runs no e2e
- So whichever stage lands second leaves master CI red.
- Fix, two parts:
  - Stage 06 removes the list assertions from the form spec, or keeps only `[data-kind=vip]` plus the pattern text, which survives stage 08.
  - Stage 08's Proof B also runs `rules-form.spec.ts`.

## Unverified

- No test, typecheck or e2e run (review job rule).
- The Polish wording is not judged by a native speaker (plan Q2).

## Notes

**Missing decisions and edge cases**
- **N1 (proven by reading): false empty state when only closed delegations exist.** Stage 03 line 14 shows one `EmptyState` "No delegations yet" when the four columns are empty and the closed list is shut. Stage 01 line 44 fetches `closed` only while the list is open. A user whose delegations are all done or cancelled sees the false text. The plan also does not say whether the "Show closed delegations" button still shows then. Decide both.
- **N2 (proven by reading): "No more rows" text can be false.** D4 (`plan.md:16`) stops "Show more" after 4 pages and then shows `dgn_col_no_more` ("No more rows in this column."). Stage 01 test 8 has 4 pages with `next` never null. The text is false then, and "Show more" stays on screen. Use a separate text for the capped case, or keep the focus on the button.
- **N3 (plausible): "Nothing here." can show while rows still wait on the next page.** `drafted` and `sent` share the `open` cursor. A column can load 0 rows while `next` is set. Stage 03 test 1 covers "0 rows" and "next set" only separately. Decide what the column shows in that case.
- **N4 (plausible): stage 08's spec can break against stage 07's form.** The delete half of the old spec uses the rule that the add half created (`rules.spec.ts:46-67`). So `rules-lists.spec.ts` needs its own setup, which stage 06 line 22 rules out. Stage 08 test 4 adds a blocklist rule. Stage 07 (line 39) renames the kind options to `rules_sentence_kind_*` ("blocked"), and 07 runs next to 08. If stage 08's spec adds the rule through the form, it breaks after stage 07 lands. Say that `rules-lists.spec.ts` seeds rules with `POST /api/rules` (`page.request`).
- **N5 (plausible): Undo can restore a rule the user does not see.** `RulesBody` is keyed by the mailbox filter (scouts.md line 101). If the user changes the filter within the 10 s of the toast, `onChanged` reloads an unmounted list. The restored chip may stay hidden until a reload. Stage 08 lines 19-25 do not cover this.
- **N6 (proven): the "Cards" docs section has no text and no owner.** `apps/docs/.../how-to/sender-rules.mdx` has no text about the cards. Stage 06 line 27 adds an empty "Cards" heading, and D19 gives the page to no later stage. Drop the heading, or give it an owner.

**Missing tests**
- **N7 (proven by reading): two decisions have no page-level test.** D9 (a focused row that moves column keeps the focus) has only the pure `focusAfterReload` test (stage 01 test 5). No stage 03 case checks it. D10 (a feed failure shows Retry only in that feed's columns) has no test in any stage.
- **N8 (plausible): stage 02 test 1 has no browser test setup to run in.** It needs a click test ("a plain click calls `onSelect` … a ctrl-click does not"). Every web unit test uses `renderToStaticMarkup` (for example `apps/web/src/lib/delegate-action.test.tsx:4`). A worker could add happy-dom, which changes `bun.lock` and breaks DB-1. Say: test `isPlainClick` as a pure function and call the handler directly.

**Interfaces and contradictions**
- **N9 (proven): `questions.md` names the wrong stages.**
  - Q1 (lines 5-6) says "plan D17, stage 07" and "change stage 07 to a confirm dialog". Undo belongs to stage 08 (`plan.md:29`, stage-08 Step 2).
  - Q2 says "Default (stage 06)". The texts are in stage 07 (stage-07 lines 17-27).
  - An owner answer to Q1 would go to the wrong worker.
- **N10 (proven): two stages share one long line of the capability docs.** All ten stages, plus F167, F168 and F170, edit rule 9 of `docs/capabilities/web-panel.md`. It is one physical line (`web-panel.md:59`). So any two parallel stages conflict at land, which breaks § Rules for width rule 1. D19 accepts "merge master, prove again". Each re-proof costs `check:job`, a web build and a Playwright run. A better design: an early stage splits the Delegations, Open loops, Delegates and Rules parts of that line into separate lines.
- **N11 (proven): stage 01 adds Polish text but has no review.** Stage 01 adds the Polish column titles (stage-01 line 21). `plan.md:71` says "Stage 01 lands on its proof", with no review. `spec/build.md:11` wants an Opus review for new user-facing Polish text.
- **N12 (plausible): two key and file lists in stage 03 can mislead a worker.**
  - Stage 03 line 9 lists `dgn_filter_*` for deletion. `lib/loops-view.ts:38-42` (`LOOP_FILTER_LABELS`) still reads `dgn_filter_open` and `dgn_filter_closed`, and so does `open-loops.spec.ts`. The typecheck catches a wrong delete, but the list misleads.
  - Stage 01 line 44 reuses `loadPages`, which lives in `lib/use-delegation-list.ts:17`. Stage 03 deletes that file only "when nothing reads" it, so the dead `useDelegationList` and `restartPages` stay. Decide whether `loadPages` moves into the new hook file.
- **N13 (plausible): stage 08 assumes `SectionCard` takes a ref.** Stage 08 line 23 moves the focus to a card root (`SectionCard` with `tabIndex={-1}`). Only the VIP card has an id. F166 `interfaces.md:69` promises "...div props" but not ref forwarding. Stage 10 line 13 hedges on this; stage 08 does not.
- **N14 (plausible): the `?filter=` change sits next to the "no URL change" rule.** D7 makes `?filter=overdue|answered` mean nothing. Today each tab has its own address (`delegations.spec.ts:93`, T9), and `web-panel.md:59` documents the four tabs. This is close to DB-1 ("no URL, query or anchor change"). Record it as part of the delegation-columns behaviour change (PB-5), so a reviewer does not read it as a DB-1 break. The demo (`apps/web/e2e/demo/record.spec.ts:221`) still opens `?filter=overdue`.
- **N15 (proven): one acceptance item maps to the wrong stage.** `plan.md:50` § Done when maps acceptance 4 ("the loops board in the new look") to stage 03 tests 2 and 5. The new look is stage 04.
- **N16 (proven, harmless): the seed has more than one row for some statuses.** Stage 03 test 2 says "one delegation per status". The seed has 3 overdue and 2 answered rows (`apps/server/src/scripts/e2e-seed/args-delegations.ts:45-89`).

## Facts checked and found true at HEAD

- The six statuses and four filters are in `packages/core/src/web/delegation.ts:59-62`. The page size is 50.
- Only `?tab=` links come from the server (`reports/digest-brief.ts:59-61`). No server code writes `?filter=`.
- `MeProvider` wraps the frame in `AppShell.tsx:133`.
- `POST /api/rules` answers 409 `rule_exists` and `rule_limit` (`config/routes.ts:280-282`). `RuleView.mailboxId` is nullable.
- The mobile e2e project is Pixel 7 (`playwright.config.ts:26`).
- The F166 owners match the plan: `InitialsAvatar` is stage 06; `SectionCard`, `RowList` and `EmptyState` are stage 10; `PageHead` is stage 09. The `text-cat-*` classes exist after F166 stage 03 (its line 9).
- On a phone, `PageHead` hides the lead when an action is present (F166 stage 09 line 9).
- `OpenLoops.tsx:37` shows the delegations switch on every tab while `delegation_pages` is on.
- Word counts are within § Plan size: `plan.md` 1499; stages 415–692.
- The "May run next to" pairs other than rule 9 of the capability docs (N10) share no file. The text keys sit at least 5 lines apart (`en-approvals.ts:283/291/292`, `en-settings.ts:224/229`).

Commands I ran (all read-only):
- `git rev-parse HEAD`
- `wc -w` on the plan files
- `git grep` and `grep` over `apps/`, `packages/`, `spec/` and `docs/`
- reads of the files cited above

## Decisions for the owner

none

## Note check

- Verdict first line and HEAD matches the candidate: proven. `git rev-parse HEAD` printed `2454ad1edb0764f1158183391d350a9cd05793dc`, the candidate.
- Each finding quotes file and line and is checked against code at HEAD, for each category the task lists: proven by the content of this message.
  - pre-mortem: the answer at the top, B2 and N1
  - gaps: N1, N2, N3, N5, N6
  - conflicting rules: N2, N14, N9
  - guess steps: N4, N8, N12, N13
  - unsourced facts: N16 (all other facts are listed under "Facts checked")
  - stages too big: none (word counts within limits)
  - Needs lines: B1
  - parallel stages on one file: B2, N10
  - Every citation comes from a read or grep in this session; the key ones are `apps/web/src/components/ui/button.tsx`, `apps/web/e2e/tests/rules.spec.ts` and `docs/capabilities/web-panel.md`.
- Blocking only for a proven break, the rest labelled notes: proven. B1 and B2 are proven by the cited files. Every N item has a proven or plausible label.
- Easy-to-miss rule (missing code detail is not a finding): followed. Each finding names a missing dependency, decision, edge case, test or interface. None asks for line numbers, edit text or file lists.
- Reminder, tests run once per job and no `test:*` runs: followed. I ran no test command.
- Reminder, product-code job runs `check:job`: not applicable. This review job committed nothing.
- Reminder, review job runs no suite, lint or typecheck: followed. I ran only reads and greps.
- Reminder, never delete `node_modules/.cache/`: followed. I did not touch it.

## Response (planner, 2026-11-24)

Each claim was checked at HEAD `e4190ab85`. Several items were already fixed by the review 1 round (`plan-review-1.md` § Response).

- **B1. Fixed.** True: `components/ui/button.tsx` has no `soft` or `destructive-soft` variant, and F166 stage 04 adds them and the 48 px fields. F166 stage 04 is now in the Needs of stages 03, 04, 07, 09 and 10, in the plan table, in the plan Input line and in the `ticket.md` gate. Stage 08 needs no F166 04: `icon-sm` and `Badge` `secondary` exist today. The programme page `docs/product/pebble-ui/README.md` line 89 has the same gap. That is a coordinator edit; this job did not edit it.
- **B2. Fixed.** The review 1 round already moved the `rules_all_mailboxes` chip assertion out of `rules-form.spec.ts` into `rules-lists.spec.ts` (stage 06 step 2). `rules-form.spec.ts` now checks only the pattern in the VIP list, which survives stage 08. Stage 08 Proof B now also runs `rules-form.spec.ts`.
- **N1. Fixed.** Stage 03: the empty state title is "No open delegations", and the closed-list button always shows.
- **N2. Fixed.** D4 and stage 03: at the 4-page cap the focus stays on the button and the status line says `dgn_col_capped`; `dgn_col_no_more` shows only when the cursor ended.
- **N3. Fixed.** D4 and stage 03 test 1: a column with 0 rows shows its empty line only when its feed ended; with a cursor it shows only Show more.
- **N4. Fixed.** Stage 06 creates the delete-step rule through `POST /api/rules`. Stage 08 test 4 creates its blocklist rule through the API, not the form.
- **N5. Fixed.** Stage 08: `onChanged` comes from `Rules`, above the keyed `RulesBody`. It raises `rulesVersion` and calls `reloadMe`, so an Undo after a filter change reloads the list on screen.
- **N6. Fixed** in the review 1 round: no "Cards" section (stage 06 step 3, D19).
- **N7. D10 fixed, D9 page test rejected.** Stage 03 test 7 fails the `answered` feed with `page.route` and expects Retry in that column only. D9: the pure `focusAfterReload` test (stage 01 test 5) and the kept "done" focus case (stage 03 test 3) cover it. A page test of a row that moves between columns needs a server status change during the test. That costs more than it proves.
- **N8. Fixed.** True: no web test uses a DOM library. Stage 02 test 1 uses `renderToStaticMarkup` and a pure `test.each` of `isPlainClick`, with no `bun.lock` change.
- **N9. Fixed** in the review 1 round (`questions.md`).
- **N10. Rejected.** Rule 9 of `docs/capabilities/web-panel.md` is one line. F167, F168 and F170 edit it too. A split by this ticket would conflict with those tickets and with the parallel F169 stages. The owner rule (2026-11-20) resolves a land conflict by "merge master, re-prove". D19 keeps that rule.
- **N11. Fixed.** Stage 01 adds Polish text, so plan § Review now gives it an Opus review. Every stage gets a review before its land.
- **N12. Fixed.** Stage 03 keeps `dgn_filter_open` and `dgn_filter_closed`. It moves `loadPages` into `lib/use-delegation-columns.ts` and then deletes `lib/use-delegation-list.ts` with `useDelegationList` and `restartPages`.
- **N13. Fixed.** Stage 08: the card root gets the focus only if `SectionCard` passes `ref` and `tabIndex`. Else a focusable card heading gets it.
- **N14. Fixed.** D7 says this is the columns change of the ticket (PB-5), not a DB-1 break, because no address goes away. `questions.md` Q5 records it. The demo still opens `?filter=overdue` and finds the overdue column (D20).
- **N15. Fixed.** Plan § Done when maps acceptance 4 to stage 03 tests 2 and 5 and stage 04 tests 1–3.
- **N16. Fixed.** Stage 03 test 2 says "each status at least once".
