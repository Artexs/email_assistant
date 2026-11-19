# F137 · Plan

> **Status 2026-11-19 — planned.** Plan base: 41770e80. Four stages, no migration, no `TERMS_VERSION` bump.

## Input

Ticket words (owner, from the F135 review): "Make both forms strip the same set (decide the set; the JS rule wins)." "Make the scrub and the check use the same normalised rule as the equality match." "A mail of another person is never touched. A mail of the named person is never left behind." Org delete is out of scope.

Decisions (P = product, D = design):

- **P1** No migration, no `TERMS_VERSION` bump, no user-visible text. The CLI gets one new refusal (D7).
- **D1 Whitespace set.** The set is what JS `String.prototype.trim()` strips today: 25 code points (U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF). Core exports it as `ADDRESS_TRIM_CHARS`. JS keeps `trim()`, so no profile key hash changes. A unit test pins `trim()` to the set over every code point; an engine change then fails CI. SQL `normalizedAddress` uses `btrim(column, <set>)`, built from the constant as `chr(n)` calls (no dependence on string literal settings). Rejected: a JS strip of a hand list (would change nothing today and drift from the engine silently); a SQL `regexp_replace` (slower, its `\s` is locale-bound).
- **D2 No index or stored column depends on the expression.** Checked: no migration holds `chr(962)` or the `normalizedAddress` text. The change is code only.
- **D3 Text match by explicit case forms.** `addressRegex` builds a case-sensitive pattern. Each letter of the asked (normalized) address becomes a class of every form that the JS rule folds to it (`addressCaseForms`, core). The table is built once, lazily, by a scan of all code points (about 100 ms). The letter `i` also takes the two-code-point forms `i` + U+0307 and `I` + U+0307. The boundary classes add `A-Z` where they relied on the `i` flag. Rejected: keep `~*` and patch `ı`, `ẞ`, Ohm and Kelvin by hand (the next odd letter breaks it again; `ſ` already over-matches the same way as `ı`).
- **D4 One way to run the pattern.** `address-map.ts` exports `matchesAddress(ref, pattern)` (`~`) and `replaceAddress(ref, pattern, replacement)` (`regexp_replace(…, 'g')`). Find, scrub, open-action check and post-erase check use only these. Acceptance: no `~*` and no `'gi'` remain under `modules/privacy`.
- **D5 NFC versus NFD stays apart.** `José` (U+00E9) and `Jose` + U+0301 are two addresses in the equality rule, the regex and the profile hash. Unchanged here (Q1).
- **D6 Probe list in code.** The 66 strings of `probe-strings.md` become `ADDRESS_RULE_PROBES` in core. The parity test and the run-time check (D7) use it.
- **D7 Run-time parity check.** Find and erase first compare SQL `normalizedAddress` with JS `normalizeSenderAddress` on the database they run on: the probe list plus `x<form>y@x.test` for every form of the case-form table. A difference refuses with `rule_mismatch` before any read or change: exit 1, no audit row, a warn line `dsr_rule_mismatch` with the count only. Reason: the equality match needs the libc `lower()` of the database to agree with JS; a database made with another locale (for example `C`) would under-match every non-ASCII address in silence. Rejected: a one-time probe on the VPS (a later restore or upgrade can change the locale).
- **D8 If CI shows a letter difference.** Locally every code point agrees except whitespace (F1). If the full-range test of stage 02 finds a non-whitespace difference on the CI image, the worker stops and reports the code points. Coordinator default (Q3): JS wins; a core map `SQL_LOWER_FIXES` goes into `normalizedAddress` as `translate()`, and stage 02 continues.
- **D9 Tests first.** Stage 01 adds the tests that kill M06, M07, M08, M22, M24 and M25 on the current code, so stages 02 and 03 change the rule under those tests.

## Facts checked

