# F137 stage 03 — The text match uses the same case forms as the equality match

Part of [`../plan.md`](../plan.md); names in [`../interfaces.md`](../interfaces.md). **[risky]** (privacy: the scrub changes kept text of other people).

Carry-over reads: `modules/privacy/address-map.ts` (`addressRegex` and its boundary comments), `dsr-match.ts`, `erase.ts` (scrub, `clearLoopTextsOfPerson`, post-erase match), `privacy-dsr-match.test.ts` (pattern table), plan.md F2, F3, `plan-review-1.md` G1. Decisions: D3, D4, D5.

Write test values with `\u` escapes (Ohm U+2126, Kelvin U+212A, Angstrom U+212B).

## Step 1 — the case-form table in core

- Goal: `addressCaseForms` (interfaces.md § Core), pure and cached, in core.
- Test (unit):
  1. `k` → contains exactly `k`, `K`, U+212A.
  2. `ω` → exactly `ω`, `Ω`, U+2126. `å` → exactly `å`, `Å`, U+212B.
  3. `ß` → exactly `ß`, `ẞ`.
  4. `ı` → exactly `ı`. `ſ` → exactly `ſ`.
  5. `σ` → exactly `σ`, `Σ`, `ς`.
  6. `i` → exactly `i`, `I`, `İ`, `i` + U+0307, `I` + U+0307.
  7. `1`, `@`, `.` → exactly themselves.
  8. Property: over the whole table, `normalizeSenderAddress(f) === target` for every form; the target comes first.

## Step 2 — one case-sensitive pattern and one way to run it

- Goal: `addressRegex` emits per letter a class (an alternation for the two-code-point `i` forms) of `addressCaseForms(letter)`; punctuation is escaped as now. Boundary classes (look-behind, look-ahead, the `[a-z]=` look-behind) take `A-Z`, the combining mark blocks and every code point of the case-form table (D3). `matchesAddress` and `replaceAddress` (D4) are the only SQL that runs a pattern: switch `rowCondition` (text, json), `findOpenActions`, the scrub and every test that runs `addressRegex` to them.
- Do not change `normalizeDsrAddress`.
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
     - Boundaries (G1): `bob@x.test` does not match `jose` + U+0301 + `bob@x.test`, `bob@x.test` + U+0301, or U+212A + `bob@x.test`; matches `é bob@x.test` (NFC é, then a space).
     - Each named row also with the json pattern on a jsonb value `{"to":"<t>"}`.

## Step 3 — scrub and post-erase check end to end

- Goal: the erase removes these forms from kept text and leaves another person's text alone (`privacy-dsr-address-rule.test.ts`).
- Test:
  1. Seed mails From `kelvin@x.test`, `straße@x.de`, `ωhm@x.test` and `ılker@x.tr`, and one kept mail From `other@x.test` whose `body_text` has four lines: `a U+212Aelvin@x.test`, `b STRAẞE@x.de`, `c U+2126hm@x.test`, `d ILKER@x.tr`.
  2. Erase `kelvin@x.test`, `straße@x.de`, `ωhm@x.test` and `ılker@x.tr` in turn: each gives kind `erased` (the post-erase check passes).
  3. The kept body is exactly `a [removed]`, `b [removed]`, `c [removed]`, `d ILKER@x.tr`.
  4. `ILKER@x.tr` in the kept mail's `to_addresses` stays after the erase of `ılker@x.tr`.
- Mutations (plan.md rule), one at a time:
  - `matchesAddress` uses `~*` and `replaceAddress` uses `'gi'`: Step 2 test 3 (ı) and Step 3 test 3 (line d) fail.
  - `addressCaseForms` returns only `[letter]`: Step 1 tests and Step 2 tests 1 and 3 fail.
  - Drop the combining marks from the boundary classes: the G1 cases fail.
  - `replaceAddress` gets a pattern without the U+212A form while `matchesAddress` keeps it: Step 3 test 2 fails with `dsr_erase_incomplete` (the post-erase check sees the leftover).

## Step 4 — docs

- `docs/capabilities/account-data.md` item 8: the pattern is case-sensitive, and each letter stands for every form that the program rule folds to it (`addressCaseForms`); name `matchesAddress` and `replaceAddress` (also in § Entry points). § Limits: an NFD spelling (`Jose` + U+0301) is another address (D5, Q1).
- Done when: the Proof (plan.md, `NN` = `03`) prints `PROOF_OK`.

## Out of scope

The run-time check (stage 04). NFC folding (Q1).

## Carry-over from the stage 02 review (PASS 5b83878b)

First commit of this stage (each with a test and a saved mutation log):
- G2: three call sites have no test with odd whitespace outside `emails.from_address`. Add one case each, in `privacy-dsr-address-rule.test.ts`: a To (and a Cc) address with trailing NBSP (`apps/server/src/modules/privacy/dsr-match.ts:116`, review mutation 19); a kept mail whose recipient array holds a padded form of the person (`erase.ts:80`, mutation 20); a `sent_emails.from_address` with a leading U+3000 (`dsr-match.ts:140`, mutation 22). Each test fails when its site goes back to `btrim(col)`.
- G1: parity test I2 prints the count of the divergent code points but asserts nothing about them. Assert: on `postgres:17` 17.x, `divergent` is a subset of the 28 known code points (U+A7CE, U+A7D2, U+A7D4, U+16EA0–U+16EB8) with no trim difference and none below U+0530; on another server version only print. Mutation 14 (U+1E01 to `a`) must fail it.
- N1 (plan F5 is wrong for the writer): `contacts/refresh.ts:121` hashes `item.address`, which comes from `normalizedAddress("emails.from_address_lower")` (`contacts/activity.ts:222`). After the deploy a sender whose stored From had tab, NBSP, U+3000 or U+FEFF gets a new profile row under the clean hash; the old row (keyed hash and dates, no address) stays until retention (365 days). Correct plan.md F5 and say so in `docs/capabilities/account-data.md` (one line). No cleanup job (coordinator decision: no address in that row, and the erase before this change missed it too).
