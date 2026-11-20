# Stage 16 results: sim support (fixtures, language detect, manifests, eval case thread, slot builder, metric row builders)

## Runs

Both runs: `bash scripts/test-audit/mutation.sh <dir> --mutate src/sim/fixtures.ts --mutate src/sim/lang.ts --mutate src/sim/manifest.ts --mutate src/sim/to-eval-case.ts --mutate src/sim/plan-bank.ts --mutate src/sim/sent-manifest.ts --mutate src/metrics/fixtures.ts`.
Each run took about 50 s. The before run used a copy of the branch base (`/tmp/f154-s16/before`); the after run used a copy of tip `5b1088bb` (`/tmp/f154-s16/after`). An earlier after run showed 13 cases that kill no before-survivor; they are removed or replaced in `5b1088bb`.
Compare: `bun scripts/test-audit/mutation-gaps.ts --before /tmp/f154-s16/before/mutation.json --after /tmp/f154-s16/after/mutation.json` printed `0 new cases kill no before-survivor` and exited 0.

Static mutants (code that runs while a test file loads) are ignored by `mutation.sh`. `plan-bank.test.ts` and other sim tests call `planBank` at module level, so most mutants of `buildSlot` count as `Ignored`. Only its 7 no-coverage mutants were counted before; the new cases reach each of them (error paths, the context profile and the sender swap).

## Before and after (counted mutants: survived plus no coverage)

| file | function | before | after |
| --- | --- | --- | --- |
| packages/core/src/sim/fixtures.ts | sentFixtureText | 11 | 0 |
| packages/core/src/sim/lang.ts | detectLang | 10 | 6 |
| packages/core/src/sim/manifest.ts | byId | 9 | 5 |
| packages/core/src/sim/to-eval-case.ts | threadOf | 8 | 0 |
| packages/core/src/sim/plan-bank.ts | buildSlot | 7 | 0 |
| packages/core/src/sim/sent-manifest.ts | byId | 6 | 5 |
| packages/core/src/metrics/fixtures.ts | hiddenMoveRow | 5 | 0 |
| packages/core/src/sim/manifest.ts | freezeIssues | 5 | 0 |
| packages/core/src/sim/fixtures.ts | filler | 4 | 2 |
| packages/core/src/metrics/fixtures.ts | handledRow | 3 | 0 |
| packages/core/src/sim/to-eval-case.ts | bodyOf | 3 | 0 |
| packages/core/src/metrics/fixtures.ts | delegationRow | 2 | 0 |
| packages/core/src/metrics/fixtures.ts | loopRow | 2 | 0 |
| packages/core/src/metrics/fixtures.ts | mistakeRow | 2 | 0 |
| packages/core/src/metrics/fixtures.ts | rejectRow | 2 | 0 |
| packages/core/src/metrics/fixtures.ts | truthRow | 2 | 0 |
| packages/core/src/metrics/fixtures.ts | urgentRow | 2 | 0 |
| packages/core/src/sim/to-eval-case.ts | partyOf | 2 | 0 |
| packages/core/src/sim/manifest.ts | nextVersion | 1 | 1 |
| packages/core/src/metrics/fixtures.ts | nextId | 1 | 0 |
| packages/core/src/sim/manifest.ts | partHash | 1 | 0 |
| packages/core/src/sim/plan-bank.ts | personaOf | 1 | 0 |
| packages/core/src/sim/plan-bank.ts | pickSender | 1 | 0 |
| packages/core/src/sim/plan-bank.ts | threadFor | 1 | 0 |
| packages/core/src/sim/sent-manifest.ts | sentFreezeIssues | 1 | 0 |
| packages/core/src/sim/sent-manifest.ts | sentManifestBody | 1 | 0 |
| packages/core/src/sim/sent-manifest.ts | sentPartHash | 1 | 0 |
| packages/core/src/sim/to-eval-case.ts | toEvalCase | 1 | 0 |

