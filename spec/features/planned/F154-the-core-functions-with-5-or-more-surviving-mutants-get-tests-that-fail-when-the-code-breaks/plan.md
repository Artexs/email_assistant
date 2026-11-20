# F154 plan — core functions with 5 or more surviving mutants get tests that kill them

> **Status 2026-11-20 — planned.** Plan base: a5399ff1. Eighteen stages: 01 first; 02–17 next to each other (each needs only stage 01); 18 last.

Source: `spec/features/active/F125-…/audit/report.md` § 4 and `audit/review-core-web-tools.md` § GAP (122 functions, 1,257 mutants; audit run at `4ce3f351`).

## Input

Owner words (ticket): "The 122 functions with 5 or more surviving mutants get cases that fail when the code breaks, starting with the 10 largest, and a mutation rerun shows the survivors fall." Out of scope: "Mutation runs outside `packages/core`." and "A change of product code to make a mutant easier to kill." Acceptance: the four lines of `ticket.md` § Acceptance.

### Product and scope

- **P1 All 122 functions are planned** (default, owner to confirm; `questions.md` Q1). The outcome names 122; the acceptance names the top 10. Stages 02–10 hold the top 10; stages 11–17 hold the rest. Rejected: plan only the top 10 (the outcome would stay false).
- **P2 No product code changes.** Tests only, plus the audit tool of stage 01. A private helper (`ipv4Allowed`, `isOneEditApart`, `deobfuscate`) is tested through the exported function that calls it. Never export a helper for a test. Rejected: export helpers (a product change the ticket forbids).
- **P3 A bug is not pinned.** When a surviving mutant shows that the current code is wrong, the worker writes no case that pins the wrong output. The worker lists it under "Bugs" in the stage results file and in the final message. The coordinator opens a ticket. Rejected: fix it in the stage (product change).

### Design

