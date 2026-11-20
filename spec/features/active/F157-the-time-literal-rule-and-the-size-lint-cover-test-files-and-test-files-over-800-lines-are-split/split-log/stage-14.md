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

## `apps/server/test/integration/mail-oauth-connect.test.ts` (1,259 lines)

Parts: `mail-oauth-connect-flow.test.ts` 449 (describes "Connect" and "the history check at an OAuth connect"), `mail-oauth-connect-reconnect.test.ts` 336, `mail-oauth-connect-callback.test.ts` 430 (describes "the callback route", "secrets never leave", "the secret store"), helpers `mail-oauth-connect-helpers.ts` 314.

Proof: `split-proof PASS cases=54`.

Assertion line: `secrets never leave :: 28. canary: ...` went from 231 to 75. Cause: the case loops over `fake.issuedRefreshTokens`, a list the fake token server fills for the whole file and no hook clears. The parts hold fewer earlier cases, so the list is shorter. No lost hook: the case still runs every check on every token it searches.

Setup list (old file, top level):

| Statement | Now |
| --- | --- |
| `const db = testDb()` | each part |
| `let fake, clients, org, secondOwnerId, logLines, logSpies` | each part (the helpers read them through getters) |
| `beforeAll`, `afterAll`, `beforeEach`, `afterEach` | repeated in each part; `makeClients` now takes the fake as an argument |
| `secrets`, `MAIL_HOST`, `IMAP_PORT`, `SMTP_PORT`, `HOSTS`, `GOOGLE_MAIL`, `login`, `dropped`, `testConfig`, `makeClients`, `locationOf`, `resultOf`, `SignedIn`, `SeedOpts` | `mail-oauth-connect-helpers.ts` (exported) |
| `extrasOf`, `appOf`, `ctxA`, `addressOf`, `enable`, `signIn`, `callback`, `mailboxRows`, `stateRows`, `auditOf`, `credentialsOf`, `secretOf`, `seedMailbox`, `mailboxOf`, `grantOf`, `depsOf` | `makeOAuthConnectKit` in the helpers file; each part destructures what it uses |

References repointed: a comment in `mail-history-connect.test.ts` (to `mail-oauth-connect-flow.test.ts`, which holds the history check at an OAuth connect).