| test file | case | kills |
| --- | --- | --- |
| packages/core/src/metrics/fixtures.test.ts | src/metrics/fixtures.test.ts > hiddenMoveRow > a row with no override holds the default moved mail | 6 |
| packages/core/src/metrics/fixtures.test.ts | src/metrics/fixtures.test.ts > hiddenMoveRow > an override replaces its field and leaves the others | 2 |
| packages/core/src/metrics/fixtures.test.ts | src/metrics/fixtures.test.ts > the other row builders > a delegation row is a sent, open, uncancelled delegation | 3 |
| packages/core/src/metrics/fixtures.test.ts | src/metrics/fixtures.test.ts > the other row builders > a handled row is an info mail with every flag off | 4 |
| packages/core/src/metrics/fixtures.test.ts | src/metrics/fixtures.test.ts > the other row builders > a loop row is a waiting loop with a due time and nothing else set | 3 |
| packages/core/src/metrics/fixtures.test.ts | src/metrics/fixtures.test.ts > the other row builders > a reject row and a mistake row hold an action id and a time | 5 |
| packages/core/src/metrics/fixtures.test.ts | src/metrics/fixtures.test.ts > the other row builders > a truth row is an unlabelled info mail | 3 |
| packages/core/src/metrics/fixtures.test.ts | src/metrics/fixtures.test.ts > the other row builders > an urgent row has a mail id, its time and no notice | 3 |
| packages/core/src/sim/fixtures.test.ts | src/sim/fixtures.test.ts > sentFixtureText > a Polish slot with no signature has the Polish filler and no signature line | 7 |
| packages/core/src/sim/fixtures.test.ts | src/sim/fixtures.test.ts > sentFixtureText > a long text with no signature and no quote has 220 words | 4 |
| packages/core/src/sim/fixtures.test.ts | src/sim/fixtures.test.ts > sentFixtureText > a medium text with no signature and no quote has 100 words | 4 |
| packages/core/src/sim/fixtures.test.ts | src/sim/fixtures.test.ts > sentFixtureText > a short quoted slot with a signature has the filler, the signature, then one block per thread mail | 6 |
| packages/core/src/sim/fixtures.test.ts | src/sim/fixtures.test.ts > sentFixtureText > a short text with no signature and no quote has 20 words | 4 |
| packages/core/src/sim/fixtures.test.ts | src/sim/fixtures.test.ts > sentFixtureText > a slot that is not quoted has no quoted block | 2 |
| packages/core/src/sim/fixtures.test.ts | src/sim/fixtures.test.ts > sentFixtureText > a slot with a signature and an executive with an empty signature has no signature line | 8 |
| packages/core/src/sim/fixtures.test.ts | src/sim/fixtures.test.ts > sentFixtureText > a slot with no hard case has no planted list | 1 |
| packages/core/src/sim/fixtures.test.ts | src/sim/fixtures.test.ts > sentFixtureText > an injection slot plants the fixture string in the first block only and lists it | 4 |
| packages/core/src/sim/lang.test.ts | src/sim/lang.test.ts > detectLang > a text of Polish letters and no stopword counts each word with such a letter as a hit | 2 |
| packages/core/src/sim/lang.test.ts | src/sim/lang.test.ts > detectLang > a top score of exactly 1.5 times the second is enough | 2 |
| packages/core/src/sim/lang.test.ts | src/sim/lang.test.ts > detectLang > a top score of exactly 3 hits is enough; 2 hits is unknown | 1 |
| packages/core/src/sim/lang.test.ts | src/sim/lang.test.ts > detectLang > a top score of less than 1.5 times the second is unknown | 1 |
| packages/core/src/sim/manifest.test.ts | src/sim/manifest.test.ts > freeze > a category with exactly the floor of kept cases has no issue; one case fewer names both numbers | 1 |
| packages/core/src/sim/manifest.test.ts | src/sim/manifest.test.ts > freeze > a tag with exactly the share of its planned cases has no issue; one case fewer names both numbers | 1 |
| packages/core/src/sim/manifest.test.ts | src/sim/manifest.test.ts > freeze > the tags that lost cases are listed in the order of their names | 2 |
| packages/core/src/sim/manifest.test.ts | src/sim/manifest.test.ts > partHash > the hash of the slots in the order a, b, c is the hash of the pairs sorted by id | 2 |
| packages/core/src/sim/manifest.test.ts | src/sim/manifest.test.ts > partHash > the hash of the slots in the order a, c, b is the hash of the pairs sorted by id | 5 |
| packages/core/src/sim/manifest.test.ts | src/sim/manifest.test.ts > partHash > the hash of the slots in the order b, a, c is the hash of the pairs sorted by id | 5 |
| packages/core/src/sim/manifest.test.ts | src/sim/manifest.test.ts > partHash > the hash of the slots in the order b, c, a is the hash of the pairs sorted by id | 5 |
| packages/core/src/sim/manifest.test.ts | src/sim/manifest.test.ts > partHash > the hash of the slots in the order c, a, b is the hash of the pairs sorted by id | 5 |
| packages/core/src/sim/manifest.test.ts | src/sim/manifest.test.ts > partHash > the hash of the slots in the order c, b, a is the hash of the pairs sorted by id | 4 |
| packages/core/src/sim/plan-bank.test.ts | src/sim/plan-bank.test.ts > buildSlot > a category whose group has no persona in the scenario stops with the group | 1 |
| packages/core/src/sim/plan-bank.test.ts | src/sim/plan-bank.test.ts > buildSlot > a persona key that is not in the scenario stops with its key | 1 |
| packages/core/src/sim/plan-bank.test.ts | src/sim/plan-bank.test.ts > buildSlot > a profile with deadlines and no topic gives deadlines only | 2 |
| packages/core/src/sim/plan-bank.test.ts | src/sim/plan-bank.test.ts > buildSlot > a profile with no topic and no deadline stops with a message | 2 |
| packages/core/src/sim/plan-bank.test.ts | src/sim/plan-bank.test.ts > buildSlot > a rule that replaces the sender by anna: the signature is %s and the greeting follows the new sender | 3 |
| packages/core/src/sim/plan-bank.test.ts | src/sim/plan-bank.test.ts > buildSlot > a rule that replaces the sender by prezes: the signature is %s and the greeting follows the new sender | 1 |
| packages/core/src/sim/plan-bank.test.ts | src/sim/plan-bank.test.ts > buildSlot > a sender who is in no topic starts a thread with the executive, never with a made-up persona | 1 |
| packages/core/src/sim/plan-bank.test.ts | src/sim/plan-bank.test.ts > buildSlot > a vip urgent slot with no VIP persona in the scenario stops with a message | 1 |
| packages/core/src/sim/sent-manifest.test.ts | src/sim/sent-manifest.test.ts > sentFreezeIssues > two disagreeing fields are listed in one issue, joined by a comma | 1 |
| packages/core/src/sim/sent-manifest.test.ts | src/sim/sent-manifest.test.ts > sentManifestBody > a slot with no text is left out of the hash, the count, and the hard-case count | 2 |
| packages/core/src/sim/sent-manifest.test.ts | src/sim/sent-manifest.test.ts > sentManifestBody > the hash of the slots in the order a, b, c is the hash of the pairs sorted by id | 1 |
| packages/core/src/sim/sent-manifest.test.ts | src/sim/sent-manifest.test.ts > sentManifestBody > the hash of the slots in the order a, c, b is the hash of the pairs sorted by id | 1 |
| packages/core/src/sim/sent-manifest.test.ts | src/sim/sent-manifest.test.ts > sentManifestBody > the hash of the slots in the order b, a, c is the hash of the pairs sorted by id | 1 |
| packages/core/src/sim/sent-manifest.test.ts | src/sim/sent-manifest.test.ts > sentManifestBody > the hash of the slots in the order b, c, a is the hash of the pairs sorted by id | 1 |
| packages/core/src/sim/sent-manifest.test.ts | src/sim/sent-manifest.test.ts > sentManifestBody > the hash of the slots in the order c, a, b is the hash of the pairs sorted by id | 1 |
| packages/core/src/sim/sent-manifest.test.ts | src/sim/sent-manifest.test.ts > sentManifestBody > the hash of the slots in the order c, b, a is the hash of the pairs sorted by id | 1 |
| packages/core/src/sim/to-eval-case.test.ts | src/sim/to-eval-case.test.ts > toEvalCase > a recipient key that is no persona stops the join with its key | 2 |
| packages/core/src/sim/to-eval-case.test.ts | src/sim/to-eval-case.test.ts > toEvalCase > a thread mail of the slot with no text entry gets an empty subject and body | 5 |
| packages/core/src/sim/to-eval-case.test.ts | src/sim/to-eval-case.test.ts > toEvalCase > an empty parent list keeps the thread of the slot | 3 |
| packages/core/src/sim/to-eval-case.test.ts | src/sim/to-eval-case.test.ts > toEvalCase > an html-only mail hands the dep its sender, recipients, date and an empty html when it has none | 3 |
| packages/core/src/sim/to-eval-case.test.ts | src/sim/to-eval-case.test.ts > toEvalCase > the cc keys become addresses in order | 1 |
| packages/core/src/sim/to-eval-case.test.ts | src/sim/to-eval-case.test.ts > toEvalCase > the first three of four parents are left out; the last three stay in time order | 1 |

