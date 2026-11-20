# F129 stage 09 — Rules, delegation, Telegram and report tools

Needs stage 02: `runCli`, `cli-pending.json` group `delegation`, the standard test. Needs stage 04: `scripts/lib/pick-member.ts`. May run next to 05–08 and 10–13.

Part of [`../plan.md`](../plan.md). Decisions: D5, D7. Recipe: `docs/cli.md` § Convert a tool.

## Tools

| Command | Risk | Needs | Notes |
| --- | --- | --- | --- |
| `rules:add` / `rules:list` | write / read | db | one file, two descriptions (`subcommand` `add`, `list`); inline parser → `rules-args.ts` |
| `delegates:add/list/disable/enable` | write / read / write / write | db | refused address or field 2 → 1 (`exits[1]`) |
| `delegations:list` / `delegations:done` | read / write | db | |
| `telegram:check` | outside | telegram | calls the real bot API (`getMe`); a fake token or the fake server is the test path |
| `telegram:link` / `telegram:unlink` | write | db | inline parsers → args files |
| `digest:times` | write | db | inline parser → `digest-times-args.ts` |
| `reply:check-copy` | read | db | |
| `trust:history-check` | write | db | queues a check; inline parser → args file |
| `stats:week` | read | db | its `key value …` lines through `out.raw` stay byte for byte; event lines stay (F103 D26) |
| `push:keys` | read | none | prints a new key pair; `outputNote`: "prints a new private key once, for the operator's `.env`" |

## Step 1 — Convert the tools

- Follow the recipe. Each subcommand file exports one description per `package.json` name; `bun run rules:add --help` shows only the `add` help (stage 01 behaviour).
- Tools that take no arguments today (`telegram:check`, `push:keys`) parse an empty option set strictly, so `--no-such-flag` exits 2 before any call.
- `telegram:check` keeps its config-error line; it moves after the parse.
- Telegram errors stay in `telegramErrorFields` form; never `error.message` (styleguide).
- Callers to update: `docs/capabilities/` pages of delegation, rules, telegram, reports; `deploy/README.md`; `docs/known-alerts.md`.

## Step 2 — Unreachable Telegram exits 3

- **Test** (unit lane, spawn): `telegram:check` with the test preload config and `TELEGRAM_API_ROOT` (or the config key the adapter uses at HEAD for the API base) set to `http://127.0.0.1:1` → exit 3 within 20 s; one `unreachable:` line; the bot token absent from stdout and stderr.
- If grammY wraps the refused connection so that `runCliCode` sees no matching code, map it to `SoftError` in the Telegram adapter, not in the script. Name the change in the final message.

## Test (args unit tests)

1. `rules-args`: `["add", "--org-id", <uuid>, "--pattern", "example.test", "--kind", "whitelist"]` → typed value; `--kind nope` → usage; `["list", "--pattern", "x"]` → usage (add-only flag).
2. `digest-times-args`: `--times 07:30,18:00` → two times; `--times 25:00` → usage; `--times none` → empty list.
3. `telegram-link-args`, `trust-history-check-args`: missing `--org-id` → usage.
4. `delegates-args`: existing cases pass; a refused address is not a usage error (the parser accepts it; the service refuses it, exit 1).
5. Integration: `delegates:add` with a refused address → exit 1 (was 2); the refusal line unchanged.

## Out of scope

Telegram bot behaviour; the weekly report content.

## Done when

Steps 1–2 done; the eleven files are out of `cli-pending.json`; the standard test passes for them; the plan.md Proof with `s09` prints `PROOF_OK`.
