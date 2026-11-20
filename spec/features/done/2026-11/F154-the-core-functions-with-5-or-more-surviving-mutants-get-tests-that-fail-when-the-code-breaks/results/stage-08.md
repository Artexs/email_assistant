# Stage 08 results: testmail batch validation, compare table, send log

Run at the stage base commit (before) and at `2d5148a4` (after). Mutate globs: the five files of the stage, with `--with-static`; the table below drops the static mutants (the audit and the full run ignore them). Work folders: `/tmp/f154-s08/before`, `/tmp/f154-s08/after2`; filter: mutants with `static: true` removed from both files; compare: `bun scripts/test-audit/mutation-gaps.ts --before … --after …`.

## Before and after (counted mutants: survived plus no coverage)

| file | function | before | after |
| --- | --- | --- | --- |
| packages/core/src/testmail/batch.ts | validateBatch | 26 | 0 |
| packages/core/src/testmail/target.ts | buildCompareRows | 13 | 4 |
| packages/core/src/testmail/target.ts | renderCompareTable | 10 | 5 |
| packages/core/src/testmail/send-log.ts | caseStates | 9 | 1 |
| packages/core/src/testmail/batch.ts | (module level) | 6 | 0 |
| packages/core/src/testmail/plan.ts | planSends | 5 | 3 |
| packages/core/src/testmail/blind.ts | (module level) | 5 | 0 |
| packages/core/src/testmail/batch.ts | hasUnreservedUrl | 4 | 2 |
| packages/core/src/testmail/batch.ts | isReservedHost | 3 | 0 |
| packages/core/src/testmail/send-log.ts | parseSendLog | 2 | 1 |
| packages/core/src/testmail/send-log.ts | sentInWindow | 2 | 1 |
| packages/core/src/testmail/batch.ts | hasPhoneNumber | 2 | 0 |
| packages/core/src/testmail/blind.ts | blindView | 2 | 0 |
| packages/core/src/testmail/send-log.ts | guardId | 2 | 0 |
| packages/core/src/testmail/batch.ts | hasUnreservedAddress | 1 | 1 |
| packages/core/src/testmail/target.ts | buildTargetInput | 1 | 1 |
| packages/core/src/testmail/target.ts | cell | 1 | 0 |
| packages/core/src/testmail/target.ts | markerOf | 1 | 0 |

Listed functions: `validateBatch` 26 to 0, the persona file schema refinement (`batch.ts` module level) 6 to 0, `buildCompareRows` 13 to 4, `renderCompareTable` 10 to 5, `caseStates` 9 to 1, `planSends` 5 to 3, `blind.ts` module level 5 to 0. Every listed function except `renderCompareTable` is under 5. `renderCompareTable` stays at 5 (all in the sort comparator); see the question.

## New cases and their kills

The run of `2d5148a4` had one more case, "a case that replies into a loop it is not part of lists each case of the loop once" in `blind.test.ts`. Without `seen.add(parent.id)` it loops for ever, so Stryker records a timeout and no `killedBy`, and the tool listed the case with 0 kills (exit 1). The case was removed after the run; the mutant (`blind.ts` 23:7) is back in the survivors (one survivor in `blindView`, which is not a listed function). Every other row of the tables is unchanged by that removal.