0 new cases kill no before-survivor

## Self-classed

The listed functions that stay at 5 or more counted mutants are `detectLang` (6), `byId` in `manifest.ts` (5) and `byId` in `sent-manifest.ts` (5). Every remaining counted mutant is classed below. The classes exceed the cap of 3 per function; the job task told the worker to class them and not to stop.

| file | line:col | mutator | replacement | class | reason |
| --- | --- | --- | --- | --- | --- |
| src/sim/lang.ts | 28:59 | ArrayDeclaration | `["Stryker was here"]` | equivalent | `match` returns null only for a text with no letter; a one-word list of a non-stopword scores 0 in every language, the same as an empty list. |
| src/sim/lang.ts | 36:7 | ConditionalExpression | `false` | unreachable | `scores` always holds three entries, so `top` and `second` are never undefined (the guard satisfies `noUncheckedIndexedAccess`). |
| src/sim/lang.ts | 36:7 | LogicalOperator | `top === undefined && second === undefined` | unreachable | same guard; neither operand is ever true. |
| src/sim/lang.ts | 36:7 | ConditionalExpression | `false` | unreachable | same guard. |
| src/sim/lang.ts | 36:28 | ConditionalExpression | `false` | unreachable | same guard. |
| src/sim/lang.ts | 36:57 | StringLiteral | `""` | unreachable | the return of the same guard never runs. |
| src/sim/manifest.ts | 86:57 | EqualityOperator | `a.slot.id <= b.slot.id` | equivalent | slot ids are unique (the plan gives each slot its own id); the sort never compares a slot with itself, so the equal case never runs. |
| src/sim/manifest.ts | 86:86 | ConditionalExpression | `true` | equivalent | after the first branch only `a > b` or `a == b` is left; with unique ids `a > b` holds, so `true` gives the same result. |
| src/sim/manifest.ts | 86:86 | ConditionalExpression | `false` | equivalent | `0` instead of `1` for `a > b`: Bun's sort moves an element only when the comparator returns a negative number. A probe sorted 3, 10, 40, 100 and 300 shuffled ids with this comparator and with the original (`/tmp/f154-s16/cmp.ts`); both gave the same order. |
| src/sim/manifest.ts | 86:86 | EqualityOperator | `a.slot.id >= b.slot.id` | equivalent | differs only for `a == b`; ids are unique. |
| src/sim/manifest.ts | 86:86 | EqualityOperator | `a.slot.id <= b.slot.id` | equivalent | `1` for `a <= b` is reached only for `a == b`; the `a < b` branch comes first. |
| src/sim/sent-manifest.ts | 54:57 | EqualityOperator | `a.id <= b.id` | equivalent | as manifest.ts 86:57. |
| src/sim/sent-manifest.ts | 54:76 | ConditionalExpression | `true` | equivalent | as manifest.ts 86:86 `true`. |
| src/sim/sent-manifest.ts | 54:76 | EqualityOperator | `a.id >= b.id` | equivalent | as manifest.ts 86:86 `>=`. |
| src/sim/sent-manifest.ts | 54:76 | ConditionalExpression | `false` | equivalent | as manifest.ts 86:86 `false`; the same probe. |
| src/sim/sent-manifest.ts | 54:76 | EqualityOperator | `a.id <= b.id` | equivalent | as manifest.ts 86:86 `<=`. |

Not in a listed function, also left: `filler` in `sim/fixtures.ts` 177:46 (`words * 10`, equivalent: the array is cut to `words` after) and 178:20 (`/\s/`, equivalent: the joined text has single spaces only); `nextVersion` in `sim/manifest.ts` 172:38 (`""`, equivalent: `Number("") + 1` and `Number("0") + 1` are both 1).

## Bugs

none.

## Plan table vs cases written

- The table of the plan said `byId` through `partHash` / `sentPartHash` with an `equivalent` class for equal ids: done above.
- `detectLang` fixed values from the plan (a Polish, an English, a number-only text) already pass in the existing test and kill no mutant, so they are not new cases. The new cases are tied to the thresholds (3 hits, ratio 1.5) and to the Polish-letter count.
- Exact-field cases for `buildSlot` with a fixed seed killed no counted mutant (their mutants are static and ignored), so they were removed; the cases that remain kill the counted ones.
- `freezeIssues` has two cases for the floors (the exact floor and one case fewer) and one for the sorted tag order, plus the exact `detail` of the unwritten and unlabelled issues (a strengthened existing case).
- The weaker case "the hash does not depend on the order of the slots" in `sent-manifest.test.ts` is replaced by the six-order table.
