# F129 stage 09 — Rules, delegation and digest tools

Needs stage 01: `runCli`, `exitCodeOf`. Needs stage 02: `cli-pending.json` group `delegation`, the standard test. Needs stage 04: `scripts/lib/pick-member.ts`. May run next to 05–08 and 10–15 (stage 14 also imports `lib/pick-member.ts`; neither edits it).

Part of [`../plan.md`](../plan.md). Decisions: D5, D7. Recipe: `docs/cli.md` § Convert a tool.

## Tools

| Command | Risk | Needs | Notes |
| --- | --- | --- | --- |
| `rules:add` / `rules:list` | write / read | db | one file, two descriptions (`subcommand` `add`, `list`); inline parser → `rules-args.ts` |
| `delegates:add/list/disable/enable` | write / read / write / write | db | refused address or field 2 → 1 (`exits[1]`) |
| `delegations:list` / `delegations:done` | read / write | db | |
| `digest:times` | write | db | inline parser → `digest-times-args.ts` |
| `reply:check-copy` | read | db | |
| `trust:history-check` | write | db | queues a check; inline parser → `trust-history-check-args.ts`; its usage text lists exit codes: rewrite them to the table |

## Step 1 — Convert the six tools

- Follow the recipe. Each subcommand file exports one description per `package.json` name; `bun run rules:add --help` shows only the `add` help (stage 01 behaviour).
- Result and refusal lines stay byte for byte.
- Callers to update: `docs/capabilities/` pages of rules, delegation and digest; `deploy/README.md`; `docs/known-alerts.md` lines that name these codes.

## Test

1. `rules-args`: `["add", "--org-id", <uuid>, "--pattern", "example.test", "--kind", "whitelist"]` → typed value; `--kind nope` → usage; `["list", "--pattern", "x"]` → usage (add-only flag).
2. `digest-times-args`: `--times 07:30,18:00` → two times; `--times 25:00` → usage; `--times none` → empty list.
3. `trust-history-check-args`: missing `--mailbox-id` → usage.
4. `delegates-args`: existing cases pass; a refused address is not a usage error (the parser accepts it; the service refuses it, exit 1).
5. Integration: `delegates:add` with a refused address → exit 1 (was 2); the refusal line unchanged.
6. Integration: `delegations:done` with an unknown delegation id → exit 1 and its current line.

**Guard check:** let `rules.ts add` accept the `list`-only form (drop the subcommand check) → test 1's last case fails; restore. Name both runs in the final message.

## Out of scope

Rule, delegation and digest behaviour; Telegram and report tools (stage 14).

## Done when

Step 1 and the tests done; the six files are out of `cli-pending.json`; the standard test passes for them; the plan.md Proof with `s09` prints `PROOF_OK`.