- **D1 Function attribution.** A mutant belongs to the innermost enclosing named function: a function declaration, a method, or an arrow or function expression whose direct parent is a variable declaration or a property assignment. An anonymous callback (`.map(…)`, `.superRefine(…)`) passes up. With none: `(module level)`. Probe 2026-11-20 on the audit run (`/tmp/f125-s03/run-4/mutation.json`): 122 functions, 1,260 mutants (the audit's 1,257 plus 3 unstable ones). Rejected: manual reading (workers would not agree).
- **D2 Counted statuses.** `Survived` and `NoCoverage` count. `Timeout`, `Killed`, `Ignored`, `CompileError`, `RuntimeError` do not.
- **D3 Per-stage measure.** Each stage measures its own source files before and after, with `--mutate` globs, at its own commit (the audit data is stale for some files). The full run is stage 18 only.
- **D4 One mutation run at a time.** `mutation.sh` takes `flock /tmp/email-assistant-mutation.lock` around Stryker (stage 01): Stryker runs at concurrency 8, and parallel runs overload the seat (`notes/2026-11-20-test-cpu-load.md`).
- **D5 Target per function.** After the stage, each listed function has fewer than 5 counted mutants, or each remaining one is listed in the results file with one class: `equivalent` (no input changes the output; one-line reason), `unreachable` (no input reaches it; one-line reason), `bug` (P3), `unstable` (status changes between runs). A function that falls but stays at 5 or more with an unlisted survivor fails the stage.
- **D6 Every new case kills.** Each new case or `test.each` row kills at least one mutant in the after run (`mutation-gaps.ts --before/--after` exits 1 otherwise). This is the ticket's "fails when its function is broken once".
- **D7 Test rules.** `docs/code-patterns.md` § Tests: one named behaviour, exact expected value (`toBe`, `toEqual`, exact issue list), `test.each` for repeated shapes. A string-literal mutant is killed by an exact text or an exact issue `{ path, message }`, never by `toContain` of a fragment the mutant keeps.
- **D8 Test file.** Cases go into the existing `*.test.ts` next to the source. Exception: stage 07 writes `triage/suspicious-auth.test.ts`, because stage 06 edits `triage/suspicious.test.ts` at the same time.
- **D9 Moved code.** When a function from the GAP list is renamed, moved or split at `HEAD` (for example `texts/bot.ts` was split after the audit), the stage follows the code by behaviour and records the new name. A function gone at `HEAD` gets the line `gone` in the results file.
- **D10 Results file.** Each stage commits `results/stage-NN.md` in this ticket folder: the `--before/--after` output (per-function table and new-case kill table), the remaining-mutant classes of D5, and "Bugs". It is the acceptance evidence.
- **D11 Score check** (default, owner to confirm; Q2). Stage 18 compares the full-run score with 86.45 %. When the score falls and the drop is in files that no F154 stage touched (new code from other tickets), stage 18 records the files and the coordinator opens a follow-up. It does not fail F154 for code F154 did not touch.

## Facts checked

- `mutation.json` of the Bun Stryker runner holds `files[path].source`, `files[path].mutants[].location.start` (1-based line and column), `status`, `killedBy` and `testFiles[path].tests[]` with `id` and `name` (read 2026-11-20 from `/tmp/f125-s03/run-4/mutation.json`).
- A full default run of `packages/core` took 19 min 42 s (same run's `mutation.log`).
- `disableBail: true` in `mutation.sh`, so `killedBy` lists every killing test (D6 relies on it).

## Not verified

- The time of a `--mutate` run of one or two files. Stage 01 records it in its results file.

## Done when

1. `results/stage-02.md` … `results/stage-17.md` exist; each shows fewer counted mutants in every listed function and meets D5.
2. Each stage's new-case table shows no case with 0 kills.
3. `results/final.md` (stage 18) lists all 122 functions with the audit count and the final count, and the core score ≥ 86.45 % or the D11 record.

## Rules for every stage

- Work method: `## Stage method` below. Read `docs/code-patterns.md` § Tests first.
- Change no file under `packages/core/src` except `*.test.ts`. A changed source file fails the stage.
- Run each mutation run in `/tmp/f154-sNN/`. Never run it outside `mutation.sh`.
- Do not run `test:unit` or `test:int`; run one file with `bun test <file>` (`.agents/limen/reminders.md`).
- A stage's expected values come from the planner's reading or probe at `a5399ff1`. When the code at `HEAD` gives another value: a code change since the plan base → use the `HEAD` value and note it in the results file; no such change → P3 (a bug or a plan error), a question in the final message.
- "The code's result at `HEAD`" in a stage means: pin the current exact value, after a check that it is not a P3 bug.
- A gap in a decision is a question in the final message, not a choice.
- Format only the stage's files.

## Stage method (stages 02–17)

1. Before any edit: `bash scripts/test-audit/mutation.sh /tmp/f154-sNN/before --mutate '<glob>'…` with the stage's source files (globs relative to `packages/core`, for example `src/replies/schema.ts`).
2. `bun scripts/test-audit/mutation-gaps.ts --in /tmp/f154-sNN/before/mutation.json --min 1` lists every counted mutant per function. Read the mutants of the listed functions.
3. Write the cases. Check each with `bun test <file>`.
4. After: the same `mutation.sh` command into `/tmp/f154-sNN/after`.
5. `bun scripts/test-audit/mutation-gaps.ts --before …/before/mutation.json --after …/after/mutation.json > /tmp/f154-sNN/gaps.md`; fix until D5 and D6 hold; write `results/stage-NN.md` (D10).

## Proof

Last step of each stage: `bun run check:job`. The final message copies its last line and points to `results/stage-NN.md`.

## Review

No `[risky]` stage. Stage 01 (a tool other stages rely on) gets a review job before its land, model `claude-sonnet-5-5`. Stages 02–18 land on the worker's proof and results file.

## Owner checkpoints and steps

None.

## Stages

- [ ] 01 [gap tool and run lock](stages/stage-01-gap-tool.md)
- [ ] 02 [replies schema and views](stages/stage-02-replies.md)
- [ ] 03 [sim checks](stages/stage-03-sim-checks.md)
- [ ] 04 [sim slot schemas](stages/stage-04-sim-slots.md)
- [ ] 05 [approval cards](stages/stage-05-approvals.md)
- [ ] 06 [look-alike domains](stages/stage-06-suspicious-lookalike.md)
- [ ] 07 [auth results and DKIM](stages/stage-07-suspicious-auth.md)
- [ ] 08 [testmail](stages/stage-08-testmail.md)
- [ ] 09 [public content](stages/stage-09-public-content.md)
- [ ] 10 [changelog and web forms](stages/stage-10-changelog-web.md)
- [ ] 11 [digest render](stages/stage-11-digest.md)
- [ ] 12 [notices and weekly](stages/stage-12-notices.md)
- [ ] 13 [texts](stages/stage-13-texts.md)
- [ ] 14 [triage rest, contacts, providers](stages/stage-14-triage-contacts.md)
- [ ] 15 [loops and outgoing](stages/stage-15-loops-outgoing.md)
- [ ] 16 [sim support](stages/stage-16-sim-support.md)
- [ ] 17 [sim live](stages/stage-17-sim-live.md)
- [ ] 18 [full run and final table](stages/stage-18-full-run.md)

## How to run (coordinator)

Move the ticket to `active/` and commit. Spawn 01; land it after its review. Then spawn 02–17 as seats allow: no shared source or test file (D8); the lock (D4) queues their runs. Spawn 18 after 02–17 land.

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F154" \
  'Implement F154 stage NN. Read spec/features/active/F154-…/ticket.md, plan.md and stages/stage-NN-<slug>.md. Last step: bun run check:job.'
```

## Planning progress

- Scouts: 0. The job task said "Do not use limen wait or any tool that waits for another job"; the planner read the audit and the code at `a5399ff1` and ran the probes itself.
- All 18 stage files written. Words: see § Log.

## Cold review

Model `claude-sonnet-5-5`: no `[risky]` stage, no risk area of the board's review line (tests and an audit tool only). The job was started without a wait (job task rule); the coordinator files its message as `plan-review-1.md`.

## Log

- 2026-11-20 plan written at `a5399ff1`. `wc -w`: plan.md under 1,500; stage files 323–700.
