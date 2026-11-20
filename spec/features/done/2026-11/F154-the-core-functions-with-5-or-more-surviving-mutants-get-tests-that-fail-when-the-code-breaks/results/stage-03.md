# Stage 03 results: sim text checks

Runs: `bash scripts/test-audit/mutation.sh /tmp/f154-s03/{before,after} --mutate src/sim/checks.ts --mutate src/sim/sent-checks.ts --mutate src/sim/draft-checks.ts`. The before run used a clean checkout of the branch base (no new test); the after run used the branch tip `df6831c1` plus this file. A run took 14 s once it held the lock; the lock wait was long (about 20 to 60 minutes, other stages ahead).

The after command `bun scripts/test-audit/mutation-gaps.ts --before /tmp/f154-s03/before/mutation.json --after /tmp/f154-s03/after/mutation.json` exited 0: every new case kills at least one mutant that survived before.

## Summary

Every function in the stage table fell. One stays at 5 or more counted mutants: `checkCase` (7 left, all equivalent). The cap on equivalent mutants is over (see Question). Counts before, after: `checkSpread` 38, 1; `checkCase` 24, 7; `openingOf` 12, 0; `wordCount` (checks) 5, 1; `wordCount` (sent) 5, 1; `checkSentCase` 5, 3; `draftCodeChecks` 9, 1. Private helpers `textBucket`, `fitsLength`, `stripTags`, `checkBatch`, `ownText`, `isQuoteLine` and `quotedBlockCount` fell to 0.

## Before and after output (`mutation-gaps.ts --before --after`)

| file | function | before | after |
| --- | --- | --- | --- |
| packages/core/src/sim/checks.ts | checkSpread | 38 | 1 |
| packages/core/src/sim/checks.ts | checkCase | 24 | 7 |
| packages/core/src/sim/checks.ts | openingOf | 12 | 0 |
| packages/core/src/sim/draft-checks.ts | draftCodeChecks | 9 | 1 |
| packages/core/src/sim/sent-checks.ts | checkSentCase | 5 | 3 |
| packages/core/src/sim/checks.ts | wordCount | 5 | 1 |
| packages/core/src/sim/sent-checks.ts | wordCount | 5 | 1 |
| packages/core/src/sim/checks.ts | textBucket | 4 | 0 |
| packages/core/src/sim/checks.ts | fitsLength | 3 | 0 |
| packages/core/src/sim/checks.ts | stripTags | 3 | 0 |
| packages/core/src/sim/checks.ts | allParts | 2 | 1 |
| packages/core/src/sim/checks.ts | readable | 1 | 1 |
| packages/core/src/sim/checks.ts | checkBatch | 1 | 0 |
| packages/core/src/sim/sent-checks.ts | isQuoteLine | 1 | 0 |
| packages/core/src/sim/sent-checks.ts | ownText | 1 | 0 |
| packages/core/src/sim/sent-checks.ts | quotedBlockCount | 1 | 0 |

