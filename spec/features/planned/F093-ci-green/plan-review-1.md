PASS 7d240f08f5862689b557cb72bc0c2407b0b79b7f

The F093 plan is correct on its central facts, and its three fixes work on Bun 1.3.14 when I run them. Before stage 1 spawns, fix M1, which is a one-line edit. M2 to M4 are gaps that can leave CI red after the ticket closes. Nothing here is a blocker. HEAD is 7d240f08 and the tree is clean. I removed all probe files.

## Blocking
None.

## Unverified
- NV1: `bun run test:int:ci` on 1.3.14. I did not run it, because this review job has no database of its own.
- NV2: `setup-bun` with `bun-version-file`. This needs a CI run after the land.
- The STARTTLS relay probe passed under `bun test` only. I did not run `tsc` or `eslint` on it. The probe for the AgentMail fake passed `tsc --noEmit` and `eslint`.

## Pre-mortem: which stage lets a failure through
- **Stage 1 step 2:** the new test fails exactly as written (M1).
- **Stage 2 step 3:** has no rule for a test that fails in CI but passes locally (M2).
- **Stage 3 and after the close:** no one has the job of watching CI (M3).
- **The bug that reaches a user (M4):** a STARTTLS connection to an IP-literal mail host fails on the image Bun. Stage 1 hides it in the test, and no step opens the follow-up ticket.

## Findings

**M1 · major · proven.** The new test fails exactly as written in `stages/stage-01-bun-pin-and-fakes.md:87`.
- The step starts a second fake `other` and calls `send` with no inbox on it.
- `fake.ts:174-177` then returns 404 before `handleSend`, so the hold never starts.
- My probe got `AgentMailError: HTTP 404 NotFoundError` where the plan expects `SoftError`, so the test fails.
- With `ensureInbox` on `other` first, the test passes on 1.3.14 in 202 ms.
- Plan rule `plan.md:170` says a deviation is a question, so a careful worker stops here.
- Fix: in step 2 test 2, call `ensureInbox` on `other` (through the client with `timeoutMs: 200`) before `holdResponseNext`.

**M2 · major · gap.** The D12 table (`plan.md:131-136`) and stage 2 step 3 (`stage-02:85-99`) do not cover one case: `test:int` fails in CI but passes under `test:int:ci` locally.
- CI uses its own GreenMail service with `-Dgreenmail.auth.disabled` (`ci.yml:32`) and its own database roles (`ci.yml:52-57`).
- Step 3.1 reads the CI result but gives no action for it.
- "Done when" (`stage-02:99`) is local only, so stage 2 can land while `master` stays red.
- Fix: add a row to D12: "fails in CI, passes locally on the pin → diagnose from the CI log under the same rules; stop and report when you cannot reproduce it".

**M3 · major · gap.** No one has the job of watching CI after F093 closes.
- D13 (`plan.md:139`) says the coordinator watches CI after each land.
- Stage 3 writes the rule only into `docs/code-patterns.md`, the styleguide and `CLAUDE.md` (`stage-03:128`).
- `spec/build.md` is the coordinator's board, and it gets only the TRACK line (`plan.md:140`). No entry under standing choices tells the coordinator to check `gh run list` after each land.
- Result: "quarantined the same day, by rule" (`ticket.md:9`) has no trigger after the close.
- Fix: the TRACK text, or a coordinator line at the stage 3 land, adds the check to the standing choices in `spec/build.md`.

**M4 · major · gap / product risk.** The fix hides a real product bug, and no step opens its follow-up ticket.
- I reproduced F7: with `subjectAltName=IP:127.0.0.1` only, on 1.3.14, the relay gives `Hostname/IP does not match certificate's altnames: Host: localhost`, and 2 tests fail.
- In production, `host-guard.ts:51` returns `{ host: literal }` with no `servername` for a public IP literal. So a STARTTLS mailbox on an IP-literal host fails closed on the image Bun.
- D9 (`plan.md:126`) adds `DNS:localhost` to the test certificate and hides this.
- The D12 row "Bun 1.3.14 behaviour that also reaches product code → stop, quarantine" (`plan.md:134`) would treat this case another way. That is a rule conflict.
- questions.md Q1 (`:248-249`) says "open a follow-up ticket", but no stage step or How-to-run item does it. Stage 1 step 4 writes only a note (`stage-01:140`).
- Fix: stage 1 step 4, or How-to-run item 5, runs `limen ticket new "The server image, CI and local checks run one current Bun (1.4.x)" --lane planned`. That ticket names F7, NV3 and the removal of `DNS:localhost`.

**m1 · minor · rule conflict.** Who adds the quarantine `test.skip`?
- How-to-run item 6 (`plan.md:230`) tells the worker, through `limen continue`, to add it.
- D13 (`plan.md:139`) says the coordinator adds it.
- The worker's rule `plan.md:165` says "Never add `test.skip` … Only the coordinator quarantines".
- Fix: choose one. The simplest choice: the coordinator commits the skip on `master`, and item 6 says "continue the job after the quarantine commit".

**m2 · minor · rule conflict.** Which fakes may a worker change?
- The allowed list (`plan.md:163`) names only `modules/testmail/agentmail/fake.ts` as a fake.
- Stage 2 step 3 (`stage-02:81,88`) says "a test fake → fix it here" but lists only `apps/server/test/**` and `tools/fake-telegram/test/**`.
- Fakes under `src/`, such as `tools/fake-telegram/src`, are in neither list, so the worker must guess.

