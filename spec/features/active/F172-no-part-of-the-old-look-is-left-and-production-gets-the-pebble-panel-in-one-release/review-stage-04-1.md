PASS 32ca6d5eb0f346bc636553dfbf1a900bbe30da52

Reviewed commit: `32ca6d5eb0f346bc636553dfbf1a900bbe30da52` (`git rev-parse HEAD` matches the candidate). No blocking finding.

**Unverified checks**
- I did not rerun the token contrast test. The review worktree has no `node_modules`, and `bun test apps/web/src/lib/tokens.test.ts` stops with `Cannot find module '@ea/core'`. Evidence is the saved `/tmp/f172-04/check.log`, which ends `check:job PASS master=a68110163b tip=32ca6d5eb0`. Lines 880–884 show the light and dark 4.5:1 and 3:1 tests passing, and the new pairs sit in those tests.
- `/tmp/f172-04/e2e.log` ends `663 passed`, 43 skipped, with no failed or flaky line. It was written at 15:03, after the tip commit at 14:42, so it applies to this commit. `build.log` and `proof.txt` (`PROOF_OK`) are also later than the tip.
- I read no picture frames, so the visual claims of the fixed rows (ellipsis in the Polish tab, the lead on a phone) are unverified. The four `no-organization-*.png` files and the `loops-tracking-on-phone-*` pictures exist in the sheet folders. I did not open them.

**Notes**
1. Behaviour and accessible names (proven by reading `git diff 0fe50edc1..HEAD -- apps/web/src`).
   - No fix changes an accessible name.
     - The category switches keep their `aria-label` (`cat_auto_label`).
     - The timezone fields keep their `Label htmlFor`.
     - The tab labels keep their text; only the visual break changes.
     - The report action card gains a named region (`aria-labelledby`) and an `h2`.
   - Four changes alter behaviour on purpose and match their rows.
     - The report hides the "Mails checked: 0" line.
     - The amber already-on note no longer shows right after a tap.
     - A page-level `EmptyState` now sits in a `Card`.
     - The Mailboxes head action shows only once a mailbox exists.
   - I found no double card: `EndCard` dropped its own `Card`, and `RuleList` uses a plain muted line.

2. Removed text keys (proven by grep).
   - `rep_intro` is the only key removed. No `apps/` code reads it.
   - The docs-site flagged-text list and its test moved to `rep_lead` (`apps/docs/src/flagged-text.ts`, `55a7327bc`).
   - `docs/capabilities/web-panel.md` still says "`rep_intro` stays the first line of the content". It also still says the category row's effect line is its title, and that activity actions wrap under the text on a phone. `web-panel.md` is out of scope for this stage (stage 05), so this is drift to carry into that stage.

3. `dropSession` in `apps/web/e2e/helpers.ts` (proven by reading the helper and its callers).
   - It goes to `about:blank` and then clears cookies. It is used only where a test signs in again straight after.
   - The panel's own redirect to `/login?next=…` on a 401 is still asserted in `apps/web/e2e/tests/auth.spec.ts:116`. The helper only removes the race between that redirect and the test's `goto`.
   - The first try (`72514cd94`, a blank page in every sign-in) is fully reverted in `081c94ab8`. No other spec calls `clearCookies`, apart from `e2e/demo/record.spec.ts`.
   - I did not rerun the account spec. The row's claim of 3 of 3 failures before and 2 of 2 passes after is only in the review file.

4. Tokens (proven by reading the diffs and `check.log`).
   - `--primary-soft-hover`, `--destructive-soft-hover` and `--destructive-edge` each have a row in ADR 0037, in the same commits (`488b633dd`, `472597724`).
   - `color-scheme: light dark` has an ADR line too.
   - The 3:1 proof for the edge is against `--card` only. The danger card also borders the page background. That matches how `--input` is tested, so I count it as a note, not a finding.

