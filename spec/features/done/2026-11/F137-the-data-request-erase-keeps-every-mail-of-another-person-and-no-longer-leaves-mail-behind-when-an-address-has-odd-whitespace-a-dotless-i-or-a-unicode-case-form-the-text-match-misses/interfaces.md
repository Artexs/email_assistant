# F137 · Interfaces

Names that one stage creates and a later stage uses. Code detail beyond these is the worker's at `HEAD`.

## Core, `packages/core/src/contacts/address.ts` (exported from `@ea/core`)

- `ADDRESS_TRIM_CHARS: string` (stage 02) — the 25 code points of D1, in code-point order. Unit-pinned to `String.prototype.trim()`.
- `ADDRESS_RULE_PROBES: readonly string[]` (stage 02) — the 66 strings of `probe-strings.md`, same order. May live in a sibling file of the same folder.
- `addressCaseForms(letter: string): readonly string[]` (stage 03) — every string whose `normalizeSenderAddress` form is `letter`, with `letter` first. Single code points from a lazy, cached scan of 1–0x10FFFF (no surrogates). For `i` also the two-code-point forms `"i\u0307"` and `"I\u0307"` (besides `I` and U+0130). For a letter with no other form: `[letter]`. Input is one code point that is already in rule form.
- `normalizeSenderAddress` keeps its signature and output (D1).
- `addressCasedCodePoints(): readonly number[]` (stage 03, added) — every code point that has another case form under the rule, or is the form of such a letter, ascending; the boundary classes of `addressRegex` take it.

## Server, `apps/server/src/modules/contacts/address-sql.ts`

- `normalizedAddress(column: string)` (stage 02) — same signature. New body: `btrim(column, <ADDRESS_TRIM_CHARS as chr() calls>)`, then `lower`, the sigma fold, the dot fold (as now). With D8 only: `translate()` of `SQL_LOWER_FIXES`.

## Server, `apps/server/src/modules/privacy/address-map.ts`

- `addressRegex(address: string, opts?: { json?: boolean }): string` (stage 03) — same signature; the pattern is case-sensitive now (D3). Valid only with the two helpers below.
- `matchesAddress(ref: <kysely sql expression>, pattern: string)` (stage 03) — the SQL `ref ~ pattern`.
- `replaceAddress(ref, pattern: string, replacement: string)` (stage 03) — the SQL `regexp_replace(ref, pattern, replacement, 'g')`.

## Server, `apps/server/src/modules/privacy` (stages 02 and 04)

- `type DivergentCodePoint = { cp: number; js: string; db: string }`.
- `divergentCodePoints(db: DbOrTrx): Promise<DivergentCodePoint[]>` (stage 02) — the full-range compare of SQL `normalizedAddress(chr(cp))` with JS `normalizeSenderAddress`, 1–0x10FFFF without surrogates, ascending `cp`. Probe text as `text` (D10). Stage 02 may place it in `modules/contacts` next to `normalizedAddress`; stage 04 imports it from there.
- `addressRuleConflicts(address: string, divergent: readonly DivergentCodePoint[]): number[]` (stage 04, pure) — D7 rule.
- `checkAddressRule(db: DbOrTrx, address: string): Promise<{ ok: true } | { ok: false; codePoints: number[] }>` (stage 04); caches the divergent set once per process (Q5).
- `formatRuleCheck(divergent: readonly DivergentCodePoint[]): string[]` (stage 04, pure) — `rule check <n>`, then `U+XXXX js <hex> db <hex>` (hex of each code point of the form, space-free, comma-joined when more than one).
- `findSubjectData` and `eraseSubjectData` take an optional `ruleCheck: (db, address) => Promise<…>` (default `checkAddressRule`). New result kind `{ kind: "rule_mismatch"; codePoints: number[] }`.
- CLI `org:dsr`: refusal via the existing `org_dsr_refused` log line (reason `rule_mismatch`); stdout `rule mismatch <n>`; exit 1. New mode `--rule-check --org-id <uuid>` (`OrgDsrArgs` mode `rule_check`), exit 0.

## Tests that later stages extend

- `apps/server/test/integration/privacy-dsr-address-rule.test.ts` (stage 01 adds the gap tests).
- `apps/server/test/integration/privacy-dsr-address-parity.test.ts` (new in stage 02; stage 03 adds the regex agreement; stage 04 adds the rule-check tests).
