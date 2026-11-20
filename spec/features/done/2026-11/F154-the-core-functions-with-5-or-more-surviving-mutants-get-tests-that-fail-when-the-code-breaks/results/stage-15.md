# Stage 15 results: open loops and outgoing mail

Runs: `bash scripts/test-audit/mutation.sh /tmp/f154-s15/{before,after} --mutate src/loops/brief.ts --mutate src/loops/extractor.ts --mutate src/loops/replies.ts --mutate src/outgoing/message.ts --mutate src/outgoing/report-mail.ts --mutate src/outgoing/sender.ts`. The first after run showed 14 new cases that killed no before-survivor (a mails-order case, empty-header and no-id cases, a reply view with no gaps, and `isLinkOfBase` rows the old test already held). They were cut, and the old `isLinkOfBase` test stays. The second after run is the result below. `mutation-gaps.ts --before --after` exits 0.

Seven of the eight listed functions fall below 5 counted mutants; `isAutoReply` stays at 5, each classed below. Five reach 0: `approvalViewOf` (13), `buildOutgoingMessage` (10), `normalizeAnswer` (8), `uniqueIds` (6) and `isLinkOfBase` (5). `reportMailHtml` (3, not listed) also reaches 0. `messageIdsOf` ends at 3, `oldestFirst` at 4, `isAutoReply` at 5 (all self-classed below).

## Before and after, per function

