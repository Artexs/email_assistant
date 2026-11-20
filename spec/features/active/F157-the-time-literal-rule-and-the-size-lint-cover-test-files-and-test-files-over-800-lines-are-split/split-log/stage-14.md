# Split log, stage 14 (mail jobs and OAuth)

Base `73801f3e`. Each part ran in its own `bun test` process with `EA_TEST_WORKER_DB=1 --timeout=30000`.

## `apps/server/test/integration/mail-jobs.test.ts` (1,257 lines)

Parts: `mail-jobs-sync.test.ts` 338 (describes "mail sync job" and "the way in: a refused host blocks the mailbox"), `mail-jobs-suspended.test.ts` 206, `mail-jobs-sent-pass.test.ts` 451, `mail-jobs-logs.test.ts` 235, helpers `mail-jobs-helpers.ts` 99.

Proof: `split-proof PASS cases=31`. No `assertions` line.

Setup list (old file, top level):

| Statement | Now |
| --- | --- |
| `const db = testDb()` and `afterAll` that destroys it | repeated in each of the four parts |
| `NOW`, `secrets`, `Box`, `addBox`, `seed`, `Opened`, `openers`, `jobFor`, `mailboxRow`, `emailCount` | `mail-jobs-helpers.ts` (exported; every part uses several) |
| `beforeEach` / `afterEach` hooks | inside describes; they moved with their describe |

References repointed: `docs/capabilities/sent-mail.md` (to `mail-jobs-sent-pass`), `docs/capabilities/sync.md` (to the four parts).
