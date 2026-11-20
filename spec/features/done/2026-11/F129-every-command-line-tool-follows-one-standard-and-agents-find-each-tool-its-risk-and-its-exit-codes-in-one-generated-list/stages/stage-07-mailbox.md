# F129 stage 07 — Mailbox tools

Needs stage 01: `runCli`, `exitCodeOf`. Needs stage 02: `cli-pending.json` group `mailbox`, the standard test. Needs stage 03: `scripts/mailbox-probe.ts` (merged). Needs stage 04: `scripts/lib/`. May run next to 05, 06 and 08–15 (the four `mailbox-cli` tools are stage 08).

Part of [`../plan.md`](../plan.md). Decisions: D5, D7. Recipe: `docs/cli.md` § Convert a tool.

## Tools

| Command | Risk | Needs | Exit changes |
| --- | --- | --- | --- |
| `mailbox:connect` | write | db, imap, smtp | bad args 1 → 2 |
| `mailbox:password` | write | db | bad args 1 → 2; still reads stdin only; a TTY is a refusal, exit 1 (D5) |
| `mailbox:check` | read | db, imap | refused host 2 → 1 (`exits[1]`: "the host is not allowed or a check failed"); IMAP down → 3 |
| `mailbox:probe-move` | outside | imap | bad args → 2 |
| `mailbox:probe-send` | outside | imap, smtp | bad args → 2 |
| `mailbox:rescan` | write | db | bad args 1 → 2 |
| `mailbox:settings` | write | db | go/no-go refusal 2 → 1 (`exits[1]`: "refused by the go/no-go gate or failed") |
| `mailbox:profile` | write | db | bad args 1 → 2 |

`mailbox:probe-*` are `outside`: they touch the real test mailbox (`TEST_MAILBOX_ADDRESS` guard stays).

## Step 1 — Convert the tools

- Follow the recipe. Result and error lines stay byte for byte. The `mailbox-settings` usage text that says "Exit 2: refused by the go/no-go gate" changes to the new table.
- Secrets: `mailbox:password` and the probes read the password from stdin only. Add the rule "a secret never comes from a flag" to the args test (case 4).
- Callers to update: `docs/capabilities/sync.md` (`mailbox:check` exit 2 → 1), `deploy/README.md` (the `auto --value on` line that says exit 2), `docs/known-alerts.md` lines that name these codes, `docs/modules.md`, `docs/capabilities/actions-and-undo.md`, `drafts-and-send.md` (probe file name and usage), `docs/code-patterns.md` if it names a code.

## Step 2 — Unreachable IMAP exits 3

- **Goal:** an outside system that does not answer gives 3, not 1, and the tool does not hang.
- **Test** (integration): `mailbox:probe-move --host 127.0.0.1 --port 1 --address <TEST_MAILBOX_ADDRESS of the test env>` with a password on stdin → exit 3 within 20 s; stderr one `unreachable:` line; no password in stdout or stderr.
- A tool with its own outer catch returns `exitCodeOf(error)` (plan rule on the `unreachable:` line).
- If the IMAP adapter wraps a refused connection in an error whose code `runCliCode` does not match, map it in the adapter to `SoftError` (the styleguide: lost connection is soft), not in the script. Name the change in the final message.

## Test (args unit tests)

1. `mailbox-check-args`: `--org-id <uuid> --mailbox-id <uuid> --probe` → `{ probe: true }`; missing `--mailbox-id` → usage.
2. `mailbox-settings-args`: each subcommand with a flag of another subcommand → usage (existing rule, now `UsageError`).
3. `mailbox-connect-args`: inline parser moved; bad port → usage.
4. No args file of this stage defines a `password` or `secret` option (a loop over the parsers' option lists).
5. Integration: `mailbox-settings` "auto on without go" → exit 1 (was 2); the refusal line unchanged.
6. Integration: `mailbox:check` on a mailbox whose host is not allowed → exit 1 (was 2).

**Guard check:** move `loadConfig` above the parse in `mailbox-check.ts` → the standard test fails for `mailbox:check` under `env -i`; remove the TTY refusal of `mailbox:password` → its test fails; restore both. Name each run in the final message.

## Out of scope

`mailbox:seed`, `mailbox:audit`, `mailbox:signals`, `mailbox:backfill` (stage 08); the probe library code.

## Done when

Steps 1–2 done; the seven files (`mailbox-probe.ts` is one file) are out of `cli-pending.json`; the standard test passes for them; the plan.md Proof with `s07` prints `PROOF_OK`.
