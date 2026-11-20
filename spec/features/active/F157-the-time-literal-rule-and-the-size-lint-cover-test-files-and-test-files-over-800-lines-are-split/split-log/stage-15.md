# F157 stage 15 split log

Base for the before runs: `73801f3e` (the branch tip before the first history merge). All runs: `EA_TEST_WORKER_DB=1 bun test --timeout=30000`. Before and after XML files were in `/tmp/f157-s15/`.

## apps/server/test/integration/mail-repo.test.ts

- Old: 1,202 lines. Before run: 49 cases, 0 fail.
- Parts: `mail-repo-mailboxes.test.ts` 301 lines (mailboxes, mailbox status, sync folder cursor, forceRescan, credentials; 12 cases), `mail-repo-emails.test.ts` 443 lines (emails; 17 cases), `mail-repo-folders.test.ts` 458 lines (listMoveCandidates, listFolderEmailKeys, mailbox settings, email location, sync folders, listFolderRowsAtUids; 20 cases). Helpers: `mail-repo-helpers.ts` 45 lines.
- Proof: `split-proof PASS cases=49`.
- Setup list: `const db = testDb()` and `afterAll` that destroys it: repeated in each part. `interface Tenant`, `createTwoTenants`, `newEmail`, `emailRow`: helpers file (each is used by two or more parts; `createTwoTenants` by all three). `sourceUidOf`: only the emails part uses it, so it stays there. No `mock.module`, no `setSystemTime`, no other hooks.
- Assertion lines: none (the proof printed none).
- References: none outside history folders (`git grep -n -F mail-repo` outside `spec/`, `notes/`, `docs/owner-decisions.md`, `docs/decisions/`, `docs/product/` prints nothing).

## apps/server/test/integration/replies-drafter-job.test.ts

- Old: 1,298 lines. Before run: 38 cases, 0 fail.
- Parts: `replies-drafter-job-drafting.test.ts` 391 lines (the first half of the drafter job describe: cases 1–7b, 10 cases), `replies-drafter-job-gates.test.ts` 455 lines (the second half of that describe, cases 9–13, 12 cases; the describe name is the same in both parts), `replies-drafter-job-hostile.test.ts` 138 lines (hostile data; 3 cases), `replies-drafter-job-exactly-once.test.ts` 395 lines (one draft per request, exactly once; 13 cases). Helpers: `replies-drafter-job-helpers.ts` 22 lines.
- Proof: `split-proof PASS cases=38`.
- Setup list: `const db = testDb()` and `afterAll` that destroys it, and the leading comment: repeated in each part. `secrets` (a secret box), `fresh` (a clock with `NOW`), `openReplySends`: helpers file (used by two or more parts). No `mock.module`, no `setSystemTime`, no other hooks.
- Assertion lines: none.
- References repointed: `docs/capabilities/drafts-and-send.md` and `docs/capabilities/reply-drafts.md` now name the four parts.

## apps/server/test/integration/replies-sweep.test.ts

- Old: 861 lines. Before run: 32 cases, 0 fail.
- Parts: `replies-sweep-answered.test.ts` 264 lines (answered; newer mail, moved mail, suspicious mail; `newerMailInThread`; 8 cases), `replies-sweep-policy.test.ts` 359 lines (policy, locks, tenants, limits; tenant isolation of the readers; the cap counts closes; 17 cases), `replies-sweep-moves.test.ts` 249 lines (races with a tap and a claim; moves, junk, spam; a paused mailbox and a Sent row not read yet; 7 cases). Helpers: `replies-sweep-helpers.ts` 38 lines.
- Proof: `split-proof PASS cases=32`.
- Setup list: `const db = testDb()`, `afterAll` that destroys it, `let logs` and its `afterEach` that stops it, and the leading comment: repeated in each part (each part sets `logs` in its own cases). `NOW` (alias of `SWEEP_NOW`), `send`, `sweepOf`, `run`: helpers file (used by two or more parts). No `mock.module`, no `setSystemTime`.
- Assertion lines: none.
- References repointed: `docs/capabilities/drafts-and-send.md` and `docs/capabilities/reply-drafts.md` now name the three parts.
