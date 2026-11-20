FAIL 57391e9fb56abe059d12a240c4ce47c6640b6539

This is a cold review of refresh 1 of the F151 plan. The plan makes the demo video and the docs shots from the synthetic demo-week export. HEAD is `57391e9fb`, the same as the candidate. The commit changes only files in the F151 plan folder. I reviewed stages 05–07 and decisions D10, D12, D13, C1a and C3 against the code at the tip. The trial-seed idea is sound: `planDemoRun` has no day rule, the seed carries `day`, and the import replaces an earlier one. One rule conflict is blocking. It makes the owner's upload gate text false.

## Blocking

**B1 · The "last line" upload rule cannot hold where stage 06 prints the verdict (proven by reading the plan and the landed code; not run).**
- **Plan, rule 1:** `stages/stage-06-demo-recording.md:29` says `uploadVerdict` "prints after the hashes, before the stage-04 exits".
- **Plan, rule 2:** `stage-06:44` (test 2) says "on a trial seed the last line is `not for upload: trial_seed`". `stages/stage-07-shots-docs-gates.md:22` writes into the release checklist: "upload only a run whose last line is `demo_source demo: upload candidate`".
- **Code:** `apps/web/e2e/demo/record.ts:164-180` prints the hashes and calls `videoProblem` inside `recordSteps`. After that returns, `closeReplay` (`record.ts:96`, `:105-108`) prints `demo_replay hits=… misses=…` and `demo_gate final|provisional`, then the miss and unused exits. If a worker follows rule 1, the last line of every demo-source run is `demo_gate …`. Test 2 then fails on a trial seed, and the owner gate text of acceptance bullet 6 is never true.
- **A guess makes it worse:** a worker who moves the verdict to the end to satisfy rule 2 prints it after `video_length …`, `demo_replay_unused` or `demo_llm_unchecked`. The verdict inputs (`source, seedDay, gateProvisional, misses, notLive`) do not hold the video limits or the model check. So a run that exits 1 can end with `demo_source demo: upload candidate`.
- **Fix (one decision in D10 and stage 06):**
  - The verdict is the last stdout line of every run.
  - It reads the run result: exit code, video limits and `demo_llm_checked`. A failed run prints `not for upload: run_failed`, or no candidate line.
  - `demo_replay`, `demo_gate`, `demo_seed_day` and `demo_llm_checked` print before it.
  - Add a `test.each` row in which a failed run with otherwise perfect inputs gives no candidate.
  - Say also whether the old `demo_source e2e: not for upload` line (`record.ts:178`) stays beside `not for upload: e2e_source` (`stage-06:45`).

## Findings (not blocking)

**F1 · The ticket and the board still gate stages 05–07 on the day-5 export (proven text drift; coordinator edit).**
- `ticket.md:41` says: "Gate: the C1 demo-week export at `…/demo-seed-day5.json` … for stages 05–07 only".
- `ticket.md:36` says "05–07 need the C1 export".
- `spec/build.md:33` says "05 (needs the C1 export)".
- D12 (`plan.md:31`), § How to run (`plan.md:87`) and the stage Needs lines say C1a, a trial export, is enough.
- A coordinator who reads the `Build after:` gate holds stages 05–07 until after 2026-11-27T23:00Z, and the refresh goal is lost.
- The refresh rule forbids edits to `ticket.md`, but `plan-refresh-1.md` does not name the edit for the coordinator. Proposed text: "Gate: an export of run day 1 or later (C1a) for stages 05–07; the day-5 export (C1) only for the final take (C3)."

**F2 · Pre-mortem: the final take has no owner and no failure path (proven gap in the plan text).**
- C3 (`plan.md:66`) and D13 (`plan.md:32`) move the day-5 runs to "a follow-up ticket". No such ticket exists in `spec/features/planned` or `active`. The plan has no ticket text and does not say who opens it or when.
- § How to run (`plan.md:87`) closes F151 at the last land, then runs C2, which drops `f121_demo`.
- C3 says only "run the stage 06 and 07 Proof commands; update …". It has no rule for a refusal, a new not-live step, a `demo_wait_timeout` or a `publicContentScan` hit on the day-5 data.
- This matters because the day-5 seed is the first one with mailbox A in `assist` after day 4 (`apps/server/src/modules/lab/serve-parts.ts:66-72`). The lab executive also taps Telegram cards (`apps/server/src/modules/lab/executive.ts`), so A can carry `auto` grants. Two paths then run for the first time in C3:
  - the "turn `auto` off" step (`stage-05:24`, "A trial seed may have none");
  - the re-gate that sends `autonomy_paused`.