**m3 · minor.** The "Done when 8" command (`plan.md:159`) can fail for the wrong reason.
- `gh run list … --limit 3` also returns runs still in progress.
- The edge-case rule (`plan.md:145`) says such a run "does not break the row", but this command then fails.
- Fix: say "the three latest runs with `status` `completed`", or use `--status completed`.

**m4 · minor · drift.** The ticket and the plan count different known-alerts entries.
- The ticket says "the two entries in `docs/known-alerts.md`" (`ticket.md:13`) and "closes both entries" (`:27`).
- Those two entries are AgentMail (`known-alerts.md:325`, pending) and `mailbox:seed` (`:333`, already fixed).
- The plan closes AgentMail and adds a new STARTTLS entry instead (`plan.md:92,156`).
- Fix: change the ticket wording to match the plan.

**m5 · minor.** Stage 3 test 2 (`stage-03:166`) checks "Quarantine" with `grep -c`, which counts lines. Today `docs/code-patterns.md` has 0 such lines, so 1 after the edit is correct. This check is fragile if a later edit adds the word again.

**q1 · question.** What does the coordinator do after a land is already done?
- How-to-run item 5 (`plan.md:229`) checks NV2 and that `test:unit` is green after the stage 1 land, but gives no action when it is red.
- Item 7 gives `limen continue` only after stage 3.
- Can a job that was landed with `--keep-open` be continued? `limen continue --help` says "resume a finished job", so this is probably yes.

**q2 · question · unsourced.** D5 (`plan.md:122`) rejects a Docker `ARG` because "the VPS Compose build needs a default anyway". No file is named as the source for this.

**Stage size:** each stage fits one job. Stage 1 has 4 steps (about 200 lines). Stage 2 step 3 is open-ended, but the 3-cause limit and the 120 m timeout bound it. Stage 3 is docs only.

## Facts checked against the code (all hold)
- **F2/F4: holds.** `bunx bun@1.3.14 test` on fake.test.ts, send.test.ts, smtp-starttls.test.ts and scheduler.test.ts gave 40 pass, 5 fail. The five failures are the five tests the plan names (`/tmp/f093-review/pin.log`), and the two AgentMail tests print "hook timed out". The local Bun 1.4.4 gave 45 pass, 0 fail (`/tmp/f093-review/local.log`).
- **F3: holds.** The scheduler tests pass on 1.3.14. The error label comes from `scheduler.ts:24`.
- **F5/D8: holds.** `fake.ts:80-88` and `:214-220` clear the timer without a resolve. With the probed `held` set, fake.test.ts passed on 1.3.14, the existing hold test took 202 ms, and `tsc --noEmit` and `eslint` were clean. The self-referencing `entry` gives no TS7022 error.
- **F6/F7/D9: holds.** The relay alone fails 2 tests. The relay plus `DNS:localhost` gives 9/9 on 1.3.14 (two runs) and on 1.4.4.
- **D11/F10: holds.** I probed scheduler tests 1 and 4 on 1.3.14 with the gate, the debug spy, the witness and a `waitFor` built to the D10 specification. Both passed in 2.6 s and 2.0 s.
- **F8: holds.** A script run with `bunx bun@1.3.14 run` has a child `bun --version` of 1.3.14, from the bunx cache `.bin/bun`.
- **F13: holds.** `gh run list --json` has an `attempt` field.
- **F12: holds.** The local `waitFor` is at `telegram-logs.test.ts:99`. `fake.test.ts:3` imports `../../../../test/contract/mail-provider`.
- **F4/D5: holds.**
  - `ci.yml:45` and `:94` have `bun-version: 1.3.14`.
  - `Dockerfile:1` is `FROM oven/bun:1.3.14\n`; the image-check command exits 0.
  - No other file pins the Bun version.
  - `package.json:15-16` define `test:unit` and `test:int` as the plan says.
- **Recent CI on `master`: holds.** The 8 latest runs are all `failure` with `attempt` 1.
- **Stage 3 anchors: hold.**
  - `code-patterns.md:97` (first Tests bullet).
  - `styleguide.md:7` (the "Checks before a commit" line, with its stale "Only one checkout" sentence).
  - `styleguide.md:27` (the Tests bullet) and `:30` (§ Avoid).
  - The `CLAUDE.md` "Shared runtime" bullet.
- **Limen commands: hold.** `ticket new --lane`, `spawn --timeout`, `land --keep-open` and `continue` all exist.

## Checks run
- `bun install --frozen-lockfile`: OK.
- 1.3.14 run and local run of the four test files: 40/5 and 45/0, as above.
- AgentMail probe: plan text fails, `ensureInbox` variant passes; typecheck and eslint clean.
- STARTTLS probe: 9/9 with the SAN, 7/2 without.
- Scheduler probe: 2/2 on 1.3.14.
- bunx child version, gh `attempt` field, `gh run list` for CI history, image-check command.
- `git status --short` at the end: empty.

## Note check
- Review covers ticket.md, plan.md, questions.md and the 3 stage files at HEAD 7d240f0: proven. `/tmp/f093-review/head.txt` holds 7d240f08f5862689b557cb72bc0c2407b0b79b7f. I read all six files in this session (findings quote their lines).
- Plan facts checked against fake.ts, smtp-starttls.test.ts, scheduler.test.ts, ci.yml and package.json: proven. `/tmp/f093-review/pin.log` and `/tmp/f093-review/local.log` hold the test runs. The probe results are in "Facts checked" above.
- Each finding has file:line and a severity, and the first line is PASS/FAIL <sha>: proven. This final message is the evidence.
- Easy-to-miss rule "Review; do not rewrite the candidate": followed. `/tmp/f093-review/status.txt` is 0 bytes (`git status --short` after I removed the probe files).
