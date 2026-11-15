# F113 stage 05 — lab CLI, caps and capability page

Part of [`../plan.md`](../plan.md). Decisions D3, D12, D13. Review 1: B4, B5, T10, N8.

## Step 1 — CLI frame

**Files.** `apps/server/src/scripts/lab.ts`, `lab-args.ts` (with test), `package.json` script `lab`.

**Interfaces.** Usage lines (a later stage fills its command; until then it exits 1 with `not built`):

```
bun run lab seed [--org lab|demo]
bun run lab reset --org lab|demo --yes
bun run lab start --mode day|week [--date YYYY-MM-DD] [--org lab|demo] [--cap-usd <n>] [--reuse]
bun run lab status [--run <id>]
bun run lab stop --run <id>
bun run lab serve
bun run lab score --run <id> [--out <dir>]
bun run lab demo-reset --yes
bun run lab demo-export --day <n> --out <file>
bun run lab demo-import --file <file> --email <address> [--replace]
```

`bun run lab:env-check` (stage 03) stays a separate script.

**Decisions.**
- Every command except `demo-import` runs `checkSimEnv` with `labAddresses` first and exits 1 with the issue codes. `demo-import` has its own guard (stage 15).
- `start`:
  - refuses `not_seeded` when the org is not in `orgs.json`;
  - refuses `org_not_fresh` when the org already holds mail and `--reuse` is not set (review T10: a run on a used org mixes the metrics of two runs; `lab reset --org lab` makes a fresh org, stage 14);
  - refuses `model_unpriced` when a configured LLM model of the stack has no row in `llmPrices` (review N8);
  - plans with `planLiveRun` (`hex4` from `crypto.randomUUID`); default `--date` = tomorrow in Warsaw, for `week` the next Monday;
  - computes the cap (below), then `startRun`; `run_active` → exit 1.
- **Cap** (review B5, P4): requested = `--cap-usd` or 1 (day) or 5 (week); a request above that default → `cap_too_high`. Cap = `runCap({ requested, monthSpent, monthCap: 20 })` from `scripts/eval-ledger.ts`, where `monthSpent` = the ledger's month spend **plus the caps of the active runs**. Cap ≤ 0 → `month_cap`.
- `runSpend(db, ctx, run)`: the run org's `llm.call` audit rows since the plan start, priced with core `costPerMail` (the price table of `unitCost`). A row whose model has no price returns `unpriced` (the serve loop stops the run with `error:unpriced`).
- `status` prints counts per run (planned, injected, late, replies, taps, skips, spend, stop reason) and the serve heartbeat (stage 11).
- `stop`: `stopRun(id, "operator")`, then one ledger line with the run spend.

## Step 2 — capability page

Create `docs/capabilities/live-lab.md` (template in `docs/capabilities/README.md`) and its index row: the env guard, run state, caps and the CLI rows.

## Tests

1. `start --mode week --date 2026-11-24` → exit 1, `not_monday`; no run folder.
2. `start` with a bad env → exit 1, the codes, no run folder.
3. `start --cap-usd 6 --mode week` → `cap_too_high`.
4. Ledger at $17.00 this month, one active run with cap $1 → a new week run gets cap $2.00; ledger at $19.10 plus an active $1 cap → `month_cap`.
5. Two `start` calls for `lab` → the second exits 1 `run_active`; `activeRuns()` has one id.
6. `start` on an org with one `emails` row → `org_not_fresh`; with `--reuse` → ok.
7. `runSpend` on seeded `llm.call` rows (2 calls of `gpt-6-luna`, 1,000 in, 200 out tokens each) = 2 × `costPerMail` of that call; a row of another org is not counted; a row of model `x-unknown` → `unpriced`.
8. `stop` → `stopped: operator` and one ledger line.
9. Each usage line parses; an unknown flag fails.

## Done when

Tests pass; `capability-map.test.ts` passes; the Proof prints `PROOF_OK`.

## Out of scope

Seed, reset, injector, bots, executive, scorer.
