PASS 60b57a0c7a4b26605b66139ba2121bdc6048436d

I reviewed commit 60b57a0c7a4b26605b66139ba2121bdc6048436d, and `git rev-parse HEAD` matches it. This commit merges master (3c64a5886) into the candidate branch. Its only own change is commit 4d15899ae. That commit rewrites the Settings alt text in both lists (E2E_ALT and DEMO_ALT, `apps/docs/src/shots.ts:47-50`, `:77-80`). It also adds one test, which checks that every alt text in both lists passes `shotTextProblem` and that `flaggedTextProblems` returns `[]` for each (`apps/docs/src/shots.test.ts:123-128`).

Blocking findings: none.

Unverified checks:
- **The exact `PROOF_OK` line:** no saved file in `/tmp/f171-04/` holds it. Each of the five step logs shows its step passed (see Note check). Not blocking.
- **Origin of the test evidence:** I ran no test suite, by task rule. Test evidence comes only from the worker's logs in `/tmp/f171-04/`, made in the worker's worktree (`…-stage-04-3e3c87a7`). `check.log` names tip 60b57a0c7, the same commit as this review.

Picture review: I opened all 20 PNGs in `/tmp/f171-04/shots/` and compared each one with its E2E_ALT text (EN and PL).
- **onboarding:** Desktop and phone, EN and PL, show "0 of 3 steps" with the cards "Connect a mailbox" / "Połącz skrzynkę" and "Link Telegram" / "Połącz Telegram". The alt text holds.
- **mailboxes:** All four show "No mailbox yet." / "Nie ma jeszcze skrzynki.", the Connect mailbox button and the Telegram card. The alt text holds.
- **settings:** All four show the four section chips (This mailbox, Digests and notices, Organization, Account and security; Ta skrzynka, Podsumowania i powiadomienia, Organizacja, Konto i bezpieczeństwo). The new alt text names them in the same order and words. The desktop shots also show "Digest times (yours)" with 08:00 and 04:00. The old text named "the signature", which no picture shows, so removing it is correct (D9).
- **rules:** The desktop shots show the "Add a rule" form and the VIP, Whitelist and Blocklist lists. The alt text holds.
- **activity:** All four show the period filters, "Only not rated", the Category filter and the empty state "Connect a mailbox first." The alt text holds.
- **Flag-off text:** No alt text holds a text from `FLAGGED_PANEL_KEYS`. The new test checks this, and `check.log:157` shows it passed. The pictures show no flagged UI (no approvals, stats, security log or OAuth buttons).
- **Real addresses and secrets:** Only two addresses appear. `e2e-owner@x.test` is a test domain. `anna@firma.pl` is the fixed example in the rule help text, and `SHOT_TEXT_ALLOW` already allows it with a reason. No secret or token appears.

Notes:
1. **Plausible: some phone alt texts name parts below the fold.** Each page has one alt text for both viewports. In the phone shots, three named parts are below the fold: "the digest times" (settings), "the rule lists" (rules) and "choose the mode" (onboarding). The onboarding desktop shot also does not show the third step, but the "0 of 3 steps" ring implies it. All these parts are on the page, so the text is not false. Stage 04 does not ask for one text per viewport. A later stage can split the alt per viewport if the owner wants exact text.
2. **Plausible: an overlap in the Settings layout, outside this diff.** In `settings-pl-desktop.png`, the long chip "Podsumowania i powiadomienia" widens the chip column to x≈552. The section label "Ta skrzynka" starts at x≈548, so the two touch by about 4 px. The English shot has no overlap. This is a defect of the web Settings page, not of this diff. A web ticket can fix it.
3. **Proven by reading the diff: the DEMO_ALT Settings text changes only the changed words.** This follows step 2 of the stage file ("DEMO_ALT follows only the words that changed in E2E_ALT").
4. **The new test follows § Tests.** It asserts exact values (`toBeNull()`, `toEqual([])`) over both lists. `break.log` shows that it fails when broken: `public_content R2 jan.kowalski@gmail.com in shot rules-en-desktop`.

Note check:
- Alt-match (20 pictures, EN and PL; no flag-off text in the alts): proven. I read all 20 files in `/tmp/f171-04/shots/` and compared them with `apps/docs/src/shots.ts` (E2E_ALT) and `apps/docs/src/flagged-text.ts`.
- No real address or secret: proven. I looked at all 20 files in `/tmp/f171-04/shots/`.
- Stage acceptance, `stages/stage-04-shots.md` (Tests 1–5, the proof chain, Look):
  - Test 1, `shots.test.ts` passes with "the default list is SHOTS: 20 files": proven. `/tmp/f171-04/check.log` line 170.
  - Test 2, 20 shot tests and the file-list test passed: proven. `/tmp/f171-04/shots.log` shows "21 passed".
  - Test 3, `shotTextProblem` gives no problem for each new alt text: proven. `/tmp/f171-04/check.log` line 157 passes.
  - Test 4, the break check fails with `public_content R2` and `rules-en-desktop`: proven. `/tmp/f171-04/break.log`.
  - Test 5, the build log says `shots: on` and there is no `image_outside`: proven. `/tmp/f171-04/build.log` has "shots: on", "Exited with code 0" and 0 matches for image_outside.
  - Proof chain prints `PROOF_OK`: not proven. No saved file holds `PROOF_OK`. Each step log exists and passed: `/tmp/f171-04/check.log` (check:job PASS), `web.log`, `shots.log`, `build.log`, and `docs.log` (166 passed).
  - Look, 20 PNGs copied to `/tmp/f171-04/shots/`: proven. 20 files are in `/tmp/f171-04/shots/`.
- Easy-to-miss rule, "Run no test suite.": followed. This session ran only git, ls, grep, head and tail commands and file and image reads. It ran no `bun test`, lint or typecheck.

Project reminders:
- Tests run once per job, never `test:unit`, `test:int` or `test:e2e`: followed. I ran no tests.
- `check:job` before the final message: does not apply. This is a review job and it made no commit.
- A review job runs no test suite, lint or typecheck: followed. I used the worker's `/tmp/f171-04/check.log` PASS line.
- Never delete `node_modules/.cache/`: followed. I did not touch it.

Commands I ran:
- `git rev-parse HEAD`, `git status`, `git log`, `git diff --stat` against the merge base, and `git show 4d15899ae`.
- `ls`, `tail`, `head` and `grep` on `/tmp/f171-04/*.log` and on the repository sources.
- I read `shots.ts`, `flagged-text.ts` and `stage-04-shots.md`.
- I opened all 20 PNGs.
