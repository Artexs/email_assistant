# F125 stage 15 — CLI stream tables (group G03, MERGE-TABLE)

Base: master at the stage base. File: `apps/server/test/integration/cli-streams-other.test.ts` (no open `limen/*` branch changes it; checked with `git diff --name-only master...<branch>` for every unmerged branch).

## Keys

`cut-keys --group G03 --area apps/server/test/integration/cli-streams-other.test.ts`: 9 keys, 3 `ok` (the missing-`DATABASE_URL` cases), 6 `deferred-none` because the cases were renamed (`exit 2` for the usage cases, `unreachable:` and `exit 3` for the database-down cases). The 6 re-resolved by their new name in the fresh scan (`/tmp/f125-s15/scan/cases-static.tsv`); each name has one case in its describe. All 9 keys are cut; none is deferred or rejected.

| Old key (`:line`) | Case at the stage base (`:line`) | Table |
| --- | --- | --- |
| 249 | 269 org-status: a bad --org-id | usage |
| 372 | 392 triage-cost: a bad option | usage |
| 409 | 429 triage-label: a bad option | usage |
| 301 | 321 telegram-unlink: a database that is down | database down |
| 378 | 398 triage-cost: a database that is down | database down |
| 444 | 464 triage-label: a database that is down | database down |
| 309 | 329 telegram-unlink: a missing DATABASE_URL | missing url |
| 386 | 406 triage-cost: a missing DATABASE_URL | missing url |
| 452 | 472 triage-label: a missing DATABASE_URL | missing url |

## Kept apart

- The org-status "database that is down" and "missing DATABASE_URL" cases are not approved keys (the review row names them as outside the group). They stay plain cases in `org-status streams`.
- The existing table `failed lines of the database scripts` is unchanged. Merging the new rows into it would rename the cases (its names are built from the script name), so the sorted JUnit names would differ. The three new tables hold the rows instead.

## Shape

One describe, `the same stream line of several scripts`, holds three `test.each` tables. Each row spawns the same script with the same arguments and checks the same code and stream text as its old case. No `beforeAll` hoist; these cases had no setup. A row keeps the exact old case name, so the usage table and the two tables of triage-cost/triage-label/telegram-unlink rows repeat a name inside one table. The class name (the describe) of these 9 cases changes from `<script> streams` to the new describe; the `name` list does not change.

## cut-proof (`--expect int=+0`)
Before: `/tmp/f125-s15/before-1`, `/tmp/f125-s15/before-2`. After: `/tmp/f125-s15/after`. Expected: unit=+0, int=+0.

| lane | cases before | cases after | serial time before | serial time after |
| --- | --- | --- | --- | --- |
| unit | 0 | 0 | 0.00 s | 0.00 s |
| int | 53 | 53 | 41.28 s | 71.83 s |

- Case counts: pass.
- Covered lines: pass; 1 noise files skipped.
- Mutants: not checked (no mutation.json on both sides); 0 on one side only.

Result: PASS


The int serial time went from 41.28 s to 71.83 s between the two runs. The runs were not under the same machine load (other jobs ran in parallel); the table spawns the same 9 scripts, so no change in spawns is expected. Guess, not verified.

## Name diff

`grep -o '<testcase name="[^"]*"' int.xml | sort` before (`before-1`) against after: empty diff, 53 names each.

## Break once per table

Each break changed one row of one table and ran `bun test <file> -t "the same stream line"` (9 cases); the file was restored from a copy after each.

- Usage table: expected text of the triage-cost row changed to `usage: bun run triage:costX`: 1 fail (a bad option: the usage on stderr, exit 2), 8 pass.
- Database-down table: expected exit code of the triage-label row changed to 4: 1 fail (a database that is down: `unreachable:` on stderr, exit 3), 8 pass.
- Missing-url table: expected stderr text of the telegram-unlink row changed to `failedX: `: 1 fail (a missing DATABASE_URL ... exit 1), 8 pass.
