# F119 stage 05 — SSO session: mark, 12 h, operator rule

Part of [`../plan.md`](../plan.md). `[risky]` (auth). Needs stage 04.

## Step 05.1 — Mark and cap the SSO session

**Goal.** PD-043: a session made by SSO lasts at most 12 h, so a user disabled in the IdP loses access within 12 h (ADR 0026 point 7).

**Files.** `platform/auth.ts` (session options and `databaseHooks`), `platform/auth-sso.ts`.

**Interfaces.**
- Better Auth `session.additionalFields`: `signInMethod` (`sign_in_method`, `input: false`, default `"password"`) and `ssoStartedAt` (`sso_started_at`, date, `input: false`).
- `databaseHooks.session.create.before` (F7, `spike.md` S4):
  - `ctx.path` is the route template `/sso/callback/:providerId`, not the concrete path (spike C2): match with `startsWith("/sso/callback/")`, never with an exact path. That path → `signInMethod: "sso"`, `ssoStartedAt: now`, `expiresAt = now + SSO_SESSION_SECONDS`;
  - else, when the endpoint's current session (`ctx.context.session`, set for every endpoint that needs a session) is `sso` (TOTP turn-on, `/change-password` with `revokeOtherSessions`, F9; cold review B2) → copy its `signInMethod` and `ssoStartedAt`, `expiresAt = ssoStartedAt + SSO_SESSION_SECONDS` (the hook data already has `ssoStartedAt` but `signInMethod: "password"`, spike C5: set both);
  - else unchanged (`password`). A sign-in path never inherits (it has no current session).
- The stage 02 trigger keeps the cap through every refresh (F5). Each read of an SSO session then refreshes the row once (one UPDATE and a `Set-Cookie` per request; accepted, cold review N10).

**Decisions.** D6, D16.

## Step 05.2 — `WebSession.signInMethod` and the operator rule

**Goal.** F105 D27: the operator guard trusts the user's TOTP state only for sessions that passed the code step. An SSO session never did (F4).

**Files.** `platform/http.ts` (`WebSession`, `requireOperator`, the `/operator` page guard), `web.ts` (`getSession`), every test fake of `WebSession`.

**Interfaces.**
- `WebSession.signInMethod: "password" | "sso"` — from `response.session.signInMethod`: `"password"` → `"password"`; anything else, also a missing field → `"sso"` (fail closed: the stricter rule, cold review N11).
- `requireOperator` order: not an operator → 404 (unchanged); `signInMethod === "sso"` → `403 { error: "password_sign_in_required" }` and `log.warn("operator_sso_session_refused", { user_id })`; no TOTP → `403 two_factor_required` (unchanged).
- `/operator` page: not an operator → the 404 page (unchanged); SSO session → the 404 page and the same warn line; no TOTP → the redirect of F105 (unchanged).
- `/api/me` and every other route: unchanged in this stage.

**Decisions.** D7.

**Test** (`apps/server/test/integration/web-sso-session.test.ts`, new; `http.test.ts` unit):

1. Ann signs in by SSO: her row has `sign_in_method = 'sso'`, `sso_started_at` set, `expires_at` within 5 s of it + 12 h.
2. Ann signs in with a password (she has one): `sign_in_method = 'password'`, `expires_at` about `now + 30 days`.
3. Refresh: move Ann's `sso_started_at` back 2 h by SQL, then `GET /api/auth/get-session` (F5 fires): `expires_at` is `sso_started_at + 12 h`, not 30 days.
4. `sso_started_at` back 11 h 59 min: `GET /api/me` 200. Back 12 h 1 min: `GET /api/me` 401.
5. Ann (SSO session, a password, `sso_started_at` 2 h back) turns TOTP on; in a second run changes the password with `revokeOtherSessions`; in a third turns TOTP off (`/two-factor/disable`, S4): the new session is `sso` with the same `sso_started_at` and `expires_at` = that + 12 h.
6. A password session with `created_at` 13 h back: `GET /api/me` 200.
7. Operator Olga (in `OPERATOR_USER_IDS`, TOTP on, member of org A, linked by SSO): SSO session → `GET /api/operator/orgs` 403 `password_sign_in_required` and one `operator_sso_session_refused` line; `GET /operator` → the 404 page.
8. Olga with password and TOTP code: `GET /api/operator/orgs` 200.
9. Ann (not an operator) with an SSO session: `/api/operator/orgs` 404 (the 404 check stays first).
10. Ann has TOTP on and signs in by SSO: a session, no code step, no `web.login` row, one `sso.login` row (S6).
11. Unit: the page guard and `requireOperator` with a fake `{ signInMethod: "sso" }` give the answers of 7; `getSession` mapping of `undefined` and `"x"` gives `"sso"`.

No test asserts the cookie `Max-Age` (30 days on each refresh; the row decides the end; spike C4).

**Check.** The Proof of `plan.md` (`/tmp/f119-s05`).

**Done when.** The eleven tests pass; every `WebSession` fake has `signInMethod`; Proof prints `PROOF_OK`.

**Out of scope.** "SSO required" (stage 06), the Account card (stage 13).
