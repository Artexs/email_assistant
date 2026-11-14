# F103 stage 03 — CLI output in the mailbox scripts

Part of [`../plan.md`](../plan.md). Needs stage 02 landed (`platform/cli.ts`).

Two steps.

## Step 1 — Convert the 10 `mailbox-*` scripts (70 calls)

**Goal.** The mailbox scripts print through `createCliOutput` with the same text as before, and no longer import `createLog`.

**Files** (`apps/server/src/scripts/`, old-form calls at `0a5c2ee`): `mailbox-audit.ts` 6, `mailbox-backfill.ts` 7, `mailbox-check.ts` 4, `mailbox-connect.ts` 9, `mailbox-password.ts` 10, `mailbox-probe-move.ts` 4, `mailbox-probe-send.ts` 5, `mailbox-rescan.ts` 5, `mailbox-seed.ts` 4, `mailbox-settings.ts` 16.

**How to convert.** The rules of stage 02 step 2 (name, `print` for `debug`/`info`, `fail` for `warn`/`error`, one string with the same characters). Also:

- A callback that a module function gets for its report lines (`log: (line) => log.info(line)` in `mailbox-probe-move.ts:66` and `mailbox-probe-send.ts:106`) becomes `(line) => out.print(line)`. The module function's parameter type does not change.
- `for (const line of reportLines(report)) log.info(line)` → `out.print(line)`.
- `error.message` stays where it is today in these scripts (D4: they test a mail server connection; the operator needs the server's reply). Do not add a new one.

**Decisions.** D3, D4, D23.

**Test.** These integration tests pass unchanged: `mail-check.test.ts`, `mail-connect.test.ts`, `mail-folders-cli.test.ts`, `mail-password.test.ts`, `mail-seed.test.ts`, `mailbox-backfill-cli.test.ts`, `imap-probe-move.test.ts`, `imap-probe-send.test.ts`, `triage-gate.test.ts` (it runs `mailbox:settings`), and every other test that `grep -rln "mailbox-\(audit\|backfill\|check\|connect\|password\|probe-move\|probe-send\|rescan\|seed\|settings\)" apps/server/test apps/server/src --include=*.test.ts` lists. A test that must change means a printed text changed: stop and report it.

**Check.** `grep -n "createLog" apps/server/src/scripts/mailbox-*.ts` prints nothing. Run the tests above with `bun test <files>`.

**Done when.** No `createLog` in the 10 files; the tests pass.

**Out of scope.** Module code that these scripts call (its lines are logs; the conversion stages own them).

## Step 2 — Final message

**Goal.** The coordinator sees the backlog fall.

**Done when.** The Proof of `plan.md` (stages 01–16, `/tmp/f103-s03`) prints `PROOF_OK`; the final message gives the `no-restricted-syntax` warning count of `lint.log` (at `0a5c2ee` minus stage 02 and 03: 395 − 55 − 70 = 270, other tickets may change it).

**Out of scope.** The lint level of `scripts/` (stage 04).
