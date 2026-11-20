# Stage 11 results: digest render, review list, schedule, callbacks

## Runs

Both runs: `bash scripts/test-audit/mutation.sh <dir> --mutate src/digest/digest.ts --mutate src/digest/review.ts --mutate src/digest/schedule.ts --mutate src/digest/callback.ts --mutate src/digest/callback-kinds.ts`. The stage table names four files; `isReplyCallback` and `base64UrlToUuid` now live in `callback-kinds.ts`, so that file is mutated too.
The mutation lock queued each run for a long time. The before run used a copy of the branch base made before the first new test (`/tmp/f154-s11/before`); the after run used a copy of tip `4a2f46e5` (`/tmp/f154-s11/after2`). A later commit removed one more case that kills no before-survivor (`dueDigestSlot at the edges of the six hours > a slot equal to the key after which none is wanted…`, kills 0 in the after run); removing a case that kills nothing cannot change a mutant status, so no third run was made.
Compare: `bun scripts/test-audit/mutation-gaps.ts --before /tmp/f154-s11/before/mutation.json --after /tmp/f154-s11/after2/mutation.json` printed `1 new case kills no before-survivor` (the case named above) and exited 1; the removal leaves 0.

## Before and after (counted mutants: survived plus no coverage)

| file | function | before | after |
| --- | --- | --- | --- |
| digest.ts | renderListed | 13 | 6 |
| digest.ts | sortItems | 10 | 4 |
| digest.ts | cutToLimit | 7 | 0 |
| digest.ts | renderDigestWithBrief | 6 | 2 |
| review.ts | renderListed | 6 | 0 |
| digest.ts | briefOptions | 5 | 2 |
| digest.ts | renderDigestMinimal | 5 | 0 |
| schedule.ts | dueDigestSlot | 5 | 0 |
| callback-kinds.ts | base64UrlToUuid | 4 | 3 |
| digest.ts | headerLine | 3 | 0 |
| callback-kinds.ts | callbackKinds.delegate_pick.decode | 2 | 1 |
| callback-kinds.ts | uuidToBase64Url | 2 | 1 |
| digest.ts | removedByBrief | 2 | 1 |
| digest.ts | hasProblem | 2 | 0 |
| digest.ts | section | 2 | 0 |
| schedule.ts | nextDigestTime | 2 | 0 |
| schedule.ts | parseDigestTimesInput | 2 | 0 |
| callback-kinds.ts | codedDecode | 1 | 1 |
| callback-kinds.ts | idDecode | 1 | 1 |
| digest.ts | digestMinimalFacts | 1 | 0 |
| digest.ts | itemBlock | 1 | 0 |
| digest.ts | mailboxLine | 1 | 0 |
| review.ts | renderReviewPage | 1 | 0 |
| schedule.ts | isLateSlot | 1 | 0 |

Listed functions that stay at 5 or more counted mutants: `renderListed` (digest.ts, 6). All 6 are classed below. Every other listed function is under 5 or at 0. `isReplyCallback` is gone: the reply family test is `isCallbackOfFamily` in `callback-kinds.ts`, which has no counted mutant. `callback.ts` itself has none.

## New cases and kills of before-survivors

