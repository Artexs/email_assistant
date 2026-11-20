# F157 stage 16 — split log

Stage base: 73801f3e. All three files were over 800 lines at that commit. The before runs (`/tmp/f157-s16/<base>.before.xml`) ran at the base with `EA_TEST_WORKER_DB=1 --timeout=30000`, from the repo root (the integration tests read `DATABASE_URL` from there). Each part ran in its own `bun test` process.

Note on the proof tool: `split-proof` compares case names and skip flags only. It printed `split-proof PASS` for a part that had one failing case (a missing import). The after runs were therefore also checked for `0 fail` per part.

## apps/server/test/integration/privacy-dsr-erase.test.ts — 895 lines

Parts: `privacy-dsr-erase-scrub.test.ts` 214 (cases 1–6 and 13 of `eraseSubjectData`), `privacy-dsr-erase-guards.test.ts` 170 (cases 7–12; same `describe` name), `privacy-dsr-erase-locks.test.ts` 195 (folder lock, tombstone cases 4 and 4b), `privacy-dsr-erase-cli.test.ts` 93. Helpers: `privacy-dsr-erase-helpers.ts` 290.

Proof: `split-proof PASS cases=22`. No `assertions` line.

Setup list:

- `const db = testDb()`, `afterAll(db.destroy)`: each part.
- `afterEach` cleanup of `orgIds` and `userIds`: the helpers file holds the lists and `cleanup` (in `makeDsrKit(db)`); each part calls `afterEach(cleanup)`. The locks part also pushes its own org and user ids into the lists.
- `KEY`, `World`, `unique`: helpers file.
- `seedOrg`, `snapshot`, `count`, `erase`, `erased`, `eraseAudit`, `waitBlocked`: helpers file (`makeDsrKit(db)`), destructured in each part that calls them.
- `repoRoot`, `script`, `run`: the cli part only.
- No `mock.module`, `setSystemTime` or `beforeAll`.

References repointed: `apps/docs/src/security/claims.ts` (the claim `export-and-delete` proofs name all four parts), `docs/legal/claims.md` row C060 (the same four parts), `docs/capabilities/account-data.md`, the comment in `danger-cli-confirm.test.ts` (names the cli part). The four parts are all listed for the claim because the claim covers mail removal, address scrub, tombstones (locks) and the CLI output of the erase.

## apps/server/test/integration/retention-clear.test.ts — 811 lines

Parts: `retention-clear-mail.test.ts` 231 (mail bodies, mail headers, triage texts, retention indexes), `retention-clear-sent.test.ts` 160 (Sent bodies and headers), `retention-clear-actions.test.ts` 292 (action payloads, applying rows, action errors, delegation tasks), `retention-clear-outbox.test.ts` 149 (outbox texts, link tokens). Helpers: `retention-clear-helpers.ts` 24.

Proof: `split-proof PASS cases=22`. No `assertions` line.

Setup list:

- `const db = testDb()`, `afterAll(db.destroy)`: each part.
- `now`, `ago`, `before30`, `before90`, `pendingBefore`, `over30`, `over90`, `Org`, `newOrg`: helpers file.
- `bodyRow`, `bodies`, `seedBodies`: mail part (used by mail-body cases only).
- `insertSentRow`, `readSent`: sent part (used by Sent cases only).
- No `mock.module`, `setSystemTime`, `beforeAll` or `afterEach`.

References repointed: `docs/capabilities/retention.md` (four parts), `docs/capabilities/sent-mail.md` (the sent part).

## apps/server/test/integration/replies-lifetime.test.ts — 821 lines

Parts: `replies-lifetime-expiry.test.ts` 168 (step 1), `replies-lifetime-gaps.test.ts` 275 (step 2), `replies-lifetime-replace.test.ts` 303 (step 3). Helpers: `replies-lifetime-helpers.ts` 117. The `describe` names keep their `step N:` prefix.

Proof: `split-proof PASS cases=27`. No `assertions` line.

Setup list:

- `const db = testDb()`, `afterAll(db.destroy)`: each part.
- `NOW`, `ago`, `TO`, `SWITCHES`, `World`, `world`, `Pair`, `reply`, `approvalDeps`, `tap`, `expiryJob`, `row`, `auditRows`: helpers file.
- `secrets`, `addCredentials`: gaps part (used only there).
- `closeDeps`: replace part (used only there).
- No `mock.module`, `setSystemTime`, hooks other than `afterAll`.

References repointed: `docs/capabilities/reply-drafts.md` (three parts).
