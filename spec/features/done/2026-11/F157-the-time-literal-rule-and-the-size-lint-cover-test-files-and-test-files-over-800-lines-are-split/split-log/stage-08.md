# Stage 08 split log

Base before the history merge: `57d52e8e`. Master did not move an old file after the merge. Both files ran with `EA_TEST_WORKER_DB=1 bun test --timeout=30000` (before: one run each, 0 failures; after: one `bun test` call per part, 0 failures). JUnit files are in `/tmp/f157-s08/`.

Folder of every path below: `apps/server/test/integration/`.

## actions-repo.test.ts (2,007 lines)

Parts (lines): `actions-repo-claim.test.ts` 344, `actions-repo-lifecycle.test.ts` 362, `actions-repo-plan.test.ts` 424, `actions-repo-undo.test.ts` 289, `actions-repo-claim-sends.test.ts` 274, `actions-repo-send-lifecycle.test.ts` 368, helpers `actions-repo-helpers.ts` 70.

Proof: `split-proof PASS cases=61`. No `assertions` line.

Topics: claim (`claimActions`, two-connection claim, tenant filter, `countClaimable`); lifecycle (`finishAction`, release, expiry, counts); plan (`actions repository`, `createPlanned` with `dependsOn`, tenant filter, `listActionsForEmails`, `isOwnActionId`); undo (`markUndone`, `insertReverse`, undo locks, failed-unnotified lists). The describe `claimActions: drafts and sends` held 600 lines: it is in two parts under the same describe name (cases 1–6 in claim-sends, 7–16 in send-lifecycle).

Setup list (old file, top level):

- `db`, `afterAll` (destroy): repeated in every part.
- `Tenant`, `createTwoTenants`, `actionRows`, `NOW`, `STALE_BEFORE`, `ALL`, `SEND_ALL`, `ago`, `filterOf`, `claimOpts`, `countOpts`, `actionState`, `ready`: `actions-repo-helpers.ts`.
- Local to the describe of drafts and sends: `setup` → `setupOrgs`, `approvedNow`, `ids` → `idsOf` (all in the helpers file, used by both halves); `MIN` stays in claim-sends (the only user).

References repointed: `apps/server/src/modules/actions/transitions.ts` (three `test:` strings → claim-sends), `docs/code-patterns.md` (→ `actions-repo-claim.test.ts`, the tenant filter cases).

## actions-send.test.ts (1,175 lines)

Parts (lines): `actions-send-outcomes.test.ts` 377, `actions-send-guards.test.ts` 280, `actions-send-recovery.test.ts` 220, `actions-send-chain.test.ts` 203, helpers `actions-send-helpers.ts` 196.

Proof: `split-proof PASS cases=33`. No `assertions` line.

Topics: outcomes (cases 1–6d of `applySend`); guards (cases 7–12 of `applySend`); recovery (crashes and recovery of an applying send); chain (send end to end). The describe `applySend` is in two parts under the same name.

Setup list (old file, top level):

- `db`, `afterAll`: every part. `afterEach` (log level and format reset): outcomes only (the only part that sets a log level).
- `NOW`, `CREATED`, `at`, `DELEGATION_ID`, `secrets`, `Setup`, `setup`, `Recorded`, `recordingHooks`, `depsOf`, `claimWhere`, `claimOne`, `PairOpts`, `pair`, `row`, `reverses`, `applyOnce`, `smtp`: `actions-send-helpers.ts`.
- `auditOf`, `sentFolderCount`: used by outcomes only, kept there.
- `fakeLlm`, `pause`, `analysisOf`: chain only.

References repointed: `apps/server/src/modules/actions/transitions.ts` (the `test:` strings → outcomes, guards, chain), `docs/capabilities/drafts-and-send.md` (the Tests list names the four parts).
