# F129 stage 10 — Eval, sim and LLM check

Needs stage 01: `runCli`, `exitCodeOf`. Needs stage 02: `cli-pending.json` group `eval`, the standard test. Needs stage 04: `scripts/lib/eval-*.ts`, `lib/sim-*.ts`. May run next to 05–09 and 11–15. Build after F141 (the provider registry ticket) closes: it edits `llm-check.ts`, `eval-args.ts`, `eval-config.ts` and `provider-scan.test.ts`.

Part of [`../plan.md`](../plan.md). Decisions: D5, D7, D13 (`--json-out`). Recipe: `docs/cli.md` § Convert a tool.

## Tools

| Command | Risk | Needs | Exit changes |
| --- | --- | --- | --- |
| `eval` | cost | db, llm | stopped at cap or error limit 2 → 4 (`exits[4]`: "stopped at the budget cap or the error limit; run the same command again"); bad args 1 → 2 |
| `sim` | cost | db, llm | stopped run 2 → 4 where it has one; bad args 1 → 2 |
| `llm:check` | cost | llm | bad args → 2; a missing key stays 1 |

`cost` (D7): agents run these only when the task names them, inside the caps (`--budget-usd`, month cap $20).

## Step 1 — Exit 4 for a stopped run

- **Goal:** "resume later" has its own code, so exit 2 means only bad arguments.
- **Files:** the paths that return 2 for a stop, in `scripts/lib/` and in the module report functions (`modules/triage/eval-report.ts`, `modules/replies/drafter-eval-scores.ts`, `modules/loops/extractor-report.ts`: changing the number there is in scope); their tests; `evals/README.md` (the exit code lines), `evals/sim/README.md`, `docs/capabilities/triage.md`, `docs/capabilities/live-lab.md`.
- **Decision:** the ledger and the resume rule do not change; only the number. A stop is never 1 (1 is a failed gate).
- **Test:**
  1. The existing "stops at the cap" test of each runner now expects 4.
  2. A drafter eval with a fake client that fails from case 2 and an error limit of 1 case → 4, and the ledger row is written as before.

- **Guard check:** set the stop code back to 2 in one runner → test 1 fails for it; restore. Name both runs in the final message.

## Step 2 — `--json` becomes `--json-out <file>`

- **Files:** `eval-args.ts` and its test, `evals/README.md`, `docs/capabilities/triage.md`, any script or doc that passes `--json` to `eval` (grep `eval .*--json`). `--sim-json` and `--real-json` keep their names (they read files, not stdout).
- **Test:**
  3. `["--real", "--json-out", "/tmp/x.json"]` → `{ jsonOut: "/tmp/x.json" }`.
  4. `["--real", "--json", "/tmp/x.json"]` → usage error naming `--json-out` in the message.

## Step 3 — Convert the three tools

- Follow the recipe. `eval.ts`, `llm-check.ts` already guard with `import.meta.main`; `runCli` replaces that block.
- The four `scripts/lib/` eval helpers pending in group `eval` (`eval-drafter`, `eval-extractor`, `eval-sim`, `eval-suspicious`) move their `process.stdout.write` to `out.write` and leave `cli-pending.json`.
- `sim` subcommands: one description (single `package.json` name); its usage lists the subcommands.
- Unreachable LLM → 3: `llm:check` catches errors in `main` today; it returns `exitCodeOf(error)`, so an LLM `SoftError` (timeout, 429, 503) exits 3. **Test 5:** `llm:check` with the fake provider that throws `SoftError` → exit 3, one `unreachable:` line, no key in output.

## Test (args)

6. `sim-args`, `llm-check-args`, `eval-args`: an unknown flag → `UsageError`; each existing case still passes.

## Out of scope

Eval logic, prompts, the sim gate rules, LLM spend (no real provider call in this stage).

## Done when

Steps 1–3 done; the three tools and the four helpers are out of `cli-pending.json`; the standard test passes for them; `git grep -n "exits 2\|exit 2" evals/ docs/capabilities/` shows no stop meaning left; the plan.md Proof with `s10` prints `PROOF_OK`.
