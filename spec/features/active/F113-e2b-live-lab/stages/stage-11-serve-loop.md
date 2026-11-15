# F113 stage 11 — serve loop

Part of [`../plan.md`](../plan.md). Decisions D12, D13, D15. Review 1: B5, N8.

## Goal

`bun run lab serve` is the long-lived process of the `lab` service. It drives every active run until its tail ends, survives restarts, and stops a run at its cap.

## Files

`apps/server/src/modules/lab/serve.ts`, the `serve` command in `scripts/lab.ts`.

## Interfaces

```ts
type ServeParts = {
  injector: (runId: string) => Promise<unknown>;
  bots: (runId: string) => Promise<unknown>;
  executive: (runId: string) => Promise<unknown>;
  mode: (runId: string) => Promise<void>;
  finish: (runId: string, reason: "done" | "budget" | `error:${string}`) => Promise<void>;   // stopRun + ledger line
};
serveTick(deps: { state: LabState; parts: ServeParts; now: () => Date; spendUsd: (runId: string) => Promise<number | "unpriced"> }, errors: Map<string, number>): Promise<void>;
runServe(deps, opts: { everyMs: number; signal: AbortSignal }): Promise<void>;   // everyMs 30000
```

## Decisions

- **Active run** = a run folder without a `stopped` event.
- **Order per run, per tick:** spend check; `mode`; `injector`; `bots`; `executive`; end check. Runs are handled one after another.
- **Spend.** `spendUsd(runId) ≥ capUsd` → `finish(budget)`. `unpriced` → `finish("error:unpriced")` (review N8). When the injector returns `stopped: "budget"` (stage 07), the loop calls `finish(budget)` too. `finish` is the only caller of `stopRun`, and it always writes the ledger line (review B5).
- **Mode** (demo, D15): when `modePlan.assistFromDay` is set and `now` ≥ 00:00 Warsaw of that run day, and no `mode: assist` event exists → set the mailbox mode `assist` with default switches (the `mailbox:settings mode` function), append `mode`. Runs without `modePlan` skip this part.
- **End.** `now ≥ tailEndsAt` → `finish(done)`. The tail keeps bots and executive working with no new mail (all items are due by `endsAt`).
- **Errors.** A part that throws logs its part name and an error code (no text), and the loop goes on. The error count is per run and part, and resets after a good tick. The 10th failure in a row → `finish("error:<part>")`.
- **Signals.** SIGTERM or SIGINT: finish the current part, then exit 0. A restart resumes from the events (each part is idempotent by stages 07, 08, 10).
- **Start check.** `runServe` runs `checkSimEnv` at start and exits 1 on an issue. It loads the corpus once.
- **Ledger.** `finish` writes one line with the run spend to `state.ledgerPath()` (stage 04), which the month cap of stage 05 reads.
- **Status.** `lab status` (stage 05) also shows the last tick time and the error counts, from a small `serve.json` that each tick rewrites.

## Tests (unit with fake parts and a fake clock)

1. One active run: a tick calls spend, mode, injector, bots, executive in that order.
2. A run with `stopped` is skipped.
3. Spend 5.00 of cap 5 → `finish(budget)`, no part runs, one `stopped` event and one ledger line. Spend `unpriced` → `finish("error:unpriced")`.
3b. The injector returns `stopped: "budget"` → `finish(budget)` in the same tick; bots and executive do not run after it.
4. `now` = `tailEndsAt` → `finish(done)` once; the next tick does nothing for it.
5. Injector throws 9 times → still active; the 10th → `finish("error:injector")`; a good tick between resets the count.
6. Demo run with `assistFromDay` 4, week from 2026-11-23: at 2026-11-25T23:30Z (Thu 00:30 Warsaw) → mode set once; a second tick does not set it again.
7. Abort signal during a tick → the loop exits after that part.
8. Bad env at start → exit 1, no tick.

## Done when

Tests pass; `live-lab.md` has the serve rules (order, stop reasons, restart); the Proof prints `PROOF_OK`.

## Out of scope

Scoring (stages 12–13) and demo reset (stage 14).

## Carry-over from the stage 03 review (N6)

`deploy/compose.sim.yaml` runs the `lab` service as `bun run lab:env-check && exec bun run lab serve`. `bun run` stays PID 1 and the lab is its child, so a stop signal may not reach the lab. When this stage builds the lab script, change that command to `exec bun apps/server/src/scripts/<lab script>.ts serve`. `apps/server/src/scripts/sim-compose-rules.ts` and its test hold the old command text: change them together.
