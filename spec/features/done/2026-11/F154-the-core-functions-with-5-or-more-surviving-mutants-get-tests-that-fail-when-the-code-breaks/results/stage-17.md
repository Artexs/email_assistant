# Stage 17 results: sim live (days, dates, env guard, executive, message ids)

## Runs

Both runs: `bash scripts/test-audit/mutation.sh <dir> --mutate src/sim/live/calendar-days.ts --mutate src/sim/live/executive.ts --mutate src/sim/live/date-shift.ts --mutate src/sim/live/run-plan.ts --mutate src/sim/live/env-guard.ts --mutate src/sim/live/message.ts`.
The mutation lock queues runs, and the script copies the sources after it gets the lock. So each run started from a `git archive` copy of one commit: before = branch base `2bab01d3` (`/tmp/f154-s17/before`), after = tip `c2d4b2bb` (`/tmp/f154-s17/after2`).
An earlier after run at `aa38629c` (`/tmp/f154-s17/after`) printed `26 new cases kill no before-survivor` and exit 1. Tip `c2d4b2bb` removes those 26 cases (rows of `test.each` and tests that kill no before-survivor).
Compare: `bun scripts/test-audit/mutation-gaps.ts --before /tmp/f154-s17/before/mutation.json --after /tmp/f154-s17/after2/mutation.json` printed `0 new cases kill no before-survivor` and exited 0. Its full output is at the end of this file.
Only test files changed (`git diff 2bab01d3 --stat -- packages/core/src` lists `*.test.ts` only; `calendar-days.test.ts` is new).

## Before and after (counted mutants: survived plus no coverage)

| file | function | before | after |
| --- | --- | --- | --- |
| calendar-days.ts | isRealDate | 13 | 9 |
| executive.ts | cardsOf | 10 | 2 |
| date-shift.ts | shiftDatesInText | 9 | 3 |
| executive.ts | kindOf | 9 | 0 |
| run-plan.ts | planLiveRun | 8 | 5 |
| env-guard.ts | sendAddressesAllowed | 6 | 0 |
| message.ts | parseLabMessageId | 5 | 4 |
| calendar-days.ts | formatDay | 5 | 0 |

Under 5 after: `cardsOf`, `shiftDatesInText`, `kindOf`, `sendAddressesAllowed`, `parseLabMessageId`, `formatDay`. At 5 or more and all classed below: `isRealDate` (9), `planLiveRun` (5).
Other functions of the six files also fell or stayed (full table at the end): `matchCase` 4 to 3, `nearestDay` 3 to 2, `executiveTapAt` 3 to 1, `decideApproval` 2 to 1, `startPoint` 2 to 1, `dayNumberOf`, `parseDay`, `idOf`, `toLabMessage`, `addDays`, `press` to 0. Not a target and not changed: `pickEntry` 3, `checkSimEnv` 1, `executiveDecision` 1, `midnight` 1, `warsawOffsetMinutes` 1.

## Self-classed

Key = file, line:column, mutator, replacement. Every row below is a mutant of the after run (`after2`).

### isRealDate (9, all equivalent)

Reason: a brute-force probe over year -5..3000, month -3..16, day -3..40 (`/tmp/f154-s17/brute.ts`) shows the function gives the same answer without the guard on line 14, without the month test, or without the day test. Only the year test changes answers (a year below 100 maps to 19xx in `Date.UTC`; the new case `50-1-1` kills those). Any month or day out of range makes `Date.UTC` roll over the year or the month, so the round trip fails anyway.

| key | class |
| --- | --- |
| calendar-days.ts 14:7 LogicalOperator `(month < 1 \|\| month > 12) && day < 1` | equivalent |
| calendar-days.ts 14:7 ConditionalExpression `false` (3 mutants) | equivalent |
| calendar-days.ts 14:7 LogicalOperator `month < 1 && month > 12` | equivalent |
| calendar-days.ts 14:20 ConditionalExpression `false` | equivalent |
| calendar-days.ts 14:34 ConditionalExpression `false` | equivalent |
| calendar-days.ts 16:42 ConditionalExpression `true` (month test) | equivalent |
| calendar-days.ts 16:76 ConditionalExpression `true` (day test) | equivalent |

