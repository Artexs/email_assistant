# F137 stage 04 — Find and erase refuse an address whose letters the database lower-cases unlike the program

Part of [`../plan.md`](../plan.md); names in [`../interfaces.md`](../interfaces.md). **[risky]** (privacy: a refusal path in front of the erase). The review of this stage covers the diff of the whole ticket.

Carry-over reads: `modules/privacy/dsr.ts` (`findSubjectData`, refusal kinds), `erase.ts` (`eraseSubjectData`, the order of account-data rule 10), `apps/server/src/scripts/org-dsr.ts` and `org-dsr-args.ts` (refusal path: `log.error("org_dsr_refused", { reason })`, exit 1), `divergentCodePoints` (stage 02), `addressCaseForms` (stage 03), `plan-review-1.md` B1, G2–G5. Decisions: D7, D8, D10, Q2, Q3, Q5.

## Step 1 — the check

- Goal: `addressRuleConflicts` (pure) and `checkAddressRule` (`divergentCodePoints` once per process, cached as a promise; then the pure function; Q5). Rule (D7): a divergent code point conflicts with the asked address when its JS form or its database form is a code point of the address's letters, or when its JS form is empty (a trim difference).
- Files: a new file in `modules/privacy` (for example `rule-check.ts`) and its tests.
- Test:
  1. Unit, `addressRuleConflicts`: divergent `[{ cp: 0xA7CE, js: "\uA7CF", db: "\uA7CE" }]`, address `"\uA7CFx@x.test"` → `[0xA7CE]`.
  2. Same divergent, address `anna@x.test` → `[]`.
  3. Database lowers more (G2): `[{ cp: 0x1E9E, js: "\u1E9E", db: "\u00DF" }]`, address `"stra\u00DFe@x.de"` (a hypothetical database that lowers U+1E9E where JS does not) → `[0x1E9E]`.
  4. Trim difference: `[{ cp: 0x09, js: "", db: "\t" }]`, any address → `[0x09]`.
  5. Integration, default `checkAddressRule(db, "anna@x.test")` → `{ ok: true }`; `checkAddressRule(db, "\uA7CFx@x.test")` → `{ ok: false }` with `0xA7CE` in `codePoints` when the test DB has that difference (skip the second assert with a printed note when `divergentCodePoints` is empty on that DB).

## Step 2 — find and erase call it first

- Goal: after the input checks (`bad_address`, `confirm_mismatch`) and before any other read or lock, `findSubjectData` and `eraseSubjectData` run `ruleCheck` (input field; default `checkAddressRule`). On `{ ok: false }` they return `{ kind: "rule_mismatch", codePoints }`: no row change, no audit row. The modules still log nothing (G4).
- CLI (`org-dsr.ts`): the existing refusal path logs `org_dsr_refused` with reason `rule_mismatch` (no new event, no new log field); stdout gets `rule mismatch <n>` (count only). New mode `org:dsr --rule-check --org-id <uuid>` prints `rule check <n>` and one line `U+XXXX js <hex> db <hex>` per divergent code point; exit 0. The lines come from pure formatters in `modules/privacy` (G5): `formatRuleCheck(divergent)`.
- Test:
  1. Find with a stub `ruleCheck` returning `{ ok: false, codePoints: [0xA7CE] }` → kind `rule_mismatch`; no `dsr.find` audit row.
  2. Erase with the same stub on an org with one mail From `anna@x.test` and its profile → kind `rule_mismatch`; mail, profile and `dsr_tombstones` unchanged; no `dsr.erase` audit row.
  3. Erase with the default check on the same org → kind `erased`.
  4. Erase of `bad` with the failing stub → `bad_address` (input check first).
  5. Unit: `formatRuleCheck([{ cp: 0xA7CE, js: "\uA7CF", db: "\uA7CE" }])` → `["rule check 1", "U+A7CE js a7cf db a7ce"]`.
  6. `org-dsr-args.test.ts`: `--rule-check --org-id <uuid>` parses to mode `rule_check`; `--rule-check` with `--address` is a usage error.
- Mutation (plan.md rule): remove the `ruleCheck` call from `eraseSubjectData` → test 2 fails; from `findSubjectData` → test 1 fails; drop rule (b) of D7 in `addressRuleConflicts` → Step 1 test 4 fails.

## Step 3 — docs close

- `docs/capabilities/account-data.md`: items 9 and 10 list `rule_mismatch` among the refusals and give the order (input, rule check, rest); item 8 states the per-address check and D8; a `--rule-check` line in § Entry points; § Limits: an address with a divergent letter cannot be erased until the database or the program changes (Q3); § Tests names `privacy-dsr-address-parity.test.ts`.
- `deploy/README.md` § Account data: `rule mismatch <n>` means the database lower-cases a letter of this address unlike the program (a glibc Unicode version older or newer than Bun's, not the locale name). Run `org:dsr --rule-check`, keep its output with the request record, do not erase by hand, and tell the owner.
- Done when: the Proof (plan.md, `NN` = `04`) prints `PROOF_OK`.

## Out of scope

A SQL fix map for divergent letters (D8). A change of the database image. A panel page. Org delete.
