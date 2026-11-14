# F105 plan — Identity A: TOTP, backup codes, break-glass owner

> **Status 2026-11-14 — planned.** Plan base: cf125cf, refreshed 2026-11-14 (first base 163c7b2; [plan-refresh-1.md](plan-refresh-1.md), [plan-refresh-2.md](plan-refresh-2.md)). Fifteen stages written; cold review 1 applied (§ Cold review). Build after the public login ticket (F082, done).

Workers read `ticket.md`, this file and their one stage file. **A gap or a deviation is a question in the final message, not a choice:** the coordinator decides from § Input or asks the owner.

## Planning progress

- [x] Collect (2026-11-14): epic page E07, discovery notes §3, §8, §11, ADR 0026, ADR 0027, PD-037–PD-050, `05-execution-plan.md` §2, `spec/build.md`, the F082 plan (done), the F098 and F099 plans and stages (in build), `.agents/limen/styleguide.md`, `docs/code-patterns.md` § Data access and § Logs, `docs/architecture.md` §7, `docs/capabilities/web-panel.md`, and the code at 163c7b2 (`platform/auth.ts`, `platform/http.ts`, `web.ts`, `modules/tenancy/*`, `modules/audit/repo.ts`, `scripts/org-flag.ts`, `scripts/web-invite.ts`, `scripts/e2e-seed.ts`, the web islands `LoginPage`, `AccountCard`, `lib/auth-client.ts`, `lib/password-errors.ts`, the e2e helpers, the migrations, `test/integration/web-helpers.ts`, `web-auth.test.ts`, `web-lockout.test.ts`).
- [x] Facts checked: probes P1–P6 in `.probe-f105/` of the planning worktree (removed after the job): Better Auth 1.7.18 with the repo's real migrations on a throwaway Postgres 18 cluster.
- [x] Decisions P1–P5, D1–D28; small defaults in [questions.md](questions.md).
- [x] Stage files 01–15 written (stage 05 split into 05 and 06 after the cold review).
- [x] Committed (explicit paths).
- [x] Cold review 1 (coordinator's review job): PASS with notes, filed as [plan-review-1.md](plan-review-1.md); N1–N9 applied (§ Cold review).
- [x] Refresh 1 (2026-11-14, base 163c7b2 → ff61cbc): the code of F092, F097, F098, F099 and F100 checked against every stage; [plan-refresh-1.md](plan-refresh-1.md). No stage changed in substance, so no second review.
- [x] Refresh 2 (2026-11-14, base ff61cbc → cf125cf): F097 stage 04 and F100 stage 04 checked against every stage; the stage 01 migration version fixed (`20261114120001` is taken); [plan-refresh-2.md](plan-refresh-2.md). No stage changed in substance, so no review.

## Input

The owner's words (word for word):

- 2026-11-13, E7 discovery, all decisions: "Okay, so go with the default values" (PD-037–PD-050).
- PD-042: "Identity order: identity A (TOTP, backup codes, break-glass owner) right after F082; identity B (OIDC) after its spike; identity no longer waits for E4."
- PD-043: "TOTP optional for members, required for operators and the break-glass owner of an "SSO required" organization; an SSO session lasts at most 12 h (offboarding bound)."
- PD-048: "Owner security log in the Account card: sign-ins, lockouts, password and 2FA changes, sessions ended, export, delete, DSR (from audit rows)."
- Discovery notes §8 (accepted with the defaults): "Better Auth `two-factor` plugin (inside `better-auth`, W6): TOTP with backup codes, trusted device 30 days. Optional for members; required for operators and for the break-glass owner of an organization with "SSO required". Enrolment and removal in the Account card; audit rows; the deletion test covers the new tables."
- Discovery notes §7: "Once TOTP exists, an operator must have it."
- ADR 0026 (proposed) point 1: "TOTP through the Better Auth `two-factor` plugin, with backup codes. Optional for members. Required for operators (ADR 0027) and for the break-glass owner of an organization with "SSO required"." Point 6: "… except one break-glass owner who signs in with password and TOTP." Point 8: "… TOTP on and off, backup code used: one audit row each, with ids and codes only."
- Owner decision 2026-11-13 (`notes/2026-11-13-limen-planner-role.md`): "Planners: do not add owner checkpoints for review or confirmation; list an owner step only for what needs the owner's hands (VPS, deploy, real secrets, real money)."
- This planning job (2026-11-14): "Read the CURRENT code (F082 closed; F098 and F099 are in build: avoid their files where you can and note overlaps as advisory). … At most one migration per stage; tell the coordinator which stages have one."

### Product decisions (from the pages above)

- **P1 TOTP is optional for members** and required for operators and for the break-glass owner (PD-043). Required means: an operator without TOTP cannot use the console (D10); a member without TOTP cannot become the break-glass owner, and the break-glass owner cannot turn TOTP off (D11, D12).
- **P2 No spike** (PD-042): the plugin ships inside the pinned `better-auth`; this plan's probes checked it on the repo's schema (§ Facts checked).
- **P3 Backup codes and a 30-day trusted device** (discovery §8, W6). Ten single-use codes. Enrolment, new codes and removal in the Account card.
- **P4 One break-glass owner per organization** (ADR 0026 point 6). Identity A stores the designation and keeps its TOTP rule. The sign-in exception for "SSO required" organizations is identity B (F119): it reads this designation.
- **P5 Audit rows** for TOTP on, off, reset, backup codes made and used, the code lock, the break-glass change, and the second factor of each sign-in (ADR 0026 point 8). The security log shows them (PD-048).

## Differences found at collect (2026-11-14)

1. The §2.1 row 11 says "≈ 4" stages. This plan has 15: the discovery count left out the login step, the QR code, the operator rule, the reset CLI, the e2e spec, the security-log kinds, docs and the VPS stage. Most stages keep one `[risky]` step or 2–4 normal steps; stages 04 and 07 are `[risky]` with two steps each, because their first step is a small typed change that the second step needs (§ Cold review, N4).
2. ADR 0026 ties the break-glass owner to "SSO required", which does not exist before identity B. Identity A makes the designation and its TOTP rule (P4); nothing at sign-in changes for a break-glass owner now.
3. The security-log registry `packages/core/src/security-log.ts` (F099 stage 12) is not on `master` at the plan base; its commit is on a job branch. Stage 13 of this plan waits for F099 stages 12 and 13. Resolved at refresh 1: F099 stages 12 (c18c07a) and 13 (b6fa717) are on `master`; the registry has the shape that stage 13 expects.
4. `apps/web/src/i18n/pl.ts` does not exist at the plan base (F098 stage 02 adds it). The web stages give en and pl texts for every key (D20). Resolved at refresh 1: `pl.ts` is on `master` (F098 stage 02) and its type `Record<TextKey, string>` makes every key required.
5. `platform/auth.ts` has 500 lines. The 2FA code goes into a new file `platform/auth-two-factor.ts` (D4).
6. The `web.login` audit row comes from `databaseHooks.session.create.after` on `/sign-in/email`. With the plugin, that hook also fires for a sign-in that still waits for its code (Fact F3). Stage 02 moves the row (D5).
7. `web.ts` has old-form log lines. New lines are events (`docs/code-patterns.md` § Logs: "A new log line in any file is an event from now on").
8. This worktree has no `node_modules`; the facts were read in the main checkout's `node_modules` (`better-auth` 1.7.18, the version in `bun.lock`).

## Facts checked (2026-11-14; `better-auth` 1.7.18, `@better-auth/utils` 0.5.1; probes on a throwaway Postgres 18.6 cluster with every repo migration applied, plus the draft SQL of stage 01)

- **F1 Plugin schema.** The `two-factor` plugin adds `user.twoFactorEnabled` (boolean, default false) and a model `twoFactor` with `secret`, `backupCodes`, `userId`, `verified`, `failedVerificationCount`, `lockedUntil` (`plugins/two-factor/schema.mjs`). The option `schema: { user: { fields: { twoFactorEnabled: "two_factor_enabled" } }, twoFactor: { modelName: "auth_two_factors", fields: { userId: "user_id", backupCodes: "backup_codes", failedVerificationCount: "failed_verification_count", lockedUntil: "locked_until" } } }` works with the `pg` pool and the Kysely adapter (probe P1: enable, verify, sign-in, backup code, disable all passed; `incrementOne` works). `tsc --strict` accepts these options, the client calls of D15, `auth.api.viewBackupCodes`, `getSession().user.twoFactorEnabled`, and a trailing plugin typed `satisfies BetterAuthPlugin` that uses `createAuthMiddleware`, `ctx.getSignedCookie`, `adapter.findOne` and `adapter.deleteMany` (probe P5).
- **F2 Enrolment.** `POST /two-factor/enable { password }` (a session and the password; `method` defaults to `totp`) returns `{ method: "totp", totpURI, backupCodes }` and writes the row with `verified: false`; `users.two_factor_enabled` stays false. The URI is `otpauth://totp/Email Assistant:<email>?secret=<base32, 52 characters>&issuer=…&digits=6&period=30`. `POST /two-factor/verify-totp { code }` with the session sets `verified: true` and `two_factor_enabled: true` and replaces the session (a new session row and cookie). A second `enable` while the row is verified answers `400 TOTP_ALREADY_ENABLED`; while it is not verified, it overwrites the row. `method: "otp"` answers `400 OTP_NOT_CONFIGURED` (no `sendOTP`). The secret and the backup codes are stored encrypted with the auth secret (`symmetricEncrypt`, `storeBackupCodes: "encrypted"` default).
- **F3 Sign-in with a second factor.** `POST /sign-in/email` with the right password for a user with TOTP answers `200 { twoFactorRedirect: true, twoFactorMethods: ["totp"] }`, sets only the signed cookie `ea.two_factor` (10 min), and deletes the session it made. Hook order (`api/dispatch.mjs` `getHooks`): the user `hooks.after` runs first and still sees `ctx.context.newSession` (with `user.twoFactorEnabled: true`); the plugin's after hook then deletes the session and sets `newSession` to null; a plugin listed after `twoFactor` sees `newSession: null` and `returned.twoFactorRedirect: true`. `databaseHooks.session.create.after` fires with `ctx.path = "/sign-in/email"` before the plugin deletes the session (probe P1, case 7).
- **F4 The code step.** `POST /two-factor/verify-totp { code, trustDevice? }` and `POST /two-factor/verify-backup-code { code, trustDevice? }` with the `ea.two_factor` cookie make the session (`databaseHooks.session.create` with the verify path). In an after hook, `ctx.context.session` is null on this sign-in path and set on the enrolment path, where its `user.twoFactorEnabled` is still `false` (the snapshot from before the request); `ctx.context.newSession` is set after success on both (probes P2, P6). A backup code works once (`401 INVALID_BACKUP_CODE` on reuse; 9 left after one use, `auth.api.viewBackupCodes({ body: { userId } })`, server only). The same TOTP code works again inside its window (no replay guard; probe P1 case 9). Codes match at ±1 step of 30 s (`@better-auth/utils/otp` `verifyTOTP`, `window = 1`), with `Date.now()`.
- **F5 Code limits.** Per challenge: 5 wrong codes, then `400 TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` and the challenge ends (`401 INVALID_TWO_FACTOR_COOKIE` after). Per account: `accountLockout` default 10 consecutive failed sign-in codes → `locked_until = now + 900 s`; while locked every verify answers `429 ACCOUNT_TEMPORARILY_LOCKED`, also a correct code (probe P1 cases 13–15). Codes checked with a session (enrolment) do not count. The plugin's rate limit is 3 requests per 10 s per client address on `/two-factor/*` (fourth: 429; probe P1 case 12). The plugin uses `Date.now()`, not `AuthDeps.now`.
- **F6 Trusted device.** `trustDevice: true` stores a row in `auth_verifications` (`value` = user id, identifier hashed) for `trustDeviceMaxAge` (default 2 592 000 s) and sets the signed cookie `ea.trust_device`. A later `/sign-in/email` with that cookie returns a session at once, and the plugin renews the row (probe P2 case 4). `ctx.context.adapter.deleteMany({ model: "verification", where: [{ field: "value", value: userId }] })` deletes these rows (probe P4). The identifiers are hashed (`storeIdentifier: "hashed"`), so rows are found only by `value`. `/sign-out` keeps the `ea.trust_device` cookie (`cookies/index.mjs` `deleteSessionCookie` expires only the session cookies), and "sign out everywhere" ends sessions, not trust rows.
- **F7 Turn off and new codes.** `POST /two-factor/disable { password }` needs a live session (`sensitiveSessionMiddleware`, `api/routes/session.mjs:304`: an authoritative session only, no age check; `SESSION_NOT_FRESH` comes only from `freshSessionMiddleware`) and the password (`400 INVALID_PASSWORD`). Corrected after cold review 1 (N2); the first text said a fresh session was needed. It sets `two_factor_enabled: false`, deletes the row, replaces the session, and deletes only this device's trust row. `POST /two-factor/generate-backup-codes { password }` returns 10 new codes and replaces the old ones (probe P1 cases 16–17). `POST /two-factor/get-totp-uri { password }` re-shows the secret.
- **F8 Challenge user.** In an after hook of a failed sign-in verify, `ctx.getSignedCookie(ctx.context.createAuthCookie("two_factor").name, ctx.context.secret)` gives the challenge id and `ctx.context.internalAdapter.findVerificationValue(id)` gives `value` = the user id (probe P3). `ctx.context.adapter.findOne({ model: "twoFactor", where: [{ field: "userId", value }] })` returns `failedVerificationCount` and `lockedUntil` (probe P4).
- **F9 Session read.** `auth.api.getSession` returns `user.twoFactorEnabled` (probe P1 cases 2 and 6). No cookie cache is set (`docs/architecture.md` §7), so a change shows at the next request.
- **F10 Password reset and 2FA.** `/reset-password` does not sign in, so a reset link does not skip the code; `/change-password` keeps 2FA on and replaces the session (probe P2 case 5).
- **F11 QR code.** `uqr` 0.1.3 (MIT, no dependencies, npm 2026-11-14): `encode(text, { ecc: "M", border: 2 })` returns `{ size, data: boolean[][] }`; for a 152-character `otpauth` URI, version 8 and size 53 (probe P5 in a separate folder). No QR library is in `bun.lock` today.
- **F12 Repo.** `AUTH_ALLOWED_PATHS` (`platform/auth.ts:54`) lists 7 paths; `/two-factor/*` answers 404 today. `memberships.role` is `owner` or `assistant`; no code changes a role or deletes a membership (`grep updateTable("memberships")`: only `setDigestTimes`). `requireOperator` and the `/operator` page guard read `web.operatorUserIds` (`platform/http.ts:270`, `:394` at ff61cbc). `WebSession` is built in `web.ts:349` (`getSession`) and in test fakes (`test/integration/web-helpers.ts:40`, `web-http.test.ts:63,65,195`, `src/platform/http.test.ts:262,300,355,399,430` at ff61cbc). The RLS test checks only tables with `org_id` (`test/integration/rls-policy.test.ts` test 1). E2e address blocks in use at ff61cbc: 10, 20, 30, 40, 60, 70, 80, 90, 100 (+100 for desktop); 50 and 150 are free.
- **F13 RLS (F092, landed after the first base).** `memberships` and `organizations` have the `tenant_rows` policy for `app` (`db/migrations/20261114100002_rls_tenant_policies.sql`): with `app.org_id` set, a query sees only that organization's rows; with it empty, every row. `requireTenant` runs the rest of each `/api` request in the tenant scope of the session's organization; `requireOperator` runs operator routes with no scope (`withoutTenantScope(() => next())`, `platform/http.ts:277`). `/api/auth/*` (the Better Auth handler), the CLIs and the jobs run with no scope (`docs/architecture.md` §5). Better Auth uses its own `pg` pool (`platform/auth.ts:487`), which the scoped driver never touches. Only `platform/http.ts` and `platform/scheduler.ts` may call the scope functions (`apps/server/src/platform/tenant-scope-sites.test.ts`). The `users` and `auth_*` tables have no policy.

## Not verified (the stage that checks it)

- The plugin's behaviour under two parallel enrolments of one user: stage 01 adds `UNIQUE (user_id)`, so the second insert fails; stage 02 test 15 checks that the answer is a 500 with no second row and no log line with a secret.
- The QR code scans in a real authenticator app (Google Authenticator, Aegis, 1Password): stage 15 (owner step U1 on the owner's phone).
- `uqr` in the Astro build (ESM import in a client island): stage 10 runs `bun run web:build`.

## Decisions (D1–D27)

**Plugin and data**

- **D1 Plugin options** (stage 02, `platform/auth-two-factor.ts`): `twoFactor({ issuer: "Email Assistant", trustDeviceMaxAge: 2_592_000, accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 }, backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: "encrypted" }, schema: <F1> })`. No `otpOptions` (no e-mail codes: the auth-mail sender is off on the VPS), no `allowPasswordless`, no `skipVerificationOnEnable`. The numbers are constants `TWO_FACTOR_LOCK = { maxFailedAttempts: 10, durationSeconds: 900 }`, `TRUST_DEVICE_SECONDS = 2_592_000`, `BACKUP_CODE_COUNT = 10`. Why: P2, P3, F2, F5. Rejected: own TOTP code (more security code to own); e-mail codes.
- **D2 Schema** (stage 01, one migration): `users.two_factor_enabled boolean NOT NULL DEFAULT false`; table `auth_two_factors` (`id uuid PK`, `user_id uuid NOT NULL UNIQUE REFERENCES users ON DELETE CASCADE`, `secret text NOT NULL`, `backup_codes text NOT NULL`, `verified boolean NOT NULL DEFAULT false`, `failed_verification_count integer NOT NULL DEFAULT 0 CHECK (>= 0)`, `locked_until timestamptz`, `created_at timestamptz NOT NULL DEFAULT now()`); `memberships.break_glass boolean NOT NULL DEFAULT false` with `CHECK (NOT break_glass OR role = 'owner')` and a partial unique index `(org_id) WHERE break_glass`. Exact SQL in stage 01. No `org_id` in `auth_two_factors`: it belongs to a user and goes with the user by cascade (like `auth_lockouts`). Why: F1, P4. Rejected: `organizations.break_glass_user_id` (it can point at a non-member and needs a trigger when a membership goes; the membership column goes with the membership).
- **D3 Allow-list** (stage 02): `AUTH_ALLOWED_PATHS` gets `/two-factor/enable`, `/two-factor/disable`, `/two-factor/verify-totp`, `/two-factor/verify-backup-code`, `/two-factor/generate-backup-codes`. Every other `/two-factor/*` path stays 404: `get-totp-uri` (it shows the secret again; the setup keeps the URI of `enable` in memory), `send-otp`, `verify-otp`. Why: F2, F7; the allow-list rule of F082. Rejected: a `/two-factor/` prefix.
- **D4 Two files for the 2FA server code**: `apps/server/src/platform/auth-two-factor.ts` holds D1, the sign-in audit plugin (D5, D8, D9) and `backupCodesLeft` (D14); `platform/auth.ts` only wires it (it has 500 lines). `apps/server/src/platform/auth-two-factor-reset.ts` holds `resetTwoFactorRows` (D13): Kysely SQL only, no `better-auth` import, so the tenancy service that calls it does not load the auth library.

**Sign-in and audit**

- **D5 A trailing plugin writes the sign-in rows** (stage 02): `signInAuditPlugin(report)` with `id: "ea-sign-in-audit"`, listed after `twoFactor` in `plugins`, one after hook (F3 order). It reports:
  - `/sign-in/email`, `newSession` set → `login` with `{ second_factor: "none" }` when `newSession.user.twoFactorEnabled` is not true, else `{ second_factor: "trusted_device" }`.
  - `/two-factor/verify-totp` or `/two-factor/verify-backup-code`, `ctx.context.session` null, `returned` not an `APIError`, `newSession` set → `login` with `{ second_factor: "totp" }` or `{ second_factor: "backup_code" }`; the backup path also reports `backup_code_used` (stage 03, D7).
  - The `databaseHooks.session.create.after` login report goes away (F3: it fires before the code step). `databaseHooks.account.update` (password change) stays.
  Why: F3, F4. Rejected: the database hook with a 2FA check (it cannot know the trusted-device result).
- **D6 Password lockout stays as it is.** A correct password clears the failure count also when a code step follows (the user hook sees `newSession`, F3). The code step has the plugin's own limits (F5). A locked password user still gets the 401 of a wrong password and never reaches the code step. Why: F082 L12, L13; F5.
- **D7 2FA events** (stage 03), reported by the same plugin; `AuthEventKind` gets `two_factor_enabled`, `two_factor_disabled`, `backup_codes_generated`, `backup_code_used`, `two_factor_locked`; `auditEvents` gets `webTwoFactorEnabled: "web.two_factor_enabled"`, `webTwoFactorDisabled: "web.two_factor_disabled"`, `webBackupCodesGenerated: "web.backup_codes_generated"`, `webBackupCodeUsed: "web.backup_code_used"`, `webTwoFactorLocked: "web.two_factor_locked"` (data `locked_until`). Rules:
  - `two_factor_enabled`: `/two-factor/verify-totp` succeeded with `ctx.context.session` set, `ctx.context.session.user.twoFactorEnabled` not true (the snapshot read before the request changed it, F4) and `newSession` set (enrolment replaces the session, F2; a code check of a user who already has TOTP makes no new session; the snapshot rule also covers a session refresh). The enrolment also runs the purge of D9 first.
  - `backup_code_used`: every successful `/two-factor/verify-backup-code`, on the sign-in path (actor `newSession.user.id`) and on the session path (actor `ctx.context.session.user.id`). A request with `disableSession: true` is refused before the endpoint (`400 DISABLE_SESSION_REFUSED`, a before hook of the same plugin): on the sign-in path it would use up a code without a session (`backup-codes/index.mjs`, the `disableSession` branch), and the panel never sends it (cold review 1, N3).
  - `two_factor_disabled`: `/two-factor/disable` succeeded (actor `ctx.context.session.user.id`).
  - `backup_codes_generated`: `/two-factor/generate-backup-codes` succeeded.
  - Data of each row: `{ via: "web" }` plus the fields named here; never a code, a secret or a URI.
- **D8 One row per code lock**: after a sign-in verify answers `401` with code `INVALID_CODE` or `INVALID_BACKUP_CODE`, the plugin reads the user id from the challenge cookie (F8) and the row; it reports `two_factor_locked` with `{ locked_until: <ISO> }` when `failedVerificationCount === TWO_FACTOR_LOCK.maxFailedAttempts` and `lockedUntil > now`. Exactly the request whose failure reached 10 sees 10 (atomic increment), so a lock writes at most one row; two parallel failures at the tenth can write none (accepted). No mail. Why: PD-048 "lockouts". Rejected: a `lock_reported_at` column (a second migration change for a rare case).
- **D9 Turning TOTP on ends old trusted devices and old sessions**: on `two_factor_enabled` (D7), the plugin first deletes every `verification` row with `value` = the user id (F6), then every other session of the user (`internalAdapter.listSessions(userId)`, all except `newSession.session.id`, through `internalAdapter.deleteSessions(tokens)`). So after a reset or a turn-off, an old trust cookie never skips the code, and no session that never passed a second factor outlives the enrolment (cold review 1, N1: D10 reads the user's state, so it trusts every live session of a TOTP user). The purge also ends an open reset link of that user (accepted). Fail closed (N6, revised after review of stage 03): a failed purge is compensated. The plugin has stored the enrolment before the hook runs, so the hook sets `users.two_factor_enabled` to false and deletes the `auth_two_factors` row in one transaction (log `two_factor_enrol_rollback`; if that fails, `two_factor_enrol_rollback_failed`), then rethrows: the answer stays a 500. The user is not enrolled, the old sessions and trust rows are unchanged (the purge reads the sessions first), and a retry works; the enrolling device must sign in again. A test pins it. Rejected: catch and go on (the purge would be silently skipped); leave the enrolment stored after a failed purge (the first plan: TOTP on, old sessions alive, no cookie on the enrolling device); a retry path that purges on a later call (no later call tells an enrolment apart). "Sign out everywhere" does not end trusted devices (a trusted device still needs the password; accepted, questions.md Q2). Why: F6 (`readSignInTwoFactorState` accepts any live trust row of the user).

**Operator, break-glass, reset**

- **D10 Operators need TOTP** (stage 04). `WebSession` gets `twoFactorEnabled: boolean` (from `getSession`, F9). `requireOperator`: a user not in `operatorUserIds` → 404 as today; an operator with `twoFactorEnabled` false → `403 { error: "two_factor_required" }` and `log.warn("operator_two_factor_required", { user_id })`. The `/operator` page guard: non-operator → the 404 page as today; operator without TOTP → `302` to `/settings?two_factor=required`. `/api/me` `operator` does not change. Operator CLIs do not change (ssh to the host is the strong factor). Why: P1, ADR 0027. Rejected: a DB read per request (the session read already holds the user). The guard checks the user's TOTP state, not whether this session passed the factor. That is safe only while every session of a TOTP user came through the plugin's code step: D9 ends the older sessions at enrolment, the allow-list (D3) opens no other sign-in path, and a new session path (F119 SSO callbacks, `/verify-email` auto sign-in) must keep it true (D27).
- **D11 Break-glass designation** (stage 05): `memberships.break_glass`. Only the operator sets or clears it, with the CLI `org:break-glass --org-id <uuid> [--user-id <uuid> | --clear]` (no option after `--org-id` = list). Tenancy service `setBreakGlassOwner(db, ctx, { userId, actor, now })` → `{ kind: "set" | "unchanged" | "not_found" | "not_owner" | "no_two_factor" }`, `clearBreakGlassOwner(db, ctx, { actor, now, reason })` → `{ kind: "cleared"; userId } | { kind: "none" } | { kind: "not_found" }` (stage 05). `getUserAuthProfile` (tenancy repo) gets `twoFactorEnabled` from `users.two_factor_enabled`: a read of a Better Auth column by our SQL, listed as an exception in `docs/code-patterns.md` by stage 14 (N5). Set: lock the organization (`lockOrganization`), check the membership is `owner` and `users.two_factor_enabled` is true, clear any other designation of the organization, set this one, audit `org.break_glass_set` (`{ user_id }`) and, when another user lost it, `org.break_glass_cleared` (`{ user_id, reason: "replaced" }`), one transaction. Why: P4. Rejected: an owner choice in the panel (the SSO setup that needs it is operator-only too, PD-041); default, owner to confirm (questions.md Q1).
- **D12 The break-glass owner cannot turn TOTP off** (stage 06): `hooks.before` on `/two-factor/disable` reads the session user (`getSessionFromCtx`) and calls `AuthDeps.keepsTwoFactor(userId)` (absent = false); true → `403` with code `BREAK_GLASS_NEEDS_TWO_FACTOR`, nothing changes. `web.ts` passes `isBreakGlassOwner(db, userId)` (tenancy repo, user-scoped). It reads the memberships of every organization of the user, so it runs only with no tenant scope (F13): the hook runs inside `/api/auth/*`, which has none. Inside an `/api` request RLS would limit it to the session's organization; no `/api` route calls it (stage 08 reads `break_glass` from the session organization's membership). An operator may turn TOTP off; the console then refuses (D10). A designation and a turn-off at the same second can leave a break-glass owner without TOTP (accepted: identity B's exception asks for TOTP at sign-in anyway, so such an owner gets no bypass). Why: P1; the designation checks TOTP only once.
- **D13 Operator reset** (stage 07): CLI `web:two-factor-reset --org-id <uuid> --user-id <uuid>` → tenancy service `resetTwoFactor(db, ctx, { userId, actor: "cli", now })` in one transaction: `resetTwoFactorRows(trx, userId)` (`platform/auth-two-factor-reset.ts`, D4: delete the `auth_two_factors` row, set `users.two_factor_enabled = false`, delete `auth_verifications` rows with `value` = user id, delete the user's `auth_sessions`; returns `{ hadTwoFactor, sessionsEnded }`), clear `break_glass` on every membership of the user with one `org.break_glass_cleared` row (`{ user_id, reason: "two_factor_reset" }`) in each such organization, and one `web.two_factor_reset` row (`{ via: "cli", sessions_ended }`, actor `cli`) in the given organization. The user then signs in with the password only and can enrol again. A repeat run changes nothing more and still prints the result. It also repairs the two mixed states of D22. Why: a member who lost the phone and the codes must get back in; the operator checks the person out of band (docs, stage 14). `docs/code-patterns.md` gets `resetTwoFactorRows` as the second exception to "only Better Auth touches the auth tables" (stage 14). Rejected: Better Auth internal-adapter calls (no single transaction with the membership change and the audit).

- **D28 Turning TOTP off needs a live session and the password, not a fresh session** (F7, corrected). A thief with an old session cookie and the password can turn TOTP off, as they can change the password (`/change-password` has the same rule). Accepted: the password is the second proof, and the security log shows `web.two_factor_disabled`. The panel has no `SESSION_NOT_FRESH` text. Rejected: a freshness check of our own in `hooks.before` (it would refuse the normal case of a member who signed in yesterday).

**Status and web**

- **D14 Status route** (stage 08): `GET /api/me/two-factor` (any member, own user; a read, so suspended organizations work) → `twoFactorStatusSchema` in `@ea/core/web`: `{ enabled: boolean, backupCodesLeft: number | null, requiredBy: ("operator" | "break_glass")[] }`. `enabled` = `c.get("session").twoFactorEnabled` (stage 04; the session read has no cache, F9); `backupCodesLeft` = `TenancyRouteDeps.backupCodesLeft(userId)` only when enabled (web.ts: `backupCodesLeft(handle, userId)` in `platform/auth-two-factor.ts`, the count of `viewBackupCodes`, never the codes; null when the read fails, with `log.warn("two_factor_codes_unreadable", { user_id, ...errorFields(error) })`); `requiredBy` holds `operator` when the user is in `operatorUserIds` and `break_glass` when the user's membership in the session organization has `break_glass` (in that order). Why: the panel needs the state without a `/api/me` change (F098 stage 04 changed `meSchema`; a separate route keeps `/api/me` and its schema as they are).
- **D15 Web client**: `authClient` gets `plugins: [twoFactorClient()]` from `better-auth/client/plugins` (no options: the login page reads `data.twoFactorRedirect`). Calls: `authClient.twoFactor.enable({ password })`, `.verifyTotp({ code, trustDevice })`, `.verifyBackupCode({ code, trustDevice })`, `.disable({ password })`, `.generateBackupCodes({ password })` (F1, probe P5).
- **D16 Login code step** (stage 09): after `signIn.email` returns `data.twoFactorRedirect`, the login page shows the code step: a 6-digit input (`autocomplete="one-time-code"`, `inputMode="numeric"`), the switch "Trust this device for 30 days" (off by default), the link "Use a backup code" (a second input for `xxxxx-xxxxx`), and "Back". Error map in `lib/two-factor-errors.ts` (exact table in stage 09). Input clean-up: TOTP removes spaces and keeps 6 digits; a backup code is trimmed only (it is case-sensitive).
- **D17 Account card section** (stages 10–11): `components/settings/TwoFactorSection.tsx` under the password form. Off: text, the alert "Your role needs two-factor sign-in" when `requiredBy` is not empty, the button "Turn on" → password → QR code (`uqr`, rendered as one SVG `<path>`; no `dangerouslySetInnerHTML`), the key in groups of 4 and the link "Open in authenticator app" (`href` = the URI) → code → the 10 backup codes once, with "Copy" (Clipboard API) and the button "I saved the codes". On: "Backup codes left: N" (a warning at 3 or fewer), "New backup codes" (password → the new codes once), "Turn off" (password). The page reads `?two_factor=required` and scrolls to the section (`id="two-factor"`).
- **D18 No feature flag.** TOTP is a security control that nothing changes for a user who does not enrol, and the operator rule cannot wait for a flag. Default, owner to confirm (questions.md Q4); it departs from PD-045 like the send limits of F099 (its Q1).
- **D19 QR library** `uqr` 0.1.3, exact pin, in `@ea/web` only (stage 10, the only `bun.lock` change). Default, owner to confirm (questions.md Q3). Rejected: no QR (a 52-character key typed on a phone); a QR service on the internet (the secret would leave the server).
- **D20 Texts** in `apps/web/src/i18n/en.ts` and `apps/web/src/i18n/pl.ts`; the stage files give the Polish text of every key. `pl.ts` is on `master` (F098 stage 02, refresh 1) and its type `Record<TextKey, string>` makes every key required, so each web stage adds each key to both files. Copy the Polish texts word for word (F098 plan P6). `apps/web/src/i18n/i18n.test.ts` fails when a Polish text equals the English one (list `SAME_IN_BOTH`) or when the placeholders differ; no F105 key reads the same in both languages.
- **D21 Security log kinds** (stage 13; F099 stages 12–13 are on `master` since refresh 1; `docs/code-patterns.md` § Data access: "A new security-relevant audit event … gets an entry in `securityEvents` … and a `sec_kind_*` text"; this ticket meets the rule in stage 13, before the ticket closes): `securityEvents` gets `web.two_factor_enabled` → `two_factor_on`, `web.two_factor_disabled` → `two_factor_off`, `web.two_factor_reset` → `two_factor_reset`, `web.backup_codes_generated` → `backup_codes_new`, `web.backup_code_used` → `backup_code_used`, `web.two_factor_locked` → `two_factor_locked`, `org.break_glass_set` → `break_glass_set`, `org.break_glass_cleared` → `break_glass_cleared`; `securityEventKinds` gets the eight kinds; `en.ts` (and `pl.ts`) get `sec_kind_<kind>`. `listSecurityLog` already reads `data.locked_until`, so the code lock shows its end time.

**Edge cases**

- **D22 Crash and repeat.** The plugin writes without a transaction: (a) enrolment verify sets `users.two_factor_enabled` and then `verified`; a crash between leaves a user whose TOTP code fails at sign-in (`TOTP_NOT_ENABLED`; the plugin offers `twoFactorMethods: []`) while backup codes still work. In this state `users.two_factor_enabled` is true, so the operator passes the D10 guard, `setBreakGlassOwner` accepts the user, and the disable refusal (D12) holds; the session that the enrolment made did pass a TOTP code, and later sign-ins need a backup code, so no session skips a second factor. Accepted: the state follows only a crash between two plugin writes; the status route shows `enabled: true`, the login page shows `tf_error_state` ("use a backup code or ask the operator to reset it"), and the reset (D13) repairs it (cold review 1, N7); (b) disable sets the user flag false and then deletes the row; a crash between leaves "off" in the panel and `TOTP_ALREADY_ENABLED` on the next enable. Both: the operator reset (D13) repairs them; the web maps `TOTP_ALREADY_ENABLED` to "ask the operator to reset two-factor sign-in". Two parallel enrolments: `UNIQUE (user_id)` makes the second fail (stage 02 test 15). The reset (D13) is one transaction and can run again.
- **D23 Two tenants, removed members.** `auth_two_factors` and `users.two_factor_enabled` are per user, not per organization; a user in two organizations has one second factor. `break_glass` is per membership; the unique index holds one per organization. No code removes a membership today (F12); the delete ticket (F106) deletes memberships by cascade, which takes the flag.
- **D24 Clocks.** The plugin uses `Date.now()` (F4, F5): tests compute codes with the real clock (`totpCode(secret)` helper of stage 02) and move a lock into the past with SQL; they never fix the clock for the code step. The password lockout keeps `AuthDeps.now`.
- **D25 Secrets.** A TOTP secret, an `otpauth` URI, a typed code and a backup code never reach a log line, an error text, an audit row, an operator notice or a test snapshot. The server never logs `enable` or `generate-backup-codes` bodies (the HTTP log has method, route, status, ms). `WEB_AUTH_SECRET` encrypts the secrets and codes (F2): a new secret makes every second factor unreadable; `deploy/README.md` says so and names the reset CLI (stage 14).
- **D26 TOTP replay inside the ±30 s window is accepted** (F4): a stolen code needs the password too, and the window is short. Default, owner to confirm (questions.md Q5).
- **D27 Seams for later tickets.** Identity B (F119): "SSO required" refuses password sign-in except for the member with `memberships.break_glass` and TOTP on (`isBreakGlassOwner`, D12), and its console may show the designation. It must keep the D10 premise: a session made by an SSO callback skips the plugin's code step, so for a user with TOTP on F119 either asks for the code after the callback, or marks SSO sessions and makes `requireOperator` and the break-glass rule read that mark instead of the user's state (cold review 1, N1). Account data (F106): `auth_two_factors` goes with the user (cascade); `memberships.break_glass` goes with the membership; no address data in either (the DSR map needs no row). The operator console (F099) may later list 2FA states; not in this plan.

## Done when

Every line maps to a stage test or check (stage in brackets).

1. A member enrols in the Account card (password, QR, code), sees 10 backup codes once, and the next sign-in asks for a code [02, 11, 12].
2. Sign-in with password and a right TOTP code or an unused backup code makes a session; a used backup code, a wrong code, an expired challenge or no code makes none [02, 09, 12].
3. Ten wrong sign-in codes lock the code step for 15 minutes (429, also for a right code) and write one `web.two_factor_locked` row [03].
4. A trusted device skips the code for 30 days; after TOTP is turned on again, an old trust cookie no longer skips it, and every session from before the enrolment is gone [02, 03].
5. Every sign-in writes one `web.login` with `second_factor` `none`, `totp`, `backup_code` or `trusted_device`; a sign-in that waits for its code writes none [02].
6. TOTP on, off, new backup codes, every used backup code, the lock, the reset and each break-glass change write one audit row each, with ids and codes only [03, 05, 07].
7. An operator without TOTP gets `403 two_factor_required` on `/api/operator/*` and a redirect from `/operator` to `/settings?two_factor=required`; a non-operator still gets 404 [04].
8. `org:break-glass` sets one break-glass owner per organization, refuses a non-owner and a user without TOTP; that owner's `/two-factor/disable` answers `403 BREAK_GLASS_NEEDS_TWO_FACTOR` [05, 06].
9. `web:two-factor-reset` turns TOTP off, ends the sessions and trusted devices, clears break-glass, and the user signs in with the password only [07].
10. `GET /api/me/two-factor` gives `enabled`, `backupCodesLeft`, `requiredBy` and never a code [08].
11. No log line, error text, audit row or test snapshot holds a TOTP secret, an `otpauth` URI, a code or a backup code (log capture in stages 02, 03, 07; e2e console check in 12) [02, 03, 07, 12].
12. The owner security log shows the eight new kinds with texts [13]; the docs, the capability page and ADR 0026 describe the landed rules [14]; on the VPS the owner enrols TOTP and the console works [15].

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, `ticket.md`, this file and your stage file first. Build only your stage.
- Format only the files of your stage: `bunx prettier --write <files>`. Never the whole repo.
- **Secrets (D25):** no TOTP secret, `otpauth` URI, typed code, backup code, password, session token or e-mail address in a log line, an error text, an audit row, an operator notice or a test snapshot. Logs hold ids, codes, counts and times. Tests that drive the code step capture the log (`spyOn(console, "log" | "warn" | "error")`, as `web-lockout.test.ts` does) and assert that no captured line holds the secret, any backup code, the typed code or `otpauth`. Use `holdsToken(line, token)` from `apps/server/test/totp.ts` (stage 02): a 6-digit code matches only as a whole token (no digit just before or after it, `/(^|\D)<code>(\D|$)/`); the secret, a backup code and `otpauth` match as substrings (cold review 1, N9).
- New log lines are events (`log.warn("operator_two_factor_required", { user_id })`), fields from `platform/log-fields.ts` only (`user_id`, `count`, `code`, `kind`, `reason` exist). `platform/` files fail the lint on an old-form line. CLI output goes to `process.stdout.write` (as `org-status.ts` does); CLI errors are event lines.
- The repo is public: no tailnet name, VPS address, real name or real address in a file. Test addresses end in `@x.test`.
- **Better Auth rate limit (F5):** `/two-factor/*` allows 3 requests per 10 s per client address. Every test request carries a fresh `x-client-ip` (`nextIp()` as in `web-lockout.test.ts`); a test that checks the limit uses one fixed address on purpose. E2e: each sign-in in its own browser context with `nextAddress(50 | 150)`.
- **TOTP in tests (D24):** codes come from `totpCode(secretBase32, atMs = Date.now())` in `apps/server/test/totp.ts` (stage 02 adds it; RFC 6238 with `node:crypto`, SHA-1, 6 digits, 30 s). The e2e spec has its own copy in `apps/web/e2e/totp.ts` (stage 12; the e2e runner does not import server test files). Never import `@better-auth/utils` in tests (a transitive dependency).
- A stage that changes a type or a required field fixes every caller and every test fake in the same stage.
- Stage files by explicit path (`git add <paths>`), never `git add -A`. Review `git diff --staged` before each commit.
- Only stage 01 adds a migration. Only stage 10 changes `bun.lock` and `package.json` dependencies. Any other need → stop and ask.
- e2e (stage 12 only): Playwright with the system Chromium. Before the first e2e run, give the job its own e2e database: `sed -i -E '/^E2E_(MIGRATOR_)?DATABASE_URL=/d' .env`, then `bun run db:worktree f105_s12_e2e | grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' | sed 's/^/E2E_/' >> .env`. Never point e2e at the shared `email_assistant_e2e`. Run `test:e2e` only under `flock /tmp/email-assistant-shared-tests.lock` (fixed ports 8081 and 8092).
- A gap or a deviation is a question in your final message, not a choice.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message list as proven only what a saved log shows. `test:int:ci` needs no lock: each job has its own DB (`CLAUDE.md`).

Server and core stages (01–08; NN = the stage number):

```
mkdir -p /tmp/f105-sNN && bun run lint > /tmp/f105-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f105-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f105-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f105-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages (09, 10, 11, 13): the same chain with `&& bun run web:build > /tmp/f105-sNN/web.log 2>&1` before `&& echo PROOF_OK`.

Stage 12 (e2e): the web chain with `&& flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f105-s12/e2e.log 2>&1` before `&& echo PROOF_OK` (the whole suite: the seed change touches every spec).

Stage 14 (docs; `<files>` = the files the stage changed):

```
mkdir -p /tmp/f105-s14 && bunx prettier --check <files> > /tmp/f105-s14/prettier.log 2>&1 && bun run lint > /tmp/f105-s14/lint.log 2>&1 && bun run test:unit:ci > /tmp/f105-s14/unit.log 2>&1 && echo PROOF_OK
```

Stage 15 has its own checks (stage file).

## Owner steps

No owner checkpoint (owner decision 2026-11-13). Owner steps only for the owner's hands:

| #   | Step | When |
| --- | ---- | ---- |
| U1  | Sign in to the panel on the VPS, turn on two-factor sign-in in Settings → Account with your phone's authenticator app, keep the backup codes. Until then the operator console sends you to the settings page. | stage 15, after the deploy |

The shared dev DB needs `bun run db:migrate` after stage 01 lands; the coordinator runs it in the main checkout (§ How to run, item 5), not the owner.

## Review

- A review job before the land for stages 01, 02, 03, 04, 06, 07 (`[risky]`: migration, auth, security), 05 (break-glass data and its CLI) and 09 (the sign-in page). Model: the board's reviewer (`spec/build.md` TRACK). Other stages land on the worker's proof.
- Review spawn (after the worker job is done; `<B>` = the job's branch):

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --review --detached --branch <B> --label "review s<NN> · F105" \
  "Review F105 stage NN on <B> against spec/features/active/F105-e7-t6-identity-a-totp-backup-codes-break-glass/plan.md and stages/stage-NN-<slug>.md. Pre-mortem: a member signed in without the second factor, an operator used the console without TOTP, a break-glass owner lost TOTP, or a secret or code reached a log or an audit row: which line of this stage let it through? Check every numbered test exists and asserts what the stage says, the secret rules (D25) and every decision the stage cites. Quote file and line for each finding."
```

## Stages

| #   | Stage | Size | Lane | Mark |
| --- | ----- | ---- | ---- | ---- |
| 01  | [Migration: 2FA table, user flag, break-glass column](stages/stage-01-migration.md) | ~150 lines | A | `[risky]` migration |
| 02  | [Plugin, allow-list, sign-in row](stages/stage-02-plugin-and-sign-in.md) | ~300 lines | A | `[risky]` auth |
| 03  | [2FA audit rows, code lock row, trusted-device and session end](stages/stage-03-two-factor-events.md) | ~280 lines | A | `[risky]` auth, audit |
| 04  | [Operators need TOTP](stages/stage-04-operator-needs-totp.md) | ~180 lines | B | `[risky]` auth |
| 05  | [Break-glass owner: service and CLI](stages/stage-05-break-glass.md) | ~230 lines | A | review |
| 06  | [The break-glass owner keeps TOTP](stages/stage-06-break-glass-keeps-totp.md) | ~120 lines | A | `[risky]` auth |
| 07  | [Operator reset](stages/stage-07-operator-reset.md) | ~280 lines | A | `[risky]` auth, data |
| 08  | [Status route](stages/stage-08-status-route.md) | ~200 lines | A | |
| 09  | [Login code step](stages/stage-09-login-code-step.md) | ~260 lines | C | review |
| 10  | [QR and setup helpers](stages/stage-10-qr-and-helpers.md) | ~220 lines | C | `bun.lock` |
| 11  | [Account card section](stages/stage-11-account-section.md) | ~300 lines | C | |
| 12  | [E2e seed and spec](stages/stage-12-e2e.md) | ~250 lines | C | |
| 13  | [Security log kinds](stages/stage-13-security-log-kinds.md) | ~120 lines | D | |
| 14  | [Docs, ADR 0026, capability page](stages/stage-14-docs.md) | ~150 lines | — | |
| 15  | [VPS deploy and checks](stages/stage-15-vps.md) — coordinator only | — | — | `[risky]` real system |

Order and parallel work:

| Stage | Needs (landed) | May run next to | Why not more |
| ----- | -------------- | --------------- | ------------ |
| 01 | — | — | the only migration: no other migration of any ticket next to it |
| 02 | 01 | — | edits `platform/auth.ts`, `web.ts` |
| 03 | 02 | 04, 09 | edits `platform/auth-two-factor.ts`, `platform/auth.ts` (`AuthEventKind`), `web.ts` (the event map) |
| 04 | 02 | 03, 09 | edits `platform/http.ts`, `web.ts` (`getSession`), test fakes |
| 05 | 03 | 09, 10 | tenancy repo, service and index, `auditEvents`, one CLI script in `package.json` |
| 06 | 05 | 07, 09, 10 | `platform/auth.ts` (before hook), `web.ts`, `web-two-factor.test.ts` |
| 07 | 05 | 06, 08, 09, 10 | tenancy service, `platform/auth-two-factor-reset.ts`, `auditEvents`, one CLI script in `package.json` |
| 08 | 04, 05 | 06, 07, 09, 10 | tenancy routes, `web.ts`, `auth-two-factor.ts` (a new function at the end) |
| 09 | 02 | 03–08 | web only: `LoginPage.tsx`, `auth-client.ts`, `en.ts` |
| 10 | 09 | 03–08 (not next to another `bun.lock` change of any ticket) | `apps/web/package.json`, `bun.lock` |
| 11 | 08, 09, 10 | 13 | `AccountCard.tsx`, `en.ts` |
| 12 | 11 | 13 | the e2e seed and the whole e2e run |
| 13 | 07 (F099 stages 12–13 are on `master`) | 08–12 | `packages/core/src/security-log.ts`, `en.ts`, `pl.ts` |
| 14 | 12 (and 13 if landed) | — | docs |
| 15 | 14 | — | VPS |

Migrations: **only stage 01**. `bun.lock`: **only stage 10**.

Advisory overlaps with tickets in build (start the stages anyway; on a land conflict, resume the worker to merge `master` and prove again):
- F098 (Polish UI; stages 01–10 landed at ff61cbc, 11–13 open): stage 13 changes `docs/code-patterns.md`, `docs/architecture.md` and the web capability page (F105 stage 14). Stages 11–12 change Telegram texts only (no F105 file).
- F099 (platform controls; stages 01–14 landed at ff61cbc, stage 15 is its VPS deploy): its deploy and F105 stage 15 never run at the same time (stage 15, Before the deploy, item 1).
- F101 (Astro 7): `apps/web/package.json` and `bun.lock` (stage 10 here): never at the same time.
- F103 (log events): `web.ts` and `platform/auth.ts` log lines.

## How to run (coordinator)

1. Before the first spawn: F082 is in `spec/features/done/` (true). Run `scripts/plan-drift.sh spec/features/planned/F105-e7-t6-identity-a-totp-backup-codes-break-glass cf125cf`; exit 1 → a refresh job first (`spec/build.md` NEXT, plan refresh rule). Move the ticket: `git mv spec/features/planned/F105-e7-t6-identity-a-totp-backup-codes-break-glass spec/features/active/`, commit.
2. Spawn one stage (NN = two digits, `<slug>` from the stage list):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "F105-sNN <slug> · F105" \
     "Implement F105 stage NN. Read spec/features/active/F105-e7-t6-identity-a-totp-backup-codes-break-glass/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f105-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

3. Stage 01: no other migration stage of any ticket in build. Stage 10: no other `bun.lock` change of any ticket in build.
4. When the job finishes: read its final message and `/tmp/f105-sNN/*.log`. For the stages of § Review, spawn the review job and wait for it; a finding → `limen continue <job-id> "<fix>"` with the same engine flags, then review again (at most 2 rounds, then the owner decides).
5. Land: `limen land <job-id> --yes --keep-open` (stage 15: the coordinator closes the ticket with `limen ticket done F105` after its checks). Drop the job DB from the main checkout: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop` (stage 12 also `f105_s12_e2e`). After stage 01 lands: `bun run db:migrate` in the main checkout (no `test:int` running there).
6. Stage 13: F099 stages 12 and 13 are on `master` (refresh 1), so stage 13 needs only stage 07. Build it before stage 14, so the docs describe its kinds and stage 15 deploys it.
7. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass. A check with no proof at all → `limen continue`.

## Cold review

Review 1 ([plan-review-1.md](plan-review-1.md), job `2026-11-14-f105-plan-review-4f13ff14`, started by the coordinator, candidate 7b05dc3): PASS, 0 blocking, 10 notes, 3 unverified items. What changed:

- N1 sessions from before the enrolment outlive it and pass the operator guard: fixed. D9 and stage 03 rule 1 end every other session of the user at enrolment (test 1a); D10 states its premise; D27 tells F119 to keep it for SSO sessions.
- N2 F7 was wrong (disable needs a live session, not a fresh one): fixed. F7 corrected; D28 records the accepted rule; stage 10 drops the `SESSION_NOT_FRESH` row and the `tf_error_not_fresh` key; stage 14 describes the code, not the first F7 text; stage 06 test 4 proves an old session works.
- N3 a backup code used without an audit row: fixed both ways. D7 and stage 03 report `backup_code_used` on every successful `verify-backup-code` (test 4a) and refuse `disableSession: true` with `400 DISABLE_SESSION_REFUSED` (test 4b).
- N4 stage size: fixed for stage 05. Its step 05.2 is now stage 06 (`[risky]`, one step); old stages 06–14 are 07–15; the stage table, the order table, § Review, § Proof, the ticket slices and every cross reference follow. Stages 04 and 07 stay `[risky]` with two steps (the first is a small typed change the second needs; Differences item 1). Stage 02 stays one step; the worker may put the cookie-jar harness in `two-factor-helpers.ts` and reports the size.
- N5 the `getUserAuthProfile` read of `users.two_factor_enabled`: fixed. D11 names it; stage 14 lists it as an exception in `docs/code-patterns.md`.
- N6 an error in the enrolment purge: decided fail closed (D9, stage 03 rule 1): compensated (enrolment taken back) and a 500; stage 11 reloads the status and shows `tf_on_without_codes`; the operator reset ends what the purge left. A later-call purge was rejected (no later call tells an enrolment apart).
- N7 the mixed state D22 (a): stated in D22 with what each guard does, why no session skips a second factor, and the repair.
- N8 `clearBreakGlassOwner` result: fixed; D11 lists `not_found` as stage 05 does.
- N9 numeric codes matched as substrings: fixed. `holdsToken` in `apps/server/test/totp.ts` (stage 02 test 2a) matches a 6-digit code as a whole token; stage 02 test 17, stage 03 test 9, stage 12 and § Rules use it.
- N10 board drift (`spec/build.md` NEXT line, §2.1 row 11 stage count): for the coordinator at the land; not in this folder.
- The review's unverified items (its U1 `uqr` API and size, U2 F099 registry shape, U3 probe P5 not rerun): unchanged; stages 10, 13 and the typecheck of stage 02 check them (§ Not verified, stage 13 header).

## Log

- 2026-11-14: planned by a `--role planner` job (Opus 5.5) at 163c7b2. Probes P1–P6 (Better Auth 1.7.18 on a throwaway Postgres with the repo migrations; `uqr`; `tsc --strict`).
- 2026-11-14: cold review 1 (PASS, 10 notes) filed; N1–N9 applied in the same planning job; stage 05 split, 15 stages.
- 2026-11-14: refresh 1 at ff61cbc (F092, F097, F098, F099, F100 landed since 163c7b2): paths, line numbers, the RLS fact F13, D12, D20, D21 and stages 01, 04–06, 08–14 updated; no stage changed in substance; [plan-refresh-1.md](plan-refresh-1.md).
- 2026-11-14: refresh 2 at cf125cf (F097 stage 04, F100 stage 04 landed since ff61cbc): stage 01 migration version and the `TENANT_TABLES` note; no stage changed in substance; [plan-refresh-2.md](plan-refresh-2.md).