```
| file | function | before | after |
| --- | --- | --- | --- |
| packages/core/src/outgoing/sender.ts | approvalViewOf | 13 | 0 |
| packages/core/src/outgoing/message.ts | buildOutgoingMessage | 10 | 0 |
| packages/core/src/loops/replies.ts | messageIdsOf | 9 | 3 |
| packages/core/src/loops/extractor.ts | normalizeAnswer | 8 | 0 |
| packages/core/src/loops/brief.ts | oldestFirst | 7 | 4 |
| packages/core/src/outgoing/message.ts | uniqueIds | 6 | 0 |
| packages/core/src/loops/replies.ts | isAutoReply | 5 | 5 |
| packages/core/src/outgoing/report-mail.ts | isLinkOfBase | 5 | 0 |
| packages/core/src/loops/extractor.ts | cut | 4 | 4 |
| packages/core/src/loops/extractor.ts | sentSkipReason | 4 | 4 |
| packages/core/src/loops/replies.ts | plainText | 4 | 4 |
| packages/core/src/loops/replies.ts | replyMatch | 4 | 4 |
| packages/core/src/loops/replies.ts | localPartOf | 4 | 2 |
| packages/core/src/loops/brief.ts | ageText | 3 | 3 |
| packages/core/src/outgoing/report-mail.ts | reportMailHtml | 3 | 0 |
| packages/core/src/loops/brief.ts | renderBriefLines | 2 | 2 |
| packages/core/src/loops/replies.ts | normalizeSubject | 2 | 2 |
| packages/core/src/loops/replies.ts | bareMessageId | 2 | 1 |
| packages/core/src/loops/brief.ts | briefKeyboard | 1 | 1 |
| packages/core/src/loops/brief.ts | countLine | 1 | 1 |
| packages/core/src/loops/brief.ts | loopSections | 1 | 1 |
| packages/core/src/loops/extractor.ts | extractorInputOf | 1 | 1 |

| test file | case | kills |
| --- | --- | --- |
| packages/core/src/loops/brief.test.ts | src/loops/brief.test.ts > the order of the lines: oldest first, ties by id > promises of the same due time go by id, whatever the order of the rows | 2 |
| packages/core/src/loops/brief.test.ts | src/loops/brief.test.ts > the order of the lines: oldest first, ties by id > rows of the same time go by id, whatever the order of the rows | 2 |
| packages/core/src/loops/brief.test.ts | src/loops/brief.test.ts > the order of the lines: oldest first, ties by id > two rows with the same time and the same id keep the order that they came in | 1 |
| packages/core/src/loops/extractor.test.ts | src/loops/extractor.test.ts > extractorOutputSchema on answers that are not an object > a missing ask is a schema failure; the code adds no null for it | 1 |
| packages/core/src/loops/extractor.test.ts | src/loops/extractor.test.ts > extractorOutputSchema on answers that are not an object > a missing promise is a schema failure; the code adds no null for it | 1 |
| packages/core/src/loops/extractor.test.ts | src/loops/extractor.test.ts > extractorOutputSchema on answers that are not an object > a number is refused as a whole, with the type of the input | 5 |
| packages/core/src/loops/extractor.test.ts | src/loops/extractor.test.ts > extractorOutputSchema on answers that are not an object > a string is refused as a whole, with the type of the input | 5 |
| packages/core/src/loops/extractor.test.ts | src/loops/extractor.test.ts > extractorOutputSchema on answers that are not an object > an array is refused as a whole, with the type of the input | 2 |
| packages/core/src/loops/extractor.test.ts | src/loops/extractor.test.ts > extractorOutputSchema on answers that are not an object > null is refused as a whole, with the type of the input | 5 |
| packages/core/src/loops/replies.test.ts | src/loops/replies.test.ts > isAutoReply senders and edge forms > a dot in the local part of a system sender is a word break | 1 |
| packages/core/src/loops/replies.test.ts | src/loops/replies.test.ts > isAutoReply senders and edge forms > a leading at sign gives an empty local part | 1 |
| packages/core/src/loops/replies.test.ts | src/loops/replies.test.ts > isAutoReply senders and edge forms > an address with no at sign is read as a local part | 2 |
| packages/core/src/loops/replies.test.ts | src/loops/replies.test.ts > the message ids of In-Reply-To and References > a loop with an empty message id matches no empty header | 5 |
| packages/core/src/loops/replies.test.ts | src/loops/replies.test.ts > the message ids of In-Reply-To and References > an id in any position of a header with two ids matches | 1 |
| packages/core/src/loops/replies.test.ts | src/loops/replies.test.ts > the message ids of In-Reply-To and References > an unclosed bracket is no id, in the header or in the loop | 3 |
| packages/core/src/loops/replies.test.ts | src/loops/replies.test.ts > the message ids of In-Reply-To and References > only the first 20 000 characters of a header are read | 2 |
| packages/core/src/loops/replies.test.ts | src/loops/replies.test.ts > the message ids of In-Reply-To and References > the id of the loop is the one id of its value; a value with two ids names none | 1 |
| packages/core/src/outgoing/message.test.ts | src/outgoing/message.test.ts > buildOutgoingMessage > what each kind of draft carries > a delegation and a clarification keep every id of the chain; only a reply or a follow-up cuts it to 20 | 1 |
| packages/core/src/outgoing/message.test.ts | src/outgoing/message.test.ts > buildOutgoingMessage > what each kind of draft carries > a delegation or a clarification has an empty Cc | 1 |
| packages/core/src/outgoing/message.test.ts | src/outgoing/message.test.ts > buildOutgoingMessage > what each kind of draft carries > a draft with no recipient is refused | 2 |
| packages/core/src/outgoing/message.test.ts | src/outgoing/message.test.ts > buildOutgoingMessage > what each kind of draft carries > a reminder with an empty due date has no due line; with a date it has one | 4 |
| packages/core/src/outgoing/message.test.ts | src/outgoing/message.test.ts > buildOutgoingMessage > what each kind of draft carries > the References drop an empty id and a missing message id, and list each id once | 6 |
| packages/core/src/outgoing/message.test.ts | src/outgoing/message.test.ts > buildOutgoingMessage > what each kind of draft carries > the name and the signature of a profile lose their outer spaces | 2 |
| packages/core/src/outgoing/report-mail.test.ts | src/outgoing/report-mail.test.ts > isLinkOfBase on the edges of the origin > a base with two closing slashes | 1 |
| packages/core/src/outgoing/report-mail.test.ts | src/outgoing/report-mail.test.ts > isLinkOfBase on the edges of the origin > a query after the origin | 2 |
| packages/core/src/outgoing/report-mail.test.ts | src/outgoing/report-mail.test.ts > isLinkOfBase on the edges of the origin > an empty url and a base of slashes | 3 |
| packages/core/src/outgoing/report-mail.test.ts | src/outgoing/report-mail.test.ts > isLinkOfBase on the edges of the origin > an empty url and an empty base | 3 |
| packages/core/src/outgoing/report-mail.test.ts | src/outgoing/report-mail.test.ts > the HTML part of a line with text around the links > the text before, between and after two links is kept, and each anchor stands alone | 4 |
| packages/core/src/outgoing/sender.test.ts | src/outgoing/sender.test.ts > approvalViewOf by kind > a delegation view has none of the follow-up and reply fields | 3 |
| packages/core/src/outgoing/sender.test.ts | src/outgoing/sender.test.ts > approvalViewOf by kind > a follow-up has no sender and lists every recipient and its number | 9 |
| packages/core/src/outgoing/sender.test.ts | src/outgoing/sender.test.ts > approvalViewOf by kind > a message with no recipient is refused | 2 |
| packages/core/src/outgoing/sender.test.ts | src/outgoing/sender.test.ts > approvalViewOf by kind > a reply view lists at most 20 gaps | 1 |

0 new cases kill no before-survivor
```