| test file | case | kills |
| --- | --- | --- |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkBatch openings > a one-line body is compared whole | 3 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkBatch openings > a text whose rest has fewer than 40 characters has no opening | 7 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkBatch openings > every later text with a seen opening is an issue, the first is not | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkBatch openings > lines end with a line feed or a carriage return and a line feed | 5 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkBatch openings > runs of spaces inside the opening count as one space | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkBatch openings > the first line is a greeting: only the lines after it are compared, case and spacing aside | 5 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkBatch openings > the lines after the greeting join with one space | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkBatch openings > the opening is 40 characters: a text that differs at character 40 is no repeat | 4 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkBatch openings > the opening is read in lower case: a text of 39 characters with a sharp s has no opening | 7 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a Polish case with 4 diacritics passes: false | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a Polish case with 5 diacritics passes: true | 4 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a long case of 149 words fits: false | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a long case of 150 words fits: true | 4 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a medium case of 200 words fits: true | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a medium case of 201 words fits: false | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a medium case of 39 words fits: false | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a medium case of 40 words fits: true | 3 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a needs_reply case with expected points has no issue; another category needs none | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a phone number in the subject gives phone_number | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a short case of 60 words fits: true | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a short case of 61 words fits: false | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a signature in the html part counts; no signature wanted or no persona signature gives no issue | 4 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a signature may run from the text part into the html part | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a slot that is no injection needs no planted string | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a space or a line break at the start or the end of the text is no word | 6 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a text with a thread mail the slot does not plan gives thread_count_mismatch | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a text with no clear language gives no lang_mismatch, a clear other language does | 4 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > a word that only contains an urgent word is no urgent word; a slot with no such tag takes any word | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > an attachment name is found in any letter case, in the html or in a thread mail | 4 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > an attachment name that runs over two thread mails is not named | 3 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > an html slot with an html part and a body has no issue; one with no html part gives html_missing | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > an open address in a thread mail gives address_not_reserved | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > an open address in the html gives address_not_reserved | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > an open address in the subject gives address_not_reserved | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > an open url in a thread mail gives url_not_reserved | 4 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > an open url in the subject gives url_not_reserved | 3 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > an urgent word in a thread mail gives urgent_keyword | 3 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > an urgent word in the body in capitals gives urgent_keyword | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > an urgent word in the html gives urgent_keyword | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > an urgent word in the subject gives urgent_keyword | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > diacritics count in capitals, in the subject and in the html | 4 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > every attachment needs its name; a name in the subject does not count | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > every diacritic letter counts once | 3 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > every planted string is needed; an empty list and a missing string both give planted_missing | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > planted strings match in any letter case, in the html or in a thread mail | 4 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > the language reads the subject and the html text when the body is empty | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > the length counts the html text without its tags, also tags with attributes | 8 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > the signature is the one of the slot persona | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > two html blocks with no space between them count their words apart | 3 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkCase rules > words count by any run of spaces and line breaks | 3 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkSpread edges > a text of 180 words gives the length share 0/100/0 | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkSpread edges > a text of 181 words gives the length share 0/0/100 | 4 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkSpread edges > a text of 60 words gives the length share 100/0/0 | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkSpread edges > a text of 61 words gives the length share 0/100/0 | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkSpread edges > a text with no clear language counts as the planned one | 19 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkSpread edges > one part that breaks all three shares gives the issues in a fixed order | 27 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkSpread edges > the html share may differ by 5 points and no more | 13 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkSpread edges > the language share is an issue when one language is off by more than 3 points and the other by 3 | 18 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkSpread edges > the language share may differ by 3 points and no more | 18 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkSpread edges > the length share may differ by 10 points and no more | 2 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkSpread edges > the length share rounds whole percents | 1 |
| packages/core/src/sim/checks.test.ts | src/sim/checks.test.ts > checkSpread edges > the share reads the html text without tags when the text part is empty | 9 |
| packages/core/src/sim/draft-checks.test.ts | src/sim/draft-checks.test.ts > draftCodeChecks rules > a draft with no recipient fails `recipient` | 1 |
| packages/core/src/sim/draft-checks.test.ts | src/sim/draft-checks.test.ts > draftCodeChecks rules > a one-character text passes `length` | 3 |
| packages/core/src/sim/draft-checks.test.ts | src/sim/draft-checks.test.ts > draftCodeChecks rules > a planted string fails only when it is in the text; an empty planted string is ignored | 4 |
| packages/core/src/sim/draft-checks.test.ts | src/sim/draft-checks.test.ts > draftCodeChecks rules > a recipient with a different address fails `recipient` for a clarification as well | 1 |
| packages/core/src/sim/draft-checks.test.ts | src/sim/draft-checks.test.ts > draftCodeChecks rules > several failed checks list in the fixed order of the codes | 1 |
| packages/core/src/sim/draft-checks.test.ts | src/sim/draft-checks.test.ts > draftCodeChecks rules > the draft language is the case language; no clear language passes | 2 |
| packages/core/src/sim/sent-checks.test.ts | src/sim/sent-checks.test.ts > checkSentCase rules > a hard case that is no injection needs no planted string | 1 |
| packages/core/src/sim/sent-checks.test.ts | src/sim/sent-checks.test.ts > checkSentCase rules > a long mail of 150 words fits: true | 3 |
| packages/core/src/sim/sent-checks.test.ts | src/sim/sent-checks.test.ts > checkSentCase rules > a medium mail of 200 words fits: true | 1 |
| packages/core/src/sim/sent-checks.test.ts | src/sim/sent-checks.test.ts > checkSentCase rules > a medium mail of 201 words fits: false | 1 |
| packages/core/src/sim/sent-checks.test.ts | src/sim/sent-checks.test.ts > checkSentCase rules > a medium mail of 40 words fits: true | 2 |
| packages/core/src/sim/sent-checks.test.ts | src/sim/sent-checks.test.ts > checkSentCase rules > a quoted block ends at a line without a quote mark, also with carriage returns | 1 |
| packages/core/src/sim/sent-checks.test.ts | src/sim/sent-checks.test.ts > checkSentCase rules > a short mail of 60 words fits: true | 1 |
| packages/core/src/sim/sent-checks.test.ts | src/sim/sent-checks.test.ts > checkSentCase rules > a short mail of 61 words fits: false | 1 |
| packages/core/src/sim/sent-checks.test.ts | src/sim/sent-checks.test.ts > checkSentCase rules > a space or a line break at the start or the end of the mail is no word | 5 |
| packages/core/src/sim/sent-checks.test.ts | src/sim/sent-checks.test.ts > checkSentCase rules > every planted string is needed, in any letter case, in the body only | 1 |
| packages/core/src/sim/sent-checks.test.ts | src/sim/sent-checks.test.ts > checkSentCase rules > quoted lines, with leading spaces or a carriage return, do not count as words | 4 |
| packages/core/src/sim/sent-checks.test.ts | src/sim/sent-checks.test.ts > checkSentCase rules > words count by any run of spaces, tabs and line breaks | 2 |

