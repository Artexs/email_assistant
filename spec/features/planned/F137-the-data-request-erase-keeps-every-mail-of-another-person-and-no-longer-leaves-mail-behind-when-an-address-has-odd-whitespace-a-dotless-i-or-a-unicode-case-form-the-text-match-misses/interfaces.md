# F137 · Interfaces

Names that one stage creates and a later stage uses. Code detail beyond these is the worker's at `HEAD`.

## Core, `packages/core/src/contacts/address.ts` (exported from `@ea/core`)

- `ADDRESS_TRIM_CHARS: string` (stage 02) — the 25 code points of D1, in code-point order. Unit-pinned to `String.prototype.trim()`.
- `ADDRESS_RULE_PROBES: readonly string[]` (stage 02) — the 66 strings of `probe-strings.md`, same order. May live in a sibling file of the same folder.
- `addressCaseForms(letter: string): readonly string[]` (stage 03) — every string whose `normalizeSenderAddress` form is `letter`, with `letter` first. Single code points from a lazy, cached scan of 1–0x10FFFF (no surrogates). For `i` also the two-code-point forms `"i\u0307"` and `"I\u0307"` (besides `I` and U+0130). For a letter with no other form: `[letter]`. Input is one code point that is already in rule form.
- `normalizeSenderAddress` keeps its signature and output (D1).

## Server, `apps/server/src/modules/contacts/address-sql.ts`

- `normalizedAddress(column: string)` (stage 02) — same signature. New body: `btrim(column, <ADDRESS_TRIM_CHARS as chr() calls>)`, then `lower`, the sigma fold, the dot fold (as now). With D8 only: `translate()` of `SQL_LOWER_FIXES`.

## Server, `apps/server/src/modules/privacy/address-map.ts`

- `addressRegex(address: string, opts?: { json?: boolean }): string` (stage 03) — same signature; the pattern is case-sensitive now (D3). Valid only with the two helpers below.
- `matchesAddress(ref: <kysely sql expression>, pattern: string)` (stage 03) — the SQL `ref ~ pattern`.
- `replaceAddress(ref, pattern: string, replacement: string)` (stage 03) — the SQL `regexp_replace(ref, pattern, replacement, 'g')`.

## Server, `apps/server/src/modules/privacy` (stage 04)

- `checkAddressRuleParity(db: DbOrTrx, opts?: { probes?: readonly string[]; normalize?: (s: string) => string }): Promise<{ ok: true } | { ok: false; differences: number }>` — one query; default probes = `ADDRESS_RULE_PROBES` plus `x<form>y@x.test` for every form of every `addressCaseForms` target; default `normalize` = `normalizeSenderAddress`.
- `findSubjectData` and `eraseSubjectData` take an optional `ruleCheck` (default `checkAddressRuleParity`) in their input. New result kind `rule_mismatch` with `differences: number`, next to `own_address` and `bad_address`.
- CLI `org:dsr`: `refused: rule_mismatch <n>` on stderr, exit 1. Warn log event `dsr_rule_mismatch` with `differences` only.

## Tests that later stages extend

- `apps/server/test/integration/privacy-dsr-address-rule.test.ts` (stage 01 adds the gap tests).
- `apps/server/test/integration/privacy-dsr-address-parity.test.ts` (new in stage 02; stage 03 adds the regex agreement; stage 04 adds the guard tests).
