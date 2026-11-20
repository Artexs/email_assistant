# F155 plan — behaviour tests replace six source-text pins

> **Status 2026-11-20 — planned.** Plan base: a5399ff1. Two stages; stage 02 waits for F147 stage 04.

## Input

Owner, F125 gate G1 answer (`spec/features/active/F125-…/audit/report.md` § 3, question 1), word for word: "keep the 4 capability-page pins (a behaviour change must update its capability page). Follow-up ticket: replace the `main.test.ts` and `composition.test.ts` source regexes with behaviour tests."

The six cases (names at HEAD; the audit line numbers drifted):

| # | File | Case |
|---|---|---|
| C1 | `main.test.ts` | the ops.slo job and the operator notices share one operator send |
| C2 | `main.test.ts` | main.ts and the job-run script call setLogRelease with the config value |
| C3 | `main.test.ts` | the ops.slo check list holds the disk and backup-age entries |
| C4 | `composition.test.ts` | scripts/job-run.ts: the committer deps get a token store |
| C5 | `composition.test.ts` | scripts/reply-check-copy.ts: the mailbox opener gets a token store |
| C6 | `composition.test.ts` | the web passes the gate to the one settings deps builder |

### Product decisions

- **P1** Scope is the six cases of the ticket. The other source pins of `composition.test.ts` and `start/jobs.test.ts` stay. Reason: the ticket and the audit rows name six; the owner's sentence is wider. Rejected: all source pins of both files (about 20 more cases, no audit row each). Default, owner to confirm (`questions.md` Q1).
- **P2** No start-up behaviour changes: the same jobs, schedules, order, log lines and sends. A new export only extracts code that exists.

### Design decisions

- **D1** Each new case lives next to the code it checks. C1 and C3 go to a new `apps/server/src/start/operator.test.ts`. C4–C6 stay in `composition.test.ts`. C2 splits: the `main.ts` half stays in `main.test.ts`; the job-run half goes to `apps/server/test/integration/job-run-cli.test.ts`. The old cases are deleted. Rejected: keep all in `main.test.ts` (that file tests the process).
- **D2** C2 runs the real entry points and reads their JSON log lines. Reason: a unit test of a shared helper does not fail when an entry point stops calling it. Rejected: a new `initLogging(config)` helper (audit proposal).
- **D3** The job-run half of C2 runs `--name platform.retention`. Reason: job-run writes no JSON line before the DB answers, and retention always writes `retention_done`. The int suite already runs retention (`retention-job.test.ts`). Rejected: a unit spawn with an unreachable DB (no JSON line).
- **D4** C4 and C5 get one exported deps builder in each script: `jobRunCommitterDeps(config: Config, db: Db): CommitterDeps` in `scripts/job-run.ts`, and `checkCopyOpenDeps(config: Config, db: Db): OpenDeps` in `scripts/reply-check-copy.ts`. The script's `main` uses the builder's result unchanged. Reason: the callers-list case in `composition.test.ts` ("no other file builds a sync job or committer deps…") stays true with no edit. Rejected: builders in `composition.ts` (changes that list).
- **D5** C6 needs no new code: `settingsRouteDeps(...)` returns `settings`, and its `gate` must be the gate passed in.
- **D6** C1 and C3 get one pure builder in `start/operator.ts`: `operatorWiring(ctx: StartContext, io?: OperatorIo)` returns `{ delivery, notices, sloTick }`. `notices` is the `OperatorNoticeDeps` that `createOperatorNotices` gets; `sloTick` is the `SloTickDeps` that the `ops.slo` tick gets; `delivery` is the one `OperatorDelivery` of F147 stage 04. `OperatorIo` is `{ statfs; readFile }`, default the `node:fs/promises` functions. `startOperator` calls it and keeps the `scheduler.add(...)`, `runs.track(...)` calls and the start log line. Reason: `start/jobs.test.ts` reads those call texts. Rejected: test-only parameters for `createOperatorNotices` and `runSloTick`; `mock.module` (it leaks across files in one Bun process).
- **D7** Shared means the same object: `toBe`. One case also delivers a text through it to a fake `late.telegram`.
- **D8** Every new case is broken once: the worker removes its wiring line, runs `bun test <file>`, sees the failure and restores the line. The final message lists each case and the line removed.
- **D9** Each new case reads no source file: no `readFileSync`, `startSource`, `callOf` or `Bun.file` on a `.ts` file. Unused imports go (`main.test.ts` loses `startSource` and `readFileSync`). The `startSource` helper and `read`/`callOf` stay: other cases use them.
- **D10** No capability page changes (P2: no behaviour change).

