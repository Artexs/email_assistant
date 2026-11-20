# Stage 05 results: approval cards and approval texts

Status: **stopped at the self-class cap**; the question is in `stage-05-question.md`. Tests are committed; `renderApprovalRequest` ends at 18 counted mutants because 16 of them are equivalent or unreachable (cap: 3 per function, 10 per stage).

## Runs

- Before: `bash scripts/test-audit/mutation.sh /tmp/f154-s05/before --mutate src/digest/approvals.ts --mutate src/texts/approvals.ts --mutate src/texts/approvals-en.ts --mutate src/texts/approvals-pl.ts`.
- After: the same command into `/tmp/f154-s05/after2`, at the commit that holds the final tests.
- `bun scripts/test-audit/mutation-gaps.ts --before /tmp/f154-s05/before/mutation.json --after /tmp/f154-s05/after2/mutation.json` exited 0 (`0 new cases kill no before-survivor`).
- `src/texts/approvals.ts` holds only types and the locale table; it has no counted mutant. The four text functions are measured in `approvals-en.ts` and `approvals-pl.ts`.

## Before and after (functions with 1 or more counted mutants)

| file | function | before | after |
| --- | --- | --- | --- |
| packages/core/src/digest/approvals.ts | renderApprovalRequest | 29 | 18 |
| packages/core/src/digest/approvals.ts | chatQuoteText | 11 | 5 |
| packages/core/src/digest/approvals.ts | replyRecipientLines | 10 | 2 |
| packages/core/src/digest/approvals.ts | renderApprovalSetRequest | 6 | 1 |
| packages/core/src/texts/approvals-pl.ts | softCap | 6 | 0 |
| packages/core/src/texts/approvals-pl.ts | tries | 6 | 0 |
| packages/core/src/texts/approvals-pl.ts | contentSoft | 5 | 0 |
| packages/core/src/digest/approvals.ts | followUpRecipientLines | 3 | 2 |
| packages/core/src/digest/approvals.ts | build | 3 | 0 |
| packages/core/src/texts/approvals-en.ts | contentSoft | 3 | 0 |
| packages/core/src/texts/approvals-en.ts | softCap | 3 | 0 |
| packages/core/src/texts/approvals-en.ts | tries | 3 | 0 |
| packages/core/src/texts/approvals-en.ts | copyCheck | 2 | 2 |
| packages/core/src/texts/approvals-pl.ts | copyCheck | 2 | 2 |
| packages/core/src/texts/approvals-pl.ts | refused | 2 | 2 |
| packages/core/src/digest/approvals.ts | render | 2 | 0 |
| packages/core/src/texts/approvals-en.ts | approvalsEn.followUp.rejected | 2 | 0 |
| packages/core/src/texts/approvals-pl.ts | approvalsPl.followUp.rejected | 2 | 0 |
| packages/core/src/texts/approvals-pl.ts | approvalsPl.sendResult.rejected | 2 | 0 |

## Function targets

| Function | Before | After | Met |
| --- | --- | --- | --- |
| `renderApprovalRequest` | 29 | 18 | no: 16 equivalent or unreachable, 2 bug-class (see Self-classed) |
| `chatQuoteText` | 11 | 5 | no: 5 equivalent (see Self-classed) |
| `replyRecipientLines` | 10 | 2 | yes: below 5 (2 unreachable fallbacks) |
| `renderApprovalSetRequest` | 6 | 1 | yes: below 5 (1 equivalent) |
| `tries` (en, pl) | 3, 6 | 0, 0 | yes |
| `softCap` (en, pl) | 3, 6 | 0, 0 | yes |
| `contentSoft` (en, pl) | 3, 5 | 0, 0 | yes |
| `rejected` (follow-up en, follow-up pl, send result pl) | 2, 2, 2 | 0, 0, 0 | yes (the send result and edit `rejected` of English had no counted mutant) |

## Self-classed

Key: file `packages/core/src/digest/approvals.ts`; line:column; mutator; replacement.

