# F082 stage 06 — Leaked-password check [risky]

Part of [`../plan.md`](../plan.md). Read its F5, F7, L14, L30 and "Rules for every stage" first. Needs stage 3 (the `hooks.before` dispatcher).

One step.

- [ ] **6.1 A password from the Have I Been Pwned list is refused on setup, reset and change**
  - Goal: a leaked password is never stored; when the check service is down or slow, no password changes and the user sees "try again later" (fail closed).
  - Files:
    - add `apps/server/src/platform/pwned.ts`, `pwned.test.ts`;
    - change `apps/server/src/platform/auth.ts` (`AuthDeps.pwnedCheck`, `hooks.before`), `platform/config.ts` (`AUTH_PWNED_CHECK`), `config.test.ts`, `.env.example`;
    - change `apps/server/src/web.ts` (wiring and the start line);
    - change `apps/web/e2e/env.ts` (`AUTH_PWNED_CHECK: "off"`);
    - change `apps/web/src/lib/password-errors.ts`, `password-errors.test.ts`, `apps/web/src/islands/SetupPage.tsx` (error mapping), `apps/web/src/i18n/en.ts`;
    - add `apps/server/test/integration/web-pwned.test.ts`.
  - Interfaces:

    ```ts
    // platform/pwned.ts
    export type PwnedResult = "ok" | "pwned" | "unavailable";
    export interface PwnedDeps { fetch: typeof fetch; timeoutMs: number }
    export const PWNED_RANGE_URL = "https://api.pwnedpasswords.com/range/";
    export function checkPwnedPassword(password: string, deps: PwnedDeps): Promise<PwnedResult>; // never rejects

    // platform/auth.ts — AuthDeps
    pwnedCheck?: (password: string) => Promise<PwnedResult>; // absent = no check (CLIs, tests that do not test it)

    // platform/config.ts
    AUTH_PWNED_CHECK: z.enum(["on", "off"]).default("on") // with emptyAsUndefined
    ```

  - Decisions (L14):
    - `checkPwnedPassword`: `hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase()`; `GET ${PWNED_RANGE_URL}${hash.slice(0, 5)}` with headers `Add-Padding: true`, `User-Agent: email-assistant` and `signal: AbortSignal.timeout(timeoutMs)`. Status not 200 → `log.warn(\`pwned check unavailable: status ${status}\`)`, `unavailable`. Body: split on `/\r?\n/`; a line whose part before `:`equals`hash.slice(5)`(case-insensitive) and whose count is an integer above 0 →`pwned`; else `ok`. A throw (network, timeout) → `log.warn(\`pwned check unavailable: ${code}\`)`with`code`= the error`name` (`TimeoutError`, `TypeError`), `unavailable`. Never log the password, the hash or the prefix.
    - `hooks.before`, only when `deps.pwnedCheck` is set, on `/reset-password` and `/change-password`: `p = ctx.body?.newPassword`; when `typeof p === "string"` and `12 <= p.length <= 128`: `pwned` → `throw APIError.from("BAD_REQUEST", { code: "PASSWORD_COMPROMISED", message: "This password is in a list of leaked passwords. Choose another one." })`; `unavailable` → `throw APIError.from("SERVICE_UNAVAILABLE", { code: "PASSWORD_CHECK_UNAVAILABLE", message: "The password check is not available. Try again later." })`. Other lengths: no call (Better Auth refuses them).
    - `web.ts`: `AUTH_PWNED_CHECK === "on"` → `pwnedCheck: (password) => checkPwnedPassword(password, { fetch, timeoutMs: 5_000 })`; `off` → no field and `log.warn("AUTH_PWNED_CHECK=off: leaked passwords are not refused")`.
    - `.env.example`: `AUTH_PWNED_CHECK=` with the comment "on (default) = refuse passwords from the Have I Been Pwned list (sends 5 hex characters of the SHA-1, nothing else); off = tests only. Server: leave empty."
    - Web (L30): `changePasswordError`: `code === "PASSWORD_COMPROMISED"` → `{ field: "password", key: "password_pwned" }`; `status === 503` or `code === "PASSWORD_CHECK_UNAVAILABLE"` → `{ field: null, key: "password_check_unavailable" }`. `SetupPage`: the same two codes → the field error `password_pwned` on the password field, or the form error `password_check_unavailable`. `en.ts`: `password_pwned: "This password is in a list of leaked passwords. Choose another one."`, `password_check_unavailable: "We cannot check the password now. Try again in a few minutes."`.
  - Test:
    1. `pwned.test.ts`: a fake `fetch` that answers the range body `"<suffix of SHA-1('password1234')>:443397\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0\r\n"` → `pwned` for `password1234`; the fake saw the URL `…/range/E6B6A` and the header `Add-Padding: true`.
    2. The same body, password `correct-horse-battery-staple` (prefix `DD606`; the fake answers a body without its suffix) → `ok`.
    3. A line with the right suffix and count `0` (padding) → `ok`.
    4. Status 503 → `unavailable`; a `fetch` that rejects → `unavailable`; a `fetch` that waits on the signal with `timeoutMs: 50` → `unavailable` in under 1 s.
    5. The captured log of tests 1–4 holds no `password1234`, no `E6B6A` and no full hash.
    6. `web-pwned.test.ts` (`createAuth` with `pwnedCheck` = a fake that returns `pwned` for `password1234`-like inputs you choose and records calls): reset with a listed password → `400` code `PASSWORD_COMPROMISED`; the old password still signs in; the token still works for a good password afterwards.
    7. Change password (signed in) with a listed password → `400 PASSWORD_COMPROMISED`; the old password still signs in.
    8. `pwnedCheck` returns `unavailable` → reset answers `503 PASSWORD_CHECK_UNAVAILABLE`; nothing changed (old password signs in).
    9. A 5-character new password → `400 PASSWORD_TOO_SHORT` and `pwnedCheck` was not called.
    10. Without `pwnedCheck`: a reset with any 12+ character password works (old behaviour).
    11. `config.test.ts`: default `on`; `off` accepted; `maybe` → `ConfigError` with `AUTH_PWNED_CHECK`.
    12. `password-errors.test.ts`: the two new mappings.
  - Check: Proof (server form, `/tmp/f082-s06`). Also `bun run web:build` passes (paste its last line).
  - Done when: the tests pass and the Proof printed `PROOF_OK`.
  - Out of scope: the terms check (stage 7 puts it before this check); a captcha (P9: none).
