# F113 stage 04 — lab state and CLI

Part of [`../plan.md`](../plan.md). Decisions D8, D12, D13, D17.

## Step 1 — state store

**Files.** `apps/server/src/modules/lab/state.ts` (module `lab`, stage 02 made it).

**Interfaces.**

```ts
type LabOrgKey = "lab" | "demo";
type LabOrg = { orgId: string; mailboxId: string; address: string; chatId: number };
type LabEvent =
  | { t: "inject_intent" | "inject_done"; slotId: string; messageId: string; lateBySec?: number }
  | { t: "bot_planned"; key: string; at: string; reply: BotReplyPlan }
  | { t: "bot_intent" | "bot_done"; key: string; messageId: string }
  | { t: "tap_planned"; key: string; at: string; data: string; messageId: number }
  | { t: "tap_intent" | "tap_done"; key: string; data: string }
  | { t: "seen"; part: string; ref: string }
  | { t: "mode"; mode: "shadow" | "assist" }
  | { t: "skip"; code: string; ref: string }
  | { t: "stopped"; reason: "done" | "budget" | "operator" | `error:${string}` };
type LabRun = { plan: LiveRunPlan; org: LabOrgKey; capUsd: number; modePlan?: { assistFromDay: number } };
createLabState(dir: string): {
  readOrgs(): Partial<Record<LabOrgKey, LabOrg>>; writeOrgs(o): void;
  createRun(run: LabRun): void; readRun(id): LabRun; listRuns(): string[];
  append(runId: string, e: LabEvent): void; events(runId: string): (LabEvent & { at: string })[];
  lock(org: LabOrgKey, runId: string): "ok" | "run_active"; unlock(org: LabOrgKey): void;
};
```

`BotReplyPlan`: an opaque record here; stage 07 narrows it.

**Decisions.**
- Layout: `<dir>/orgs.json`, `<dir>/runs/<runId>/{run.json,events.jsonl}`, `<dir>/locks/<org>.lock`.
- `append` writes one JSON line and syncs it before it returns; the store adds `at` (injected clock).
- `events` skips a broken last line (a crash in mid-write) and counts it in `status`.
- A lock holds the run id. `lock` gives `run_active` while the run of that lock has no `stopped` event. A lock whose run has `stopped` is replaced.

## Step 2 — CLI frame

**Files.** `apps/server/src/scripts/lab.ts`, `lab-args.ts` (with test), `package.json` script `lab`.

**Interfaces.** Usage lines (every later stage fills its command; until then it exits 1 with `not built`):

```
bun run lab seed [--org lab|demo]
bun run lab start --mode day|week [--date YYYY-MM-DD] [--org lab|demo] [--cap-usd <n>]
bun run lab status [--run <id>]
bun run lab stop --run <id>
bun run lab serve
bun run lab score --run <id> [--out <dir>]
bun run lab demo-reset --yes
bun run lab demo-export --day <n> --out <file>
bun run lab demo-import --file <file> --email <address> [--replace]
```

**Decisions.**
- Every command except `demo-import` runs `checkSimEnv` first and exits 1 with the issue codes (stage 02). `demo-import` has its own guard (stage 14).
- `start`: reads the scenario and week slots (F097 readers in `scripts/sim-files.ts`), calls `planLiveRun` with `hex4` from `crypto.randomUUID`, writes the run, takes the lock. Default `--date`: tomorrow in Warsaw; for `week` the next Monday. Default `--cap-usd`: 1 (day) or 5 (week); a higher value is refused (`cap_too_high`). It refuses when the org is not in `orgs.json` (`not_seeded`).
- Month cap: `start` refuses when the eval spend ledger (`scripts/eval-ledger.ts`) shows ≥ $20 this month (`month_cap`). The serve loop writes one ledger line when a run stops.
- `runSpend(db, ctx, run)`: the run org's `llm.call` audit rows since the plan start, through the E3a reader and core `unitCost` (one price table).
- `status` prints counts per run (planned, injected, late, replies, taps, skips, spend, stop reason).
- `stop`: `stopped: operator`, lock released.

## Step 3 — capability page

Create `docs/capabilities/live-lab.md` (template in `docs/capabilities/README.md`) and its index row, with the env guard and run state rules.

## Tests

1. Append 3 events, read them back in order; a broken last line is skipped and counted.
2. `lock("lab", "r1")` → `ok`; second `lock("lab", "r2")` → `run_active`; after `stopped` on r1 → `ok`.
3. `start --mode week --date 2026-11-24` → exit 1, `not_monday`.
4. `start` with a bad env → exit 1, the codes, no run folder.
5. `start --cap-usd 6 --mode week` → `cap_too_high`.
6. `start` with a ledger at $20.10 this month → `month_cap`.
7. `runSpend` on seeded `llm.call` rows (2 calls of `gpt-6-luna`, 1,000 in, 200 out tokens each) equals 2 × `costPerMail` of that call; a row of another org is not counted.
8. Each usage line parses; an unknown flag fails.

## Done when

Tests pass; `capability-map.test.ts` passes; the Proof prints `PROOF_OK`.

## Out of scope

Seed, injector, bots, executive, scorer.
