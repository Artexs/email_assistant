# Stage 14 results: triage helpers, contacts, mail providers, send limits

## Runs

Both runs: `bash scripts/test-audit/mutation.sh <dir> --mutate src/triage/eval-case.ts --mutate src/triage/cost.ts --mutate src/triage/metrics.ts --mutate src/triage/settings.ts --mutate src/triage/payloads.ts --mutate src/triage/address.ts --mutate src/contacts/address.ts --mutate src/contacts/suggestions.ts --mutate src/mail/providers.ts --mutate src/send-limits.ts`.
The before run used a copy of the branch base made before the first new test (`/tmp/f154-s14/before`), because the mutation lock queued the run for a long time. The final after run is `/tmp/f154-s14/after6`.
Compare: `bun scripts/test-audit/mutation-gaps.ts --before /tmp/f154-s14/before/mutation.json --after /tmp/f154-s14/after6/mutation.json` printed `0 new cases kill no before-survivor` and exited 0.
No product code changed.

## Before and after (counted mutants: survived plus no coverage)

| file | function | before | after |
| --- | --- | --- | --- |
| triage/eval-case.ts | prioritize | 17 | 0 |
| triage/cost.ts | priceRowFor | 9 | 3 |
| mail/providers.ts | serversFor | 9 | 0 |
| triage/metrics.ts | simGoNoGo | 9 | 0 |
| triage/settings.ts | describeSettings | 9 | 0 |
| contacts/address.ts | caseFormTable | 8 | 4 |
| triage/address.ts | splitAddress | 7 | 3 |
| contacts/suggestions.ts | byRank | 5 | 5 |
| triage/eval-case.ts | byId | 5 | 4 |
| mail/providers.ts | presetForAddress | 5 | 2 |
| send-limits.ts | windowUntil | 5 | 2 |
| triage/payloads.ts | sendPayloadFor | 5 | 0 |
| contacts/address.ts | addressCasedCodePoints | 2 | 0 |

Every listed function except `byRank` is under 5. `byRank` keeps its 5 survivors, and six other functions keep 2 to 4; all are classed below. The tool also prints other functions of these files (for example `addressLowerForms`, `ruleSummary`, `wilsonInterval`); they are outside this stage and are not in this table.

## Self-classed

Class `equivalent`: no input changes the output. Class `unreachable`: no caller can reach the branch. Each row was also checked by applying the mutant by hand and running the file tests (they passed), except the sort rows, which a 24-permutation probe covers.