### planLiveRun (5, all equivalent)

Reason: the sort comparator reaches the slot id test only for equal times, and slot ids are unique. The result of the last branch (`1` or `0` for a larger id) does not change the order: the engine's stable sort asks `compare(later, earlier)` and a `0` keeps the order that a `1` gives. Probe (`/tmp/f154-s17/sort.test.ts`): a comparator with `a.id <= b.id ? 1 : 0` sorted 200 random shuffles each of 2, 3, 4, 5, 8, 12 and 20 tied items with 0 wrong orders.

| key | class |
| --- | --- |
| run-plan.ts 92:59 EqualityOperator `a.slotId <= b.slotId` (equal ids never occur) | equivalent |
| run-plan.ts 92:86 ConditionalExpression `true` | equivalent |
| run-plan.ts 92:86 ConditionalExpression `false` | equivalent |
| run-plan.ts 92:86 EqualityOperator `a.slotId >= b.slotId` | equivalent |
| run-plan.ts 92:86 EqualityOperator `a.slotId <= b.slotId` | equivalent |

The comparator mutants `a.at <= b.at`, `a.at > b.at` to `false` and `a.slotId < b.slotId` to `true` are killed by the new tie and order cases.

### parseLabMessageId (4, all equivalent)

Reason: a text with only one bracket gives `null` without the mismatch test too, because `LAB_ID` refuses a leading `<` and refuses `>` in the domain. `bracketed` is used only when both or neither bracket is there, so `&&` and the two `startsWith`/`endsWith` literals do not matter.

| key | class |
| --- | --- |
| message.ts 48:21 LogicalOperator `trimmed.startsWith("<") \|\| trimmed.endsWith(">")` | equivalent |
| message.ts 48:40 StringLiteral `""` | equivalent |
| message.ts 48:65 StringLiteral `""` | equivalent |
| message.ts 49:7 ConditionalExpression `false` | equivalent |

### shiftDatesInText (3)

| key | class | reason |
| --- | --- | --- |
| date-shift.ts 166:11 ConditionalExpression `false` (`!entry`) | unreachable | the month name comes from a pattern built from the same table, so `pickEntry` always finds an entry |
| date-shift.ts 180:9 ConditionalExpression `true` (`g.en !== undefined`) | equivalent | the English form is the last of four; when it is reached its group is set |
| date-shift.ts 182:73 ArrayDeclaration `["Stryker was here"]` | unreachable | the lower-case name is always a key of the table, so `?? []` never applies |

### cardsOf (2)

| key | class | reason |
| --- | --- | --- |
| executive.ts 168:9 ConditionalExpression `false` (`callback === null`) | equivalent | a null callback has no id, and `id === undefined` skips it |
| executive.ts 176:9 EqualityOperator `<=` | equivalent | an equal rank gives the same kind; the stored `callback` of the group is never read |

### Counted mutants in the other functions of the six files (not targets)

Left as they are, each class stated for the coordinator: `nearestDay` 109:31 `<=` and 111:7 `false` (equivalent: a tie needs two dates 182 days or more from the anchor, outside the 90-day window; with `best` undefined the result is undefined either way); `matchCase` 116:7 `true`, 116:7 `>= 1`, 116:63 `true` (equivalent: a month name always has 3 letters or more and letters); `pickEntry` 127:7, 128:7, 129:45 (equivalent: a one-entry list gives `entries[0]`, and a shared name lists English first); `executiveTapAt` 124:55 `- 1` (unstable: it changes only the one seed value out of about 5 million that hits the 90-minute end); `decideApproval` 71:9 `true` (equivalent: an undefined expected address never equals a recipient); `startPoint` 113:7 `<=` (equivalent: the equal case is taken by the first test); `executiveDecision` 87:14 `false` (equivalent: no `rw:undefined` button exists, so the result is the same no-rule answer); `checkSimEnv` 48:83 `"Stryker was here!"` (equivalent: neither text is a loopback root); `warsawOffsetMinutes` 51:10 `*` (equivalent: the value is only compared for equality); `midnight` 55:31 `""` (equivalent: an empty time reads as 00:00).