5. Spot check of 14 "fixed" rows (proven with `git show --stat`). Each named commit changes the file its row names.
   - `e70a63822` ProgressRing, `72510de75` global.css and ADR, `05c8d88fe` WaitingList, `6c02313f2` ActivityPage.
   - `55a7327bc` ReportContent and the keys, `2548584c1` LoopSettingsCard, `2f9a03b82` global.css and LoopRow, `86c73692b` PageHead.
   - `488b633dd` button, badge, tokens and ADR, `cc3ba58f7` SettingsPage, `ed6c0de5a` MailboxesPage, `d421a5b68` SettingsNav.
   - `c5421ce37` Nav, `0ba22e64e` CategoriesCard, Row and the `cat_action_*` keys.
   - `check.py` in `/tmp/f172-04` also checks that all fixed rows name a branch commit and that every proposal row has a follow-up line.

6. Polish text (proven by reading the pl diffs). The new keys have no reader gender: `Włączyć zalecane?`, `Co możesz zrobić dalej`, the `cat_action_*` noun phrases, and `rules_pattern_placeholder`. The reworded `rep_lead` is in the third person ("Co asystent zrobiłby…", an existing form).

7. `cc3ba58f7` (SettingsPage scroll pin) is plausible, not proven.
   - The commit adds no test, and the effect has no cleanup.
   - It watches `document.body` with a `ResizeObserver` and calls `scrollIntoView` on each resize, for up to 3 s. A wheel, touch, pointer or key event stops it.
   - The row said "about 8 lines"; the change is 23 lines, still under the 100-line limit.
   - Only the e2e run covers it. It passed at tip, but I did not check whether a hash-scroll spec exists.

**Checks I ran**
- `git rev-parse HEAD` matches the candidate.
- I read the diff `0fe50edc1..HEAD` (54 files) and `git show --stat` for 14 commits.
- I ran grep for `rep_intro`, `clearCookies`, `EmptyState` callers and `cat_effect_*`/`cat_action_*`.
- I read the saved logs `/tmp/f172-04/check.log`, `e2e.log`, `build.log` and `proof.txt`.
- I ran `bun test apps/web/src/lib/tokens.test.ts`; it failed to start (module not found, no install). It is unverified here, not a failure of the candidate.
- I ran no suite, lint or typecheck, as the reminders say.

**Note check**
- No fix changes behaviour or an accessible name unseen: proven. Evidence: diff `0fe50edc1..HEAD` read in full for `apps/web/src`. The one bash call that exited 0 and joined its commands with `&&` was `git diff --quiet 32ca6d5eb0f346bc636553dfbf1a900bbe30da52 HEAD && grep -n "next=%2Factivity" apps/web/e2e/tests/auth.spec.ts && grep -n "pass) design token contrast" /tmp/f172-04/check.log && grep -n "663 passed" /tmp/f172-04/e2e.log && git show --stat --format=%h e70a63822 05c8d88fe 6c02313f2 2548584c1 2f9a03b82 86c73692b 488b633dd cc3ba58f7`. Saved log: `/tmp/f172-04/e2e.log` (663 passed).
- No removed text key is still used; `dropSession` hides no redirect fault: proven. Evidence: `apps/web/e2e/tests/auth.spec.ts:116` (from the `&&` call above) still asserts `/login?next=%2Factivity`. Only `rep_intro` was removed, and no code under `apps/` reads it. `docs/capabilities/web-panel.md` still names it (note 2).
- New tokens have 4.5:1 and 3:1 proof: proven for the saved run, not rerun here. Evidence: `/tmp/f172-04/check.log` lines 880–884 (from the same `&&` call). Local rerun failed on a missing install, so it is unverified at this worktree.
- Eight spot-checked "fixed" rows each have a change in the named commit: proven. Evidence: the `git show --stat` part of the `&&` call above (15 file lines for 8 commits); 14 commits checked in all (note 5).
- Easy-to-miss rule, "Polish text with reader gender": followed. Evidence: the `pl-reply.ts` and `pl-settings.ts` diffs are the only changed Polish text, and none holds a gendered form (note 6).
- Project reminders: followed. This review ran no test suite, lint or typecheck. It ran one test file (`tokens.test.ts`) only to prove the token doubt, and it failed to start for lack of `node_modules`. I did not delete `node_modules/.cache/`. I ran no `check:job`, because a review job does not.

Decisions for the owner: none (review job).
