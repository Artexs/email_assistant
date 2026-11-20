# F154 plan — core functions with 5 or more surviving mutants get tests that kill them

> **Status 2026-11-20 — planned.** Plan base: a5399ff1. Eighteen stages: 01; then 02–17 in parallel; 18 last.

Source: `spec/features/active/F125-…/audit/report.md` § 4 and `audit/review-core-web-tools.md` § GAP (122 functions, 1,257 mutants; audit run at `4ce3f351`).

## Input

Owner words (ticket): "The 122 functions with 5 or more surviving mutants get cases that fail when the code breaks, starting with the 10 largest, and a mutation rerun shows the survivors fall." Out of scope: "A change of product code to make a mutant easier to kill."

### Product and scope

- **P1 All 122 functions are planned** (default, owner to confirm; `questions.md` Q1). The outcome names 122; the acceptance names the top 10 (stages 02–10). Rejected: only the top 10 (the outcome would stay false).
- **P2 No product code changes.** Tests only, plus the stage 01 tool. A private helper is tested through the exported caller that each stage table names (column "Through"). Never export a helper for a test. Rejected: export helpers (a product change).
- **P3 A bug is not pinned.** A surviving mutant that shows wrong current code gets no case that pins the wrong output; the worker lists it under "Bugs" in the results file and the final message; the coordinator opens a ticket. Rejected: fix it in the stage.

### Design

- **D1 Function attribution.** A mutant belongs to the innermost named function: a declaration, a method, or an arrow or function expression whose parent is a variable or a property. An anonymous callback passes up. With none: `(module level)`. This short name is the audit form. The row id is the short name when unique in the file; else the dotted chain of named ancestors, outermost first (`en.followUp.rejected`), plus `@<start line>` if it still repeats. Probe on the audit run (`/tmp/f125-s03/run-4/mutation.json`) by short name: 122 functions, 1,260 mutants (3 more than the audit: unstable mutants, not checked one by one).
- **D2 Counted statuses.** `Survived` and `NoCoverage`; no other.
- **D3 Per-stage measure.** Each stage measures its own files before and after with `--mutate` globs (the audit data is stale for some files). Only stage 18 runs all of core.
- **D4 One mutation run at a time.** `mutation.sh` takes a `flock` around Stryker (stage 01): it runs at concurrency 8 (`notes/2026-11-20-test-cpu-load.md`).
- **D5 Target per function.** Every listed function must fall (ticket acceptance). After the stage it has fewer than 5 counted mutants, or each remaining one is listed by its key (file, line, column, mutator, replacement) with a class — `equivalent` (no input changes the output), `unreachable`, `bug` (P3), `unstable` — and a one-line reason. Cap: at most 3 `equivalent` plus `unreachable` per function and 10 per stage; above it the stage stops and asks. These rows go under "Self-classed" in the results file, for the coordinator's spot-check.
- **D6 Every new case kills a survivor.** Each new case or `test.each` row kills at least one mutant that was `Survived` or `NoCoverage` before and is `Killed` after (D5 key). `mutation-gaps.ts --before/--after` exits 1 otherwise. This is the ticket's "fails when its function is broken once".
- **D7 Test rules.** `docs/code-patterns.md` § Tests: one named behaviour, an exact expected value, `test.each` for repeated shapes. A string-literal mutant dies by an exact text or issue `{ path, message }`, never by `toContain`.
- **D8 Test file.** Cases go into the `<source>.test.ts` next to the source; the stage creates it when missing. Two parallel stages never write one file: stage 07 writes `triage/suspicious-auth.test.ts` (stage 06 owns `suspicious.test.ts`); stage 05 owns `texts/approvals.test.ts`; stage 13 owns `texts/notices.test.ts`, `texts/minimal.test.ts`, `texts/loop-taps.test.ts` and `texts/bot.test.ts`. No stage edits `texts/index.test.ts`.
- **D9 Moved code.** A GAP function renamed, moved or split at `HEAD` (for example `texts/bot.ts`) is followed by behaviour under its new name. A function gone at `HEAD` gets `gone` in the results file.
- **D10 Results file.** Each stage commits `results/stage-NN.md` in this ticket folder: the `--before/--after` output, the D5 "Self-classed" rows, and "Bugs". It is the acceptance evidence.
- **D11 Score check** (default, owner to confirm; Q2). Stage 18 compares the full-run score with 86.45 %. A drop in files no stage of this ticket touched is recorded; the coordinator opens a follow-up; this ticket does not fail for it.

## Facts checked

- `mutation.json` holds `files[path].source`, mutant `location.start` (1-based), `status`, `killedBy`, and `testFiles[path].tests[]` with `id` and `name` (read 2026-11-20 from the audit run).
- A full default run of `packages/core` took 19 min 42 s (same run's `mutation.log`).
- `disableBail: true` in `mutation.sh`, so `killedBy` lists every killing test (D6 relies on it).
- `check:job` runs the bare-code scan (`apps/server/src/bare-codes.test.ts`). It reads comments of every `.ts` file, tests included, and strings of non-test files.

## Not verified

- The time of a `--mutate` run of one or two files. Stage 01 records it in its results file.

## Done when

1. `results/stage-02.md` … `results/stage-17.md` exist; each shows fewer counted mutants in every listed function and meets D5.
2. Each stage's new-case table shows no case with 0 kills of a before-survivor (D6).
3. `results/final.md` (stage 18) lists all 122 functions with the audit count and the final count, and the core score ≥ 86.45 % or the D11 record.

## Rules for every stage

- Change no file under `packages/core/src` except `*.test.ts`. A changed source file fails the stage.
- Mutation runs go to `/tmp/f154-sNN/`, only through `mutation.sh`.
- Do not run `test:unit` or `test:int`; run one file with `bun test <file>` (`.agents/limen/reminders.md`).
- Expected values come from the planner's reading or probe at `a5399ff1`. Another value at `HEAD`: after a code change since then → use it and note it; else a question (P3 or a plan error).
- "The code's result at `HEAD`" in a stage means: pin the current exact value, after a check that it is not a P3 bug.
- No plan code in code, comments, strings or test names: no `D5`, `P2`, `stage 3`, `F154`, `review 1`, `PD-012`. Name the rule in words. `check:job` runs the bare-code scan and fails on them.
- A gap in a decision is a question in the final message, not a choice.
- Format only the stage's files.

## Stage method (stages 02–17)

1. Before any edit: `bash scripts/test-audit/mutation.sh /tmp/f154-sNN/before --mutate '<glob>'…` (globs relative to `packages/core`, for example `src/replies/schema.ts`).
2. `bun scripts/test-audit/mutation-gaps.ts --in /tmp/f154-sNN/before/mutation.json --min 1`; read the mutants of the listed functions.
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

- Scouts: 0 (the job task forbade waiting on jobs); the planner read the code and ran probes itself. All 18 stages written.

## Cold review

Model `claude-sonnet-5-5` (no `[risky]` stage, no risk area). PASS at `73dab91b`, 11 notes (`plan-review-1.md`). Fixed 1–8 and 11 (stage 12 values, Through columns, D5 cap, D6 survivors, bare-code rule, D1 ids, D8 files, `sentLabelSchema`, lock wait budget). Note 9: D1 softened. Note 10: no change.

## Log

- 2026-11-20 plan written at `a5399ff1`; review 1 fixes after it. `wc -w` limits hold.
