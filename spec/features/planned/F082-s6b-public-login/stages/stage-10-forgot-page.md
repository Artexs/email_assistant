# F082 stage 10 — `/forgot` page and the login link

Part of [`../plan.md`](../plan.md). Read its L9, L10, L28 and "Rules for every stage" (the Playwright rules) first. Needs stage 3. Starts after checkpoint A.

Two steps.

- [ ] **10.1 The page and its request**
  - Goal: a signed-out user can ask for a reset link; the page says the same thing for every address, and says plainly when reset by e-mail is off.
  - Files:
    - add `apps/web/src/pages/forgot.astro` (the shape of `setup.astro`), `apps/web/src/islands/ForgotPage.tsx`;
    - change `apps/web/src/lib/auth-requests.ts` (+ add `auth-requests.test.ts`), `apps/web/src/i18n/en.ts`, `apps/web/src/islands/LoginPage.tsx`;
    - change `packages/core/src/web/password.ts` (`forgotFormSchema`) and `password.test.ts`;
    - change `apps/server/src/platform/http.ts` (`PUBLIC_PAGE_PATHS`) and `http.test.ts`.
  - Interfaces:

    ```ts
    // packages/core/src/web/password.ts
    export const forgotFormSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email("email_invalid")) });

    // apps/web/src/lib/auth-requests.ts
    export type ResetRequestResult = "sent" | "off" | "too_many" | "error";
    export function resetRequestResult(status: number): ResetRequestResult; // 200 sent, 404 off, 429 too_many, else error
    export function requestPasswordReset(email: string): Promise<ResetRequestResult>;
    // POST /api/auth/request-password-reset, JSON { email, redirectTo: `${location.origin}/setup` }; a network error → "error"
    ```

  - Decisions (L28):
    - `PUBLIC_PAGE_PATHS` gets `/^\/forgot\/?$/`.
    - `ForgotPage`: an `AuthCard` with title `forgot_title`, the text `forgot_text`, the e-mail field (label `email_label`), the button `forgot_send` (`forgot_sending` while pending). The form parses with `forgotFormSchema` (field error `email_invalid`). Result `sent` → the form is replaced by `forgot_sent` and a link `go_to_sign_in` to `/login`; `off` → `forgot_off` (role `alert`) and the same link; `too_many` → `error_too_many`; `error` → `error_generic`.
    - `LoginPage`: under the form a link `login_forgot_link` to `/forgot`.
    - `en.ts` keys (exact): `title_forgot: "Reset password"`, `forgot_title: "Reset your password"`, `forgot_text: "Enter the e-mail address of your account. We send a link to set a new password."`, `forgot_send: "Send link"`, `forgot_sending: "Sending…"`, `forgot_sent: "If this address has an account, a link is on its way. It works for 1 hour."`, `forgot_off: "Reset by e-mail is off. Ask the operator for a new link."`, `login_forgot_link: "Forgot your password?"`.
  - Test:
    1. `password.test.ts`: `forgotFormSchema.parse({ email: "  A@X.Test " }).email === "a@x.test"`; `"nope"` → issue `email_invalid`.
    2. `auth-requests.test.ts`: `resetRequestResult` for 200, 404, 429, 500.
    3. `http.test.ts`: without a session `GET /forgot` is not redirected (with a test dist folder, as the existing `/setup` case does).
  - Check: `bun run test:unit`, `bun run web:build`.
  - Done when: the tests pass and the build passes.
  - Out of scope: reading the mail (stages 2–3 test the server side).

- [ ] **10.2 Playwright**
  - Goal: the page works in the built app without a session, in both projects.
  - Files: add `apps/web/e2e/tests/forgot.spec.ts`.
  - Decisions: the e2e server has no `AUTH_*` keys, so the request answers 404 and the page shows `forgot_off`. Use a fresh `x-forwarded-for` per test as `auth.spec.ts` does. Check CSP errors with `cspErrors` as the other specs do.
  - Test:
    1. Signed out, `goto("/forgot")` → the URL stays `/forgot`; the heading `forgot_title` shows.
    2. Enter `nobody@x.test`, press `forgot_send` → the alert `forgot_off` shows; a link to `/login` shows.
    3. Enter `nope` → the field error `email_invalid`; no request was sent (`page.on("request")` sees no `request-password-reset`).
    4. `/login` has the link `login_forgot_link`; a click opens `/forgot`.
    5. No CSP error on the page.
  - Check: Proof (web form, `/tmp/f082-s10`, specs `forgot.spec.ts auth.spec.ts`).
  - Done when: the Proof printed `PROOF_OK`.
  - Out of scope: the "sent" path in the browser (the e2e server has no sender).
