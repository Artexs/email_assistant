# Cut stage 11: the stats:week argument case and the bounded close

Base: master at the merge `e2bfbc7c`. Rows: `audit/review-int-e2e.md` rows 146 and 212 (owner `ok`).

## Keys (`cut-keys.ts`, fresh scan at the base)

| old key | status | key at the base |
| --- | --- | --- |
| `apps/server/test/integration/stats-week-cli.test.ts:56` | `deferred-none` (the int case was renamed: the name ends `exit 2`, not `exit 1`) | re-resolved as `apps/server/test/integration/stats-week-cli.test.ts::a week that is not a Monday, a bad id or a stray argument print the usage and exit 2`: `ok`, line 56 |
| `apps/server/test/integration/mail-sent-budget.test.ts:328` | `ok` | `apps/server/test/integration/mail-sent-budget.test.ts:328` |

## Rename note

The row names `readStatsWeekOptions`. At the base the function is `parseStatsWeekArgs` in `apps/server/src/scripts/stats-week-args.ts` (it throws `UsageError`). This is a rename, not a deferral.

## The six argument lists and their rows in `stats-week-args.test.ts` (`test.each` of `parseStatsWeekArgs`)

1. `["--org-id", orgId, "--week", "2026-11-17"]` → row "a day that is not a Monday".
2. `["--org-id", orgId, "--week", "2026-02-30"]` → row "a date that does not exist".
3. `["--org-id", "not-a-uuid"]` → row "an --org-id that is no uuid".
4. `["--org-id", orgId, "--mailbox-id", "x"]` → row "a --mailbox-id that is no uuid".
5. `["--org-id", orgId, "stray"]` → row "an operand".
6. `[]` → row "no argument". The int case keeps this spawn: the parse row does not prove that the script maps `UsageError` to the usage line and exit 2.

No unit row added. The int case is now named "an empty argument list prints the usage and exits 2" and keeps its three asserts (exit 2, usage line on stderr, empty stdout). The other five spawns are gone.

## The bounded close

The case moved to `apps/server/src/modules/mail/imap/client.test.ts` (`bounded close`), with `jest.useFakeTimers()` of `bun:test`. It asserts `closed` is 0 after `CLOSE_LOGOUT_TIMEOUT_MS - 1` ms and 1 after `CLOSE_LOGOUT_TIMEOUT_MS`. Fake timers reach the timer of `client.ts`: no deferral. The twin case "a LOGOUT that works does not call client.close()" stays in the int file.

## cut-proof

Files: both int files and both unit files, `cut-run.sh` twice before and once after, `--expect unit=+1,int=-1`.

| lane | cases before | cases after | serial time before | serial time after |
| --- | --- | --- | --- | --- |
| unit | 53 | 54 | 0.37 s | 0.39 s |
| int | 21 | 20 | 11.93 s | 7.71 s |

- Case counts: pass.
- Covered lines: pass; 1 noise files skipped.
- Mutants: not checked (no mutation.json on both sides); 0 on one side only.

Result: PASS


## Break once (both reverted; `git diff` of product code is empty)

- `parseStatsWeekArgs` returns defaults when `--org-id` is missing: the unit row "no argument is a usage error" fails, and the remaining int spawn "an empty argument list prints the usage and exits 2" fails.
- The close timer set to `CLOSE_LOGOUT_TIMEOUT_MS + 1`: the unit case "a LOGOUT that never returns ends with client.close() exactly at the timeout" fails (5 s test timeout, the close never fires at the timeout).
