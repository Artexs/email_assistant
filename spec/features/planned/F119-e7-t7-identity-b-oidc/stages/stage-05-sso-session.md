# F119 stage 05 — SSO session: mark, 12 h, operator rule

Part of [`../plan.md`](../plan.md). `[risky]` (auth). Needs stage 04.

## Step 05.1 — Mark and cap the SSO session

**Goal.** PD-043: a session made by SSO lasts at most 12 h, so a user disabled in the IdP loses access within 12 h (ADR 0026 point 7).

**Files.** `platform/auth.ts` (session options and `databaseHooks`), `platform/auth-sso.ts`.

**Interfaces.**
- Better Auth `session.additionalFields.signInMethod`: `{ type: "string", fieldName: "sign_in_method", input: false, defaultValue: "password" }`.
- `databaseHooks.session.create.before`: when the endpoint context path starts with `/sso/callback/` (F7, `spike.md` S4), return the session data with `signInMethod: "sso"` and `expiresAt = now + SSO_SESSION_SECONDS`. Any other path: unchanged. No context (a CLI or a server call without an endpoint): unchanged (`password`).
- The stage 02 trigger keeps the cap through Better Auth's refresh (F5); this stage adds no other cap code.

**Decisions.** D6, D16.

## Step 05.2 — `WebSession.signInMethod` and the operator rule

**Goal.** F105 D27: the operator guard trusts the user's TOTP state only for sessions that passed the code step. An SSO session never did (F4).

**Files.** `platform/http.ts` (`WebSession`, `requireOperator`, the `/operator` page guard), `web.ts` (`getSession`), every test fake of `WebSession`.

**Interfaces.**
- `WebSession.signInMethod: "password" | "sso"` — from `response.session.signInMethod`: `"sso"` → `"sso"`, any other value → `"password"` (the column CHECK allows only the two).
- `requireOperator` order: not an operator → 404 (unchanged); `signInMethod === "sso"` → `403 { error: "password_sign_in_required" }` and `log.warn("operator_sso_session_refused", { user_id })`; no TOTP → `403 two_factor_required` (unchanged).
- `/operator` page: not an operator → the 404 page (unchanged); SSO session → the 404 page and the same warn line; no TOTP → the redirect of F105 (unchanged).
- `/api/me` and every other route: unchanged in this stage.

**Decisions.** D7.

**Test** (`apps/server/test/integration/web-sso-session.test.ts`, new; `http.test.ts` unit):

1. Ann signs in by SSO: her `auth_sessions` row has `sign_in_method = 'sso'` and `expires_at` within 5 s of `created_at + 12 h`.
2. Ann signs in with a password (she has one): `sign_in_method = 'password'`, `expires_at` about `now + 30 days`.
3. Refresh: move Ann's SSO row `created_at` back 2 h by SQL, then `GET /api/auth/get-session` (the refresh rule of F5 fires: `expiresAt − 30 d + 1 d` is in the past): the row's `expires_at` is still `created_at + 12 h`, not 30 days.
4. Move the SSO row `created_at` back 11 h 59 min (trigger recomputes the cap): `GET /api/me` answers 200.
5. Move it back 12 h 1 min: `GET /api/me` answers 401 and the row is gone after `GET /api/auth/get-session`.
6. A password session with `created_at` 13 h back: `GET /api/me` answers 200.
7. Operator Olga (in `OPERATOR_USER_IDS`, TOTP on, member of org A, linked by SSO): SSO session → `GET /api/operator/orgs` 403 `password_sign_in_required` and one `operator_sso_session_refused` line; `GET /operator` → the 404 page.
8. Olga with password and TOTP code: `GET /api/operator/orgs` 200.
9. Ann (not an operator) with an SSO session: `/api/operator/orgs` 404 (the 404 check stays first).
10. Ann has TOTP on and signs in by SSO: a session, no code step, no `web.login` row, one `sso.login` row (S6).
11. Unit: the page guard and `requireOperator` with a fake session `{ signInMethod: "sso" }` give the answers of 7.

**Check.** The Proof of `plan.md` (`/tmp/f119-s05`).

**Done when.** The eleven tests pass; every `WebSession` fake has `signInMethod`; Proof prints `PROOF_OK`.

**Out of scope.** "SSO required" (stage 06), the Account card (stage 12).