| File | Function | Line:col | Mutator | Replacement | Class | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| contacts/address.ts | caseFormTable | 68:20 | EqualityOperator | `cp < 0x10ffff` | equivalent | The last code point folds to itself and joins no other letter, so a table without it gives the same forms. |
| contacts/address.ts | caseFormTable | 69:9 | ConditionalExpression | `false` | equivalent | A lone surrogate folds to itself: an entry with one form changes no list and no cased code point. |
| contacts/address.ts | caseFormTable | 69:9 | EqualityOperator | `cp > 0xd800` | equivalent | Same: it only adds the entry of the first surrogate. |
| contacts/address.ts | caseFormTable | 69:25 | EqualityOperator | `cp < 0xdfff` | equivalent | Same: it only adds the entry of the last surrogate. |
| triage/cost.ts | priceRowFor | 48:7 | ConditionalExpression | `false` | equivalent | The `own` guard is redundant: no price row has the endpoint `own`, so the loop skips every row and returns null. |
| triage/cost.ts | priceRowFor | 48:20 | StringLiteral | `""` | equivalent | Same guard. |
| triage/cost.ts | priceRowFor | 59:35 | ConditionalExpression | `false` | equivalent | With no current row, `currentStart` is minus infinity and every start is at least that. |
| triage/address.ts | splitAddress | 8:16 | MethodExpression | `.trim()` removed | equivalent | Group 1 of the pattern never has edge whitespace: `\s*` before it is greedy and `\s*` after it takes the rest. A probe over strings from a whitespace-heavy alphabet found no untrimmed group. |
| triage/address.ts | splitAddress | 8:29 | StringLiteral | `"Stryker was here!"` | unreachable | Group 1 always takes part in a match, so the `?? ""` fallback never runs. |
| triage/address.ts | splitAddress | 12:66 | StringLiteral | `"Stryker was here!"` | unreachable | Group 2 always takes part in a match. |
| contacts/suggestions.ts | byRank | 152:6 | EqualityOperator | `key <= key` | equivalent | Two candidates never have the same key (one per kind, scope and pattern), so the equal case does not occur. |
| contacts/suggestions.ts | byRank | 152:47 | ConditionalExpression | `true` | equivalent | The Bun sort moves an element only when the comparator returns a negative number, so 1 and 0 order alike. A probe over all 24 permutations of 4 equal-rank candidates gave the same order for the original and for each mutant. |
| contacts/suggestions.ts | byRank | 152:47 | ConditionalExpression | `false` | equivalent | Same. |
| contacts/suggestions.ts | byRank | 152:47 | EqualityOperator | `key >= key` | equivalent | Same. |
| contacts/suggestions.ts | byRank | 152:47 | EqualityOperator | `key <= key` | equivalent | Same. |
| triage/eval-case.ts | byId | 73:29 | ConditionalExpression | `true` | equivalent | Same sort behaviour: the `1` or `0` result of the second comparison never changes the order. |
| triage/eval-case.ts | byId | 73:29 | ConditionalExpression | `false` | equivalent | Same. |
| triage/eval-case.ts | byId | 73:29 | EqualityOperator | `id >= id` | equivalent | Same. |
| triage/eval-case.ts | byId | 73:29 | EqualityOperator | `id <= id` | equivalent | Same. |
| mail/providers.ts | presetForAddress | 82:7 | ConditionalExpression | `false` | equivalent | An empty domain finds no preset anyway: no preset lists the empty text. |
| mail/providers.ts | presetForAddress | 82:18 | StringLiteral | `"Stryker was here!"` | equivalent | Same guard. |
| send-limits.ts | windowUntil | 39:7 | ConditionalExpression | `false` | equivalent | With fewer sends than the cap, the index `length - cap` is negative, the read is undefined, and the next line returns null. |
| send-limits.ts | windowUntil | 42:10 | ConditionalExpression | `false` | unreachable | The cap is at least 1 (the config schema allows 1 to 10 000) and the list holds at least cap entries, so the index is always in range. |

Count per function: caseFormTable 4, priceRowFor 3, splitAddress 3, byRank 5, byId 4, presetForAddress 2, windowUntil 2. That is 23 rows. The cap of the plan (3 per function, 10 per stage) is exceeded by byRank, byId, caseFormTable and the stage total; the job task says the coordinator accepts these classes. Two further survivors in these files belong to functions outside the table (`selectCases` 93:7, equivalent: with no `perCategory` the per-category path returns every case, sorted by id).

## New cases

Full output of the compare command (the case table lists every new case with its before-survivor kills):

