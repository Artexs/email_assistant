# Stage 06 results: look-alike domains and the punycode decoder

Source: `packages/core/src/triage/suspicious.ts`. Tests: `packages/core/src/triage/suspicious.test.ts`. Commands:

```
bash scripts/test-audit/mutation.sh /tmp/f154-s06/before --mutate src/triage/suspicious.ts   # before any edit
bash scripts/test-audit/mutation.sh /tmp/f154-s06/after  --mutate src/triage/suspicious.ts   # at the test commit
bun scripts/test-audit/mutation-gaps.ts --before /tmp/f154-s06/before/mutation.json --after /tmp/f154-s06/after/mutation.json
```

The gap tool exited 0: every new case kills at least one mutant that survived before ("0 new cases kill no before-survivor").

## Before and after (counted mutants: survived plus no coverage)

| Function | Before | After |
| --- | --- | --- |
| `isOneEditApart` | 29 | 8 |
| `punycodeDecode` | 23 | 5 |
| `adapt` | 18 | 0 |
| `digitValue` | 16 | 7 |
| `skeleton` | 8 | 1 |
| `isLookalike` | 9 | 3 |

The other functions of the file (stage 07 owns them) are not counted here.

## Cases added (22 test rows in 6 `test.each` / test blocks, one commit)

- `isLookalike`: insertion, deletion, two substitutions, length difference 2, other TLD, three near-swap shapes that are not swaps (different first letter, second letter, tail), an insertion with a different tail, label length edges (4/4, 5/5, 4/5, 5/4), a sender on the known list next to another known domain, and three skeleton matches with labels under 5 letters (so only the skeleton route can answer): `vv`, hyphen, `i` for `l`.
- `registrableDomain` with punycode: `日本語`, `げ射故`, `쀞ѣѿ`, `膺ご` (several bias rounds, large deltas), `aaaaa늄댎` (a digit sum of 391 after the first round, the bias threshold edge), U+10FFFF (the last valid code point); invalid keeps the label: `{` after `z` in the digit table, a non-ASCII or U+0080 character in the basic part, a hyphen at the start of the encoded part.
- The 15 values of the stage file that already killed their mutants in the existing tests (plain substitution, adjacent swaps, the known-list case, the two-sided target case, `rn` to `m`) are not added: each killed no before-survivor, so the gap tool would have refused them.

## Self-classed (24 rows: over the cap; question in `stage-06-questions.md`)

Keys are line:column in the file at this commit, then mutator and replacement. Every row survives the final test run.

| Function | Key | Class | Reason |
| --- | --- | --- | --- |
| `isOneEditApart` | 312:18 `ConditionalExpression` false | equivalent | A length difference of 2 or more never makes the shorter tail equal the longer tail one character on: their lengths differ. |
| `isOneEditApart` | 314:10 true, 314:10 `\|\|` (with its parentheses), 314:10 `<=`, 314:30 true, 314:30 `<=`, 314:10 inner true | equivalent (6 rows) | The loop also needs `a[start] === b[start]`. Past the end of one string that is `undefined` against a character, which is false; both ends are reached only when `a === b`, which returns first. Checked over every pair of strings from {a, b, c} up to length 6: 0 differences for each mutant. |
| `isOneEditApart` | 321:29 `<=` | equivalent | Equal lengths return in the branch above; the lengths differ here, so `<` and `<=` agree. Same exhaustive check: 0 differences. |
| `punycodeDecode` | 176:11 false, 176:11 `>` | equivalent (2) | `charCodeAt` past the end gives `NaN`; `digitValue(NaN)` is `-1`; the next check returns `null` as the removed check did. |
| `punycodeDecode` | 180:37 `>` | equivalent | At `k === bias + T_MAX` both branches give `T_MAX`. |
| `punycodeDecode` | 188:9 false | equivalent | Without the check a code point above U+10FFFF makes `String.fromCodePoint` throw; the `catch` returns `null`, the same result. |
| `punycodeDecode` | 193:11 `{}` | unreachable | With the check at line 188, `String.fromCodePoint` never throws. |
| `digitValue` | 153:7 (false, `>`, `<`, true), 153:21 `<`, 153:40 `+` | unreachable (6) | The upper-case branch cannot be reached: `foldHost` lowers the whole host (NFKC then `toLowerCase`) before any label is decoded, so `A`–`Z` never arrive. |
| `digitValue` | 154:7 `code >= 97` true | equivalent | A code below 97 that is not a digit gives a negative value, which the caller treats like `-1`. |
| `skeleton` | 301:16 initial text | equivalent | Both skeletons that are compared get the same prefix. |
| `isLookalike` | 330:101 default list | equivalent | The default target would matter only for a domain one edit from the placeholder text. |
| `isLookalike` | 335:53, 340:47 `?? ""` | unreachable | `split(".")[0]` always exists. |

## Bugs

None. No surviving mutant shows wrong current behaviour.
