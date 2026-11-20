# F129 stage 11 — Testmail and operations tools

Needs stage 01: `runCli`, `exitCodeOf`. Needs stage 02: `cli-pending.json` group `testmail-ops`, the standard test. Needs stage 04: `scripts/lib/credentials-check-lines.ts`, `lib/ops-alerts-lines.ts`, `lib/release-prepare-lib.ts`. May run next to 05–10 and 12–15.

Part of [`../plan.md`](../plan.md). Decisions: D5, D7, D13 (testmail stays). Recipe: `docs/cli.md` § Convert a tool.

## Tools

| Command | Risk | Needs | Exit changes |
| --- | --- | --- | --- |
| `testmail:setup` / `validate` / `blind` / `send` | outside | db, agentmail | bad args 1 → 2; `send` "not done, no fix needed" 2 → 4 (`exits[4]`; code from `modules/testmail/send.ts`, in scope; `send.test.ts` changes) |
| `testmail:status` | read | db | |
| `testmail:target` | outside | db, imap | "nothing sent yet" 2 → 1 |
| `testmail:remote` | outside | vps, git | "nothing sent yet" 2 → 1; it runs `testmail:target` on the VPS |
| `ops:alerts` | read | db | |
| `ops:alert-test` | outside | telegram | sends the `TEST` text through the real path |
| `credentials:check` | read | db | an argument → 2 (was 1) |
| `release:prepare` | write | git | refused version or empty `[Unreleased]` 2 → 1; keeps its positional `<x.y.z>` |

`testmail:remote` keeps its stdin and exit pass-through over ssh (`notes/2026-11-07-agentmail-test-mail.md`): the remote exit code is the local exit code.

## Step 1 — Convert the tools

- Follow the recipe. `testmail.ts` has five subcommands: five descriptions with `subcommand`. `testmail-target.ts` and `testmail-remote.ts` have `deliver` and `compare`: one description each (one `package.json` name), usage lists both.
- `credentials:check`: its result line `[credentials-check] credentials ok=<n> failed=<m>` and its exit codes for a run stay; `deploy/restore.sh` parses the line and, under `set -euo pipefail`, stops on a non-zero exit. `deploy/test/restore.test.ts` stays green.
- `release:prepare`: it runs no git command (checklist line 21) — `needs` is `git` only because it reads the working tree; if it reads no git state, use `["none"]`.
- Callers to update: `docs/release-checklist.md`, `docs/capabilities/operations.md`, `deploy/README.md`, `docs/known-alerts.md`, `notes/` stay (history).

## Step 2 — Tests

1. `credentials-check.test.ts`: "an argument gives exit 1" becomes exit 2 with `usage: bun run credentials:check` on stderr; the other cases unchanged.
2. `release-prepare-args` test: `["0.4.3", "--date", "2026-11-21"]` → typed; `["v0.4.3"]` → usage; `["0.4.3", "0.4.4"]` → usage.
3. `release:prepare 0.0.1` on a temp root whose `package.json` version is `0.4.2` → exit 1 (was 2), stderr names the refusal, no file changed.
4. `testmail-target` integration (`testmail-remote.test.ts` or `mail-deliver.test.ts`): `compare` with no send log → exit 1 (was 2).
5. New `testmail-args.ts` (from the inline parser): each subcommand's valid case; `["send", "--batch", ""]` → usage; `["nope"]` → usage.
6. `ops-alert-test`: `--kind nope` → usage (exit 2); `--kind` and `--all` together → usage.

**Guard check:** change one character of the `credentials ok=` line → `deploy/test/restore.test.ts` fails; restore. Name both runs in the final message.

## Out of scope

Moving the `testmail` module to `tools/` (follow-up, `questions.md`); AgentMail calls (no real send in tests).

## Done when

Steps 1–2 done; the seven files are out of `cli-pending.json`; the standard test passes for them; the plan.md Proof with `s11` prints `PROOF_OK`.
