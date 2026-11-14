# F106 stage 03 — The route `DELETE /api/organization`

Part of [`../plan.md`](../plan.md). `[risky]` (auth, data delete).

## Step 1 — the flag, the route and its guards

**Goal.** An owner deletes the organization from the panel with the password and the typed name; nobody else can.

**Files.** `packages/core/src/features.ts` (flag); `packages/core/src/web` (request and response schemas); `modules/privacy/routes.ts` (new, `privacyRoutes`); `apps/server/src/web.ts` (`apiRouters`, the password dep); `platform/http.ts` (`SUSPENDED_WRITE_ALLOW`).

**Interfaces.**

- Flag `org_delete`: `{ default: false, description: "Delete the organization in the Account card (owners).", epic: "E7-T3", removeBy: "2027-03-01" }`. Stage 04 reads it from `/api/me` `features`.
- `orgDeleteRequestSchema = z.object({ password: z.string().min(1).max(128), confirmName: z.string().min(1).max(200) })`; `orgDeleteResponseSchema = z.object({ mailboxAddresses: z.array(z.string()) })` in `@ea/core/web`.
- `PrivacyRouteDeps.verifyPassword(headers: Headers, password: string): Promise<boolean>`: `web.ts` fills it with `auth.api.verifyPassword({ body: { password }, headers })` (plan F4); `APIError` with `INVALID_PASSWORD` → false; any other error is thrown (500).
- `recordPasswordFailure(deps: { lockout: LockoutStore; now: () => Date; onEvent: AuthDeps["onEvent"]; sendLockoutMail?: AuthDeps["sendLockoutMail"] }, user: { id: string; email: string }): Promise<void>`, exported from `platform/auth-lockout.ts`: the body of the private sign-in failure counting in `platform/auth.ts` (count, lock, `web.login_locked` event, lock mail rule), moved out of the hook. The sign-in hook and the route both call it (review 1, N10). `PrivacyRouteDeps` gets `lockout` and this function's deps from `web.ts`.
- `ApiErrorCode` (core) gets `wrong_name`, `wrong_password` and `locked`; stage 04 maps them to texts.
- `SUSPENDED_WRITE_ALLOW` gets `{ method: "DELETE", path: /^\/api\/organization$/ }` (S6a decision S2: a paused account can still delete itself).

**Decisions.** D4, D14, D17, P6. The order of checks, each answer final:

1. Session and tenant (existing `/api` guards).
2. `requireOwner` → `403 owner_only`.
3. Flag `org_delete` off for the organization → `404 not_found`.
4. Body invalid → the answer that the other `/api` write routes give for a bad body.
5. `orgNameMatches(name, confirmName)` false → `400 wrong_name`. No audit row, no lockout count.
6. `lockout.isLocked(userId)` → `429 locked`.
7. `verifyPassword` false → `recordPasswordFailure`, write `org.delete_refused` with `{ reason: "wrong_password", via: "web" }` and the user id as actor, `400 wrong_password`.
8. `deleteOrganization({ via: "web" })`; `not_found` → `404 not_found`; `name_mismatch` (renamed in between) → `400 wrong_name`; `deleted` → `200 { mailboxAddresses }` with a `Set-Cookie` that expires the Better Auth session cookie (`ea.session_token` with the attributes Better Auth sets; the worker reads the name from Better Auth at `HEAD`).

A right password does not reset the lockout counter (only a sign-in does). The password, the typed name and the organization name never reach a log line, an error text or an audit row.

**Test** (integration, `privacy-routes.test.ts`, with `web-helpers.ts`; each request with a fresh `x-client-ip`):

1. Owner, flag on, right password and name `"acme test"` for "Acme Test" → 200, addresses sorted, the org is gone, the session cookie is expired, and the next `GET /api/me` with the old cookie → 401.
2. Flag off → 404; the org stays.
3. Member with role `assistant` (seeded by SQL) → 403 `owner_only`.
4. Wrong name → 400 `wrong_name`; no `org.delete_refused` row; the lockout count is unchanged.
5. Wrong password → 400 `wrong_password`; one `org.delete_refused` row; `auth_lockouts.failed_count` is 1.
6. Ten wrong passwords → the tenth locks (same rule as sign-in); the 11th request with the right password → 429 `locked`; the org stays.
7. Organization `suspended` → the delete works (200).
8. Route matrix: in a `suspended` organization every other write route still answers 403 `org_suspended` (extend the existing matrix test, do not copy it).
9. Missing `Origin` → 403 `bad_origin` (existing guard; one case).
10. Log and response capture of tests 1–6 hold no password, no "Acme" and no `@x.test` outside the 200 body of test 1.

**Check.** `bun test apps/server/test/integration/privacy-routes.test.ts` and the route-matrix test file.

**Done when.** Tests 1–10 pass, `docs/capabilities` are not touched yet, and the plan Proof (server chain) prints `PROOF_OK`.

**Out of scope.** The dialog (stage 04); the security-log kind (stage 10).
