Verdict: fix before build. I found 3 blocking and 7 minor findings. The full finding list is in my previous message. In short:

- **Blocking:**
  1. Stage 02 says "same rule as today" for the flag check in `DelegationTabs`. Today the component has no flag check and no `useMe`. The existing tests would break.
  2. Stages 07 and 08 change assertions that stage 06 and the stage test lines call unchanged. The delete step also needs a rule that the add step creates.
  3. Stages 02 and 06 omit F166 stage 08 (`web:build:dev`, `patterns.spec.ts`) from their Needs lines.
- **Minor:**
  - Stage 03 deletes `dgn_filter_*` keys that `loops-view.ts` still reads.
  - Stage 06 asks for a docs regroup with "no change of a sentence", but the page has no "Cards" text.
  - Stage 08 assumes `SectionCard` takes `tabIndex`.
  - `questions.md` tags Q1 as minor and cites the wrong stages.
  - D7 (old filter addresses do nothing) is not listed as an owner-visible default.
  - Stage 03 test 2 needs the seed flags confirmed.
  - Stage 01 has no test of the hook's page-count merge.

Stages 01, 04, 05, 09 and 10 have no blocking finding.

## Note check
- Verdict message lists findings on stages 01–10 (Needs lines, file seams, proof commands, scope creep, owner-visible decisions): proven. The previous message has a per-stage table for all ten stages, and this message gives the verdict. The deliverable is a message, so there is no file or command log to cite.
- No file edited and no job spawned: proven. `test -z "$(git status --short)" && git log master..HEAD --oneline | wc -l` printed `0`. That run used `|` and `$()`, so by the proof rule it does not count as a clean evidence line. Evidence that stands: I made no edit or spawn call on the repository, and the earlier `git status --short` printed nothing. The only file I wrote is the job's `note.md`, which sits outside the worktree.
- Easy-to-miss rule ("Report only; do not edit files."): followed. The worktree is clean and `git log master..HEAD` lists no commits.

## Binding project reminders
- Tests run once per job; no `test:unit`, `test:int` or `test:e2e`: followed. I ran no test command.
- `check:job` as the last step: not applicable. This is a review job and I committed no product code.
- Review job runs no test suite, lint or typecheck: followed. I only read files and ran `git status`, `git log`, `ls`, `grep` and `sed`.
- Never delete `node_modules/.cache/`: followed. I did not touch it.
- Never commit with `--no-verify`: followed. I made no commit.

## Response (planner, 2026-11-24)

The reviewer's full list is the last message of job `2026-11-23-f169-cold-review-of-the-plan-6e711632` (its `log`). Each claim was checked at HEAD `81bb583d3`.

1. **Fixed, one part rejected.** True: `DelegationTabs.tsx` has no flag check and no `useMe`; its tests are in `lib/delegates-components.test.tsx` and render it bare. Rejected: "with the flag off the pages lose their tabs". Today `Delegations.tsx` and `DelegatesPage.tsx` return `dlg_off` before the tabs (`delegations.spec.ts` T16, `delegates.spec.ts` T8 assert no tabs). Stage 02 now keeps `DelegationTabs` pure and adds `DelegationSwitch` (reads `useMe`, renders the tabs only with `delegation_pages`) as the page head action. Stage 05 uses it. No user-visible change.
2. **Fixed.** True: `rules.spec.ts` asserts `rule_kind_vip` and `rules_all_mailboxes` on the comboboxes and `rules_all_mailboxes` on the list row, and the delete uses the rule the add step makes. Stage 06 now lists which assertion goes to which file, moves the row's scope assertion to `rules-lists.spec.ts`, and creates the rule there through `POST /api/rules` (`cleanUpOrg` deletes every rule after each test). Stage 07 changes the two combobox texts; stage 08 changes the scope assertion. The lost "All mailboxes" line is a user-visible default: `questions.md` Q4.
3. **Fixed.** Stages 02 and 06 and the plan table name F166 stage 08. The plan's input line now says the "03, 06, 09, 10 only" rule holds for the ticket, not for each stage.
4. **Fixed.** True: `lib/loops-view.ts` reads `dgn_filter_open` and `dgn_filter_closed`. Stage 03 keeps both.
5. **Fixed.** True: `sender-rules.mdx` has no text on the cards and one sentence on remove. Stage 06 renames "Steps" to "Add a rule" and moves the remove sentence to "Remove a rule"; no "Cards" section (D19 changed). Stage 07 counts `apps/docs` `UiText` reads before it deletes a key; `rules_all_mailboxes` goes with whichever of stages 07 and 08 lands second.
6. **Fixed.** F166 `interfaces.md` says only "div props". Stage 08 now has the stage 10 fallback (a focusable heading).
7. **Fixed.** Q1 is `[important: user-visible]`; Q4 (scope line) and Q5 (old `?filter=` addresses, D7) are new `[important: user-visible]` items. The flag-off tabs need no question (see 1).
8. **Fixed.** Q1 cites stage 08, Q2 stage 07.
9. **Fixed.** `seed-delegations.ts` turns on `delegation_pages`, `approvals_page`, `stats_page`, not `open_loops`. Stage 03 test 2 says so.
10. **Fixed.** Stage 01 adds the pure `reloadPlan(feeds, closedOpen)` and test 10 (page counts kept, `closed` only while open).