| test file | case | kills |
| --- | --- | --- |
| callback.test.ts | callback.test.ts > the delegate pick data holds each id as 22 characters of base64url > 00000000-0000-4000-8000-000000000001 and ffffffff-ffff-4fff-bfff-ffffffffffff encode to dp:AAAAAAAAQACAAAAAAAAAAQ:________T_-__________w and parse back | 2 |
| callback.test.ts | callback.test.ts > the delegate pick data holds each id as 22 characters of base64url > a last character that is not the canonical one of its 16 bytes gives null, in either part | 1 |
| callback.test.ts | callback.test.ts > the delegate pick data holds each id as 22 characters of base64url > ffffffff-ffff-4fff-bfff-ffffffffffff and 00000000-0000-4000-8000-000000000001 encode to dp:________T_-__________w:AAAAAAAAQACAAAAAAAAAAQ and parse back | 2 |
| digest.test.ts | digest.test.ts > a digest with a brief at the 4096 characters > a text of exactly the maximum keeps every line of the brief | 1 |
| digest.test.ts | digest.test.ts > a mailbox that synced exactly 30 minutes ago > the line is the plain one; a millisecond more makes it late | 1 |
| digest.test.ts | digest.test.ts > one mail without a summary and the cut text > a mail with no AI text has no summary line and no empty line in its block | 2 |
| digest.test.ts | digest.test.ts > one mail without a summary and the cut text > a text cut to the limit has no buttons and names no loop | 3 |
| digest.test.ts | digest.test.ts > one mail without a summary and the cut text > two rows of 4 buttons share one keyboard line of 8; a third button on a row starts a new line | 2 |
| digest.test.ts | digest.test.ts > the 4096 characters of a message > a cut at the first half of the first pair keeps 4094 characters before the mark | 6 |
| digest.test.ts | digest.test.ts > the 4096 characters of a message > a cut at the first half of the last pair keeps 4094 characters before the mark | 6 |
| digest.test.ts | digest.test.ts > the 4096 characters of a message > a cut at the last character before the surrogates keeps 4095 characters before the mark | 1 |
| digest.test.ts | digest.test.ts > the 4096 characters of a message > a cut at the second half of a pair keeps 4095 characters before the mark | 3 |
| digest.test.ts | digest.test.ts > the 4096 characters of a message > a text of exactly the maximum stays whole | 2 |
| digest.test.ts | digest.test.ts > the 4096 characters of a message > a text one character over is cut to the maximum with the mark at the end | 1 |
| digest.test.ts | digest.test.ts > the footer of a digest with a brief > a digest in shadow mode needs every mailbox in shadow mode for the shadow line | 1 |
| digest.test.ts | digest.test.ts > the footer of a digest with a brief > a digest with a brief block has an empty line before and after the block | 3 |
| digest.test.ts | digest.test.ts > the footer of a digest with a brief > no open loop gives no count line | 3 |
| digest.test.ts | digest.test.ts > the footer of a digest with a brief > the urgent mails of the brief leave the list and the more line counts only the other mails of their category | 2 |
| digest.test.ts | digest.test.ts > the header of a digest > a scheduled digest with a slot shows the slot time; an on-demand one shows the time of the build, slot or not | 4 |
| digest.test.ts | digest.test.ts > the message of one mail and the +N more line > a count above the listed mails gives the more line with the exact rest | 1 |
| digest.test.ts | digest.test.ts > the message of one mail and the +N more line > no items and no count gives no section and no footer | 1 |
| digest.test.ts | digest.test.ts > the message of one mail and the +N more line > one listed mail gives the exact text, one keyboard row and no more line | 2 |
| digest.test.ts | digest.test.ts > the minimal digest > a promise alone gives the promise count | 3 |
| digest.test.ts | digest.test.ts > the minimal digest > a scheduled digest shows the slot clock, both sections with counts and the link | 4 |
| digest.test.ts | digest.test.ts > the minimal digest > a waiting loop alone gives the waiting count | 2 |
| digest.test.ts | digest.test.ts > the minimal digest > no mailbox with a problem gives no line | 4 |
| digest.test.ts | digest.test.ts > the minimal digest > no open loop gives no line | 4 |
| digest.test.ts | digest.test.ts > the minimal digest > one mailbox with a problem gives the singular line | 2 |
| digest.test.ts | digest.test.ts > the minimal digest > the Polish digest follows the Polish plurals and a section with no mail shows its count only | 4 |
| digest.test.ts | digest.test.ts > the minimal digest > three mailboxes with a problem give the plural line | 2 |
| digest.test.ts | digest.test.ts > the minimal facts of a digest > a mailbox with a blocked host counts 1 | 1 |
| digest.test.ts | digest.test.ts > the minimal facts of a digest > a mailbox with a login error counts 1 | 1 |
| digest.test.ts | digest.test.ts > the minimal facts of a digest > a paused mailbox that synced a minute ago counts 1 | 1 |
| digest.test.ts | digest.test.ts > the minimal facts of a digest > a scheduled digest has the slot instant; an on-demand one has the build instant even with a slot | 1 |
| digest.test.ts | digest.test.ts > the minimal facts of a digest > an active mailbox that synced exactly 30 minutes ago counts 0 | 1 |
| digest.test.ts | digest.test.ts > the options of the brief lines > the age of a line counts from the clock of the digest and the day follows its time zone | 3 |
| digest.test.ts | digest.test.ts > the order of the listed items > a category that has items shows its title once, with the count of the category | 1 |
| digest.test.ts | digest.test.ts > the order of the listed items > a mail that appears twice keeps the order of the input | 3 |
| digest.test.ts | digest.test.ts > the order of the listed items > items of one category list the newest first when the input is mixed | 1 |
| digest.test.ts | digest.test.ts > the order of the listed items > items of one category list the newest first when the input is oldest first | 1 |
| digest.test.ts | digest.test.ts > the order of the listed items > items received at the same time list by their id, smallest first | 5 |
| review.test.ts | review.test.ts > renderReviewPage > a page of 60 mails keeps the first 23 and no more than fit in one message | 1 |
| review.test.ts | review.test.ts > renderReviewPage > a page of exactly the maximum keeps every mail; a character more drops the last one | 1 |
| review.test.ts | review.test.ts > renderReviewPage > the page is exact: a missing summary, an empty one, a long one and a mail of today | 6 |
| schedule.test.ts | schedule.test.ts > dueDigestSlot at the edges of the six hours > a slot at the clock of now is due; one minute ahead is not | 1 |
| schedule.test.ts | schedule.test.ts > dueDigestSlot at the edges of the six hours > a slot exactly six hours old is not due; one minute younger is | 4 |
| schedule.test.ts | schedule.test.ts > dueDigestSlot at the edges of the six hours > a slot of the day before is due when it lies within the six hours, an older one is not | 3 |
| schedule.test.ts | schedule.test.ts > dueDigestSlot at the edges of the six hours > across midnight the newest of the slots of both days wins and its date and time are split from the key | 3 |
| schedule.test.ts | schedule.test.ts > dueDigestSlot at the edges of the six hours > the newest slot wins whatever the order of the times | 2 |
| schedule.test.ts | schedule.test.ts > isLateSlot > exactly 10 minutes after the slot is not late; a millisecond more is | 1 |
| schedule.test.ts | schedule.test.ts > nextDigestTime > the nearest time wins whatever the order of the times, and a time equal to now is not next | 2 |
| schedule.test.ts | schedule.test.ts > the digest times a user types > six times are the most; the seventh is refused | 1 |
| schedule.test.ts | schedule.test.ts > the digest times a user types > white space around the text is ignored, none in any letter case gives no times | 1 |

