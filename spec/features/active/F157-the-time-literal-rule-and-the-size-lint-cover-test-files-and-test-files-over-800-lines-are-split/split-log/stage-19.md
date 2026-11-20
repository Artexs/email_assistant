# F157 stage 19 — split log

Stage base: ceca540de. Both files were over 800 lines at that commit (1,216 and 803 by `wc -l`). The before runs (`/tmp/f157-s19/<base>.before.xml`) ran at the base with `EA_TEST_WORKER_DB=1 --timeout=30000`, from the repo root: 50 and 37 cases, 0 fail. Each part ran in its own `bun test` process, all with 0 fail.

## apps/server/test/integration/web-two-factor.test.ts — 1,216 lines

Parts: `web-two-factor-sign-in.test.ts` 382 (`two-factor sign-in`, `backupCodesLeft`, `two-factor enrolment edge cases`, `secrets`), `web-two-factor-events.test.ts` 372 (`two-factor events` with its nested break-glass `describe`), `web-two-factor-codes.test.ts` 292 (the code for turn off and new codes). Helpers: `two-factor-helpers.ts` 425 (it held 137 lines; the new `makeWebTwoFactorKit` and four exported constants are the rest).

Proof: `split-proof PASS cases=50`.

Assertion line: `secrets :: no console line holds a secret, a code or otpauth`, 23,971 before, 4,069 after. Cause: the case loops over every secret and every console line of the run. Its `secrets` list and console spies now hold only what the cases of its own part collected (the sign-in part); before, they held the whole file. The case is unchanged and still passes (more than 20 secrets in the part). The check on the secrets of the events and codes parts is gone; see the stage report, "Decisions for the owner".

Setup list (each statement of the old file that is not an import, `describe` or `test`):

- `const db = testDb()`: each part. `afterAll(db.destroy)`: `kit.close` (also closes the three handles and restores the spies); each part registers `afterAll(kit.close)`.
- `BASE_URL`, `SECRET`, `PASSWORD`, `NEW_PASSWORD`, `WRONG_PASSWORD`, `BACKUP_CODE`: exported from `two-factor-helpers.ts` (`BASE_URL` and `PASSWORD` already were); a part imports the ones it uses.
- `resets`, `makeHandle`, `handle`, `lockHandle`, `keepHandle`, `auth`, `orgIds`, `userIds`, `secrets`: inside `makeWebTwoFactorKit(db)`; each part builds its own kit and destructures what it uses.
- `logSpy`, `errorSpy`, `warnSpy` and `beforeAll`: `kit.spies` and `kit.silenceConsole`; each part registers `beforeAll(kit.silenceConsole)`. The bodies read `spies.log`, `spies.error` and `spies.warn`.
- `afterEach` cleanup: `kit.cleanup`; each part registers `afterEach(kit.cleanup)`.
- `nextIp`, `Client`, `createOwner`, `requestResetLink`, `setPassword`, `Enrolment`, `createEnrolled`, `challenge`, `typedCode`, `wrongCode`, `twoFactorRow`, `twoFactorFlag`, `countSessions`, `loginRows`, `auditRows`, `trustRows`, `enrol`: the kit (`nextIp` is the module function that was already there; `Enrolment` is an exported type). A part that uses `Client` as a type adds `type Client = InstanceType<typeof Client>`.
- No `mock.module` or `setSystemTime`.

References repointed: `docs/capabilities/web-panel.md` (the list of web tests names the three parts), `docs/legal/claims.md` row C070 (`web-two-factor-sign-in.test.ts`, which holds the enrolment case that turns TOTP on). The comment above the old kit in `two-factor-helpers.ts` now names `makeWebTwoFactorKit`.

## apps/server/test/integration/web-http.test.ts — 803 lines

Parts: `web-http-pages.test.ts` 151 (`static pages`, `the installable shell`, `page gate`), `web-http-api.test.ts` 307 (`api`, `auth mount`, `HSTS`, `x-request-id`, `errors`, `web off`, `dist missing`, `http logs`), `web-http-real.test.ts` 302 (`real webDeps`, `web root events`). Helpers: `web-helpers.ts` 243 (it held 144 lines).

Proof: `split-proof PASS cases=37`. No `assertions` line.

Setup list:

- `const db = testDb()`: each part.
- `let dist`, `beforeAll` (the temp folder), `afterAll` (remove it, `db.destroy`): `makeWebHttpKit(db)` in `web-helpers.ts` (`kit.dist`, `kit.createDist`, `kit.close`); each part registers `beforeAll(kit.createDist)` and `afterAll(kit.close)`. A body that read `dist` reads `kit.dist`.
- `afterEach(setLogLevel("info"))`: each part.
- `checkDb`, `extras`, `GOOD`, `REFRESH`, `ORIGIN`, `AUTH_MAIL_OFF`: exported from `web-helpers.ts`; a part imports the ones it uses.
- `makeWeb`, `appWith`: the kit.
- `offScope`, `errorRouters`: the api part only (no other part uses them).
- No `mock.module` or `setSystemTime`.

References repointed: `docs/capabilities/web-panel.md` (served headers name `web-http-pages.test.ts`; the list of web tests names the three parts), the comment in `apps/web/integrations/pwa-shell.test.ts` (`web-http-pages.test.ts`).

## Reference checks

`git grep -n -F -e "web-two-factor.test" -e "web-http.test"` outside `spec/`, `notes/`, `docs/owner-decisions.md`, `docs/decisions/` and `docs/product/` prints nothing. `bun test` of the five files of procedures § Split step 11: 106 pass, 0 fail.

## Repair: the console check runs in each web-two-factor part

The split left the case `secrets :: no console line holds a secret, a code or otpauth` only in `web-two-factor-sign-in.test.ts`, so the events and codes parts had no check of their own secrets and console lines. Now each part ends with a case that runs one function, `expectNoSecretInConsole` (a member of `makeWebTwoFactorKit` in `two-factor-helpers.ts`, with the loop and the `secrets.length > 20` check unchanged):

- `web-two-factor-sign-in.test.ts`: `secrets :: no console line holds a secret, a code or otpauth` (same name; its body is now one call).
- `web-two-factor-events.test.ts`: `secrets :: events: no console line holds a secret, a code or otpauth` (new).
- `web-two-factor-codes.test.ts`: `secrets :: codes: no console line holds a secret, a code or otpauth` (new).

The case count of the three parts is 52 (50 before the split, plus the two new cases). No other case changed. Each part alone, from the repo root with `EA_TEST_WORKER_DB=1 bun test --timeout=30000`: sign-in 19 pass, events 17 pass, codes 16 pass, 0 fail.

Break test: in the events part only, the new case first called `console.log` with `secrets[0]`. The run failed that case (`Expected: false`, `Received: true`; 1 fail, the other 16 passed). I reverted the break; the committed file has no such line.