- The `@setup` check "no `auto` category" (`stage-05:37`) is passive on a trial seed: it passes because there is nothing to remove.
- **Fix:**
  - (a) Write the follow-up ticket now, or tell the coordinator to open it at close. Its scope: the day-5 take, the stop-and-ask rules of `stage-06:38` applied to it, and a new `*_demo` database.
  - (b) Add a test of the auto-off path in stage 05: a copy of the trial seed in a temp folder with one `auto` category on A's `mailbox_settings`, run through `--setup-only`. Then the code runs before F151 closes.

**F3 · The final-seed mark rests only on the seed's `day` field, and the export does not check that the day has ended (proven code fact; plausible risk).**
- `exportDemo` writes `day` and refuses no day that has not ended (`apps/server/src/modules/lab/demo-seed/export.ts:85-89`, `:130`). The plan says so itself (`plan.md:42`).
- C1a (`plan.md:64`) says "of the newest run day", not "of the newest ended run day".
- `uploadVerdict` (`stage-06:29`) treats any `day ≥ 5` as final. So a `--day 5` export taken during day 5 becomes an upload candidate on partial data.
- The seed holds `exportedAt`, but no start date to compare it with, and export changes are out of scope.
- **Fix:** write "newest ended day" in C1a. Name the procedural guard in D12: C1's time, and the owner check at G3.

**F4 · D10 and stage 06 disagree on which day counts as final (proven wording conflict, small).**
- D10 (`plan.md:29`) says "a day-5 seed", and stage 07 (`:31`) says "the day-5 export".
- `uploadVerdict` (`stage-06:29`) says "day ≥ 5", so days 6 and 7 pass, and `parseDemoSeed` accepts days up to 7 (`format.ts:39`).
- Pick one rule and say it in D10.

**F5 · A trial seed can make the worker change the demo alt text in the wrong direction (plausible).**
- `stage-07` step 1 says "fix only an alt text that is now false".
- The demo `activity` alt text says "the demo mail that the assistant sorted" (`apps/docs/src/shots.ts:86-90`). On a day 1–3 shadow seed, the assistant sorted nothing. It only shows what it would do.
- A stage 07 worker on a trial seed can rewrite the text for shadow mode. That text is false for the day-5 seed and for G2.
- **Fix:** add a rule to D13 that alt texts and captions describe the day-5 seed, and that a trial-only difference is noted but not fixed.

**F6 · D8's primary path is dead on the day-5 seed too (proven by code; plan fact incomplete).**
- `plan.md:42` says "Days 1–3 are shadow, so a trial seed gives `overdueDelegation` null".
- The lab switches A to assist with `keepSwitches: false` (`serve-parts.ts:71`). No lab code sets `create_draft`: a grep of `modules/lab` finds it only in `tables.ts`. `overdueOf` returns null unless `create_draft` is true (`apps/web/e2e/lib/demo/run-plan.ts:127`).
- So step 7 takes the fallback on every seed of this run. Trial and final do not differ here, and the "Remind now on an imported delegation" branch (`stage-06` step 7) has no seed that tests it.
- **Fix:** write this in the plan facts, so that no worker builds or proves a branch that cannot run.

**F7 · The day-5 take depends on two things that the trial does not pin (plausible).**
- Production prompt: `prepareDemoRun` compares the seed with `prompts.classifier.version` at the checkout that runs (`apps/web/e2e/lib/demo/prepare.ts:225`). `classifier-v3` and `v4` exist (`apps/server/src/modules/triage/prompts/index.ts:58-72`). If master moves the pointer before C3, the final take refuses with `demo_prompt_mismatch` and the trial does not.
- Sim stack: no rule keeps the sim image and classifier fixed from 2026-11-23 to 2026-11-27 (`deploy/README.md:1158`, releases to the sim stack). A mid-week change gives `demo_seed_mixed_models` on day 5 only.
- **Fix:** C1a or C3 should state both conditions, or pin the checkout.

