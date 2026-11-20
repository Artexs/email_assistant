# Stage 12 results: notices, weekly report, local time

Sources: `packages/core/src/digest/notices.ts`, `digest/weekly.ts`, `digest/local-time.ts`, `notices/render.ts`, `notices/renderers.ts`, `notices/views.ts`. Tests: `digest/notices.test.ts`, `digest/weekly.test.ts`, `digest/local-time.test.ts`, `notices/trust.test.ts`, and the new `notices/render.test.ts`.

The before run held only the old tests (it started before the first edit of the worktree). The after run is at the test commit `ccba8055`. Commands:

```
bash scripts/test-audit/mutation.sh /tmp/f154-s12/before --mutate src/digest/notices.ts --mutate src/digest/weekly.ts --mutate src/digest/local-time.ts --mutate src/notices/render.ts --mutate src/notices/renderers.ts --mutate src/notices/views.ts
bash scripts/test-audit/mutation.sh /tmp/f154-s12/after  --mutate <the same six>
bun scripts/test-audit/mutation-gaps.ts --before /tmp/f154-s12/before/mutation.json --after /tmp/f154-s12/after/mutation.json   # exit 0
```

The full gap tool output (every function of the six files and every new case with its kill count) is in `results/stage-12-gaps.md`. Its last line: `0 new cases kill no before-survivor`.

An earlier after run (`after1`, at `8737635a`) listed 42 new cases that killed nothing. They were cut or replaced in `ccba8055` and the run was repeated; only the second run counts.

## Before and after (counted mutants: survived plus no coverage)

| Function | Before | After |
| --- | --- | --- |
| `renderActionFailedNotice` | 12 | 0 |
| `renderUrgentNotice` | 6 | 1 |
| `evidenceItems` | 12 | 1 |
| `autoItems` | 7 | 0 |
| `renderWeeklyReport` | 7 | 0 |
| `localInstants` | 8 | 8 |
| `lateMin` | 6 | 5 |
| `renderNotice` | 10 | 10 |
| `noticeRenderers.urgent.telegram.full` | 12 | 3 |
| `trustUrl` | 6 | 2 |

Other functions of the same files: `quietEnd` 3 to 3, `isQuietTime` 2 to 1, `renderSyncStaleNotice` 2 to 0, `renderSendHeldNotice` 1 to 0, `startOfLocalDay` 1 to 1, the `text` helper of `localParts` 1 to 1. Three functions stay at 5 or more (`localInstants`, `lateMin`, `renderNotice`): every one of their survivors is self-classed below.

## Cases added

- `renderActionFailedNotice`: the exact last line of an original `create_draft`, and of an original and a reverse `flag` and `mark_read` (the join of tries, place and status when the place is empty); an original `move` after `bad_payload` has no folder in the first line.
- `renderUrgentNotice`: no AI text gives no empty line; `delegable` gives the Delegate button in the first row.
- `renderSyncStaleNotice` with a last good sync; `renderSendHeldNotice` for a follow-up with and without the panel link.
- `renderWeeklyReport` through its public function: the mail line for the three `important`/`triaged` shapes, the review sample line from one labelled mail, the shadow-mode line (three shapes), each auto item shape (no row, 29 kept, no precision, no lower bound, lower bound), two `auto` rows of one category (more kept labels wins, a tie keeps the first), a trip that is not tripped, a tripped row with no reason ahead of one with a reason, two `auto` rows for the proof and check, proof `none`, check `fail` and an unknown outcome.
- `notices/render.test.ts`: the urgent notice on Telegram `full` with every optional field (exact lines and both button rows) and with no action to show (the stay folder).
- Local time: `isQuietTime` at the start of a window that does not wrap midnight; `lateMin` over such a window.
- `trust.test.ts`: a settings link with a password and no user name; a link that passes the pattern but is no URL; a report link with 36 characters that are not a UUID.
- The values of the stage file for `localToInstant`, `startOfLocalDay` and `lateMin` at the range edge all held, but each killed no before-survivor (the existing tests already killed those mutants), so the gap tool refused them and they are not added. The same holds for the plain-form and refusal cases of `renderNotice`, the bare-view urgent case, and most `trustUrl` refusal rows.

## Self-classed (all remaining survivors of the table functions, and of the other functions of the files)

