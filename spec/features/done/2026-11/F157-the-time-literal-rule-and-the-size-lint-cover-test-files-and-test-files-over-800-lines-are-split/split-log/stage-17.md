# F157 stage 17 — split log

Stage base: ceca540d. All three files were over 800 lines at that commit (1,876, 1,218 and 834; the stage file lists older counts). The before runs (`/tmp/f157-s17/<file>.before.xml`) ran at the base with `EA_TEST_WORKER_DB=1 --timeout=30000`, from the repo root. Each part ran in its own `bun test` process; each had 0 failing cases. The `describe` names keep their old text, also the ones that hold a plan code or a ticket code.

## apps/server/test/integration/triage-service.test.ts — 1,876 lines

Parts: `triage-service-save.test.ts` 218 (`saveTriage`, the rule that shaped a result), `triage-service-routing.test.ts` 333 (`triageOne`: category routes, own endpoint, thread context; the `describe` name `triageOne` is in two parts), `triage-service-errors.test.ts` 324 (`triageOne`: soft, config, safety, hard errors, lost claims, pause reset), `triage-service-gates.test.ts` 183 (cost gates), `triage-service-delegation.test.ts` 237 (the delegation plan), `triage-service-reply.test.ts` 271 (the reply rule), `triage-service-folder.test.ts` 239 (the plan by the source folder). Helpers: `triage-service-helpers.ts` 241.

Proof: `split-proof PASS cases=59`. No `assertions` line.

Setup list:

- `const db = testDb()`, `afterAll(db.destroy)`: each part.
- `now`, `setup`, `decision`, `results`, `audit`, `emailStatus`, `FakeLlm`, `fakeLlm`, `analysis`, `FakePause`, `fakePause`, `setupMail`, `llmRows`, `delegationSetup`, `delegationAnswer`, `triageDeps`, `delegationRows`: helpers file (each is used by two or more parts).
- `OFFER_DAY`, `dependsOn`: delegation part only.
- `REPLY_DELEGATE`, `sentDelegation`, `delegationStatus`, `replySetup`: reply part only.
- The local helpers of a `describe` (`deps`, `addLlmCalls`, `folderSetup`, `run`, `ruleOf`) stay in their `describe`.
- No `mock.module`, `setSystemTime`, `beforeAll`, `beforeEach` or `afterEach`.

References: none found.

## apps/server/test/integration/triage-job.test.ts — 1,218 lines

Parts: `triage-job-basic.test.ts` 232 (`createTriageJob`), `triage-job-errors.test.ts` 507 (pause and errors), `triage-job-limits.test.ts` 277 (daily cap, junk folder limit), `triage-job-suspended.test.ts` 200 (suspended organizations, after a resume). Helpers: `triage-job-helpers.ts` 86.

Proof: `split-proof PASS cases=32`. No `assertions` line.

Setup list:

- `const db = testDb()`, `afterAll(db.destroy)`: each part.
- `let errorSpy`, `beforeEach` (spy on `console.error`), `afterEach` (restore): repeated in each part, so all parts keep the muted console.
- `now`, `minutesFromNow`, `FakeLlm`, `probeCategories`, `infoAnswer`, `fakeLlm`, `job`, `mailboxWithSettings`, `emailRow`: helpers file.
- No `mock.module`, `setSystemTime` or `beforeAll`.

Finding during the work: the first generated trim lost an import of `infoAnswer` (a spread use was not seen), and `split-proof` printed PASS with one failing case and one `assertions` line (the case threw inside a fake LLM and the mail stayed pending). I fixed the import and ran all parts again: 0 failing cases, no `assertions` line.

References repointed: `docs/capabilities/triage.md` (the four parts).

## apps/server/test/integration/slo-checks.test.ts — 834 lines

Parts: `slo-checks-sync-lag.test.ts` 116, `slo-checks-urgent.test.ts` 323 (urgent latency), `slo-checks-urgent-quiet.test.ts` 223 (urgent latency with own quiet hours), `slo-checks-llm-errors.test.ts` 135 (with its three call helpers). Helpers: `slo-checks-helpers.ts` 109.

Proof: `split-proof PASS cases=45`. No `assertions` line.

Setup list:

- `const db = testDb()`, `afterAll(db.destroy)`: each part.
- `inRollback` used the file's `db`: the helpers file exports `makeInRollback(db)`; each part runs `const inRollback = makeInRollback(db)`. The call sites keep their text.
- `Trx`, `cfg`, `noTestMail`, `at`, `NOW`, `STARTED`, `setMailbox`, `orgWithMailbox`, `urgentOrg`, `urgentMail`, `sentNotice`, `urgent`: helpers file.
- `llmCalls`, `okCalls`, `failCalls`: llm-errors part only.
- No hooks other than `afterAll`, no `mock.module`, `setSystemTime`.

References repointed: `docs/capabilities/operations.md` (the four parts).