## Self-classed

Key: file, line:column, mutator, replacement. No product change is possible, so each remaining mutant of a listed function has a class. The coordinator accepts the classes; the per-function cap of three `equivalent` plus `unreachable` is passed for `isAutoReply` (five), `oldestFirst` (four) and the stage total (twelve).

| Function | Key | Class | Reason |
| --- | --- | --- | --- |
| `oldestFirst` | `loops/brief.ts` 101:94 EqualityOperator `id(a) <= id(b)` | equivalent | Only changes the result for equal ids from 0 to 1. The engine sort reads only whether the result is below 0. |
| `oldestFirst` | `loops/brief.ts` 101:94 EqualityOperator `id(a) >= id(b)` | equivalent | Same: 0 or 1 for the equal-id case. |
| `oldestFirst` | `loops/brief.ts` 101:94 ConditionalExpression `true` | equivalent | Same: 1 in place of 0 when the ids are equal; 1 in place of 1 otherwise. |
| `oldestFirst` | `loops/brief.ts` 101:94 ConditionalExpression `false` | equivalent | Same: 0 in place of 1 when the first id is larger. Probe `/tmp/f154-s15/sorttest.ts` (random arrays of 2 to 1000 rows under Bun): 0 output differences for the three comparator variants. |
| `messageIdsOf` | `loops/replies.ts` 51:25 ConditionalExpression `false` (the `undefined` check) | unreachable | Callers pass `string \| null`; `replyMatch` and `bareMessageId` never pass `undefined`. |
| `messageIdsOf` | `loops/replies.ts` 51:53 ArrayDeclaration `["Stryker was here"]` | equivalent | The result is compared with a loop id that has no white space; the mutant text has some. |
| `messageIdsOf` | `loops/replies.ts` 55:21 Regex `/\s/` | equivalent | A split on one white-space character adds empty words; the `word !== ""` filter drops them. |
| `isAutoReply` | `loops/replies.ts` 93:55 StringLiteral `"Stryker was here!"` | unreachable | `split` always returns one element or more; the `?? ""` side never runs. |
| `isAutoReply` | `loops/replies.ts` 97:43 StringLiteral | equivalent | A null `Precedence` and a text that is not in the set both give `false`. |
| `isAutoReply` | `loops/replies.ts` 100:54 StringLiteral | equivalent | A null sender and a text with no `@` that is not a system name both give `false`. |
| `isAutoReply` | `loops/replies.ts` 101:10 ConditionalExpression `true` | equivalent | An empty sender then asks the set for `""`, which it does not hold. |
| `isAutoReply` | `loops/replies.ts` 101:19 StringLiteral | equivalent | Same: an empty sender asks the set for `""`. |

Also left, in listed helpers with fewer than 5 mutants: `localPartOf` 78:34 (unreachable, same `?? ""` after `split`) and 76:17 `at <= 0` (equivalent: no system name starts with `@`); `bareMessageId` 59:7 (equivalent: `messageIdsOf(null)` is `[]`).

## Bugs

None found. Pinned values are the ones at `HEAD`.
