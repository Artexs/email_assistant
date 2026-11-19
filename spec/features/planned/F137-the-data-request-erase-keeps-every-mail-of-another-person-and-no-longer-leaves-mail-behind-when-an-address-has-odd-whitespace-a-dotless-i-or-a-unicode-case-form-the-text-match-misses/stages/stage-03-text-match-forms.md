# F137 stage 03 — The text match uses the same case forms as the equality match

Part of [`../plan.md`](../plan.md); names in [`../interfaces.md`](../interfaces.md). **[risky]** (privacy: the scrub changes kept text of other people).

Carry-over reads: `apps/server/src/modules/privacy/address-map.ts` (`addressRegex`, its boundary comments), `dsr-match.ts` (`rowCondition`, `findOpenActions`), `erase.ts` (the scrub, `clearLoopTextsOfPerson`, the post-erase match), `apps/server/test/integration/privacy-dsr-match.test.ts` (the pattern table tests), plan.md F2 and F3. Decisions: D3, D4, D5.

Test values use `\u` escapes in code: ı U+0131, ẞ U+1E9E, ß U+00DF, Ω-Ohm U+2126, Ω U+03A9, ω U+03C9, K-Kelvin U+212A, Å-Angstrom U+212B, ſ U+017F, İ U+0130, combining dot U+0307.

## Step 1 — the case-form table in core

- Goal: `addressCaseForms` (interfaces.md § Core), pure and cached.
- Files: `packages/core/src/contacts/address.ts` (or a sibling), unit test, core index.
- Test (unit):
  1. `k` → contains exactly `k`, `K`, U+212A.
  2. `ω` → exactly `ω`, `Ω`, U+2126. `å` → exactly `å`, `Å`, U+212B.
  3. `ß` → exactly `ß`, `ẞ`.
  4. `ı` → exactly `ı`. `ſ` → exactly `ſ`.
  5. `σ` → exactly `σ`, `Σ`, `ς`.
  6. `i` → exactly `i`, `I`, `İ`, `i` + U+0307, `I` + U+0307.
  7. `1`, `@`, `.` → exactly themselves.
  8. Property: for every target of the table, every form `f` gives `normalizeSenderAddress(f) === target`, and the first element is the target.

## Step 2 — one case-sensitive pattern and one way to run it

- Goal: `addressRegex` emits per letter a class (an alternation for the two-code-point `i` forms) of `addressCaseForms(letter)`; punctuation is escaped as now. Add `A-Z` wherever a boundary class relied on the `i` flag (`atext`, the `[a-z]=` look-behind, the look-ahead). `matchesAddress` and `replaceAddress` (D4) are the only SQL that runs a pattern: switch `rowCondition` (text, json), `findOpenActions`, the scrub and every test that runs `addressRegex` to them.
- Decisions: D3, D4. Do not change `normalizeDsrAddress`.
- Check: `grep -rnE "~\*|'gi'" apps/server/src/modules/privacy` prints nothing (acceptance).
- Test:
  1. The pattern table of `privacy-dsr-match.test.ts` passes with unchanged expectations, plus upper-case rows: `<P@X.TEST>` matches `p@x.test`; `JIMBOB@X.TEST` does not match `bob@x.test`.
  2. **Pattern agreement** (in `privacy-dsr-address-parity.test.ts`): for each address `a` that `normalizeDsrAddress` accepts among `ADDRESS_RULE_PROBES` (40 today), and each probe `p` (trimmed): `matchesAddress('write to ' || p || ' today', addressRegex(a))` equals `normalizedAddress(p) = a`, both computed in SQL. Mismatches: 0.
  3. **Named cases** (SQL, text form `write to <t> today`):
     - `ılker@x.tr` does not match `ILKER@x.tr`; matches `ılker@x.tr`.
     - `ilker@x.tr` matches `ILKER@x.tr`, `İLKER@x.tr`, `I` + U+0307 + `LKER@x.tr`; does not match `ılker@x.tr`.
     - `straße@x.de` matches `STRAẞE@x.de`; does not match `STRASSE@x.de`.
     - `ωhm@x.test` matches U+2126 + `hm@x.test` and `Ωhm@x.test`.
     - `kelvin@x.test` matches U+212A + `elvin@x.test`.
     - `ſam@x.test` does not match `SAM@x.test`.
     - Each named row also with the json pattern on a jsonb value `{"to":"<t>"}`.

## Step 3 — scrub and post-erase check end to end

- Goal: the erase removes these forms from kept text and leaves another person's text alone (`privacy-dsr-address-rule.test.ts`).
- Test:
  1. Seed mails From `kelvin@x.test`, `straße@x.de`, `ωhm@x.test` and `ılker@x.tr`, and one kept mail From `other@x.test` whose `body_text` has four lines: `a U+212Aelvin@x.test`, `b STRAẞE@x.de`, `c U+2126hm@x.test`, `d ILKER@x.tr`.
  2. Erase `kelvin@x.test`, `straße@x.de`, `ωhm@x.test` and `ılker@x.tr` in turn: each gives kind `erased` (the post-erase check passes).
  3. The kept body is exactly `a [removed]`, `b [removed]`, `c [removed]`, `d ILKER@x.tr`.
  4. The same kept mail with `ILKER@x.tr` in `to_addresses` keeps that element after the erase of `ılker@x.tr`.
- Mutations (plan.md rule), one at a time:
  - `matchesAddress` uses `~*` and `replaceAddress` uses `'gi'`: Step 2 test 3 (ı) and Step 3 test 3 (line d) fail.
  - `addressCaseForms` returns only `[letter, letter.toUpperCase()]`: Step 1 tests and Step 2 test 3 (Kelvin, ẞ, Ohm) fail.
  - `replaceAddress` gets a pattern without the U+212A form while `matchesAddress` keeps it: Step 3 test 2 fails with `dsr_erase_incomplete` (the post-erase check sees the leftover).

## Step 4 — docs

- `docs/capabilities/account-data.md` item 8: the pattern is case-sensitive, and each letter stands for every form that the program rule folds to it (`addressCaseForms`); name `matchesAddress` and `replaceAddress` (also in § Entry points). § Limits: an NFD spelling (`Jose` + U+0301) is another address (D5, Q1).
- Done when: the Proof (plan.md, `NN` = `03`) prints `PROOF_OK`.

## Out of scope

The run-time check (stage 04). NFC folding (Q1).