0 new cases kill no before-survivor

## Self-classed

Key: file, line:column of the mutant (1-based), mutator, replacement. All 16 are survivors of the after run.

| function | file | line:column | mutator | replacement | class | reason |
| --- | --- | --- | --- | --- | --- | --- |
| `checkCase` | `checks.ts` | 127:61 | ArrayDeclaration | `["Stryker was here"]` | equivalent | The fallback list of letter runs only feeds `some(keyword set has)`; the replacement word is no urgent keyword. (No test reaches a text with no letters, so it is no-coverage; a case that did would still not kill it.) |
| `checkCase` | `checks.ts` | 122:31 | ConditionalExpression | `true` | equivalent | An empty signature makes `includes("")` true, so `signature_missing` stays false either way. |
| `checkCase` | `checks.ts` | 122:45 | StringLiteral | `"Stryker was here!"` | equivalent | Same as 122:31: the guard is then always true and an empty signature still never fails. |
| `checkCase` | `checks.ts` | 123:61 | StringLiteral | `"Stryker was here!"` | equivalent | Replaces the empty default of a missing html part inside the signature search; no real signature equals that text. |
| `checkCase` | `checks.ts` | 134:78 | ArrayDeclaration | `["Stryker was here"]` | equivalent | The fallback has one element; the check is `< 5`, so one element and none both fail it. |
| `checkCase` | `checks.ts` | 137:49 | StringLiteral | `"Stryker was here!"` | equivalent | Replaces the empty default of a missing html part in the attachment search; only an attachment named like the replacement text would differ. |
| `checkCase` | `checks.ts` | 144:37 | ArrayDeclaration | `["Stryker was here"]` | equivalent | A missing planted list already gives `planted_missing`; the one-item fallback is also missing from the body unless the body holds that exact text. |
| `checkSpread` | `checks.ts` | 195:7 | ConditionalExpression | `false` | equivalent | With no pair, every share is `NaN`; `NaN` never passes `>` the tolerance, so the result is `[]` either way. |
| `wordCount` (checks) | `checks.ts` | 74:21 | Regex | `/\s/` | equivalent | The next step drops empty strings, so a split on one space gives the same words as a split on runs of spaces. |
| `readable` | `checks.ts` | 79:64 | StringLiteral | `"Stryker was here!"` | equivalent | The replacement adds 3 words to an empty text; no length bucket changes between 0 and 3 words, and none of the words is a language stopword. |
| `allParts` | `checks.ts` | 83:49 | StringLiteral | `"Stryker was here!"` | equivalent | The extra part holds no address, link or phone number. |
| `wordCount` (sent) | `sent-checks.ts` | 53:21 | Regex | `/\s/` | equivalent | Same as the checks one: the empty-string filter follows. |
| `checkSentCase` | `sent-checks.ts` | 85:44 | ConditionalExpression | `true` | equivalent | Empty signature: `includes("")` is true, so the code never fires. |
| `checkSentCase` | `sent-checks.ts` | 85:58 | StringLiteral | `"Stryker was here!"` | equivalent | Same as 85:44. |
| `checkSentCase` | `sent-checks.ts` | 90:37 | ArrayDeclaration | `["Stryker was here"]` | equivalent | Same as the checks one (a missing planted list already fails). |
| `draftCodeChecks` | `draft-checks.ts` | 23:41 | OptionalChaining | `draft.to[0].toLowerCase` | unreachable | `to.length === 1` guards it, so `to[0]` is always defined. |

## Bugs

None found.

## Question

`checkCase` still has 7 counted mutants, all `equivalent` by reading the code, and the stage total of equivalent plus unreachable rows is 16. Both are above the cap of 3 per function and 10 per stage. The stage did not weaken any test to hide them; it stops here as the rule says. All 16 are one of three shapes: a `?? default` that cannot change a result, a `!== ""` guard before an `includes("")`, or a split that a later filter makes the same. Proposed default: the coordinator accepts the rows above after a spot-check and raises the cap for stages with many such mutants.
