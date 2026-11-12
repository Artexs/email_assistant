# F082 stage 07 — Terms on the server: `TERMS_VERSION`, the reset hook, `/api/me` terms, `POST /api/me/terms` [risky]

Part of [`../plan.md`](../plan.md). Read its F2, F5, L15–L17, L29, L30, B5 and "Rules for every stage" first. Needs stages 1 (`setUserTerms`), 4 (`invite-delivery.ts`) and 6 (the hook order).

Parallel: lane A, last; after stages 4 and 6. Stage 8 may run at the same time.

One step. After this stage every `/reset-password` call must carry `termsVersion`; this stage updates every caller, so the web setup keeps working before stage 11 adds the checkbox. Until stage 11 lands, the setup page sends the version without a checkbox; that is accepted because no deploy happens before stage 15.

- [ ] **7.1 One request sets the password and records the accepted terms**
  - Goal: no password is set without the current terms; the accepted version and time are stored with an audit row; the panel can see and record the acceptance.
  - Files:
    - add `packages/core/src/web/terms.ts` (+ `terms.test.ts`); change `packages/core/src/web/index.ts`, `me.ts`, `me.test.ts`, `errors.ts` (`"terms_outdated"`) and its test;
    - change `apps/server/src/platform/auth.ts` (`AuthDeps.onTermsAccepted`, `hooks.before`, `onPasswordReset`);
    - change `apps/server/src/modules/audit/repo.ts` (`webTermsAccepted: "web.terms_accepted"`, data `via`, `version`);
    - change `apps/server/src/modules/tenancy/routes.ts` (`/me` terms, `POST /me/terms`);
    - change `apps/server/src/platform/http.ts` (`SUSPENDED_WRITE_ALLOW`);
    - change `apps/server/src/web.ts` (`termsAcceptedHandler`, wiring);
    - change every `createAuth` caller (`onTermsAccepted`) and every `resetPassword` caller (`termsVersion`): `grep -rln "createAuth(\|resetPassword\|reset-password" apps packages --include=*.ts --include=*.tsx` — at least `scripts/invite-delivery.ts`, `scripts/e2e-seed.ts`, `platform/auth.test.ts`, `web-auth.test.ts`, `web-auth-logs.test.ts`, `web-invite-cli.test.ts`, `web-schema.test.ts`, `web-http.test.ts`, `web-reset-request.test.ts`, `web-lockout.test.ts`, `web-pwned.test.ts`, and every test or web file that builds a `Me` object;
    - add `apps/web/src/lib/auth-requests.ts`; change `apps/web/src/lib/password-errors.ts` (+ test), `apps/web/src/islands/SetupPage.tsx`, `apps/web/src/i18n/en.ts`;
    - add `apps/server/test/integration/web-terms.test.ts`.
  - Interfaces:

    ```ts
    // packages/core/src/web/terms.ts
    export const TERMS_VERSION = "2026-11-12"; // S6e changes it with every change of the legal texts
    export const termsAcceptBodySchema = z.object({ version: z.string().min(1).max(40) });
    // me.ts — meSchema gets:
    terms: z.object({ accepted: z.boolean(), current: z.string() }),

    // platform/auth.ts — AuthDeps
    onTermsAccepted: (userId: string, version: string) => Promise<void>; // required; never throws into Better Auth

    // web.ts — one transaction: setUserTerms + audit row web.terms_accepted in the oldest organization. Never throws (log.error).
    export function termsAcceptedHandler(db: Db, now: () => Date): AuthDeps["onTermsAccepted"];

    // apps/web/src/lib/auth-requests.ts
    export type SetPasswordResult = { ok: true } | { ok: false; status: number; code: string | null };
    export function setPasswordWithTerms(input: { token: string; newPassword: string }): Promise<SetPasswordResult>;
    ```

  - Decisions:
    - `hooks.before` on `/reset-password`, always (no dep switch), first in that path's checks: `ctx.body?.termsVersion !== TERMS_VERSION` → `throw APIError.from("BAD_REQUEST", { code: "TERMS_REQUIRED", message: "Accept the terms first." })`. The pwned check (stage 6) runs after it (L16).
    - `onPasswordReset`: after `report("password_set", …)` and the lockout clear: `await deps.onTermsAccepted(user.id, TERMS_VERSION)` inside `try`/`catch` (`log.error(\`web: terms record failed for user ${user.id}: ${describeError(error)}\`)`). The hook already proved the request held the current version (F5: the body is not readable here).
    - `termsAcceptedHandler`: `listMembershipsOfUser` → oldest; then `db.transaction()`: `setUserTerms(trx, userId, version, now())` and, when a membership exists, `recordAudit(trx, { orgId }, { event: auditEvents.webTermsAccepted, actor: userId, data: { via: "web", version } })`.
    - `GET /me`: `terms: { accepted: profile?.termsVersion === TERMS_VERSION, current: TERMS_VERSION }` (`getUserAuthProfile`).
    - `POST /me/terms` (any member, in `tenancyRoutes`): `parseBody(c, termsAcceptBodySchema)`; `version !== TERMS_VERSION` → `409 { error: "terms_outdated" }`; else one transaction: `setUserTerms(trx, userId, TERMS_VERSION, deps.now())` and the audit row in the session's organization (`c.get("ctx")`); answer `204`.
    - `SUSPENDED_WRITE_ALLOW` gets `{ method: "POST", path: /^\/api\/me\/terms$/ }` (a paused account can still accept the terms; it changes no mail and no organization data).
    - Every `createAuth` caller passes `onTermsAccepted: termsAcceptedHandler(db, () => new Date())` — the server, `invite-delivery.ts`, the e2e seed (so the seeded users get `TERMS_VERSION`, which stage 12 needs) and the tests (or a recording fake where the test checks it).
    - Callers of `auth.api.resetPassword` build the body in a variable first, so the extra field passes the type check: `const body = { newPassword, token, termsVersion: TERMS_VERSION }; await auth.api.resetPassword({ body });`.
    - `setPasswordWithTerms` (L29): `fetch("/api/auth/reset-password", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ newPassword, token, termsVersion: TERMS_VERSION }) })`; `res.ok` → `{ ok: true }`; else read the JSON `code` (or `null`). `SetupPage` uses it in place of `authClient.resetPassword`. `lib/password-errors.ts` gets `setupError(status, code)` → `"invalid"` (code `INVALID_TOKEN`) or a `TextKey`: 429 → `error_too_many`, `TERMS_REQUIRED` → `terms_required`, `PASSWORD_COMPROMISED` → `password_pwned`, 503 / `PASSWORD_CHECK_UNAVAILABLE` → `password_check_unavailable`, else `error_generic`. `en.ts`: `terms_required: "Accept the terms to continue."`.
  - Test (`web-terms.test.ts`, `createAuth` as in `web-auth.test.ts`, plus route tests with `webTestApp`):
    1. A reset without `termsVersion` → `400` code `TERMS_REQUIRED`; the old password still signs in; `users.terms_version` stays `NULL`; the same token then works with the field.
    2. `termsVersion: "2000-01-01"` → `400 TERMS_REQUIRED`.
    3. `termsVersion: TERMS_VERSION` → `200`; `terms_version = TERMS_VERSION`, `terms_accepted_at` not null; one `web.terms_accepted` row with `data.version = TERMS_VERSION`.
    4. Without the field and with a recording `pwnedCheck` → the check was not called.
    5. `onTermsAccepted` that throws → the reset still answers `200`; one `log.error` line with the user id and no address.
    6. `GET /api/me` of a user with `terms_version` `NULL` → `terms = { accepted: false, current: TERMS_VERSION }`; after test 7 → `accepted: true`.
    7. `POST /api/me/terms` `{ version: TERMS_VERSION }` → `204`, the columns set, one audit row; `{ version: "2000-01-01" }` → `409 { error: "terms_outdated" }`, nothing changes; `{}` → `400 validation`; no session → `401`.
    8. A suspended organization (`suspendOrg`): `POST /api/me/terms` → `204`; `PATCH /api/organization` → still `403 org_suspended`.
    9. `packages/core`: `meSchema` parses an object with `terms`; `termsAcceptBodySchema` refuses `{ version: "" }`.
    10. `password-errors.test.ts`: every `setupError` mapping above.
    11. `e2e-seed.test.ts` (existing) still passes: the seed sets passwords with the terms.
  - Check: Proof (web form, `/tmp/f082-s07`, specs `auth.spec.ts`; the job's own e2e DB): the setup page now posts through `setPasswordWithTerms`.
  - Done when: the tests pass, every hit of `grep -rn "resetPassword(\|reset-password\"" apps --include=*.ts --include=*.tsx` sends `termsVersion` (or is the route itself), and the Proof printed `PROOF_OK`.
  - Out of scope: the checkbox and the legal pages (stage 11); the dialog (stage 12).
