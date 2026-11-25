PASS 841b32576b625faa6165c5f84d15fe056d645ef3

Reviewed commit: 841b32576b625faa6165c5f84d15fe056d645ef3 (`git rev-parse HEAD` matches). It is the approvals queue flow of F168 stage 04: product commits 89f1bc08f and 6b0123f3c, then a merge of master 368808abc.

Blocking findings: none. I found no path where a double tap, a stale card or a keyboard action approves, sends or holds a draft other than the one on screen. I found no path that sends mail without a tap.

Unverified:
- The zero-lock runs `/tmp/f168-04/e2e-zero-arm.log` and `e2e-zero-lock.log` (01:57) came from a working tree before commit 6b0123f3c (02:14). The Q2 lines in those logs (676–677, `waitingIds`) match the committed test. I cannot confirm that the product code of that tree matches the commit.
- `/tmp/f168-04/shots/` (02:13) also comes from before 6b0123f3c. `mobile-en-focus.png` already shows the smaller Change and No buttons that this commit added. The sheet index `sheet.log` (02:15) lists 8 pictures and 0 overflow marks. I opened two pictures (`mobile-en-focus.png`, `desktop-en-outcome.png`). I did not compare them with the `02-approvals-*` mockups.
- `PROOF_OK` was not saved in any log. Its parts show success at the tip: `check.log` ends `check:job PASS master=368808abc9 tip=841b32576b full=0` (02:17), `build.log` exits 0 (02:17), and `e2e.log` (02:24) shows 152 passed, 6 skipped, 0 failed across approvals, reply-panel, open-loops, delegations, loops-panel and patterns.

Evidence for the safety claims (code read, plus logs):
- **No send without a tap (proven by grep).** `postApprove` and `postReject` have one caller each, `decide()` in `use-approvals-queue.ts:254` and `:260`. `decide` is bound only to `onApprove` and `onReject` clicks in `ApprovalsPage.tsx`. The approvals components have no key handler (grep for keydown/onKeyDown is empty). The hold timer, `leave()` and the expiry path only call `select` or `reload`.
- **Stale card.** `current` needs `detail.data.id === id`, so a card for an old id never renders under a new URL id; the page shows Loading. Handlers pass the `open.id` that was rendered, and `decide` returns when `target !== live.current.id`. `singleFlight` stops a second request before React re-renders.
- **Double tap (proven by log).** With `ARM_MS = 0`, Q2 failed: the next draft became `held` (`e2e-zero-arm.log`, "Expected: waiting, Received: held"). With both locks at 0, Q2 failed on a timeout. At the tip, Q2 passes in both projects (`e2e.log`). The arm time is load-bearing and the test catches its loss.
- **Keyboard.** After a decision, the focus goes to the outcome status line, then to the title `h2` of the new card. Enter or key repeat does not reach the next card's Yes. Tab skips Yes while it is disabled; `reply-panel.spec.ts` T4 now waits for it.

Notes (none blocking):
1. **Plausible: the arm can carry over when the same draft id comes back.** `useArmed` (`queue-support.ts`) keeps `armedId` and does not clear it when `openId` becomes null. A draft that goes X → null → X gets its buttons on at once, with no 500 ms wait. Two paths reach this:
   - One waiting draft, then "Later", then "Show them again".
   - Fast "Later" through every draft before the first one armed, then "Show them again".
   - Also a pick X → Y → X inside 500 ms.

   This contradicts the comment on `armed()`: "Every change of the focused id restarts the time." I found no layout where the second tap of a double tap lands on Yes this way (the end card's button is not where the bar's Yes is). Keyboard focus goes to the title. Fix: reset `armedId` to null in the effect when `openId` changes. A unit test with fake timers can cover it.
