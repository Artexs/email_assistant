# Stage 07 results: trusted auth results, attachments, display names, DKIM

Base for the before run: `541dd312` (a detached copy of the commit before the new tests, so the run held only the old tests). Commands:

```
bash scripts/test-audit/mutation.sh /tmp/f154-s07/before --mutate src/triage/suspicious.ts --mutate src/triage/dkim-pass.ts --mutate src/triage/dkim-signature.ts
bash scripts/test-audit/mutation.sh /tmp/f154-s07/after2 --mutate <the same three>
bun scripts/test-audit/mutation-gaps.ts --before /tmp/f154-s07/before/mutation.json --after /tmp/f154-s07/after2/mutation.json   # exit 0
```

The full output (all functions of the three files, and every new case with its kill count) is in `results/stage-07-gaps.md`. Its last line: `0 new cases kill no before-survivor`.

## Functions of the stage (counted = Survived + NoCoverage)

| File | Function | Before | After |
| --- | --- | --- | --- |
| `triage/suspicious.ts` | `trustedAuthResults` | 14 | 5 |
| `triage/suspicious.ts` | `isRiskyAttachment` | 7 | 3 |
| `triage/suspicious.ts` | `isDisplayNameSpoof` | 7 | 2 |
| `triage/suspicious.ts` | `foldName` | 6 | 1 |
| `triage/suspicious.ts` | `domainOfAddress` | 5 | 1 |
| `triage/dkim-pass.ts` | `trustedAlignedPassDomains` | 17 | 8 |
| `triage/dkim-pass.ts` | `stripCommentsAndQuotes` | 9 | 3 |
| `triage/dkim-signature.ts` | `tagsOf` | 8 | 1 |

Every function fell. Two functions are not below 5: `trustedAuthResults` (5) and `trustedAlignedPassDomains` (8). All their remaining mutants are self-classed below, and the classes exceed the cap of 3 per function. This is the stage-stop case: the question is in `questions-stage-07.md`.

## Tests

- New file `packages/core/src/triage/suspicious-auth.test.ts`: `trustedAuthResults` direct, plus `assessSuspicious` tables for auth fail, risky attachment, display-name spoof and Reply-To domain.
- `dkim-pass.test.ts`: tables for the lexing and alignment edge cases and the empty signing domain.
- `dkim-signature.test.ts`: a table of tag shapes (empty parts, a leading colon, a repeated tag, a tag with no `=`).
- The first draft had the cases of the stage table as written. 41 of them killed no before-survivor (for example `null` gives `null`, a look-alike suffix, a stray `)`), because the old tests or the old code path already caught the same mutants. They are removed, so every kept case kills at least one before-survivor.

## Self-classed (for the spot-check)

Keys are `line:column mutator`, lines of `HEAD` of the source files. Classes are by reading the code; none is proven by a test.

`suspicious.ts` `trustedAuthResults`:

| Key | Class | Reason |
| --- | --- | --- |
| 366:7 EqualityOperator `semicolon <= 0` | equivalent | A semicolon at index 0 gives an empty id, which the next check returns as null anyway. |
| 368:54 Regex `/\s/` | equivalent | The value is trimmed first, so the first token is the same with one or many white-space characters. |
| 369:7 Conditional `false` | equivalent | An empty id matches no trusted entry (entries are filtered to non-empty), so the result is null anyway. |
| 369:14 StringLiteral | equivalent | Same guard as above. |
| 368:67 StringLiteral (NoCoverage) | unreachable | `split(...)[0]` always exists, so the `?? ""` fallback never runs. |

`dkim-pass.ts` `trustedAlignedPassDomains`:

| Key | Class | Reason |
| --- | --- | --- |
| 64:7 Conditional `false` | equivalent | `trustedAuthResults(null, …)` returns null, so the next line returns `[]` anyway. |
| 72:20 OptionalChaining | equivalent | When the regex matches, group 1 always has text. |
| 72:20 Regex `(?:\s)` | equivalent | A result part starts with `dkim` (checked before), so `^` can never start `header.d`. |
| 73:9 Conditional `true` | equivalent | The reported replacement is at the start of the condition: `signer !== undefined` becomes true, and `aligned.includes(undefined)` is false. |
| 61:64, 64:30, 65:70, 67:27 ArrayDeclaration | unreachable | The mutant returns or starts with the list `["Stryker was here"]`. Only a signature with that exact `d` shows it, and no mail holds one (`d` must be a domain name). |

Other functions that stay above zero (all below 5, listed for completeness): `isRiskyAttachment` 382:16, 382:71, 384:57 (equivalent or unreachable fallbacks and an optional chain on `split()[0]`); `isDisplayNameSpoof` 412:7, 412:18 (a guard that the next line repeats); `foldName` 395:14 (`/\p{M}/gu` against `/\p{M}+/gu`, same result in a global replace); `domainOfAddress` and `tagsOf` 56:9 (`equals <= 0` gives null in both versions).

## Bugs

none.

## Not done

- A mutation run of the whole of `packages/core` (stage 18 does it).
