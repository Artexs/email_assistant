# Stage 09 results: public content check, next path, CSP parse

Run: `bash scripts/test-audit/mutation.sh <dir> --mutate 'src/web/public-content.ts' --mutate 'src/web/next-path.ts' --mutate 'src/web/csp.ts'` before (at `HEAD` without new cases, from a `git archive` copy) and after (the committed cases). Then `bun scripts/test-audit/mutation-gaps.ts --before … --after …` exited 0 ("0 new cases kill no before-survivor").

## Result per function

| Function | Before | After | Remaining |
| --- | --- | --- | --- |
| `ipv4Allowed` | 25 | 0 | none |
| `r4ExternalAsset` | 17 | 11 | all self-classed below |
| `parseAllowList` | 16 | 14 | all self-classed below |
| `safeNextPath` | 16 | 5 | all self-classed below |
| `parseDirectives` | 5 | 2 | under 5 (a marker mutant and `/\s/` for `/\s+/`, which splits to the same first token) |

Not required by the table but moved by the same cases: `isExternal` 3 to 0, `attribute` 2 to 1.

## Self-classed

Key: file, line:column, mutator, replacement. Cap check: the plan allows 3 `equivalent` plus `unreachable` per function and 10 per stage. This stage is over it (see "Over the cap"). The mutants of the tool marker kind (`"Stryker was here!"`, `["Stryker was here"]`) are classed `equivalent` on the coordinator's rule.

### `safeNextPath` (5)

| Key | Class | Reason |
| --- | --- | --- |
| `next-path.ts` 3:44 ConditionalExpression `false` | equivalent | `""` then falls to the `startsWith("/")` check and returns `/` as before |
| `next-path.ts` 3:52 StringLiteral `"Stryker was here!"` | equivalent | tool marker; same fall-through for `""` |
| `next-path.ts` 4:19 EqualityOperator `i <= raw.length` | equivalent | `charCodeAt(raw.length)` is `NaN`; both tests are false |
| `next-path.ts` 10:7 ConditionalExpression `false` | unreachable | after the checks above, `raw` starts with one `/`, so the resolved origin is always the base origin |
| `next-path.ts` 10:49 StringLiteral `""` | unreachable | the body of the same guard |

### `r4ExternalAsset` (11)

| Key | Class | Reason |
| --- | --- | --- |
| `public-content.ts` 71:26 ArrayDeclaration `["Stryker was here"]` | equivalent | tool marker; the array is filled before use |
| `public-content.ts` 73:43 StringLiteral marker | equivalent | tool marker; group 4 of the match is never empty |
| `public-content.ts` 74:9 OptionalChaining `m[1].toLowerCase` | unreachable | group 1 always matched |
| `public-content.ts` 75:82 Regex `/\s/` | equivalent | `trim()` first, so the first token is the same |
| `public-content.ts` 75:95 StringLiteral marker | equivalent | tool marker; `split` never returns an empty array |
| `public-content.ts` 79:36 StringLiteral marker | equivalent | tool marker; `m[1]` is never nullish |
| `public-content.ts` 79:50 StringLiteral marker | equivalent | tool marker; no `rel` token matches the marker text |
| `public-content.ts` 79:74 Regex `/\s/` | equivalent | an extra empty token changes no `includes` answer |
| `public-content.ts` 81:35 StringLiteral marker | equivalent | tool marker; `m[1]` is never nullish |
| `public-content.ts` 81:50 StringLiteral marker | equivalent | tool marker; the marker text is not an external url |
| `public-content.ts` 85:39 StringLiteral marker | equivalent | tool marker; group 3 always matched |

### `parseAllowList` (14)

The check `entry === "" || reason === ""` is redundant: after `trim()`, `entry` or `reason` is empty only when the line holds no ` | `. So both the throw and its conditions reduce to `cut < 0`, and no input tells these mutants from the code.

| Key | Class | Reason |
| --- | --- | --- |
| `public-content.ts` 139:19 ConditionalExpression `false` | equivalent | `cut < 0` still gives an empty `reason`, which throws |
| `public-content.ts` 139:19 EqualityOperator `cut <= 0` | equivalent | `cut` is never 0 after `trim()` |
| `public-content.ts` 139:29 StringLiteral marker | equivalent | tool marker; `reason` is empty, so it throws |
| `public-content.ts` 140:20 ConditionalExpression `false` | equivalent | `cut < 0` still gives an empty `entry`, which throws |
| `public-content.ts` 140:20 EqualityOperator `cut <= 0` | equivalent | `cut` is never 0 after `trim()` |
| `public-content.ts` 140:30 StringLiteral marker | equivalent | tool marker; `entry` is empty, so it throws |
| `public-content.ts` 140:35 MethodExpression `line.slice(cut + 3)` | equivalent | the line has no trailing space, so `trim()` removes nothing that decides emptiness |
| `public-content.ts` 140:35 MethodExpression `line` | equivalent | a non-empty line is a non-empty reason |
| `public-content.ts` 140:46 ArithmeticOperator `cut - 3` | equivalent | the slice is non-empty in both forms |
| `public-content.ts` 141:9 ConditionalExpression `false` | equivalent | the other operand throws for every line without ` | ` |
| `public-content.ts` 141:9 LogicalOperator `&&` | equivalent | both are empty exactly when `cut < 0` |
| `public-content.ts` 141:19 StringLiteral marker | equivalent | tool marker; `reason === ""` still throws |
| `public-content.ts` 141:25 ConditionalExpression `false` | equivalent | the other operand throws for every line without ` | ` |
| `public-content.ts` 141:36 StringLiteral marker | equivalent | tool marker; `entry === ""` still throws |

