# Results: replies tests (drafter schema, decoded view, digits, input)

Runs: `bash scripts/test-audit/mutation.sh` on `src/replies/views.ts`, `digits.ts`, `input.ts` (default, static mutants ignored). Before: a checkout of `HEAD` without the new tests. After: this branch. The tool output is `bun scripts/test-audit/mutation-gaps.ts --before … --after …`.

## Before and after (target functions)

| file | function | before | after |
| --- | --- | --- | --- |
| views.ts | deobfuscate | 23 | 0 |
| digits.ts | alnumStream | 7 | 6 |
| digits.ts | numberKeys | 6 | 4 |
| input.ts | cutChars | 7 | 2 |
| schema.ts | (module level) | 42 | not verified (see below) |

## New cases that kill a before-survivor (tool output, without schema.test.ts)

| test file | case | kills |
| --- | --- | --- |
| digits.test.ts | digits.test.ts > the typed number keys and the IBAN stream > a letter of another script breaks the stream even when its capital is an ASCII letter | 1 |
| digits.test.ts | digits.test.ts > the typed number keys and the IBAN stream > a typed number written with dashes is known as one number | 1 |
| digits.test.ts | digits.test.ts > the typed number keys and the IBAN stream > typed groups that follow each other after two spaces are one number | 1 |
| input.test.ts | input.test.ts > cutChars > counts a pair as one character at the limit | 1 |
| input.test.ts | input.test.ts > cutChars > cuts a text one over the limit | 5 |
| input.test.ts | input.test.ts > cutChars > cuts after a surrogate pair without splitting it | 5 |
| input.test.ts | input.test.ts > cutChars > gives an empty text for a limit of 0 | 4 |
| input.test.ts | input.test.ts > cutChars > keeps a text of exactly the limit | 1 |
| views.test.ts | views.test.ts > the decoded view > a dot word after a domain part with spaces: a@b . co dot pl | 5 |
| views.test.ts | views.test.ts > the decoded view > a dot word after a dotted domain: a@b.co dot pl | 5 |
| views.test.ts | views.test.ts > the decoded view > a split scheme without a space after the first letter: ht t p://x.pl | 3 |
| views.test.ts | views.test.ts > the decoded view > a split scheme without a space before the colon: h t t p://x.pl | 2 |
| views.test.ts | views.test.ts > the decoded view > a split scheme without a space before the p: h t tp://x.pl | 3 |
| views.test.ts | views.test.ts > the decoded view > a split scheme without a space before the s: h t t ps://x.pl | 3 |
| views.test.ts | views.test.ts > the decoded view > a split scheme without a space between the t letters: h ttp://x.pl | 4 |
| views.test.ts | views.test.ts > the decoded view > a split scheme without s: h t t p ://x.pl | 1 |
| views.test.ts | views.test.ts > the decoded view > a split scheme: H t t p s://x.pl | 2 |
| views.test.ts | views.test.ts > the decoded view > spaces inside a dot in brackets: a ( . ) b | 2 |
| views.test.ts | views.test.ts > the decoded view > spaces inside a dot word in brackets: a ( dot ) b | 2 |
| views.test.ts | views.test.ts > the decoded view > spaces inside an at word in brackets: a ( at ) b | 1 |
| views.test.ts | views.test.ts > the decoded view > spaces inside the brackets: jan ( malpa ) firma | 1 |
| views.test.ts | views.test.ts > the decoded view > two spaces after a bare at: jan at  firma dot pl | 1 |
| views.test.ts | views.test.ts > the decoded view > two spaces around a dot word after an address: jan@firma  dot  pl | 2 |
| views.test.ts | views.test.ts > the decoded view > two spaces before a bare at: jan  at firma dot pl | 1 |
| views.test.ts | views.test.ts > the decoded view > two spaces before a dot word with an at word: jan at firma  dot pl | 2 |


The tool exits 1 on this run only because of the cases of `schema.test.ts`: this run did not include `schema.ts`.

## Not verified: schema.ts

The mutation pair for `schema.ts` did not run: the run lock queue was too long for the job budget. Instead:
- A first run of all four files (before the last edit of `schema.test.ts`) showed `(module level)` of `schema.ts` going from 42 no-coverage mutants to 3 survivors. The 3 were the `code: "custom"` string of each issue. The last edit made the test assert `code`; that rerun did not happen.
- Manual break check (one source edit at a time, `bun test src/replies/schema.test.ts`, source then restored): body max 10_001 and 9_999, gap max 21 and 19, gap length max 201 and 199, `.strict()` removed, language list with `"de"`: each gives 1 failing test.
- The limit rows (limit, extra key, language) kill only static mutants, which the default run ignores. To prove the kill rule for them, run `bash scripts/test-audit/mutation.sh <out> --with-static --mutate src/replies/schema.ts` before (without `schema.test.ts`) and after.

## Self-classed (remaining mutants)

All are `equivalent`: no input changes the output.

| mutant | class | reason |
| --- | --- | --- |
| digits.ts 243:78 ArrayDeclaration (alnumStream, no coverage) | equivalent | An empty match list and the junk token both give a stream with no IBAN start. |
| digits.ts 242:13 StringLiteral prefix of `out` | equivalent | A lower-case prefix holds no country code, so no candidate starts in it. |
| digits.ts 245:50 MethodExpression `token` | equivalent | An IBAN candidate starts at the last two letters of a word; the longer word adds no candidate. |
| digits.ts 245:62 UnaryOperator `slice(+2)` | equivalent | Same: the last two letters stay in the stream. |
| digits.ts 246:14 Regex without `^`, and without `$` (2 mutants) | equivalent | A token is an ASCII alphanumeric run or one non-ASCII character; both forms give the same test. |
| digits.ts 200:26 ArrayDeclaration (numberKeys) | equivalent | A text key holds no digit run of 3 or more digits. |
| digits.ts 201:15 and 205:15 StringLiteral (numberKeys chain) | equivalent | A prefix without digits adds no digit substring to a key. |
| digits.ts 210:9 ConditionalExpression `true` (numberKeys) | equivalent | It pushes a duplicate key. |
| input.ts 31:10 `false` and `chars.length < max` | equivalent | When the length equals the limit, the join of all characters is the text itself. |

Cap: `alnumStream` keeps 6 counted mutants, all `equivalent` (cap is 3 per function). `numberKeys` (4) and `cutChars` (2) are under 5. Question for the coordinator: accept the 6 on `alnumStream`? No further case can kill them.

## Bugs

None found. One observation, not pinned: `decodedView("jan at firma dot co dot uk")` gives `jan@firma.co dot uk` (only the first dot word becomes a dot). One case pins the documented rule that a letter of another script breaks the IBAN stream (a dotless i inside an IBAN hides it from `ibansOf`).
