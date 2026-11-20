# F160 core mutation gaps: result and classes

Runs: `bash scripts/test-audit/mutation.sh <dir> --mutate <file>… --with-static` on five files
(`texts/operator.ts`, `cli/render.ts`, `cli/description.ts`, `ops/alert-text.ts`, `replies/schema.ts`).
Before: the commit before this work. After: this branch. `mutation-gaps.ts --before … --after …` exits 0
("0 new cases kill no before-survivor").

| file | function | before | after |
| --- | --- | --- | --- |
| texts/operator.ts | `slo_urgent_latency` (en + pl) | 21 | 0 |
| texts/operator.ts | `slo_llm_errors` (en + pl) | 18 | 0 |
| texts/operator.ts | `slo_backup_age` (en + pl) | 5 | 0 |
| ops/alert-text.ts | `operatorEventSample` | 12 | 0 |
| cli/render.ts | `renderToolTable` | 12 | 7 (classed below) |
| cli/description.ts | (module level, with static mutants) | 24 | 4 (classed below) |
| replies/schema.ts | (module level, with static mutants) | 1 | 0 |

The default run (static mutants ignored) counts fewer module-level mutants of `description.ts` than the
with-static run above; both are under 5 after.

## Remaining mutants

`renderToolTable` (7, `cli/render.ts`):

| position | mutator | class | reason |
| --- | --- | --- | --- |
| 33:45 | ConditionalExpression `true` and `false`, EqualityOperator `>=` and `<=` (4) | equivalent | They change the comparator result only between `1` and `0` (greater against equal). Bun's sort asks for `< 0` only, so no input order changes. Verified: a 3-row reverse order test and a same-name stability test pass with each mutant. |
| 39:78 | OptionalChaining `row[column].length` | unreachable | Every cell row has four cells and `column` is 0 to 2. The `?.` only satisfies `noUncheckedIndexedAccess`. |
| 41:32 | ConditionalExpression `true`, EqualityOperator `column <= 3` (2) | equivalent | The last column then gets `padEnd(widths[3] ?? 0)`; `widths` has 3 entries, so the pad width is 0 and nothing changes. |

`description.ts` module level (4):

| position | mutator | class | reason |
| --- | --- | --- | --- |
| 72:27 | MethodExpression `trimEnd().startsWith("\n")` and `trimStart()` (2) | unreachable | The refine `!usage.trimEnd().endsWith("\n")` never fails: `trimEnd()` removes the newline first, so a usage with a trailing newline passes. A product bug (the intent is `usage.endsWith("\n")`); a test cannot tell the mutants from the original without a product change. |
| 72:59 | StringLiteral `""` (the refine message) | unreachable | The same refine never fails, so its message never shows. |
| 77:53 | StringLiteral `?? ""` | unreachable | `"…".split("\n")[0]` is never undefined; `?? ""` only satisfies `noUncheckedIndexedAccess`. |

Product finding for the coordinator (not changed here, out of scope): the "usage has no trailing newline" check in
`cliDescriptionSchema` is dead code. Fix: `!usage.endsWith("\n")`.

Also seen: the "summary is one line" refine always runs together with the regex issue (`.` does not match a
newline), so a two-line summary gives two issues; the new test pins both.