Keys are line:column in the file at this commit, then mutator and replacement. Every row survives the final run. Every local-time row was also run against the original over a sweep of the four zones Warsaw, Havana, Lord Howe and New York: `localToInstant` and `startOfLocalDay` over 40 dates and 9 times each, and `isQuietTime`, `quietEnd` and `lateMin` over 120 hours in three windows, eight quiet settings and several spans. The 19 local-time mutants gave the same 93 760 results as the original (the script is `/tmp/f154-s12/eq/`; it is not in the repo).

| Function | Key | Class | Reason |
| --- | --- | --- | --- |
| `localInstants` | 126:68 `a + b` | equivalent | The set holds the candidate for the offset before the change first. In the autumn repeat that offset is the larger one, so its instant is the smaller: the list is already sorted. |
| `localInstants` | 129:26 `true`, 129:26 `before <= after` | equivalent (2) | A gap exists only when the offset grows, so `before < after` always holds there; the offsets never match in a gap. |
| `localInstants` | 129:61 `[]` | unreachable | The `else` array runs only when `before >= after`, which cannot be a gap. |
| `localInstants` | 132:10 `>=`, 132:10 `high + low` | equivalent (2) | The search shrinks to one minute; the next step then gives `mid === low` and the break ends it, so the result is the same. |
| `localInstants` | 134:9 `false`, 134:9 `<` | equivalent (2) | `mid <= low` holds only for a range under two minutes, which the loop condition never lets in: offsets are whole minutes. |
| `lateMin` | 202:7 `<` | equivalent | With `to === from` the quiet minutes are 0 and the result is 0 either way. |
| `lateMin` | 204:7 `true` | equivalent | With `start === end` the window starts and ends at one instant and adds 0. |
| `lateMin` | 205:19 `>=` | equivalent | The block runs only when `start !== end`. |
| `lateMin` | 214:14 `<=`, 215:11 `true` | equivalent (2) | One more loop turn reads the day after the last day: its window starts after `to` and adds 0. |
| `renderNotice` | 24:7 `false` | equivalent | `render` is called inside the `try`; calling `undefined` throws a `TypeError`, which the `catch` maps to the same `{ ok: false }`. |
| `renderNotice` | 31:7 `false` (twice), 31:7 `&&`, 31:34 `false`, 31:82 `{}`, 31:88 `true` | unreachable (6) | No renderer gives an empty text or one over 4096 characters: the digest view schema caps its text at the limit, and the card renderers cut to it or throw (the `catch` handles that). |
| `renderNotice` | 32:7 `false`, 32:68 `{}`, 32:74 `true` | unreachable (3) | The buttons come from fixed renderers and from the digest view, which `outButtonsSchema` already checked. |
| `noticeRenderers.urgent.telegram.full` | 120:27 `""` | equivalent | `aiTextFor` has no branch for `urgent`; `""` takes the same last branch. |
| `noticeRenderers.urgent.telegram.full` | 138:17, 139:17 `false` | equivalent (2) | The spread of an absent field gives `{ suspicious: undefined }`; the renderer reads `undefined` like an absent key. |
| `renderUrgentNotice` | 70:27 `""` | equivalent | `whySuffix` treats only `unsure` differently. |
| `evidenceItems` | 65:9 `paused?.trip.reason` | equivalent | `paused` is found only when its `trip` is set. |
| `trustUrl` | 280:12 regex without `^`, 280:12 regex without `$` | equivalent (2) | The query is 45 characters long when `slice(9)` is a UUID, so a match must start at 0 and end at the end; `uuidPattern` is anchored on both sides. |
| `quietEnd` | 190:19 `>=`, 192:74 `>=` | equivalent (2) | Equal start and end return before (`isQuietTime` is false); an end instant equal to `at` cannot happen while `at` is quiet. |
| `quietEnd` | 194:27 `-` | unreachable | The fallback needs a zone that changes its rules twice in two days. |
| `isQuietTime` | 180:7 `<=` | equivalent | Equal start and end return on the line above. |
| `startOfLocalDay` | 152:52 `""` | equivalent | `Number("")` is 0: `""` reads as 00:00. |
| `localParts` text helper | 50:93 | unreachable | The part always exists. |

The classes exceed the cap of the plan for `localInstants` (8), `lateMin` (5), `renderNotice` (10) and the stage; the job instruction is to class them and finish, and the coordinator accepts the classes.

## Bugs

None. No surviving mutant shows wrong current behaviour.
