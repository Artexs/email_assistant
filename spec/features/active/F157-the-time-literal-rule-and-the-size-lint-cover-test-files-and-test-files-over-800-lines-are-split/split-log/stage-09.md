# Stage 09 split log

Base before the first history merge: `57d52e8e` (HEAD of the job). Every old file was over 800 lines at that base. Each file went through the history merge (`history-copies.sh`) and a trim commit. `Before` XML: old file at the base, `EA_TEST_WORKER_DB=1 bun test --timeout=30000`. `After` XML: each part in its own `bun test` process. No `assertions` line appeared in any proof output.

Setup in all four files: `const db = testDb()` and the `afterAll` that destroys it. Every part repeats both. The other top-level statements moved by use: used by two or more parts → helpers file (exported); used by one part → stays in that part.

## actions-committer.test.ts (1,134 lines)

- Parts: `actions-committer-job.test.ts` 328 (`createCommitterJob`), `actions-committer-refusals.test.ts` 266 (auth error with a reason, suspended organization, refused host), `actions-committer-sends.test.ts` 197, `actions-committer-undo-move.test.ts` 226. Helpers: `actions-committer-helpers.ts` 187.
- Proof: `split-proof PASS cases=32`.
- Setup list: `NOW`, `RECEIVED`, `secrets`, `Box`, `addBox`, `Mail`, `addMail`, `Opener`, `openerFor`, `jobFor`, `actionState`, `flagsOf`, `SendOpener`, `senderOpener`, `sendJob`, `pairOf` → helpers file. Hooks: only `afterAll`, repeated. No `mock.module`, no `setSystemTime`.
- References repointed: `docs/capabilities/actions-and-undo.md` (four part lines).

## actions-follow-up.test.ts (993 lines)

- Parts: `actions-follow-up-committer.test.ts` 336, `actions-follow-up-switch.test.ts` 100, `actions-follow-up-recipients.test.ts` 233, `actions-follow-up-sent.test.ts` 225. Helpers: `actions-follow-up-helpers.ts` 202.
- Proof: `split-proof PASS cases=29`.
- Setup list: `NOW`, `CREATED`, `SENT_AT`, `at`, `secrets`, `run`, `MARKERS`, `Setup`, `setup`, `addCredentials`, `FollowUpOpts`, `FollowUp`, `followUp`, `tap`, `committerOf`, `row`, `loopOf`, `draftsCount`, `prepare` → helpers file. `auditOf`, `sentCount`, `applyDepsOf`, `claimOne` → committer part only. Hooks: only `afterAll`, repeated.
- References repointed: `docs/capabilities/open-loops.md`.

## actions-move.test.ts (959 lines)

- Parts: `actions-move-ensure.test.ts` 387 (original move, crash test, `ensureMoved`), `actions-move-reverse.test.ts` 194, `actions-move-rescue.test.ts` 288. Helpers: `actions-move-helpers.ts` 169.
- Proof: `split-proof PASS cases=29`.
- Setup list: `NOW`, `RECEIVED`, `SINCE`, `INTERIA`, `Setup`, `setup`, `depsOf`, `message`, `MESSAGE_ID`, `deliver`, `insertMail`, `claim`, `actionState`, `emailState`, `auditEvents`, `uidsIn`, `callCount`, `REVERSE_AT`, `insertMoved` → helpers file. `insertTestEmailLike` → reverse part; `JUNK`, `LATER` → rescue part. Hooks: only `afterAll`, repeated.
- References repointed: `docs/capabilities/actions-and-undo.md`; `PAIR_RULES` string `(8)` → `actions-move-reverse.test.ts`.

## actions-drafts.test.ts (810 lines)

- Parts: `actions-drafts-apply.test.ts` 489 (`applyDraft`, committer job with drafts), `actions-drafts-remove.test.ts` 247 (`removeDraft`, failing draft and reject). Helpers: `actions-drafts-helpers.ts` 137.
- Proof: `split-proof PASS cases=23`.
- Setup list: `NOW`, `CREATED`, `Setup`, `setup`, `depsOf`, `claimOne`, `actionState`, `reverseRows`, `auditRows`, `draftUids`, `MAIL` → helpers file. `HEX`, `secrets`, `DELEGATION_ID`, `recordingHooks`, `appendCalls` → apply part. Hooks: only `afterAll`, repeated.
- References repointed: `docs/capabilities/drafts-and-send.md`; three `PAIR_RULES` strings → `actions-drafts-apply.test.ts` (dead send, three hard APPEND errors) and `actions-drafts-remove.test.ts` (two reverse-row cases).