### Edge cases

- A spawned `main.ts` loads `.env` from its working folder: the test runs it in `tmpdir()` with an env built from scratch (D2).
- Without an operator chat, the delivery has no send and counts as delivered: case 2.3 checks this.
- The telegram runtime is set after the operator start (`late.telegram`): the builder must read it at send time, not at build time (case 2.2 sets it after the build).

## Facts checked (2026-11-20, HEAD a5399ff1)

- A spawned `main.ts` with only `PATH`, `DATABASE_URL=postgres://app:x@127.0.0.1:1/x`, `CREDENTIALS_KEY` (32 bytes of 1), `EA_RELEASE=f155-r1`, `LOG_FORMAT=json` exits 1. Stdout holds a `features_off` line and stderr a `db_role_check_failed` line, both with `"release":"f155-r1"` (local probe).
- `scripts/job-run.ts` sets the release before the DB; it writes no log line before the DB answers (read).
- `createOAuthTokens` touches the DB only on a token call, so a builder with `{} as never` as the DB works (read: `modules/mail/oauth/tokens.ts`).
- `OpenDeps` is exported from `modules/mail`; `oauthTokens` is optional there and required in the input of `committerDeps` (read).
- F147 stage 04 (not landed) changes `OperatorNoticeDeps` and `SloTickDeps` to take `delivery`, and edits C1 (read: its stage file).

## Not verified

- The exact shape of `OperatorDelivery` after F147 stage 04 lands. Stage 02 reads it at HEAD; a different shape is a question, not a choice.

## Done when

- The ticket's three acceptance lines hold.
- `bun run check:job` passes on each stage branch.

## Rules for every stage

- A gap or a deviation from a decision is a question in the final message, not a choice.
- Format only the files of the stage. No `--no-verify`.
- Tests follow `docs/code-patterns.md` § Tests: exact values, one behaviour per case.
- While working, run only the changed test files with `bun test <file>`.

## Proof

The last step of each stage is `bun run check:job`; the final message copies its last line.

## Review

- Stage 01: no review (tests and two extracted builders).
- Stage 02: a review before the land, `claude-opus-5-5`: it moves the wiring of the operator send (sending to people).

## Stages

- [ ] [stage 01 — CLI and web wiring, release stamp](stages/stage-01-cli-web-release.md) (C2, C4, C5, C6)
- [ ] [stage 02 — operator wiring](stages/stage-02-operator-wiring.md) (C1, C3)

## How to run (coordinator)

Move the ticket to `active/` and commit. Spawn stage 01 now; spawn stage 02 when F147 stage 04 is on master. Both may run at the same time once Needs are met; both may edit `main.test.ts` (merge master, re-prove). Board worker model, `--prepare 'bash scripts/limen-prepare.sh'`, text `Implement F155 stage NN. Read ticket.md, plan.md and stages/stage-NN-<slug>.md. Final proof: plan.md § Proof.` Drop the job DB after each land.

## Planning progress

- Scouts: 0. The job task forbade any tool that waits for another job; the planner read the code itself.
- [written] ticket.md § Slices, § Sequenced; plan.md; stage 01; stage 02; questions.md.
- Word counts (`wc -w`, before the review): ticket.md 277, plan.md 1181, stage 01 506, stage 02 547.

## Cold review

Model: `claude-opus-5-5` at `high`, because stage 02 moves the wiring of the operator send (sending to people, a risk area of `spec/build.md` TRACK). The job task forbade any tool that waits for another job, so the planner started the review detached and did not wait for it. Review job: `2026-11-20-f155-plan-review-1c257442` (on this branch, at commit `363e0264`). `plan-review-1.md` does not exist yet: the coordinator files the review's final message there and continues this job to fix the findings (one round).