## Bugs

None. Two quirks are pinned, not bugs: `isRealDate` refuses a year below 100 (`50-1-1` is `false`) because of how `Date.UTC` maps those years, and an empty or unset send-address list gives no `send_address_not_scenario` issue (nothing to send to). Dates in this code are 4-digit years near 2026, so neither shows in use.

## Full output of the compare

| file | function | before | after |
| --- | --- | --- | --- |
| packages/core/src/sim/live/calendar-days.ts | isRealDate | 13 | 9 |
| packages/core/src/sim/live/executive.ts | cardsOf | 10 | 2 |
| packages/core/src/sim/live/date-shift.ts | shiftDatesInText | 9 | 3 |
| packages/core/src/sim/live/executive.ts | kindOf | 9 | 0 |
| packages/core/src/sim/live/run-plan.ts | planLiveRun | 8 | 5 |
| packages/core/src/sim/live/env-guard.ts | sendAddressesAllowed | 6 | 0 |
| packages/core/src/sim/live/message.ts | parseLabMessageId | 5 | 4 |
| packages/core/src/sim/live/calendar-days.ts | formatDay | 5 | 0 |
| packages/core/src/sim/live/date-shift.ts | matchCase | 4 | 3 |
| packages/core/src/sim/live/date-shift.ts | pickEntry | 3 | 3 |
| packages/core/src/sim/live/date-shift.ts | nearestDay | 3 | 2 |
| packages/core/src/sim/live/executive.ts | executiveTapAt | 3 | 1 |
| packages/core/src/sim/live/executive.ts | decideApproval | 2 | 1 |
| packages/core/src/sim/live/executive.ts | startPoint | 2 | 1 |
| packages/core/src/sim/live/calendar-days.ts | dayNumberOf | 2 | 0 |
| packages/core/src/sim/live/calendar-days.ts | parseDay | 2 | 0 |
| packages/core/src/sim/live/executive.ts | idOf | 2 | 0 |
| packages/core/src/sim/live/message.ts | toLabMessage | 2 | 0 |
| packages/core/src/sim/live/env-guard.ts | checkSimEnv | 1 | 1 |
| packages/core/src/sim/live/executive.ts | executiveDecision | 1 | 1 |
| packages/core/src/sim/live/run-plan.ts | midnight | 1 | 1 |
| packages/core/src/sim/live/run-plan.ts | warsawOffsetMinutes | 1 | 1 |
| packages/core/src/sim/live/calendar-days.ts | addDays | 1 | 0 |
| packages/core/src/sim/live/executive.ts | press | 1 | 0 |

