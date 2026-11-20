# F157 stage 18 — split log

Stage base: ceca540d. All three files were over 800 lines at that commit (the time-literal fix had grown them to 896, 895 and 828). The before runs (`/tmp/f157-s18/<base>.before.xml`) ran at the base with `EA_TEST_WORKER_DB=1 --timeout=30000`, from the repo root. Each part ran in its own `bun test` process (`/tmp/f157-s18/<part>.after.xml`); every part ended `0 fail`. `master` did not change an old file after the history merges, so no port and no restart.

## apps/server/test/integration/trust-regate.test.ts — 896 lines

Parts: `trust-regate-grants.test.ts` 256 (cases 1–4 and the grant, idempotence, trip and log cases of `regateAll`), `trust-regate-evidence.test.ts` 331 (cases 7–9, the evidence cases, two organizations and `a mailbox that fails alone`; the `describe` name `regateAll` stays in both), `trust-regate-concurrent.test.ts` 165 (`regateAll with two connections`), `trust-regate-start.test.ts` 40 (`the start run`). Helpers: `trust-regate-helpers.ts` 213.

Proof: `split-proof PASS cases=32`. No `assertions` line.

Setup list:

- `const db = testDb()`, `afterAll(db.destroy)`, `beforeEach(configureFeatures({ off: [] }))`: the grants, evidence and concurrent parts. The start part reads source files and needs none of them.
- `NOW`, `GRANT_AT`, `KEY_A`, `KEY_B`, `KEY_A_EU`, `NO_EVIDENCE`, `gateFile`, `gateOf`, `depsOf`, `Entry`, `on`, `setup`, `Box`, `policyOf`, `tripsOf`, `noticesOf`, `checksOf`, `policyAudit`, `notificationAnswer`, `llmOf`, `triageOf`, `moveOf`: helpers file.
- `waitForLockWait`: concurrent part (the only user).
- `other = testDb()` with its `afterAll`, and `withCommittedBox`: inside the `describe` of the concurrent part.
- No `mock.module`, `setSystemTime` or `beforeAll`.

References repointed: `docs/capabilities/trust.md` (re-gate and tripwire line, the four parts).

## apps/server/test/integration/trust-history-classify.test.ts — 895 lines

Parts: `trust-history-classify-sample.test.ts` 272 (sample 1, item rows, sample order and lock, acted-on seam, mail of another mailbox), `trust-history-classify-reuse.test.ts` 225 (2: stored results of another model; the review gaps), `trust-history-classify-cost.test.ts` 357 (3–8, failed calls, the synthetic scope with no test mail), `trust-history-classify-model.test.ts` 140 (pause, unjudgeable mail, model scope, time budget). Helpers: the existing `trust-history-classify-helpers.ts` 201 takes `RUN_MS`.

Proof: `split-proof PASS cases=34`. No `assertions` line.

Setup list:

- `const db = testDb()`, `let removePrice`, `beforeAll(priceFixture)`, `afterAll(removePrice, db.destroy)`: each part.
- `RUN_MS`: `trust-history-classify-helpers.ts` (four parts use it).
- `countOf`: sample part (the only user).
- No `mock.module`, `setSystemTime` or `beforeEach`.

References repointed: `docs/capabilities/trust.md` (history check line, the four parts); the comment in the parts that named `trust-history-job.test.ts` now names the backfill and flags parts of the job split.

## apps/server/test/integration/trust-history-job.test.ts — 828 lines

Parts: `trust-history-job-claim.test.ts` 359 (step 1, carry-over), `trust-history-job-backfill.test.ts` 177 (step 2), `trust-history-job-flags.test.ts` 253 (step 3, the flag refresh closes its connection, gone mail), `trust-history-job-model.test.ts` 82 (no triage code or model client reached; only the classify step calls the model). Helpers: the existing `trust-history-helpers.ts` 183 takes `historyJobKit(db)`.

Proof: `split-proof PASS cases=32`. No `assertions` line.

Setup list:

- `const db = testDb()`, `afterAll(db.destroy)`: each part.
- `queue`, `emailsOf` (both used `db`): `historyJobKit(db)` in the helpers file; each part destructures the ones it calls (claim and backfill both; flags and model `queue`).
- `THIRD_ATTEMPT`: claim part (the only user).
- No `mock.module`, `setSystemTime`, `beforeAll` or `beforeEach`.

References repointed: `docs/capabilities/trust.md` (the connect paragraph and the history check line: the four parts).

## Checks

- Reference checks (procedures step 11): `bun test apps/server/src/capability-map.test.ts apps/server/src/legal-papers.test.ts apps/server/src/bare-codes.test.ts apps/docs/src/security/claims.test.ts apps/server/src/modules/actions/transitions.test.ts` → 106 pass, 0 fail.
- `git grep -n -F` of the three old file names outside the history folders prints nothing.
