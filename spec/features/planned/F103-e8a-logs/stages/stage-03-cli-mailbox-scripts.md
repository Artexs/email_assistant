# F103 stage 03 — CLI output in the mailbox scripts

Part of [`../plan.md`](../plan.md). Needs stage 02 landed (`platform/cli.ts`).

One step.

## Step 1 — Convert the 11 `mailbox-*` scripts (71 calls)

**Goal.** Every old-form log line of the mailbox scripts prints through `createCliOutput` with the same text as before.

**Files** (`apps/server/src/scripts/`, old-form calls at `560e74e7`): `mailbox-audit.ts` 6, `mailbox-backfill.ts` 7, `mailbox-check.ts` 4, `mailbox-connect.ts` 9, `mailbox-password.ts` 10, `mailbox-probe-move.ts` 4, `mailbox-probe-send.ts` 5, `mailbox-rescan.ts` 5, `mailbox-seed.ts` 4, `mailbox-settings.ts` 16, `mailbox-signals.ts` 1.

**How to convert.** The rules of stage 02 step 2. Also:

- A callback that a module function gets for its report lines (`log: (line) => log.info(line)` in `mailbox-probe-move.ts` and `mailbox-probe-send.ts`) becomes `(line) => out.print(line)`. The module function's parameter type does not change.
- `for (const line of reportLines(report)) log.info(line)` → `out.print(line)`.
- `error.message` stays where it is today (D4: these scripts test a mail server connection). Add no new one.
- `mailbox-signals.ts` (added after the first base): only its usage line is old form and moves to `out.fail`. Its `mailbox_signals_failed` event lines and its `process.stdout.write` output stay (D26), so it keeps its `createLog` import.

**Decisions.** D3, D4, D23, D26.

**Test.** These integration tests pass unchanged: `mail-check.test.ts`, `mail-connect.test.ts`, `mail-folders-cli.test.ts`, `mail-password.test.ts`, `mail-seed.test.ts`, `mailbox-backfill-cli.test.ts`, `imap-probe-move.test.ts`, `imap-probe-send.test.ts`, `triage-gate.test.ts` (it runs `mailbox:settings`), and every other test that names one of these scripts. A test that must change means a printed text changed: stop and report it.

**Done when.** `bun run lint` shows no `no-restricted-syntax` message in `scripts/mailbox-*.ts`; only `mailbox-signals.ts` of these files still imports `createLog`; the tests pass; the Proof (`/tmp/f103-s03`) prints `PROOF_OK`; the final message gives the warning count (416 − 55 − 71 = 290 at `560e74e7`; other tickets may change it).

**Out of scope.** Module code that these scripts call (its lines are logs; the conversion stages own them). The lint level of `scripts/` (stage 04).
