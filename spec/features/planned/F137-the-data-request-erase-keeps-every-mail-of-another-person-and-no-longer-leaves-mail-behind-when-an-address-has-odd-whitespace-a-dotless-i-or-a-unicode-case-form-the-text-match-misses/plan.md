# F137 · Plan

> **Status 2026-11-19 — planned.** Plan base: 41770e80. Four stages, no migration, no `TERMS_VERSION` bump.

## Input

Ticket words: "Make both forms strip the same set (decide the set; the JS rule wins)." "Make the scrub and the check use the same normalised rule as the equality match." "A mail of another person is never touched. A mail of the named person is never left behind."

Decisions (P = product, D = design):

- **P1** No migration, no `TERMS_VERSION` bump, no user-visible text; one new CLI refusal (D7).
- **D1 Whitespace set.** The set is what JS `String.prototype.trim()` strips today: 25 code points (U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF). Core exports it as `ADDRESS_TRIM_CHARS`. JS keeps `trim()` (no profile key hash changes); a unit test pins `trim()` to the set over every code point. SQL `normalizedAddress` uses `btrim(column, <set>)`, built from the constant as `chr(n)` calls (no dependence on string literal settings). Rejected: a SQL `regexp_replace` (its `\s` is locale-bound).
- **D2** No index or stored column uses the `normalizedAddress` text: the change is code only.
- **D3 Text match by explicit case forms.** `addressRegex` builds a case-sensitive pattern. Each letter of the asked (normalized) address becomes a class of every form that the JS rule folds to it (`addressCaseForms`, core). Built once, lazily (a scan of all code points, about 100 ms); `i` also takes `i` + U+0307 and `I` + U+0307. The boundary classes add `A-Z` where they relied on the `i` flag, the combining mark blocks (U+0300–U+036F, U+1AB0–U+1AFF, U+1DC0–U+1DFF, U+20D0–U+20FF, U+FE20–U+FE2F) and every code point of the case-form table, whatever the database calls `[:alpha:]` (review G1: `jose` + U+0301 + `bob@x.test` matched). Rejected: patch `ı`, `ẞ`, Ohm and Kelvin by hand under `~*` (`ſ` over-matches like `ı`; the next letter breaks it again).
- **D4 One way to run the pattern.** `address-map.ts` exports `matchesAddress(ref, pattern)` (`~`) and `replaceAddress(ref, pattern, replacement)` (`regexp_replace(…, 'g')`). Find, scrub, open-action check and post-erase check use only these.
- **D5 NFC versus NFD stays apart.** `José` (U+00E9) and `Jose` + U+0301 are two addresses in the equality rule, the regex and the profile hash. Unchanged here (Q1).
- **D6 Probe list in code.** The 66 strings of `probe-strings.md` become `ADDRESS_RULE_PROBES` in core. The parity tests use it.
- **D7 Run-time check per address.** Find and erase first compute, on the database they run on, the divergent set: every code point 1–0x10FFFF (no surrogates) where SQL `normalizedAddress(chr(cp))` differs from JS `normalizeSenderAddress` (one query, about 1 s). The set is cached per process (Q5). They refuse with `rule_mismatch` before any lock or change when a divergent code point (a) has a JS form or a database form that is a letter of the asked address, or (b) has an empty JS form (a trim difference). Then the equality match is exact for this address, in both directions (database lowers less, or more, than JS). Result: no audit row; the CLI logs the existing `org_dsr_refused` with reason `rule_mismatch` and prints `rule mismatch <n>` (a count). `org:dsr --rule-check --org-id <uuid>` prints the divergent set (`U+XXXX js <hex> db <hex>`, no personal data), exit 0. Rejected: refuse on any difference (postgres:17 has 28 letter differences today, so every erase would refuse); a static SQL fix map (the image tag `postgres:17` floats; the VPS build may differ from CI); the probe list alone (misses a database that lowers more than JS, review G2).
- **D8 Known differences stay unfixed.** On `postgres:17` (17.11, glibc of Debian 13) 28 letters differ: U+A7CE, U+A7D2, U+A7D4, U+16EA0–U+16EB8 (Unicode 16 and 17; Bun lowers them, glibc does not). No real address is expected to hold them; an erase of such an address refuses (D7, Q3). Stage 02 test I2 allows letter differences only outside U+0000–U+052F and outside the letters of the 66 probes, and none in whitespace.
- **D10** Probe strings go to SQL as a `text[]` parameter, never via `convert_from` or a `name` value (collation `C`: `lower('Σ')` stays `Σ`; review N1).
- **D9 Tests first.** Stage 01 kills the six mutations on the current code; stages 02 and 03 then change the rule under those tests.

## Facts checked

