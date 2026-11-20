# F129 stage 14 — Telegram, weekly stats and key tools

Needs stage 01: `runCli`, `exitCodeOf`. Needs stage 02: `cli-pending.json` group `telegram`, the standard test. Needs stage 04: `scripts/lib/pick-member.ts`. May run next to 05–13 and 15.

Part of [`../plan.md`](../plan.md). Decisions: D5, D7. Recipe: `docs/cli.md` § Convert a tool.

## Tools

| Command | Risk | Needs | Notes |
| --- | --- | --- | --- |
| `telegram:check` | outside | telegram | calls the real bot API (`getMe`); catches errors in `main` today |
| `telegram:link` / `telegram:unlink` | write | db | inline parsers → args files |
| `stats:week` | read | db | its `key value …` lines through `out.raw` stay byte for byte; event lines stay (F103 D26) |
| `push:keys` | read | none | prints a new key pair; `outputNote`: "prints a new private key once, for the operator's `.env`" |

## Step 1 — Convert the five tools

- Follow the recipe. `telegram:check` and `push:keys` take no arguments: a strict empty parse first, so `--no-such-flag` exits 2 before any call or key generation.
- `telegram:check` keeps its config-error line; it moves after the parse. Its outer catch returns `exitCodeOf(error)`; a 3 prints `[telegram-check] unreachable: <describeError>` (plan rule).
- Telegram errors stay in `telegramErrorFields` form; never `error.message` (styleguide).
- Callers: `docs/capabilities/` pages of Telegram and reports, `deploy/README.md`, `docs/known-alerts.md` (`telegram:check` lines).

## Step 2 — Unreachable Telegram exits 3

- **Test** (unit lane, spawn with `--no-env-file`): `telegram:check` with the test preload's config env and `TELEGRAM_API_ROOT=http://127.0.0.1:1` → exit 3 within 20 s; one `unreachable:` line; the bot token absent from stdout and stderr.
- If grammY wraps the refused connection so that `exitCodeOf` sees no matching code, map it to `SoftError` in the Telegram adapter, not in the script. Name the change in the final message.
- **Guard check:** make the outer catch return 1 → this test fails; restore. Name both runs in the final message.

## Test (args)

1. `telegram-link-args`: missing `--org-id` → usage; `--user-id x` → usage.
2. `telegram-unlink-args`: valid case; unknown flag → usage.
3. `stats-week-args`: existing cases pass; an unknown flag → `UsageError`.
4. `push:keys --no-such-flag` → exit 2 and nothing on stdout (no key printed).

## Out of scope

Bot behaviour; the weekly report content.

## Done when

Steps 1–2 done; the five files are out of `cli-pending.json`; the standard test passes for them; the plan.md Proof with `s14` prints `PROOF_OK`.