| test file | case | kills |
| --- | --- | --- |
| contacts/address.test.ts | contacts/address.test.ts > addressCasedCodePoints > is exactly the code points that share a form with another code point, ascending, and is built once | 2 |
| contacts/address.test.ts | contacts/address.test.ts > the case form table over every code point > every group of single code points that fold to one letter is the list of addressCaseForms, in code-point order | 5 |
| contacts/suggestions.test.ts | contacts/suggestions.test.ts > suggestionsFor: cap, order, skip > VIPs with equal counts order by key ascending, whatever the input order | 1 |
| contacts/suggestions.test.ts | contacts/suggestions.test.ts > suggestionsFor: cap, order, skip > VIPs: the larger count comes first, whatever the input order and the keys | 1 |
| mail/providers.test.ts | mail/providers.test.ts > presetForAddress > "@interia.pl" gives "interia" | 1 |
| mail/providers.test.ts | mail/providers.test.ts > presetForAddress > "gmail.com" gives null | 1 |
| mail/providers.test.ts | mail/providers.test.ts > presetForAddress > "jan@ interia.pl " gives "interia" | 1 |
| mail/providers.test.ts | mail/providers.test.ts > serversFor > an empty input throws | 1 |
| mail/providers.test.ts | mail/providers.test.ts > serversFor > throws when the IMAP host is missing | 7 |
| mail/providers.test.ts | mail/providers.test.ts > serversFor > throws when the IMAP port is missing | 7 |
| mail/providers.test.ts | mail/providers.test.ts > serversFor > throws when the SMTP host is missing | 5 |
| mail/providers.test.ts | mail/providers.test.ts > serversFor > throws when the SMTP port is missing | 3 |
| send-limits.test.ts | send-limits.test.ts > checkSendLimits until time of a full window > more sends than the cap: the window passes when the oldest one that must leave has left | 3 |
| send-limits.test.ts | send-limits.test.ts > checkSendLimits until time of a full window > the recipient window uses the same rule over the sends to that address, in any order | 3 |
| send-limits.test.ts | send-limits.test.ts > checkSendLimits until time of a full window > the same sends in any order hold until the same time | 3 |
| triage/address.test.ts | triage/address.test.ts > splitAddress > "  \" Jan \" <a@b.pl>" gives name "Jan" and address "a@b.pl" | 1 |
| triage/address.test.ts | triage/address.test.ts > splitAddress > "  jan@firma.pl  " gives name null and address "jan@firma.pl" | 1 |
| triage/address.test.ts | triage/address.test.ts > splitAddress > "Jan \"J\" <a@b.pl>" gives name "Jan \"J\"" and address "a@b.pl" | 1 |
| triage/address.test.ts | triage/address.test.ts > splitAddress > "\"Jan\" Kowalski <a@b.pl>" gives name "\"Jan\" Kowalski" and address "a@b.pl" | 1 |
| triage/cost.test.ts | triage/cost.test.ts > priceRowFor with dated rows > a row without a start applies from the beginning, and a dated row replaces it | 4 |
| triage/cost.test.ts | triage/cost.test.ts > priceRowFor with dated rows > an EU row and a standard row are chosen apart | 1 |
| triage/cost.test.ts | triage/cost.test.ts > priceRowFor with dated rows > takes the row with the latest start that is not after the day, whatever the list order | 4 |
| triage/cost.test.ts | triage/cost.test.ts > priceRowFor with dated rows > two rows with the same start: the later row of the list wins | 3 |
| triage/cost.test.ts | triage/cost.test.ts > priceRowFor with dated rows > two rows without a start: the later row of the list wins | 2 |
| triage/eval-case.test.ts | triage/eval-case.test.ts > selectCases order by id > cases with the same id keep their input order | 1 |
| triage/eval-case.test.ts | triage/eval-case.test.ts > selectCases priority inside one category > a block-only case is not chosen when it also has a vip rule | 2 |
| triage/eval-case.test.ts | triage/eval-case.test.ts > selectCases priority inside one category > a block-only case is not chosen when it also has a whitelist rule | 2 |
| triage/eval-case.test.ts | triage/eval-case.test.ts > selectCases priority inside one category > takes the first 2 cases by priority: first rule case, first block-only case, no-rule cases, the rest | 2 |
| triage/eval-case.test.ts | triage/eval-case.test.ts > selectCases priority inside one category > takes the first 3 cases by priority: first rule case, first block-only case, no-rule cases, the rest | 6 |
| triage/eval-case.test.ts | triage/eval-case.test.ts > selectCases priority inside one category > takes the first 4 cases by priority: first rule case, first block-only case, no-rule cases, the rest | 6 |
| triage/eval-case.test.ts | triage/eval-case.test.ts > selectCases priority inside one category > takes the first 5 cases by priority: first rule case, first block-only case, no-rule cases, the rest | 12 |
| triage/eval-case.test.ts | triage/eval-case.test.ts > selectCases priority inside one category > takes the first 6 cases by priority: first rule case, first block-only case, no-rule cases, the rest | 12 |
| triage/eval-case.test.ts | triage/eval-case.test.ts > selectCases priority inside one category > takes the first 7 cases by priority: first rule case, first block-only case, no-rule cases, the rest | 10 |
| triage/eval-case.test.ts | triage/eval-case.test.ts > selectCases priority inside one category > without a block-only case a whitelist case comes first and the no-rule cases follow | 12 |
| triage/metrics.test.ts | triage/metrics.test.ts > simGoNoGo > the rows of one category with custom limits > a Wilson lower bound exactly at the bar is go | 2 |
| triage/metrics.test.ts | triage/metrics.test.ts > simGoNoGo > the rows of one category with custom limits > a category with no rows has no kept rows and no numbers | 5 |
| triage/metrics.test.ts | triage/metrics.test.ts > simGoNoGo > the rows of one category with custom limits > a row with no kept mails never passes, even with a bar of 0 and a minimum of 0 | 2 |
| triage/metrics.test.ts | triage/metrics.test.ts > simGoNoGo > the rows of one category with custom limits > a support below minSupport is too few, with the numbers of the lowest threshold | 3 |
| triage/metrics.test.ts | triage/metrics.test.ts > simGoNoGo > the rows of one category with custom limits > a support exactly at minSupport and kept exactly at minKept pass | 2 |
| triage/metrics.test.ts | triage/metrics.test.ts > simGoNoGo > the rows of one category with custom limits > enough support but no threshold with enough kept rows is no-go with the numbers of the lowest threshold | 6 |
| triage/metrics.test.ts | triage/metrics.test.ts > simGoNoGo > the rows of one category with custom limits > go at the lowest threshold that is kept enough, with every count exact | 3 |
| triage/metrics.test.ts | triage/metrics.test.ts > simGoNoGo > the rows of one category with custom limits > the bar is compared with the Wilson lower bound, not with the precision | 2 |
| triage/payloads.test.ts | triage/payloads.test.ts > sendPayloadFor by draft kind > a clarification send has exactly its own keys | 5 |
| triage/payloads.test.ts | triage/payloads.test.ts > sendPayloadFor by draft kind > a delegation send has exactly its own keys | 4 |
| triage/payloads.test.ts | triage/payloads.test.ts > sendPayloadFor by draft kind > a follow_up send has exactly its own keys | 3 |
| triage/payloads.test.ts | triage/payloads.test.ts > sendPayloadFor by draft kind > a reminder send has exactly its own keys | 2 |
| triage/payloads.test.ts | triage/payloads.test.ts > sendPayloadFor by draft kind > a reply send has exactly its own keys | 4 |
| triage/settings.test.ts | triage/settings.test.ts > describeSettings > a mixed state: one switch on, one category on, another category with a threshold and auto off | 11 |
| triage/settings.test.ts | triage/settings.test.ts > describeSettings > default settings: every switch and every category is off, the threshold is 0.7 | 11 |
| triage/settings.test.ts | triage/settings.test.ts > describeSettings > every option set: the lines show each value, in the order of the switch names and the categories | 11 |

0 new cases kill no before-survivor


## Bugs

None.

## Notes for the coordinator

- The stage text expects a preset plus one overriding field to make that field win in `serversFor`. At the branch base the preset wins over every field (`serversFor({ preset: "gmail", imapHost: "other.test", ... })` gives the Gmail hosts). That case would kill no survivor, so no test pins it either way. The route body schema decides whether the mix can occur; it is not a mutation gap.
- A mutation run credits the build of the case form table (`contacts/address.ts`) only to the first test of the file that calls it, because the table is built once. The checks of the table therefore sit in the first test of `contacts/address.test.ts`, which carries a 30 s timeout for its scan of 1.1 million code points: an instrumented run on a busy machine failed the default 5 s once (dry run of the third after run).
- Test names of new cases are one line: a test name with a multi-line value makes the tool credit no kills to the case.
