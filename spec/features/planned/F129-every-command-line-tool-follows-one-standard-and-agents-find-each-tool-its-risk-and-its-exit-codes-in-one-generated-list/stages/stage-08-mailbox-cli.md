# F129 stage 08 — The `mailbox-cli` tools

Needs stage 01: `runCli`, `exitCodeOf`. Needs stage 02: `cli-pending.json` group `mailbox-cli`, the standard test. Needs stage 04: `scripts/lib/mailbox-cli.ts`, `lib/mailbox-backfill-gate.ts`. May run next to 05–07 and 09–15.

Part of [`../plan.md`](../plan.md). Decisions: D5, D7, D9. Recipe: `docs/cli.md` § Convert a tool.

## Tools

| Command | Risk | Needs | Notes |
| --- | --- | --- | --- |
| `mailbox:seed` | dev | db, greenmail | appends fixtures by IMAP; its refusal of a non-GreenMail host stays |
| `mailbox:audit` | read | db, imap | lost or duplicate INBOX mail 2 → 1 (`exits[1]`: "lost or duplicate mail found"); the code comes from `modules/mail/audit.ts`, in scope |
| `mailbox:signals` | read | db, imap | |
| `mailbox:backfill` | write | db, imap | long run; `exits[4]`: "stopped at its limit; run again to continue", only if it has such a stop today |

## Step 1 — One shared start in `lib/mailbox-cli.ts`

- **Goal:** the four tools load config only after the parse, so `--help` and a bad flag need no env.
- **Interface:** `lib/mailbox-cli.ts` keeps its exported helpers but its config load becomes a function the entries call inside `main`, after their parse; no module-level config read remains.
- **Decisions:**
  - These tools print through `platform/log` event lines today (F103 D26 for the scripts it names; check the F103 plan for these four). Event lines stay; free text goes through `createCliOutput`. Do not turn an event line into a text line or back.
  - `mailbox:backfill` and its lock: Ctrl-C leaves the lock and the cursor as today (no signal handler, D5). A run after Ctrl-C continues; the existing test of the lock stays green.
  - D9: no new dev-DB guard on `mailbox:seed`.

## Step 2 — Convert the four tools

- Follow the recipe. `process.exit` at the end of each entry goes; `runCli` owns the exit.
- Callers to update: `docs/capabilities/sync.md` (the `mailbox:audit` exit 2 line), `docs/capabilities/live-lab.md`, `notes/` are history (no edit), `deploy/README.md` backfill section, `apps/server/test/integration/mailbox-oauth-cli.test.ts`, `mail-hosts-configured.test.ts`.

## Test

1. `bun run mailbox:seed --help` with env `{ PATH, HOME }` → exit 0 (fails at HEAD with "Missing or bad config keys"): the standard test covers it once the file leaves `cli-pending.json`.
2. `mailbox-seed-args`: an unknown flag and a non-number `--count` → `UsageError`; existing bound cases keep their values. Add no new bound (shape only).
3. `mailbox-signals-args` (no test today): valid input and each invalid input → usage.
4. Inline parsers of `mailbox:audit` and `mailbox:backfill` move to `mailbox-audit-args.ts` and `mailbox-backfill-args.ts`, each with a unit test (valid case; missing `--org-id`; bad `--since` date → usage).
5. `mailbox:audit` on a mailbox with a missing INBOX mail → exit 1 (was 2); its lines unchanged (update the existing audit test).
6. Integration: the existing `mailbox:backfill` lock test and the seed test pass unchanged, apart from exit 1 → 2 for bad arguments.

**Guard check:** call the config load at module level in `lib/mailbox-cli.ts` again → the standard test fails for `mailbox:seed` (spawn with `--no-env-file`); restore. Name both runs in the final message.

## Out of scope

The sync and backfill logic; other mailbox tools (stage 07).

## Done when

Steps 1–2 done; the four files are out of `cli-pending.json`; the standard test passes for them; the plan.md Proof with `s08` prints `PROOF_OK`.