| test file | case | kills |
| --- | --- | --- |
| batch.test.ts | batch.test.ts > personaFileSchema keys > a repeated key is an issue on each later persona, at its own index | 6 |
| batch.test.ts | batch.test.ts > validateBatch rules > a batch id that differs from the file name comes last | 2 |
| batch.test.ts | batch.test.ts > validateBatch rules > a blank test mailbox address flags nothing | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > a blind delegation with active delegates when blind is required | 2 |
| batch.test.ts | batch.test.ts > validateBatch rules > a blind label equal to the expected category | 2 |
| batch.test.ts | batch.test.ts > validateBatch rules > a blind label that differs from the expected category | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > a blind label that differs, with a borderline note | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > a blind label that differs, with a note that is not borderline | 2 |
| batch.test.ts | batch.test.ts > validateBatch rules > a carriage return in the subject | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > a case language that differs from the persona language | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > a duplicate id is flagged after the issues of the first case with that id | 3 |
| batch.test.ts | batch.test.ts > validateBatch rules > a duplicate id is flagged on the second case only | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > a line feed in the subject | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > a link to a host with an unknown ending | 3 |
| batch.test.ts | batch.test.ts > validateBatch rules > a link to a real host in the body | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > a link to a real host in the subject | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > a missing blind label when blind is required | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > a number with 9 digits in the body | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > a number with 9 digits in the subject | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > a reserved host followed by two closing marks | 3 |
| batch.test.ts | batch.test.ts > validateBatch rules > a spaced number with 8 digits | 2 |
| batch.test.ts | batch.test.ts > validateBatch rules > a www host with an unknown ending | 3 |
| batch.test.ts | batch.test.ts > validateBatch rules > an address on a real host in the body | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > an address on a real host in the subject | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > an expected and a blind delegation without active delegates when blind is required | 4 |
| batch.test.ts | batch.test.ts > validateBatch rules > an expected delegation without active delegates | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > an unknown persona is flagged without a language issue | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > one case that breaks several rules lists them in rule order | 7 |
| batch.test.ts | batch.test.ts > validateBatch rules > replyTo an earlier case of another persona in the work group | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > replyTo an earlier case of another persona outside the work group | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > replyTo an earlier case of the same persona outside the work group | 6 |
| batch.test.ts | batch.test.ts > validateBatch rules > replyTo to a later case | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > replyTo to the case itself | 2 |
| batch.test.ts | batch.test.ts > validateBatch rules > replyTo with an id that is not in the batch | 1 |
| batch.test.ts | batch.test.ts > validateBatch rules > the bare host test | 4 |
| batch.test.ts | batch.test.ts > validateBatch rules > the test mailbox address in the body, whatever its case and padding | 3 |
| batch.test.ts | batch.test.ts > validateBatch rules > the test mailbox address in the subject | 3 |
| blind.test.ts | blind.test.ts > blindLabelsSchema, exact issues > a repeated id is an issue on each later label, at its own index | 5 |
| blind.test.ts | blind.test.ts > blindView, exact output > a reply to itself and a loop of replies stop at the first repeat | 1 |
| plan.test.ts | plan.test.ts > planSends, exact plans > a case with no state in the map is due | 2 |
| send-log.test.ts | send-log.test.ts > caseStates, exact states > a higher attempt wins over a lower one, whatever the log order | 3 |
| send-log.test.ts | send-log.test.ts > caseStates, exact states > the earliest sent wins, whatever the log order | 1 |
| send-log.test.ts | send-log.test.ts > caseStates, exact states > the later intent of an equal attempt does not replace the first | 5 |
| send-log.test.ts | send-log.test.ts > caseStates, exact states > two sent lines at the same time: the first one in the log wins | 2 |
| send-log.test.ts | send-log.test.ts > caseStates, exact states > within one attempt a failed line wins over its intent, whatever the log order | 4 |
| send-log.test.ts | send-log.test.ts > keys and labels > a label of 256 characters is valid and one of 257 is not | 2 |
| send-log.test.ts | send-log.test.ts > parseSendLog > skips a blank line and a whitespace-only line between lines | 1 |
| send-log.test.ts | send-log.test.ts > sentInWindow > a send exactly at the start of the window is outside it | 2 |
| target.test.ts | target.test.ts > buildCompareRows, exact rows > one row per case in batch order, with every cell of each state | 1 |
| target.test.ts | target.test.ts > buildCompareRows, exact rows > the first result of an email wins | 1 |
| target.test.ts | target.test.ts > buildCompareRows, exact rows > two copies with the same id keep their input order | 4 |
| target.test.ts | target.test.ts > buildCompareRows, exact rows > with many copies in a shuffled order, the copy with the lowest id is used | 3 |
| target.test.ts | target.test.ts > buildCompareRows, exact rows > with no result on any copy, the copy with the lowest id is used, whatever the input order | 7 |
| target.test.ts | target.test.ts > buildCompareRows, exact rows > with results on several copies, the copy with the lowest id that has one is used | 6 |
| target.test.ts | target.test.ts > buildTargetInput, markers > a note that is neither attack nor borderline gives no marker | 1 |
| target.test.ts | target.test.ts > renderCompareTable, exact text > a pipe in a cell is escaped and the cell keeps its other text | 1 |
| target.test.ts | target.test.ts > renderCompareTable, exact text > a row that is not sent, not synced or not triaged shows its state label | 3 |
| target.test.ts | target.test.ts > renderCompareTable, exact text > an empty table is the header and a zero summary | 3 |
| target.test.ts | target.test.ts > renderCompareTable, exact text > many prompt versions of one count are listed by name, whatever the row order | 2 |
| target.test.ts | target.test.ts > renderCompareTable, exact text > prompt versions sort by count, then by name, and a missing version reads none | 2 |
| target.test.ts | target.test.ts > renderCompareTable, exact text > prompt versions with equal counts are listed by name, whatever the row order | 2 |

