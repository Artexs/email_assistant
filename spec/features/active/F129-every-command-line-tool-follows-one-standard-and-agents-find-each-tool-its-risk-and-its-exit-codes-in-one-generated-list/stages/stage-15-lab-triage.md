# F129 stage 15 — Lab, sim stack checks and triage tools

Needs stage 01: `runCli`, `exitCodeOf`. Needs stage 02: `cli-pending.json` group `lab`, the standard test. Needs stage 04: `scripts/lib/lab-run.ts`, `lib/sim-compose-rules.ts`, `lib/triage-cost-report.ts`. May run next to 05–14.

Part of [`../plan.md`](../plan.md). Decisions: D5, D7, D13 (`triage:cost` stays). Recipe: `docs/cli.md` § Convert a tool.

## Tools

| Command | Risk | Needs | Callers and exit notes |
| --- | --- | --- | --- |
| `lab` | dev | db, docker, telegram | bad args 1 → 2; `telegram_link_timeout`, `confirm_needed`, `org_mismatch` stay exit 1 (`docs/capabilities/live-lab.md`) |
| `lab:env-check` | read | none | CI expects stdout exactly `[lab-env-check] telegram_token_not_fake` and a non-zero exit (stays 1); `deploy/compose.sim.yaml` runs it with `&&` before the server |
| `sim:check` | read | none | CI step expects exit 0 on the repo's compose files |
| `triage:cost` | read | db | inline parser → `triage-cost-args.ts` |
| `triage:label` | cost | db, llm | inline parser → `triage-label-args.ts`; agents run it only when the task names it (D7) |

## Step 1 — Convert the five tools

- Follow the recipe. Result lines stay byte for byte; `lab` subcommands (`seed`, `start`, `stop`, `serve`, `reset`, `score`, `status`, `demo-*`) share one description (one `package.json` name) whose usage lists them.
- `lab:env-check` and `sim:check` take no arguments today: a strict empty parse first, so `--no-such-flag` exits 2 before any file read. The CI steps in `.github/workflows/ci.yml` and the compose command keep working: run both CI commands locally and save their output.
- `lab:env-check` keeps its stdout line on stdout (CI reads stdout, not stderr).
- Callers: `docs/capabilities/live-lab.md`, `docs/capabilities/triage.md` (`triage:cost` lines), `docs/decisions/0035-llm-endpoint-eu-and-own-model.md` (names `triage:cost`; an ADR keeps its text unless it states an exit code).

## Step 2 — Tests

1. `lab-args` test: an unknown flag → `UsageError`; each existing case passes.
2. `lab-env-check.test.ts`: the real-form token case still prints exactly `[lab-env-check] telegram_token_not_fake` on stdout and exits 1; `--no-such-flag` → 2.
3. `triage-cost-args` (new): `--days 7` → `{ days: 7 }`; `--days x` → usage; an unknown flag → usage. Keep the bounds the inline parser has; add none.
4. `triage-label-args` (new): valid case from its usage line; missing required flag → usage.
5. `bash -c 'bun run sim:check'` → exit 0 at the stage head (save the log as `/tmp/f129-s15/sim-check.log`).

**Guard check:** make `lab:env-check` print its refusal on stderr instead of stdout → test 2 fails; restore. Name both runs in the final message.

## Out of scope

Lab stack behaviour, sim compose rules, LLM spend (no real provider call).

## Done when

Steps 1–2 done; the five files are out of `cli-pending.json`; the standard test passes for them; the plan.md Proof with `s15` prints `PROOF_OK`.