## Over the cap

Non-marker rows: `parseAllowList` 10, `safeNextPath` 4, `r4ExternalAsset` 3; stage total 17 (cap: 3 per function, 10 per stage). The cause is dead or redundant code, not missing cases. A later change to the product code would remove it (drop the redundant empty checks in `parseAllowList`; drop the origin guard in `safeNextPath`). This stage changes no product code, so the question for the coordinator is whether to accept these classes as they stand. Question file: `questions-stage-09.md`.

## Bugs

none.

## New cases and their kills

Output of `mutation-gaps.ts --before --after` (the `0 new cases kill no before-survivor` line closes it).

| test file | case | kills |
| --- | --- | --- |
| packages/core/src/web/csp.test.ts | src/web/csp.test.ts > parseDirectives > an empty policy has no directive | 3 |
| packages/core/src/web/csp.test.ts | src/web/csp.test.ts > parseDirectives > it drops spaces and empty parts between semicolons and keeps the inner spaces of a directive | 3 |
| packages/core/src/web/next-path.test.ts | src/web/next-path.test.ts > safeNextPath edges > "//x.invalid/a" -> "/" | 1 |
| packages/core/src/web/next-path.test.ts | src/web/next-path.test.ts > safeNextPath edges > "/loginx" -> "/" | 1 |
| packages/core/src/web/next-path.test.ts | src/web/next-path.test.ts > safeNextPath edges > "/setup/x" -> "/" | 1 |
| packages/core/src/web/next-path.test.ts | src/web/next-path.test.ts > safeNextPath edges > "/x\u0007" -> "/" | 6 |
| packages/core/src/web/next-path.test.ts | src/web/next-path.test.ts > safeNextPath edges > "/x\u001f" -> "/" | 7 |
| packages/core/src/web/next-path.test.ts | src/web/next-path.test.ts > safeNextPath edges > "/x_" -> "/" | 6 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 0.0.0.1 is a public address and fails | 3 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 172.15.0.1 is a public address and fails | 5 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 172.31.255.1 is a private address and passes | 1 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 172.32.0.1 is a public address and fails | 2 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 192.0.113.1 is a public address and fails | 11 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 192.0.3.1 is a public address and fails | 7 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 192.1.2.1 is a public address and fails | 9 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 192.169.1.1 is a public address and fails | 4 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 192.51.100.1 is a public address and fails | 8 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 198.51.101.7 is a public address and fails | 4 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 198.52.100.1 is a public address and fails | 6 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 203.0.114.9 is a public address and fails | 5 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 203.1.113.1 is a public address and fails | 7 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 8.0.113.1 is a public address and fails | 7 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 8.0.2.1 is a public address and fails | 7 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 8.168.0.1 is a public address and fails | 4 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 8.20.0.1 is a public address and fails | 5 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 8.51.100.1 is a public address and fails | 6 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > IPv4 address classes > 8.8.8.8 is a public address and fails | 3 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > external asset forms > <img SRCSET='//cdn.x.io/a.png 2x'> fails with its url | 2 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > external asset forms > <img src=" https://cdn.x.io/a.png "> fails with its url | 2 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > external asset forms > <img src="/https://cdn.x.io/a.png"> passes | 1 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > external asset forms > <img src="https://artexs.github.io"> passes | 2 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > external asset forms > <img src="https://artexs.github.io/a.png"> passes | 1 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > external asset forms > <img src='//cdn.x.io/a.png'> fails with its url | 2 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > external asset forms > <link REL="stylesheet" HREF="https://cdn.x.io/s.css"> fails with its url | 1 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > external asset forms > <p style="background:url('https://cdn.x.io/i.png')"> fails with its url | 2 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > external asset forms > a{background:url( 'https://cdn.x.io/i.png' )} fails with its url | 3 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > external asset forms > a{background:url('https://cdn.x.io/i.png')} fails with its url | 2 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > parseAllowList lines > a bar without spaces throws with the line number | 1 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > parseAllowList lines > an empty entry throws with the line number | 1 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > parseAllowList lines > an empty reason throws with the line number | 1 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > parseAllowList lines > it skips an indented comment line and a line of spaces | 1 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > parseAllowList lines > it trims the spaces around the entry and the reason | 1 |
| packages/core/src/web/public-content.test.ts | src/web/public-content.test.ts > parseAllowList lines > no separator throws with the line number | 1 |

0 new cases kill no before-survivor
