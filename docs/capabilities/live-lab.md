# Live lab

> Checked against the code at `f9bb9662`, 2026-11-15.

## What it does now

The live lab plays the frozen week of made-up mail (`lab-01`) through the real pipeline on a separate sim stack (ADR 0021). Today the code has the guard, the run plan, the state files and the `lab` CLI frame: `start`, `status` and `stop` work; `seed`, `reset`, `serve`, `score` and the demo commands exit 1 with `not built` until their stages land. A run belongs to one lab organization (`lab` or `demo`). `start` plans the run, clamps its cost cap to what is left of the month budget, and writes the run folder under `LAB_STATE_DIR`. `status` prints the counts of each run. `stop` ends a run and writes one spend line in the ledger. The lab sends no mail and no tap to a real person: every command refuses on an env that is not the sim stack.

## Rules

1. **Env guard.** Every `bun run lab` command except `demo-import` first runs `checkSimEnv` with the scenario addresses (`labAddresses`). Any issue code exits 1 with the codes and no change on disk. The codes are in `packages/core/src/sim/live/env-guard.ts`.
2. **Run plan.** `planLiveRun` shifts the week by whole weeks and keeps the Warsaw wall time of each slot. A `week` run starts on a Monday (`not_monday`), a run that crosses a DST change is refused (`dst_change`), a bad date is `bad_date`. The default `--date` is tomorrow in Warsaw; for `week` it is the next Monday. The run id is `<day|week>-<YYYYMMDD>-<4 hex>`.
3. **Start checks**, in this order; the first failure exits 1 and writes nothing:
   1. `not_seeded`: the org is not in `orgs.json`.
   2. `cap_too_high`: `--cap-usd` is above the default of the mode ($1 for `day`, $5 for `week`).
   3. the run plan refusals of rule 2.
   4. `month_cap`: the cap left is zero or less (rule 4).
   5. `model_unpriced`: a model the lab roles call (every role but `judge`) has no price in `llmPrices`. A call with no price would count $0 toward the cap, so the stack is refused.
   6. `org_not_fresh`: the org already holds mail and `--reuse` is not set. A run on a used org mixes the metrics of two runs; `lab reset` (not built) makes a fresh org.
   7. `run_active`: the org has an active run. The lock is taken before any file is written, so a refused start leaves no run folder.
4. **Cap.** `capFor(request)` = `min(request, 20 − spend of the month in the ledger − caps of the active runs)`, never below 0 (`runCap` of `apps/server/src/platform/eval-ledger.ts`). The ledger gets a line only when a run ends, so the cap of an active run counts as spent. The ledger is `<LAB_STATE_DIR>/eval-spend.jsonl`.
5. **Run spend.** `runSpend` sums the run organization's `llm.call` rows from the start of the plan, priced with `costPerMail`. A row whose model has no price makes the result `unpriced` (never $0); the priced part is a lower bound. The serve loop (not built) stops such a run with `error:unpriced`.
6. **Stop.** `stop --run <id>` writes `stopped: operator` (the only writer of `stopped` is `stopRun`), frees the org lock, and writes one ledger line with the run spend. A second `stop`, or a ledger line that exists already for the run id, adds no second line.
7. **Status.** One line per run: org, cap, planned, injected, late, replies, taps, skips, spend and the stop reason. The serve heartbeat comes with the serve loop.

## Entry points

| Kind     | Name                                                                           | Where                                      |
| -------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| CLI      | `bun run lab start`, `status`, `stop` (the other commands exit 1: `not built`) | `apps/server/src/scripts/lab.ts`           |
| CLI      | argument parser and the 10 usage lines                                         | `apps/server/src/scripts/lab-args.ts`      |
| function | command dispatch with the env guard                                            | `apps/server/src/scripts/lab-run.ts`       |
| function | `startLabRun`, `stopLabRun`, `writeRunLedgerLine`                              | `apps/server/src/modules/lab/start.ts`     |
| function | `runSpend`                                                                     | `apps/server/src/modules/lab/run-spend.ts` |
| function | run state, locks and `capFor`                                                  | `apps/server/src/modules/lab/state.ts`     |
| function | `checkSimEnv`, `planLiveRun`                                                   | `packages/core/src/sim/live/env-guard.ts`  |

## Data

Files under `LAB_STATE_DIR` (an absolute path): `orgs.json`, `runs/<runId>/run.json`, `runs/<runId>/events.jsonl`, `locks/<org>.lock`, `eval-spend.jsonl`. Events hold ids, codes and counts only. The lab reads the `llm.call` rows of `audit_log` and counts the rows of `emails`; it writes no table.

## Limits

- Seed, reset, injector, bots, executive, serve loop, scorer and the demo commands: F113 stages 06 to 15 (`bun run lab` exits 1 with `not built`).
- The month cap is checked at `start` only. Two `start` calls for two orgs at the same moment can both read the same state. Stage 11 (F113) stops a run at its own cap.
- The ledger is per machine: offline evals on another machine use their own file.
- The sim stack files and `lab:env-check` come with F113 stage 03.

## Decisions

ADR 0021 (simulator stack). F113 decisions: caps $1 a day run, $5 a week run, $20 a month (PD-023); one active run per org; each measured run on a fresh org.

## Tests

- `apps/server/src/scripts/lab-args.test.ts`
- `apps/server/src/scripts/lab-run.test.ts`
- `apps/server/src/modules/lab/state.test.ts`
- `apps/server/test/integration/lab-run-spend.test.ts`