**F8 · Stage 06 holds pure work that waits for the export with no need (plausible size and order risk).**
- Stage 06 is at 699 of 700 words. It holds all eight live steps, two full recording runs (each with a test timeout of about 27 min from `demoTestTimeoutMs`, `apps/web/e2e/lib/demo/server-env.ts:77-81`), the stop-and-ask rule after two takes, the README column and capability rule 24.10.
- `uploadVerdict`, `seedDay`, the `demo_seed_day` line and the parse of the `llm_settings` lines are pure. They need no export.
- **Fix:** split them into their own stage, which can land now and also carries the B1 fix. That fits the refresh goal and makes stage 06 smaller.

## Checks run

- `git rev-parse HEAD` (a standalone call) printed `57391e9fb56abe059d12a240c4ce47c6640b6539`, the same as the candidate. `git show 57391e9fb --stat` lists only plan-folder files.
- `wc -w` (a standalone call) printed: plan.md 1487; stages 05, 06 and 07: 699, 699 and 671. All are within § Plan size.
- I read the code at the tip: `apps/web/e2e/demo/record.ts`, `apps/web/e2e/demo/global-setup.ts`, `apps/web/e2e/demo/demo.config.ts`, `apps/web/e2e/lib/demo/{run-plan,prepare,server-env,record-args}.ts`, `apps/web/e2e/lib/shot-source.ts`, `apps/web/e2e/docs-shots/*`, `apps/docs/src/shots.ts`, `modules/lab/demo-seed/export.ts`, `modules/lab/serve-parts.ts`, `modules/delegation/remind.ts`, `modules/trust/history-job.ts`, `tools/llm-replay/src/replay.ts`, `deploy/README.md` § Sim stack step 12, and `notes/2026-11-15-vps-deploy-queue.md` § Demo run for F151.
- No test suite, lint, typecheck or recording ran (review job rule). Every runtime result above is labelled plausible unless the code text alone settles it.

## Facts checked, no finding

- The run dates match the note: day 1 ends 2026-11-23T23:00Z, day 5 ends 2026-11-27T23:00Z, and assist starts on day 4.
- The seed carries `day` (`types.ts:12`, `format.ts:39`), so `DemoPrepared.seedDay` has a source that is not the file name.
- `setupDemoOrg` imports with replace. `planDemoRun` has no day rule.
- `llm_settings` is logged with `endpoint` and `host` (`apps/server/src/start/triage.ts:86`, `platform/llm/settings.ts:47-55`). Server output is piped to the Playwright runner (`apps/web/e2e/servers.ts:28-29`).
- `docs:build` follows `DEMO_SEED_FILE` through `shotSourceKind()` (`apps/docs/src/shots.ts:116`). So the stage 07 test 3 command works as written.

## Note check

- HEAD matches the candidate: proven. `git rev-parse HEAD` (a standalone call in this session; it printed 57391e9fb56abe059d12a240c4ce47c6640b6539).
- Stages 05–07 and D10, D12, D13, C1a and C3 were checked against the code at the tip, and each finding quotes file:line with a label: proven. The findings B1 and F1–F8 in this message are the evidence. The code reads are listed under Checks run.
- The trial and final split was checked for gaps, conflicts, worker guesses, unsourced facts and stage size: proven. Gaps: F2, F5, F6. Conflicts: B1, F1, F4. Worker guess: B1. Unsourced or unpinned facts: F3, F7. Size: F8. Word counts come from `wc -w spec/features/active/F151-the-demo-video-and-the-docs-screenshots-come-from-the-synthetic-demo-week-export/plan.md spec/features/active/F151-the-demo-video-and-the-docs-screenshots-come-from-the-synthetic-demo-week-export/stages/stage-05-demo-setup.md spec/features/active/F151-the-demo-video-and-the-docs-screenshots-come-from-the-synthetic-demo-week-export/stages/stage-06-demo-recording.md spec/features/active/F151-the-demo-video-and-the-docs-screenshots-come-from-the-synthetic-demo-week-export/stages/stage-07-shots-docs-gates.md`.
- Easy-to-miss rule ("missing code detail is not a finding"; "a review job runs no test suite, lint or typecheck"): followed. Each finding names a missing decision, test, interface or rule conflict, and none asks for line numbers or edit text. Only git, grep, sed, awk, cat, ls and wc ran.
- Reminder "tests run once per job; no test:unit, test:int or test:e2e": followed. No test command ran.
- Reminder "a product-code job runs check:job last": does not apply. This review made no commit.
- Reminder "a review job runs no suite, lint or typecheck": followed. None ran.
- Reminder "never delete node_modules/.cache": followed. This session did not touch it.