2. **Plausible: a list pick while an approve runs.** `pick` sets the phase to idle while the request still runs. After that:
   - `detail.mutate({ id: X })` raises the load counter and drops the answer for the newly picked draft Y. Y shows the skeleton until a later reload, because the detail does not poll.
   - On a `409 changed`, `applyOutcome` calls `select(outcome.openId)` and moves the user from Y to the new version of X, which then arms for 500 ms.
   - On a `next-button` outcome, Y's buttons stay off until the next pick.

   Nothing sends the wrong draft: `singleFlight` drops Y's tap while X runs. Fix: guard `mutate` and `select` in `decide` and `applyOutcome` with `live.current.id === target`, or turn list picks off while the phase is not idle.
3. **Proven by the picture: the step count moves early.** During the hold after "Yes" on draft 1, the progress row already reads "2 of 5" (`/tmp/f168-04/shots/desktop-en-outcome.png`), because `done` goes up in `applyOutcome`. This is cosmetic; the stage text does not settle it.
4. **Unverified: a redraft that ends after the user moved on.** In that case (T8b), `use-reply-actions.ts` aborts and does not add the old id to `ownIds`, which the stage file asks for. The server makes the old version `superseded`, so the list drops it on reload. I saw no user-visible effect; T8b passes in `e2e.log`.

Checks I ran:
- `git rev-parse HEAD`: matches the candidate.
- `git diff --stat master...841b32576`: 26 files.
- Read the diff of the queue hook, `queue-support.ts`, `lib/approvals-queue.ts`, `ApprovalActions.tsx`, `QueueHead.tsx`, `QueueStates.tsx`, `ApprovalsPage.tsx`, `use-resource.ts`, `use-selected-id.ts`, `use-reply-actions.ts`, the seed, the specs and the capability page.
- grep of the `postApprove` / `postReject` callers and of key handlers.
- Read `/tmp/f168-04/check.log`, `build.log`, `e2e.log`, `e2e-zero-arm.log`, `e2e-zero-lock.log`, `sheet.log` and two pictures.
- No test suite, lint or typecheck (as the task says).

Note check
- HEAD is the candidate: proven. `git rev-parse HEAD` printed 841b32576b625faa6165c5f84d15fe056d645ef3 in a call of its own.
- No wrong-draft approve, send or hold; no send without a tap: proven by code read and log. The code read covers `apps/web/src/components/approvals/use-approvals-queue.ts` (the only callers of postApprove and postReject, the `decide` id guard) and `apps/web/src/components/approvals/queue-support.ts` (`useArmed`). The log is `/tmp/f168-04/e2e-zero-arm.log` (without the arm time, the next draft became held). Plausible gaps are notes 1 and 2; neither is a proven break.
- Done-when item 1, Q1–Q9 and the earlier approvals tests pass: proven. `/tmp/f168-04/e2e.log` shows 152 passed, 6 skipped, 0 failed, at tip 841b32576b after `check.log`.
- Done-when item 2, the contact sheet read next to `02-approvals-*`: not proven. `/tmp/f168-04/sheet.log` lists 8 pictures. The pictures were taken before commit 6b0123f3c, and I did not compare them with the mockups.
- Done-when item 3, PROOF_OK: not proven. No log holds the `PROOF_OK` line. Its parts passed at the tip: `/tmp/f168-04/check.log`, `/tmp/f168-04/build.log`, `/tmp/f168-04/e2e.log`.
- Both lock times at 0 make Q2 fail: proven on a pre-commit tree. `/tmp/f168-04/e2e-zero-lock.log` and `/tmp/f168-04/e2e-zero-arm.log` show it; the tree's product code is unverified.
- Verdict first line: proven. This message starts with `PASS 841b32576b625faa6165c5f84d15fe056d645ef3`.
- Easy-to-miss rule "Run no test suite; read the code and the saved logs": followed. I ran only git, grep, cat and file reads. No `bun test`, `test:*`, lint or typecheck command ran in this job.
- Reminder "tests run once per job; no test:unit/int/e2e": followed. No test command ran.
- Reminder "a job that commits product code runs check:job": not applicable. This review made no commit.
- Reminder "a review job runs no suite, lint or typecheck": followed. None ran.
- Reminder "never delete node_modules/.cache": followed. I touched no file outside the job note.
