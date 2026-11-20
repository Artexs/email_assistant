# F125 stage 11 — G01 part 3: the stats:week argument spawns and the bounded IMAP close move to unit tests

Part of [`../plan.md`](../plan.md) § Phase B. Needs stage 08: `cut-keys.ts`, `cut-run.sh`, `cut-proof.ts`. May run next to 09, 10, 12–20. Gets a review job (plan § Review).

Group G01 (`MOVE-TO-UNIT`, owner `ok`). Rows: `audit/review-int-e2e.md` rows 146 and 212. Follow plan § Cut stage steps (S1–S7).

## Rows of this stage

- `apps/server/test/integration/stats-week-cli.test.ts:56` "a week that is not a Monday, a bad id or a stray argument print the usage and exit 2".
- `apps/server/test/integration/mail-sent-budget.test.ts:328` "a LOGOUT that never returns ends with client.close() after the timeout".

## Step 1 — stats:week arguments

- The row names `readStatsWeekOptions`; at 1685baff the function is `parseStatsWeekArgs` in `apps/server/src/scripts/stats-week-args.ts` (it throws `UsageError`). Use it; this is a rename, not a deferral.
- Unit: one `test.each` table in `apps/server/src/scripts/stats-week-args.test.ts` with the six argument lists of the int case as rows (labels name the bad part: not a Monday, 30 February, bad org id, bad mailbox id, stray argument, no arguments). Each row asserts `toThrow(UsageError)` and the exact message.
- **D16** (default, owner to confirm: `questions.md` Q7) The int case stays with one spawn, the empty argument list, and keeps its three asserts (exit 2, the usage line on stderr, empty stdout). Reason: the parse function does not prove that the script maps `UsageError` to exit 2 and the usage line; the evidence row named the exit-1 case (row 135) as the wiring check, but that case covers exit 1 only. Rejected: remove all six spawns. The int case count does not change; the time drops by five spawns.

## Step 2 — Bounded close

- Move the case to `apps/server/src/modules/mail/imap/client.test.ts` (the file next to `createImapMailProvider`).
- **D17** (default, owner to confirm: Q8) The unit case uses Bun fake timers (`jest.useFakeTimers()` of `bun:test`; a probe on Bun 1.4.4 on 2026-11-20 advanced a 3 s `setTimeout` in 3 ms). It asserts `closed` is 0 after `CLOSE_LOGOUT_TIMEOUT_MS − 1` ms and 1 after `CLOSE_LOGOUT_TIMEOUT_MS`. Reason: the unit lane has no real multi-second wait (the parallel-runs ticket F124, which made unit runs fast, set that rule), and a cut stage changes no product code (Cut stage rule 5), so no shorter injected timeout. If fake timers do not reach the timer in `client.ts`, the case stays in the int file and the row is deferred with that reason.
- The twin case "a LOGOUT that works…" is no row and stays.

## Proof (S5)

- Before: both int files and both unit files. After: the same four files.
- `--expect unit=+7,int=-1` (6 table rows and 1 case; the stats:week int case stays). Adjust only for a deferred row and write why.
- Break once: change the `UsageError` throw of `parseStatsWeekArgs` to return defaults for a missing org id (a row fails), and set the close timer to `CLOSE_LOGOUT_TIMEOUT_MS + 1` (the unit case fails); restore both.

## Out of scope

- Any product code change (both breaks are reverted).
- The other spawning CLI tests (`audit/report.md` § 4 item 2).

## Done when

- `audit/cut-s11.md` holds the keys, the rename note, the `cut-proof` PASS section and both break-once lines.
- One commit, message `F125 G01 MOVE-TO-UNIT: stats:week arguments and the bounded close to unit`.
- Last step: `bun run check:job`; copy its last line.
