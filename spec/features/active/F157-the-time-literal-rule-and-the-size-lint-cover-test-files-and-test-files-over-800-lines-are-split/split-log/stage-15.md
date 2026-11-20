# F157 stage 15 split log

Base for the before runs: `73801f3e` (the branch tip before the first history merge). All runs: `EA_TEST_WORKER_DB=1 bun test --timeout=30000`. Before and after XML files were in `/tmp/f157-s15/`.

## apps/server/test/integration/mail-repo.test.ts

- Old: 1,202 lines. Before run: 49 cases, 0 fail.
- Parts: `mail-repo-mailboxes.test.ts` 301 lines (mailboxes, mailbox status, sync folder cursor, forceRescan, credentials; 12 cases), `mail-repo-emails.test.ts` 443 lines (emails; 17 cases), `mail-repo-folders.test.ts` 458 lines (listMoveCandidates, listFolderEmailKeys, mailbox settings, email location, sync folders, listFolderRowsAtUids; 20 cases). Helpers: `mail-repo-helpers.ts` 45 lines.
- Proof: `split-proof PASS cases=49`.
- Setup list: `const db = testDb()` and `afterAll` that destroys it: repeated in each part. `interface Tenant`, `createTwoTenants`, `newEmail`, `emailRow`: helpers file (each is used by two or more parts; `createTwoTenants` by all three). `sourceUidOf`: only the emails part uses it, so it stays there. No `mock.module`, no `setSystemTime`, no other hooks.
- Assertion lines: none (the proof printed none).
- References: none outside history folders (`git grep -n -F mail-repo` outside `spec/`, `notes/`, `docs/owner-decisions.md`, `docs/decisions/`, `docs/product/` prints nothing).
