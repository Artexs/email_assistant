# F157 stage 20 — split log

Stage base: 239147f9b. The re-measure (`git ls-files` of the test-code globs `| xargs wc -l`) found one file over 800 lines: `tools/fake-telegram/test/lab-executive.test.ts`, 808. That is at most 2, so it is split here. 198 test-code files are over 400 lines.

## tools/fake-telegram/test/lab-executive.test.ts — 808 lines

The before run (`/tmp/f157-s20/lab-executive.before.xml`) ran at the base with `EA_TEST_WORKER_DB=1 --timeout=30000`: 14 cases, 0 fail. Each part ran in its own `bun test` process, all with 0 fail.

Parts: `lab-executive-approvals.test.ts` 212 (cases 1, 2, the stale-button press, the reminder-set and failed-send presses), `lab-executive-digest.test.ts` 167 (case 3, 5b, the repeated digest, `lookupCard`), `lab-executive-guards.test.ts` 244 (cases 4, 5, 6, 7, 7b and the stopped run). Helpers: `lab-executive.test-helper.ts` 271 (new).

Proof: `split-proof PASS cases=14`. No `assertions` line.

Setup list (each statement of the old file that is not an import, `describe` or `test`):

- `const db = testDb()` and `afterAll(db.destroy)`: each part.
- `dirs`, `fakes`, the `afterEach` cleanup, `withWorld`, `approvalCard`, `movedMail`, `digestCard`: inside `makeExecutiveKit(db)` in the helpers file; each part builds its own kit and registers `afterEach(kit.cleanup)`. The restart case reads `kit.fakes`.
- `SIM_ROOT`, `WAIT_MS`, `DOMAIN`, `corpus`, `planned`, `plan`, `runId`, `slotOf`, `addressOf`, `labId`, `WRONG_DELEGATE`, `RIGHT_DELEGATE`, `until`, `sendStatus`, `kinds`, the `Org` and `World` types: the helpers file (read-only values, shared by the parts that use them).
- `PREFIXES`: the guards part only.
- No `mock.module` or `setSystemTime`.

Changed spelling: the temp folder prefix `f113-s10-exec-` is now `lab-executive-` (no case checks it).

References repointed: `docs/capabilities/live-lab.md` (the list of lab tests names the three parts). The reference checks (`capability-map`, `legal-papers`, `bare-codes`, `claims`, `transitions` tests) pass.