- **F1** (planner, 2026-11-19, temp cluster in `tmp-probe/`, PostgreSQL 18.6, libc `en_US.UTF-8`, Bun 1.4.4): SQL `normalizedAddress(chr(cp))` versus JS `normalizeSenderAddress` for every code point 1–0x10FFFF without surrogates: 24 differences, all in the D1 whitespace set (U+0020 agrees). No letter differs.
- **F2** (same cluster): a prototype of D3 (case-sensitive `~`, class per letter, `A-Z` in the boundaries) over the 66 probes × 40 accepted addresses: 0 misses, 0 over-matches.
- **F3** JS fold table: 1,479 target letters; targets with more than one source form: `i` (I, İ), `k` (K, U+212A), `å` (Å, U+212B), `ǆ`, `ǉ`, `ǌ`, `ǳ`, `θ` (Θ, U+03F4), `σ` (Σ, ς), `ω` (Ω, U+2126). Every target is stable under the fold.
- **F4** The F135 review (`2026-11-19-f135-review-erase-address-rule-6006ca65/result`): 4 whitespace differences in 66 probes; regex over-match `ı`/`I`; misses `ẞ`, Ohm, Kelvin; surviving mutations M06, M07, M08, M22, M24, M25.
- **F5** Profile hashes come from JS (`contacts/profiles.ts` normalizes again before `senderKeyHash`), so D1 creates no orphan profile rows.

## Not verified

- **N1** The `postgres:17` image (CI, `deploy/compose.yaml`) agrees with F1. Stage 02 test I2 checks it in CI; D8 says what then.
- **N2** The VPS database locale. Stage 04 (D7) checks it at each find and erase.

## Done when

1. Stage 02 parity test: 0 differences over the 66 probes and over all code points, whitespace included.
2. The six mutations of stage 01 fail a committed test (worker result lists each).
3. Stage 03 tests: scrub and post-erase check agree with the equality match on `ı`, `ẞ`, Ohm and Kelvin.
4. `grep -rnE "~\*|'gi'" apps/server/src/modules/privacy` finds nothing.
5. `docs/capabilities/account-data.md` items 7–10 and § Limits describe D1, D3, D5 and D7.

## Rules for every stage

- Read `ticket.md`, this file, `interfaces.md` and your stage file. A gap in a decision, or a deviation, is a question in your final message, not a choice.
- No address, hash, subject or mail text in a log line, error text or audit row (account-data rule 17).
- Test helpers: `contacts-fixtures.ts` (`newOrg`, `KEY`, `NOW`, `ago`), `fixtures.ts` (`insertTestEmail`), `helpers.ts` (`testDb`). Write non-ASCII test values as `\u` escapes.
- Mutation rule: apply each listed mutation alone, run its test file, see it fail, restore. List each with the failing test name in the result.
- Format only the stage's files. No migration. No `bun.lock` change.

## Proof

```
mkdir -p /tmp/f137-sNN && bun run lint > /tmp/f137-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f137-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f137-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f137-sNN/int.log 2>&1 && echo PROOF_OK
```

Run it after the last commit, with nothing after it.

## Owner checkpoints and steps

No owner step: no migration, no flag, no deploy step. Questions with defaults: `questions.md`.

## Review

Ticket note: privacy, irreversible erase. Stages 02, 03 and 04 get a review job on `claude-opus-5-5` before the land. Stage 04's review covers the diff of the whole ticket. Stage 01 (tests only) lands on its proof and mutation list.

## Stages

1. [stage-01-gap-tests](stages/stage-01-gap-tests.md): tests that kill M06, M07, M08, M22, M24, M25.
2. [stage-02-one-trim-set](stages/stage-02-one-trim-set.md) `[risky]`: one whitespace set, probe list, parity tests.
3. [stage-03-text-match-forms](stages/stage-03-text-match-forms.md) `[risky]`: case-form pattern for find, scrub and check.
4. [stage-04-parity-guard](stages/stage-04-parity-guard.md) `[risky]`: run-time parity check, docs close.

## How to run (coordinator)

Move the ticket to `active/` and commit before the first spawn. Land stage N before you spawn stage N+1. Drop the job DB after each land.

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F137" \
  'Implement F137 stage NN. Read spec/features/active/F137-…/ticket.md, plan.md, interfaces.md and stages/stage-NN-<slug>.md; build every step. Final proof: <Proof with NN>. In the final message, list as proven only what a saved log shows.'
```

## Planning progress

- Scouts: 3 (`scouts.md`). Probe: `tmp-probe/` (not committed).
- [written] plan.md, interfaces.md, questions.md, probe-strings.md, stages 01–04.
- Word counts (`wc -w`, before the review): plan.md 1,284; stage 01 594; stage 02 568; stage 03 694; stage 04 565.

## Cold review

Pending.

## Log

- 2026-11-19 plan written at base 41770e80.
