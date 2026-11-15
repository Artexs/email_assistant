# F113 stage 10 — serve loop

Part of [`../plan.md`](../plan.md). Decisions D12, D13, D15.

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
  finish: (runId: string, reason: "done" | "budget" | `error:${string}`) => Promise<void>;
};
serveTick(deps: { state: LabState; parts: ServeParts; now: () => Date; spendUsd: (runId: string) => Promise<number> }, errors: Map<string, number>): Promise<void>;
runServe(deps, opts: { everyMs: number; signal: AbortSignal }): Promise<void>;   // everyMs 30000
```

## Decisions

- **Active run** = a run folder without a `stopped` event.
- **Order per run, per tick:** spend check; `mode`; `injector`; `bots`; `executive`; end check. Runs are handled one after another.
- **Spend.** `spendUsd(runId) ≥ capUsd` → `finish(budget)`: append `stopped: budget`, release the lock, write the ledger line. The injector also checks (stage 06); this check also stops bots and executive.
- **Mode** (demo, D15): when `modePlan.assistFromDay` is set and `now` ≥ 00:00 Warsaw of that run day, and no `mode: assist` event exists → set the mailbox mode `assist` with default switches (the `mailbox:settings mode` function), append `mode`. Runs without `modePlan` skip this part.
- **End.** `now ≥ tailEndsAt` → `finish(done)`. The tail keeps bots and executive working with no new mail (all items are due by `endsAt`).
- **Errors.** A part that throws logs its part name and an error code (no text), and the loop goes on. The error count is per run and part, and resets after a good tick. The 10th failure in a row → `finish("error:<part>")`.
- **Signals.** SIGTERM or SIGINT: finish the current part, then exit 0. A restart resumes from the events (each part is idempotent by stages 06, 07, 09).
- **Start check.** `runServe` runs `checkSimEnv` at start and exits 1 on an issue. It loads the corpus once.
- **Ledger.** `finish` writes one line to the eval spend ledger with the run spend (the month cap of stage 04 reads it). The ledger path comes from `LAB_STATE_DIR` in the container (`<dir>/eval-spend.jsonl`), passed to the ledger module as its file override.
- **Status.** `lab status` (stage 04) also shows the last tick time and the error counts, from a small `serve.json` that each tick rewrites.

## Tests (unit with fake parts and a fake clock)

1. One active run: a tick calls spend, mode, injector, bots, executive in that order.
2. A run with `stopped` is skipped.
3. Spend 5.00 of cap 5 → `finish(budget)`, no part runs.
4. `now` = `tailEndsAt` → `finish(done)` once; the next tick does nothing for it.
5. Injector throws 9 times → still active; the 10th → `finish("error:injector")`; a good tick between resets the count.
6. Demo run with `assistFromDay` 4, week from 2026-11-23: at 2026-11-25T23:30Z (Thu 00:30 Warsaw) → mode set once; a second tick does not set it again.
7. Abort signal during a tick → the loop exits after that part.
8. Bad env at start → exit 1, no tick.

## Done when

Tests pass; `live-lab.md` has the serve rules (order, stop reasons, restart); the Proof prints `PROOF_OK`.

## Out of scope

Scoring (stages 11–12) and demo reset (stage 13).
