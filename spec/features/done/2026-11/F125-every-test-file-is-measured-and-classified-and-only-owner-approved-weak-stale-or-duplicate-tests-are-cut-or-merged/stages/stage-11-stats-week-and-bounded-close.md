# F125 stage 11 — G01 part 3: the stats:week argument case is cut to one spawn, and the bounded IMAP close moves to a unit test

Part of [`../plan.md`](../plan.md) § Phase B. Needs stage 08: `cut-keys.ts`; stage 08b: `cut-run.sh`, `cut-proof.ts`. May run next to 09, 10, 12–20. Gets a review job (plan § Review).

Group G01 (`MOVE-TO-UNIT`, owner `ok`). Rows: `audit/review-int-e2e.md` rows 146 and 212. Follow plan § Cut stage steps (S1–S7).

## Rows of this stage

- `apps/server/test/integration/stats-week-cli.test.ts:56` "a week that is not a Monday, a bad id or a stray argument print the usage and exit 2".
- `apps/server/test/integration/mail-sent-budget.test.ts:328` "a LOGOUT that never returns ends with client.close() after the timeout".

## Step 1 — stats:week arguments: cut the int case to one spawn

- The row names `readStatsWeekOptions`; at 1685baff the function is `parseStatsWeekArgs` in `apps/server/src/scripts/stats-week-args.ts` (it throws `UsageError`). This is a rename, not a deferral.
- `apps/server/src/scripts/stats-week-args.test.ts` already has one `test.each` with seven argument lists, each `toThrow(UsageError)` (plan review 3, finding 2). Add no unit row. Confirm that each of the six argument lists of the int case has a row there, and write the row label for each list in the log. A list with no row: the int case keeps that spawn, and the log says why. An exact-message assert in the table is a rewrite and out of scope.
- **D16** (default, owner to confirm: `questions.md` Q7) The int case keeps one spawn, the empty argument list, with its three asserts (exit 2, the usage line on stderr, empty stdout). The other five spawns go. Reason: the parse function does not prove that the script maps `UsageError` to exit 2 and the usage line; the evidence row named the exit-1 case (row 135) as the wiring check, but that case covers exit 1 only. Rejected: remove all six spawns. The int case count does not change; the time drops by five spawns.

## Step 2 — Bounded close

- Move the case to `apps/server/src/modules/mail/imap/client.test.ts` (the file next to `createImapMailProvider`).
- **D17** (default, owner to confirm: Q8) The unit case uses Bun fake timers (`jest.useFakeTimers()` of `bun:test`; a probe on Bun 1.4.4 on 2026-11-20 advanced a 3 s `setTimeout` in 3 ms). It asserts `closed` is 0 after `CLOSE_LOGOUT_TIMEOUT_MS − 1` ms and 1 after `CLOSE_LOGOUT_TIMEOUT_MS`. Reason: the unit lane has no real multi-second wait (the parallel-runs ticket F124, which made unit runs fast, set that rule), and a cut stage changes no product code (Cut stage rule 5), so no shorter injected timeout. If fake timers do not reach the timer in `client.ts`, the case stays in the int file and the row is deferred with that reason.
- The twin case "a LOGOUT that works…" is no row and stays.

## Proof (S5)

- Before: both int files and both unit files. After: the same four files.
- `--expect unit=+1,int=-1` (the bounded close moves; the stats:week int case stays one case with one spawn). Adjust only for a deferred row and write why.
- Break once: change the `UsageError` throw of `parseStatsWeekArgs` to return defaults for a missing org id (the existing "no argument" row and the remaining spawn fail), and set the close timer to `CLOSE_LOGOUT_TIMEOUT_MS + 1` (the unit case fails); restore both.

## Out of scope

- Any product code change (both breaks are reverted).
- The other spawning CLI tests (`audit/report.md` § 4 item 2).

## Done when

- `audit/cut-s11.md` holds the keys, the rename note, the six list-to-row lines, the `cut-proof` PASS section and both break-once lines.
- One commit, message `F125 G01 MOVE-TO-UNIT: stats:week argument case to one spawn, the bounded close to unit`.
- Last step: `bun run check:job`; copy its last line.