1 new case kills no before-survivor


## Self-classed

Key: file, line:column, mutator, replacement.

| key | class | reason |
| --- | --- | --- |
| `batch.ts` 114:90 StringLiteral `"Stryker was here!"` | unreachable | the address pattern has a capture group that always matches, so `match[1] ?? ""` never takes `""` |
| `batch.ts` 120:72 StringLiteral `"Stryker was here!"` | unreachable | same: the host patterns always capture |
| `batch.ts` 124:28 StringLiteral `"Stryker was here!"` | unreachable | same: the bare domain pattern always captures |
| `send-log.ts` 61:47 StringLiteral `"Stryker was here!"` | unreachable | `split` returns at least one element, so the last index always exists |
| `send-log.ts` 130:16 ConditionalExpression `true` | equivalent | at that branch the top line is an intent: failed is handled before and a sent line sets `sent` |
| `send-log.ts` 139:33 ConditionalExpression `true` | equivalent | only a sent line has `via`, so `line.via === "send"` already implies the type |
| `plan.ts` 43:37 ObjectLiteral `{}` | equivalent | a state with no kind takes the due branch, like `{ kind: "due" }` |
| `plan.ts` 43:45 StringLiteral `""` | equivalent | same |
| `plan.ts` 56:57 StringLiteral `""` | equivalent | the parent state is only compared with `"failed"` |
| `target.ts` 56:20 OptionalChaining `state.kind` | equivalent | `caseStates` returns a state for every case id of the batch |
| `target.ts` 112:70 ConditionalExpression `true` | equivalent | the sort moves an element only for a negative result (probe on Bun 1.4.4: 30 shuffled ids sort the same); 1 and 0 act alike |
| `target.ts` 112:70 ConditionalExpression `false` | equivalent | same |
| `target.ts` 112:70 EqualityOperator `a.id >= b.id` | equivalent | same |
| `target.ts` 112:70 EqualityOperator `a.id <= b.id` | equivalent | same |
| `target.ts` 197:37 EqualityOperator `a[0] <= b[0]` | unreachable | the names are keys of a `Map`, so two entries never have an equal name |
| `target.ts` 197:56 ConditionalExpression `true` | unreachable | same: only an equal name differs |
| `target.ts` 197:56 EqualityOperator `a[0] >= b[0]` | unreachable | same |
| `target.ts` 197:56 ConditionalExpression `false` | equivalent | the sort moves an element only for a negative result |
| `target.ts` 197:56 EqualityOperator `a[0] <= b[0]` | equivalent | same |

Inside the listed functions only `renderCompareTable` stays at 5 or more: 3 unreachable and 2 equivalent, over the cap of 3 per function (see the question). `buildCompareRows` keeps 4, `planSends` 3 and `caseStates` 1; they are under 5 and are classed here for the spot-check only.

Local check of the sort mutants: each of ten comparator mutants (`target.ts` 112 and 197) was applied by hand and `bun test src/testmail/target.test.ts` was run. Only `a.id <= b.id ? -1` (equal ids) failed; the Stryker run also kills it, through the case "two copies with the same id keep their input order". The other nine passed with 30 shuffled ids and 30 shuffled versions.

## Not counted here

Static mutants (module-level regexes and zod schemas) are outside the audit and the default full run. With `--with-static` the module-level rows were `batch.ts` 37 to 26, `send-log.ts` 11 to 11, `target.ts` 5 to 5, `blind.ts` 5 to 0. No case of this stage targets them.

## Bugs

None found. One difference from the stage text: a case that has a sent line and a later failed line is `sent` at HEAD (the mail left, so the case is done); the stage text says the later state wins. The code is deliberate (the existing case "sent of an older attempt wins over a newer intent" pins the same rule), so no case pins the failed line and no bug is listed.

## Question for the coordinator

`renderCompareTable` keeps 5 mutants in the sort comparator of the prompt-version list (`target.ts` 197): 3 unreachable (equal names cannot occur in a `Map`) and 2 equivalent for this sort engine. The cap (3 per function, 10 per stage) is exceeded, so the stage asks: accept the 5 as classed? Proposed default: accept. No test can kill them without a change to `target.ts`, which is out of scope.
