# F105 stage 11 — E2e seed and spec

Part of [`../plan.md`](../plan.md). Read its D16, D17, D24, D25, "Rules for every stage" (the e2e rule: own e2e DB, `flock`) first. Lane C. Needs stage 10 (and so 02–09).

Two steps. About 250 changed lines.

- [ ] **11.1 One two-factor owner per project in the e2e seed**
  - Goal: the e2e run has a user per Playwright project whose TOTP the spec can turn on and off without touching the users of other specs.
  - Files: change `apps/server/src/scripts/e2e-seed-args.ts`, `apps/server/src/scripts/e2e-seed.ts`, `apps/server/test/integration/e2e-seed.test.ts`.
  - Interfaces (pattern of the terms owners):

    ```ts
    // e2e-seed-args.ts
    export const E2E_TWO_FACTOR_EMAILS: Record<E2eProject, string> = {
      mobile: "e2e-two-factor-mobile@x.test",
      desktop: "e2e-two-factor-desktop@x.test",
    };
    export const e2eTwoFactorOrgName = (project: E2eProject): string => `E2E Two-factor ${project}`;
    // SeedFile gets:
    twoFactorOwners: Record<E2eProject, { userId: string; email: string; password: string }>;
    ```

    `e2e-seed.ts`: `wipe` deletes the new organizations (by name) and users (by e-mail) too; for each project `createOrganizationWithOwner` (`timezone: "Europe/Warsaw"`, `displayName: "E2E Two-factor <project>"`), the password `E2E_MEMBER_PASSWORD` set through `requestLink` + `setPassword` (so the terms are current); `twoFactorOwners` in the written seed file. A re-run of the seed starts the user with TOTP off (the user is new; its `auth_two_factors` row went with the old user by cascade).
  - Decisions: D24.
  - Test (`e2e-seed.test.ts`):
    1. After the seed, each `twoFactorOwners[project]` exists, is the owner of `E2E Two-factor <project>`, has `two_factor_enabled = false` and the current terms.
    2. A second seed run gives new ids and still `two_factor_enabled = false` (set it true with SQL between the runs to prove the reset).
  - Check: `bun test apps/server/test/integration/e2e-seed.test.ts apps/server/src/scripts`.
  - Done when: tests 1–2 pass.
  - Out of scope: the spec (11.2).

- [ ] **11.2 `two-factor.spec.ts`**
  - Goal: the browser proves enrolment, sign-in with a code and with a backup code, the used-code refusal, and turning TOTP off.
  - Files: add `apps/web/e2e/totp.ts` (the RFC 6238 helper, `node:crypto` only: `base32Decode`, `totpCode(secretBase32, atMs = Date.now())`; the same code as `apps/server/test/totp.ts`, which the e2e runner must not import); add `apps/web/e2e/tests/two-factor.spec.ts`.
  - Interfaces and behaviour:
    - `test.describe.configure({ mode: "serial" })`. The tests of one project share module variables `secret: string` and `codes: string[]` (each project runs in its own worker with its own user).
    - Address blocks 50 (mobile) and 150 (desktop) (Fact F12). Every sign-in runs in a new browser context (`browser.newContext({ baseURL: E2E_BASE_URL, extraHTTPHeaders: { "x-forwarded-for": nextAddress(base) } })`), so the limit of 3 calls per 10 s on `/two-factor/*` never answers (Fact F5).
    - Each page collects every console message (`page.on("console")`); `afterEach` asserts that no message holds `secret`, `otpauth`, or any of `codes`, and that `cspErrors` is empty.
  - Test (`two-factor.spec.ts`; user = `readSeed().twoFactorOwners[project]`):
    3. Turn on: sign in (password only) → `/onboarding`; go to `/settings`; in `[data-section=two-factor]` click `tf_turn_on`, fill `password_label`, click `continue`; `[data-qr=totp]` is visible; `secret` = the text of `[data-totp-secret]` without spaces; fill `tf_code_label` with `totpCode(secret)`, click `tf_verify`; `[data-backup-codes] li` has 10 items, each matching `/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/`; keep them in `codes`; click `tf_codes_done`; the section shows `tf_on_text` and `Backup codes left: 10` (`en.tf_codes_left` with `{count}` = 10).
    4. Sign in with a code (new context): fill the password form → the code step shows `tf_code_label`; fill a wrong code (`"000000"`, or `"111111"` when `"000000"` is the current code) → `tf_error_code`; fill `totpCode(secret)` → the URL ends with `/onboarding`.
    5. Sign in with a backup code (new context): password → click `tf_use_backup` → fill `codes[0]` → `/onboarding`. Then a new context: password → `tf_use_backup` → `codes[0]` again → `tf_error_backup_code` and the URL stays `/login`.
    6. Trusted device: a new context, password, `totpCode(secret)` with the `tf_trust_device` switch on → `/onboarding`; in the same context sign out (the user menu's sign-out, or `POST /api/auth/sign-out` with `page.request` and `origin: E2E_BASE_URL`), sign in again with the password → `/onboarding` without the code step.
    7. Turn off (new context, sign in with a code): `/settings` → `tf_turn_off` → password → `continue` → the toast `tf_off_toast` and the section shows `tf_off_text`; a new context signs in with the password only → `/onboarding` with no code step.
  - Check: give the job its own e2e DB (plan § Rules), then `bun run web:build && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e -- two-factor.spec.ts`; then the whole suite once (the seed change touches every spec).
  - Done when: tests 3–7 pass on both projects (`mobile`, `desktop`) and the whole e2e suite passes.
  - Out of scope: an operator e2e case (the integration tests of stage 04 cover the guard); a Polish run (F098 stage 03 owns the Polish browser spec).

## Done when

- Steps 11.1 and 11.2 are done and committed by explicit paths.
- The stage 11 Proof command of `plan.md` (`/tmp/f105-s11`, the web chain plus the whole `test:e2e` under `flock`) prints `PROOF_OK`.