- **F1** (planner, 2026-11-19, temp cluster, PostgreSQL 18.6 on Arch glibc, Bun 1.4.4): SQL `normalizedAddress(chr(cp))` versus JS `normalizeSenderAddress` for every code point 1–0x10FFFF without surrogates: 24 differences, all in the D1 whitespace set.
- **F1b** (plan review, 2026-11-19, dev DB `postgres:17` = 17.11 Debian, `en_US.utf8`): the same compare gives 52 differences: the 24 whitespace and 28 letters (D8). Source: `plan-review-1.md` B1, `/tmp/f137rev-scripts/sql17.txt`.
- **F2** (same cluster): a prototype of D3 (case-sensitive `~`, class per letter, `A-Z` in the boundaries) over the 66 probes × 40 accepted addresses: 0 misses, 0 over-matches.
- **F3** JS fold table: 1,479 targets, 2,968 forms; more than one source form for `i`, `k`, `å`, `ǆ`, `ǉ`, `ǌ`, `ǳ`, `θ`, `σ`, `ω`. Every target is stable under the fold (review N2 confirms).
- **F4** The F135 review (`.limen/jobs/2026-11-19-f135-review-erase-address-rule-6006ca65/result`): the findings that this ticket fixes.
- **F5** Profile hashes come from JS (`contacts/profiles.ts`), so D1 orphans no profile row.

## Not verified

- **N1** The VPS database: same tag `postgres:17`, maybe another build. D7 checks it at each find and erase; `--rule-check` shows it.

## Done when

1. Stage 02 parity test: 0 differences over the 66 probes, whitespace included; over all code points, no whitespace difference and only the D8 letter differences.
2. The six mutations of stage 01 fail a committed test (worker result lists each).
3. Stage 03 tests: scrub and post-erase check agree with the equality match on `ı`, `ẞ`, Ohm and Kelvin; a combining mark next to an address is not a boundary.
4. Stage 04 tests: an address with a divergent letter refuses with `rule_mismatch` and changes nothing.
5. `grep -rnE "~\*|'gi'" apps/server/src/modules/privacy` finds nothing.
6. `docs/capabilities/account-data.md` items 7–10 and § Limits describe D1, D3, D5 and D7.

## Rules for every stage

- A gap in a decision, or a deviation, is a question in your final message, not a choice.
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

None. Questions with defaults: `questions.md`.

## Review

Stages 02, 03 and 04 get a `claude-opus-5-5` review before the land (privacy, irreversible erase); stage 04's review covers the whole ticket diff. Stage 01 (tests only) lands on its proof and mutation list.

## Stages

1. [stage-01-gap-tests](stages/stage-01-gap-tests.md): tests that kill M06, M07, M08, M22, M24, M25.
2. [stage-02-one-trim-set](stages/stage-02-one-trim-set.md) `[risky]`: one whitespace set, probe list, parity tests.
3. [stage-03-text-match-forms](stages/stage-03-text-match-forms.md) `[risky]`: case-form pattern for find, scrub and check.
4. [stage-04-parity-guard](stages/stage-04-parity-guard.md) `[risky]`: run-time check per address, `--rule-check`, docs close.

## How to run (coordinator)

Move the ticket to `active/` and commit first. Land stage N before stage N+1; drop the job DB after.

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F137" \
  'Implement F137 stage NN. Read spec/features/active/F137-…/ticket.md, plan.md, interfaces.md and stages/stage-NN-<slug>.md; build every step. Final proof: <Proof with NN>. In the final message, list as proven only what a saved log shows.'
```

## Planning progress

- Scouts: 3 (`scouts.md`). [written] all files, stages 01–04.
- `wc -w` after the review fixes: plan.md 1,486; stages 594, 623, 694, 685.

## Cold review

Model `claude-opus-5-5`, thinking high (stages 02–04 are `[risky]`, privacy erase). Job `2026-11-19-f137-plan-review-0d8a2a00`, filed whole as `plan-review-1.md`: FINDINGS, 1 blocking, 5 gaps, 6 notes. Fixes:

- B1: D7 rewritten (per-address refusal over the full divergent set), D8 (known 28 letters stay unfixed, I2 bounds), F1b, Q3.
- G1: D3 boundaries take combining marks and the case-form table; stage 03 named boundary cases.
- G2: D7 uses the full code-point range, both directions.
- G3: `--rule-check` prints the divergent set; runbook line names the cause (glibc Unicode version), not `datctype`.
- G4: no new log event; the CLI's `org_dsr_refused` with the new reason; modules still log nothing.
- G5: no CLI test; the CLI lines come from pure formatters with unit tests; `--rule-check` parsing in `org-dsr-args.test.ts`.
- N1: D10. N4: stage 03 mutation 2 returns `[letter]`. N5: counts above. N2, N3, N6: no change.

## Log

- 2026-11-19 plan written at base 41770e80; review fixes the same day.
