# F137 stage 04 — Find and erase refuse on a database whose `lower()` disagrees with the program

Part of [`../plan.md`](../plan.md); names in [`../interfaces.md`](../interfaces.md). **[risky]** (privacy: a refusal path in front of the erase). The review of this stage covers the diff of the whole ticket.

Carry-over reads: `apps/server/src/modules/privacy/dsr.ts` (`findSubjectData`, refusal kinds, `dsrAuditData`), `erase.ts` (`eraseSubjectData`, the order of account-data rule 10), `apps/server/src/scripts/org-dsr.ts` (refusal output, exit codes), `privacy-dsr-address-parity.test.ts` (stages 02 and 03), `docs/capabilities/account-data.md` items 9, 10, 14 and 17. Decisions: D7, Q2, Q5.

## Step 1 — the check

- Goal: `checkAddressRuleParity` (interfaces.md § privacy). One SQL query: `normalizedAddress` over `unnest($probes)` with ordinality; JS compares each row with `normalize(probe)`. Default probes: `ADDRESS_RULE_PROBES` plus `` `x${form}y@x.test` `` for every form of every target of the case-form table (about 3,000 strings; build once and cache).
- Files: a new file in `modules/privacy` (for example `rule-check.ts`), exported from the module index.
- Test (`privacy-dsr-address-parity.test.ts`):
  1. Default call on the test database → `{ ok: true }`.
  2. `probes: ["ANNA@x.test", "b@x.test"]`, `normalize: (s) => s` → `{ ok: false, differences: 1 }`.
  3. `probes: []` → `{ ok: true }` (no query error).
  4. Default call takes under 1 s (log the time in the test output; assert < 5,000 ms so CI noise does not fail it).

## Step 2 — find and erase call it first

- Goal: `findSubjectData` and `eraseSubjectData` run `ruleCheck` before any other read and before any lock. On `{ ok: false }` they return `{ kind: "rule_mismatch", differences }`: no row changes, no audit row, one warn line `dsr_rule_mismatch` with `differences` only (no address, no org name; account-data rule 17). The order: input checks (`bad_address`, `confirm_mismatch`) stay first, then the rule check, then the rest of rule 9 or rule 10.
- Files: `dsr.ts`, `erase.ts`, `org-dsr.ts` (stderr `refused: rule_mismatch <n>`, exit 1).
- Decisions: D7. The check is not behind a flag (Q5).
- Test (integration):
  1. Find with a stub `ruleCheck` returning `{ ok: false, differences: 3 }` → kind `rule_mismatch`, `differences` 3; no `dsr.find` audit row.
  2. Erase with the same stub on an org with one mail of `anna@x.test` → kind `rule_mismatch`; the mail, its profile and the tombstone table are unchanged; no `dsr.erase` audit row.
  3. Erase with the default check on the same org → kind `erased` (the default passes on the test DB).
  4. Erase with a bad address and the failing stub → `bad_address` (input check first).
  5. CLI (`org-dsr` test, if the file exists; else the script's arg-level test): the stub path prints `refused: rule_mismatch 3` and exits 1. If the CLI cannot take a stub, test the formatter of the refusal line instead and say so in the result.
- Mutation (plan.md rule): remove the `ruleCheck` call from `eraseSubjectData` → test 2 fails. Remove it from `findSubjectData` → test 1 fails.

## Step 3 — docs close

- `docs/capabilities/account-data.md`: item 9 and 10 refusal lists add `rule_mismatch`; item 8 says the check runs at each find and erase; item 14 or 17 names the log event `dsr_rule_mismatch` (count only); § Tests names `privacy-dsr-address-parity.test.ts`. `deploy/README.md` § Account data: one line — `refused: rule_mismatch` means the database locale lower-cases unlike the program; do not erase; check `datctype` (`en_US.utf8` expected) and tell the owner.
- Done when: the Proof (plan.md, `NN` = `04`) prints `PROOF_OK`.

## Out of scope

Changing the database locale. A panel page. Org delete.