## Self-classed (the 22 counted mutants after the run)

Key: file, line:column, mutator, replacement. All are classed `equivalent` or `unreachable`; none is a bug.

| key | class | reason |
| --- | --- | --- |
| digest.ts 316:48 ArrayDeclaration `["Stryker was here"]` | equivalent | tool marker; `ids` of an empty brief block is never read |
| digest.ts 284:54 ArrayDeclaration | equivalent | tool marker; a marker id matches no mail |
| digest.ts 437:60 ArrayDeclaration | equivalent | tool marker; a marker id matches no mail |
| digest.ts 335:47 OptionalChaining `section.categories` | unreachable | every category is in one of the two sections, so `section` is never undefined |
| digest.ts 336:9 ConditionalExpression `true` | unreachable | same: `section !== undefined` is always true |
| digest.ts 364:7 ConditionalExpression `true` | equivalent | `undefined > 0` is false, so the second test decides alone |
| digest.ts 389:31 ConditionalExpression `false` | unreachable | `brief` is always set when its sections are set; the test only narrows the type |
| digest.ts 420:28 ConditionalExpression `false` | unreachable | an odd index always has a row before it |
| digest.ts 455:27 ConditionalExpression `true` | equivalent | without a spam review the retry renders the same text again, then the loop goes on |
| digest.ts 296:9 ConditionalExpression `false` | equivalent | `{ links: undefined }` reads like no `links` in `renderBriefLines` |
| digest.ts 296:9 OptionalChaining `input.brief.links` | unreachable | `briefOptions` runs only when the brief has sections, so `brief` is set |
| digest.ts 173:37 ConditionalExpression `true` | equivalent | changes the result only for two equal ids; the sort reads only a negative result |
| digest.ts 173:37 ConditionalExpression `false` | equivalent | 0 and 1 order the same: V8 sorts on `< 0` only (checked: a 60 item list still passes with it) |
| digest.ts 173:37 EqualityOperator `>=` | equivalent | differs only for equal ids, and 1 and 0 order the same |
| digest.ts 173:37 EqualityOperator `<=` | equivalent | differs only for equal ids, and 1 and 0 order the same |
| callback-kinds.ts 77:11 BlockStatement `{}` | unreachable | `atob` cannot throw: the 22 characters already match the base64url pattern |
| callback-kinds.ts 73:7 ConditionalExpression `false` | unreachable | the caller's pattern (`DELEGATE_PICK_REST`) already holds the same test |
| callback-kinds.ts 80:7 ConditionalExpression `false` | unreachable | 22 base64url characters always decode to 16 bytes |
| callback-kinds.ts 68:73 Regex `/=+/` | equivalent | `=` only ever ends the string |
| callback-kinds.ts 88:21 ConditionalExpression `true` | equivalent | `UUID_REST.test(undefined)` tests the text `undefined` and fails |
| callback-kinds.ts 97:19 ConditionalExpression `false` | equivalent | `CODED_REST.exec(undefined)` tests the text `undefined` and fails |
| callback-kinds.ts 258:21 ConditionalExpression `false` | equivalent | same for `DELEGATE_PICK_REST` |

Cap: `renderListed` has 6 mutants classed `equivalent` or `unreachable` (cap 3 per function); the stage has 22 (cap 10). Every one has a reason above; the coordinator decides whether the cap needs a ruling. Three are the tool marker kind, which the job instruction classes `equivalent` without a question.

## Bugs

None.

## Notes for the next worker

- The text of the one test file `digest.test.ts` is now 1,340 lines; a later stage could split it. No product file changed.
- To force an exact 4096-character text, `digestOfLength` in `digest.test.ts` builds mailbox lines of known size; the same helper can serve other render limits.