| test file | case | kills |
| --- | --- | --- |
| packages/core/src/sim/live/calendar-days.test.ts | src/sim/live/calendar-days.test.ts > dayNumberOf and addDays > a text that is not a real date throws with the text | 4 |
| packages/core/src/sim/live/calendar-days.test.ts | src/sim/live/calendar-days.test.ts > formatDay > 2026, 12, 31 is 2026-12-31 | 2 |
| packages/core/src/sim/live/calendar-days.test.ts | src/sim/live/calendar-days.test.ts > formatDay > 2026, 3, 5 is 2026-03-05 | 4 |
| packages/core/src/sim/live/calendar-days.test.ts | src/sim/live/calendar-days.test.ts > formatDay > 987, 11, 22 is 0987-11-22 | 3 |
| packages/core/src/sim/live/calendar-days.test.ts | src/sim/live/calendar-days.test.ts > isRealDate > 1900-2-29 is false | 1 |
| packages/core/src/sim/live/calendar-days.test.ts | src/sim/live/calendar-days.test.ts > isRealDate > 2026-12-32 is false | 1 |
| packages/core/src/sim/live/calendar-days.test.ts | src/sim/live/calendar-days.test.ts > isRealDate > 2026-2-29 is false | 1 |
| packages/core/src/sim/live/calendar-days.test.ts | src/sim/live/calendar-days.test.ts > isRealDate > 2026-4-31 is false | 1 |
| packages/core/src/sim/live/calendar-days.test.ts | src/sim/live/calendar-days.test.ts > isRealDate > 50-1-1 is false | 5 |
| packages/core/src/sim/live/calendar-days.test.ts | src/sim/live/calendar-days.test.ts > parseDay > " 2026-03-05" is not a date | 1 |
| packages/core/src/sim/live/calendar-days.test.ts | src/sim/live/calendar-days.test.ts > parseDay > "2026-02-29" is not a date | 1 |
| packages/core/src/sim/live/calendar-days.test.ts | src/sim/live/calendar-days.test.ts > parseDay > "2026-03-05\n" is not a date | 1 |
| packages/core/src/sim/live/calendar-days.test.ts | src/sim/live/calendar-days.test.ts > parseDay > "2026-03-05x" is not a date | 1 |
| packages/core/src/sim/live/calendar-days.test.ts | src/sim/live/calendar-days.test.ts > parseDay > "x2026-03-05" is not a date | 1 |
| packages/core/src/sim/live/date-shift.test.ts | src/sim/live/date-shift.test.ts > shiftDatesInText forms and years > a day and month nearest to the anchor may fall in the next year | 2 |
| packages/core/src/sim/live/date-shift.test.ts | src/sim/live/date-shift.test.ts > shiftDatesInText forms and years > a month name of another language in the English order, Januar 29, 2027, stays | 2 |
| packages/core/src/sim/live/date-shift.test.ts | src/sim/live/date-shift.test.ts > shiftDatesInText forms and years > a month name of another language in the English order, Januar 29, stays | 2 |
| packages/core/src/sim/live/date-shift.test.ts | src/sim/live/date-shift.test.ts > shiftDatesInText forms and years > a month name of another language in the English order, März 5, stays | 2 |
| packages/core/src/sim/live/date-shift.test.ts | src/sim/live/date-shift.test.ts > shiftDatesInText forms and years > a month name of another language in the English order, stycznia 29, stays | 2 |
| packages/core/src/sim/live/date-shift.test.ts | src/sim/live/date-shift.test.ts > shiftDatesInText forms and years > a month name with mixed capitals follows the case of its first letter | 3 |
| packages/core/src/sim/live/date-shift.test.ts | src/sim/live/date-shift.test.ts > shiftDatesInText forms and years > a two-digit day and month keeps two digits, a one-digit day of a month name does not | 4 |
| packages/core/src/sim/live/date-shift.test.ts | src/sim/live/date-shift.test.ts > shiftDatesInText forms and years > a year below 1000 keeps four digits | 1 |
| packages/core/src/sim/live/date-shift.test.ts | src/sim/live/date-shift.test.ts > shiftDatesInText forms and years > a year in the text decides the date, whatever the anchor | 3 |
| packages/core/src/sim/live/date-shift.test.ts | src/sim/live/date-shift.test.ts > shiftDatesInText forms and years > an impossible date 30 lutego stays | 1 |
| packages/core/src/sim/live/date-shift.test.ts | src/sim/live/date-shift.test.ts > shiftDatesInText forms and years > an impossible date 31 lutego 2027 stays | 1 |
| packages/core/src/sim/live/date-shift.test.ts | src/sim/live/date-shift.test.ts > shiftDatesInText forms and years > an impossible date February 30 stays | 1 |
| packages/core/src/sim/live/date-shift.test.ts | src/sim/live/date-shift.test.ts > shiftDatesInText forms and years > the separators of a month-name date stay as they were | 2 |
| packages/core/src/sim/live/env-guard.test.ts | src/sim/live/env-guard.test.ts > checkSimEnv > the send addresses: a list of blanks and commas | 4 |
| packages/core/src/sim/live/env-guard.test.ts | src/sim/live/env-guard.test.ts > checkSimEnv > the send addresses: an allowed list with spaces and capitals | 1 |
| packages/core/src/sim/live/env-guard.test.ts | src/sim/live/env-guard.test.ts > checkSimEnv > the send addresses: an empty list | 4 |
| packages/core/src/sim/live/env-guard.test.ts | src/sim/live/env-guard.test.ts > checkSimEnv > the send addresses: an unset list | 5 |
| packages/core/src/sim/live/env-guard.test.ts | src/sim/live/env-guard.test.ts > checkSimEnv > the send addresses: two addresses when one is allowed | 1 |
| packages/core/src/sim/live/env-guard.test.ts | src/sim/live/env-guard.test.ts > checkSimEnv > the send addresses: two allowed addresses with spaces and a trailing comma | 3 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a button that names no action, set, mail or delegation is part of no card | 4 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: answered_yes is other | 2 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: approve is approval | 1 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: approve_set is reminder_set | 1 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: cancel is feedback | 1 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: delegate_open is other | 2 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: delegation_done is other | 4 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: mistake is other | 2 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: pick is feedback | 1 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: reject is approval | 1 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: reject_set is reminder_set | 1 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: reply_draft is other | 2 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: review_right is other | 2 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: right is feedback | 1 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: send_again is send_failed | 1 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > a single button: went_out is send_failed | 1 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > cardsOf by the kind of the button > buttons of one id with two kinds make one card of the kind that comes first in the card order | 5 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > executiveDecision approvals > a draft of another kind is rejected as not needed even when a clarification is expected | 1 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > executiveDecision approvals > a press with no reason is only the button, without a reason key | 1 |
| packages/core/src/sim/live/executive.test.ts | src/sim/live/executive.test.ts > executiveTapAt > a card at the first minute of the hours starts from that minute | 1 |
| packages/core/src/sim/live/message.test.ts | src/sim/live/message.test.ts > labMessageId and parseLabMessageId > an id with spaces around the bare form gives the slot and the run | 1 |
| packages/core/src/sim/live/message.test.ts | src/sim/live/message.test.ts > labMessageId and parseLabMessageId > an id with spaces around the brackets gives the slot and the run | 1 |
| packages/core/src/sim/live/message.test.ts | src/sim/live/message.test.ts > toLabMessage > a reply answers the last slot of the chain, whatever its length | 1 |
| packages/core/src/sim/live/message.test.ts | src/sim/live/message.test.ts > toLabMessage > a slot with no parent has no In-Reply-To header at all | 1 |
| packages/core/src/sim/live/run-plan.test.ts | src/sim/live/run-plan.test.ts > planLiveRun > a later slot with the smaller id comes after an earlier slot with the larger id, input: the earlier slot first | 1 |
| packages/core/src/sim/live/run-plan.test.ts | src/sim/live/run-plan.test.ts > planLiveRun > three slots at one time sort by slot id, input ids ascending | 2 |
| packages/core/src/sim/live/run-plan.test.ts | src/sim/live/run-plan.test.ts > planLiveRun > three slots at one time sort by slot id, input ids mixed | 2 |
| packages/core/src/sim/live/run-plan.test.ts | src/sim/live/run-plan.test.ts > planLiveRun > three slots at one time sort by slot id, input ids mixed the other way | 2 |

0 new cases kill no before-survivor