| Function | Line:column | Mutator | Replacement | Class | Reason |
| --- | --- | --- | --- | --- | --- |
| chatQuoteText | 46:37 | UnaryOperator | `+1` | equivalent | headerEnd is never 1 here; for -1 the sliced text has the same line count |
| chatQuoteText | 46:23 | ConditionalExpression | `false` | equivalent | no blank line: slicing off the last character leaves the same line count |
| chatQuoteText | 49:11 | EqualityOperator | `index <= headerLines` | equivalent | the line at index headerLines is the blank line, which is never a sender line |
| chatQuoteText | 50:38 | ArithmeticOperator | `line.indexOf(": ") - 2` | equivalent | prefix and rest are joined again; the prefix part never holds a link |
| chatQuoteText | 50:51 | StringLiteral | `""` | equivalent | prefix and rest are joined again; the prefix part never holds a link |
| followUpRecipientLines | 70:25 | ArrayDeclaration | `[]` | unreachable | followUpRecipientLines is outside this stage; the To list is never missing |
| followUpRecipientLines | 75:26 | StringLiteral | `""` | unreachable | followUpRecipientLines is outside this stage |
| replyRecipientLines | 85:69 | ArrayDeclaration | `["Stryker was here"]` | unreachable | the length check above makes the `?? []` fallback dead |
| replyRecipientLines | 86:84 | ArrayDeclaration | `["Stryker was here"]` | unreachable | the length check above makes the `?? []` fallback dead |
| renderApprovalRequest | 114:7 | ConditionalExpression | `true` | equivalent | an undefined version gives `undefined >= 2`, which is false |
| renderApprovalRequest | 130:58 | ConditionalExpression | `true` | unreachable | the subject of a view is a string, never null |
| renderApprovalRequest | 164:7 | ConditionalExpression | `true` | equivalent | a text that fits runs no loop; the later cut flag is read only when the text is over the limit |
| renderApprovalRequest | 164:7 | EqualityOperator | `text.length >= MESSAGE_MAX_CHARS` | equivalent | a text that fits runs no loop; the later cut flag is read only when the text is over the limit |
| renderApprovalRequest | 168:34 | ArithmeticOperator | `max + 1` | equivalent | the overflow is at least 1, so max - overflow is always the smaller value |
| renderApprovalRequest | 170:36 | ConditionalExpression | `false` | unreachable | inside the loop the quote is never null |
| renderApprovalRequest | 172:9 | ConditionalExpression | `true` | equivalent | the quote is never null at this line |
| renderApprovalRequest | 172:9 | ConditionalExpression | `false` | bug | an empty quote on a too-long card is shown with the quote-cut note; no case pins that |
| renderApprovalRequest | 172:9 | EqualityOperator | `quote === null` | bug | an empty quote on a too-long card is shown with the quote-cut note; no case pins that |
| renderApprovalRequest | 181:71 | ConditionalExpression | `true` | unreachable | when the card is still too long, the quote is already empty or null, so the rebuild gives the same text |
| renderApprovalRequest | 181:9 | ConditionalExpression | `true` | unreachable | when the card is still too long, the quote is already empty or null, so the rebuild gives the same text |
| renderApprovalRequest | 181:9 | ConditionalExpression | `false` | unreachable | when the card is still too long, the quote is already empty or null, so the rebuild gives the same text |
| renderApprovalRequest | 181:9 | EqualityOperator | `text.length >= MESSAGE_MAX_CHARS` | unreachable | when the card is still too long, the quote is already empty or null, so the rebuild gives the same text |
| renderApprovalRequest | 181:9 | EqualityOperator | `text.length <= MESSAGE_MAX_CHARS` | unreachable | when the card is still too long, the quote is already empty or null, so the rebuild gives the same text |
| renderApprovalRequest | 181:71 | ConditionalExpression | `false` | unreachable | when the card is still too long, the quote is already empty or null, so the rebuild gives the same text |
| renderApprovalRequest | 181:71 | EqualityOperator | `quote !== null` | unreachable | when the card is still too long, the quote is already empty or null, so the rebuild gives the same text |
| renderApprovalRequest | 181:95 | ObjectLiteral | `{}` | unreachable | when the card is still too long, the quote is already empty or null, so the rebuild gives the same text |
| renderApprovalRequest | 181:113 | StringLiteral | `"Stryker was here!"` | unreachable | when the card is still too long, the quote is already empty or null, so the rebuild gives the same text |
| renderApprovalSetRequest | 255:14 | StringLiteral | `"Stryker was here!"` | equivalent | the loop below always runs once and overwrites the start value |

Totals in `renderApprovalRequest`: 5 equivalent, 11 unreachable, 2 bug-class. In `chatQuoteText`: 5 equivalent. Stage total of equivalent plus unreachable: 21 (cap 10).
These mutants sit in the code that guards the 4096-character limit (lines 164–184 of the source) and in null checks that the types rule out.

## Bugs

- English `approvals.causes.tries(1, "")` reads "The send failed 1 times". No case pins it. The Polish text is correct ("1 raz").
- A quote with empty text on a card that is too long shows "Quoted original:" with no text and the line "(quote cut; the draft has the full text)" although nothing was cut (source line 172, mutants `quote === null` and `false`). No case pins it.

## Notes

- The quote shrink undershoots when hiding links makes the text longer: a quote of 1,600 times `x.pl ` and a 2,500-character body gives a card of 3,764 characters, not 4,096. A case pins the exact quote text. It is a conservative result, not a wrong one.
- Cases from the stage list that killed no before-survivor were dropped (D6): English `contentSoft("552")`, `softCap("452")`, `tries(3, "550")`, the English send-result and edit `rejected` lines, the English follow-up `rejected(null)`, the Polish follow-up `rejected("Anna")`, and a set card with no subject.
- New files and blocks: `packages/core/src/texts/approvals.test.ts` (new) and three `describe` blocks at the end of `packages/core/src/digest/approvals.test.ts`. No source file changed.
- `followUpRecipientLines` (3 before, 2 after) and the English and Polish `copyCheck` and `refused` texts (2 each) are outside this stage (fewer than 5 counted mutants).
