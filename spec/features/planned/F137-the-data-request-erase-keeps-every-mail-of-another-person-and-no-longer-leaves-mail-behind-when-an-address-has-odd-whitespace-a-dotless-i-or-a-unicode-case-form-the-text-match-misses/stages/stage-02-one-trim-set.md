# F137 stage 02 — One whitespace set in the SQL form and the JS form

Part of [`../plan.md`](../plan.md); names in [`../interfaces.md`](../interfaces.md). **[risky]** (privacy, irreversible erase).

Carry-over reads: `packages/core/src/contacts/address.ts` and `address.test.ts`, `apps/server/src/modules/contacts/address-sql.ts` and its users (`contacts/activity.ts`, `privacy/dsr-match.ts`, `privacy/erase.ts`), `../probe-strings.md`, `docs/capabilities/account-data.md` items 7 and 8. Decisions: D1, D2, D6, D8, D10.

## Step 1 — the set and the probe list in core

- Goal: `ADDRESS_TRIM_CHARS` and `ADDRESS_RULE_PROBES` (interfaces.md § Core). `normalizeSenderAddress` does not change.
- Files: `packages/core/src/contacts/address.ts` (or a sibling file for the probe list), its unit test, the core index.
- Test (unit):
  1. For every code point 0–0x10FFFF without surrogates: `` `${c}x${c}`.trim() === "x" `` exactly when `c` is in `ADDRESS_TRIM_CHARS`.
  2. `ADDRESS_TRIM_CHARS` has 25 code points in ascending order, with no duplicate.
  3. `ADDRESS_RULE_PROBES.length === 66`; entry 0 is `"ANNA\u03a3@x.gr"`; entry 56 is `"\u3000anna@x.test"` (zero-based, as in `probe-strings.md`); the entries hold tab, NBSP, U+3000 and newline.
- Done when: unit tests pass.

## Step 2 — the SQL form strips the same set

- Goal: `normalizedAddress` trims with `btrim(column, <set>)` (D1). The set is built from `ADDRESS_TRIM_CHARS` as `chr(<n>)` calls joined by `||`, at module load. No hand-written list in SQL.
- Files: `apps/server/src/modules/contacts/address-sql.ts`, its comment.
- Decisions: D2 (no index or generated column uses this text; do not touch `emails.from_address_lower`).
- Test: new file `apps/server/test/integration/privacy-dsr-address-parity.test.ts`.
  1. **I1 probes.** One query: `normalizedAddress` over `unnest(ADDRESS_RULE_PROBES)` with ordinality. Compare each row with `normalizeSenderAddress` of the same entry. Differences: 0.
  2. **I2 every code point.** One query over `generate_series(1, 1114111)` without 55296–57343: `normalizedAddress(chr(cp))`. Compare with `normalizeSenderAddress(String.fromCodePoint(cp))` in JS. Keep the run under 10 s (one text result, not 1.1 M row objects, if that is slow). Assert (D8): no difference at a code point of `ADDRESS_TRIM_CHARS`; no difference below U+0530; no difference at a code point of the 66 probes. Print the count of the other differences in the test output (28 expected on `postgres:17`, 0 on a newer glibc). Stage 04 reuses this query: write it as one exported function, `divergentCodePoints` (interfaces.md).
  3. **I3 framed whitespace.** For each code point `t` of `ADDRESS_TRIM_CHARS`: SQL form of `t || 'Anna@X.test' || t` is `anna@x.test`.
  - Probe text goes in as a `text[]` parameter (D10).
- Done when: I1–I3 pass.

## Step 3 — the erase end to end

- Goal: an erase deletes the mail of a stored address with odd whitespace, and the profile does not come back.
- Files: `privacy-dsr-address-rule.test.ts` (or the parity file).
- Test, one case per suffix: tab U+0009, NBSP U+00A0, U+3000, newline U+000A, U+FEFF:
  1. Seed: two mails From `anna@x.test<suffix>`, one From `other@x.test`; run the profile pass.
  2. Find `anna@x.test` → 2 mails, 1 sender profile.
  3. Erase `anna@x.test` → kind `erased`; 1 mail left (`other`); run the profile pass again → only the `other@x.test` key hash.
  4. A mail From `<suffix>anna@x.test` (leading) also goes (one case, tab only).
- Mutation (plan.md rule): set `btrim(column)` back to the default set. I1, I2, I3 and Step 3 fail. List them.
- Before the fix, confirm that Step 3 fails on the old SQL form (run it once at `HEAD` first) and say so in the result.
- Done when: all pass at the stage commit.

## Step 4 — docs

- `docs/capabilities/account-data.md` item 7: the trim is the JS `trim()` set, pinned by a test (`ADDRESS_TRIM_CHARS`). Item 8: replace "cannot disagree" with "agree on every code point; the test `privacy-dsr-address-parity.test.ts` proves it on the test database". Add the test file to § Tests.
- Done when: the Proof (plan.md, `NN` = `02`) prints `PROOF_OK`.

## Out of scope

The text regex (stage 03). The run-time check (stage 04). Other modules that call `lower()` or `toLowerCase()` on addresses (scout 1 item 5): they do not feed the DSR match.
