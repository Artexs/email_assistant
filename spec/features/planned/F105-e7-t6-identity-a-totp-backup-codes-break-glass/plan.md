# F105 plan — Identity A: TOTP, backup codes, break-glass owner

> **Status 2026-11-14 — planned.** Plan base: 163c7b2. Fourteen stages written. The cold review is for the coordinator (the planning job did not start one). Build after the public login ticket (F082, done).

Workers read `ticket.md`, this file and their one stage file. **A gap or a deviation is a question in the final message, not a choice:** the coordinator decides from § Input or asks the owner.

## Planning progress

- [x] Collect (2026-11-14): epic page E07, discovery notes §3, §8, §11, ADR 0026, ADR 0027, PD-037–PD-050, `05-execution-plan.md` §2, `spec/build.md`, the F082 plan (done), the F098 and F099 plans and stages (in build), `.agents/limen/styleguide.md`, `docs/code-patterns.md` § Data access and § Logs, `docs/architecture.md` §7, `docs/capabilities/web-panel.md`, and the code at 163c7b2 (`platform/auth.ts`, `platform/http.ts`, `web.ts`, `modules/tenancy/*`, `modules/audit/repo.ts`, `scripts/org-flag.ts`, `scripts/web-invite.ts`, `scripts/e2e-seed.ts`, the web islands `LoginPage`, `AccountCard`, `lib/auth-client.ts`, `lib/password-errors.ts`, the e2e helpers, the migrations, `test/integration/web-helpers.ts`, `web-auth.test.ts`, `web-lockout.test.ts`).
- [x] Facts checked: probes P1–P5 in `.probe-f105/` of the planning worktree (removed after the job): Better Auth 1.7.18 with the repo's real migrations on a throwaway Postgres 18 cluster.
- [x] Decisions P1–P5, D1–D27; small defaults in [questions.md](questions.md).
- [x] Stage files 01–14 written.
- [x] Committed (explicit paths).
- [ ] Cold review: the coordinator starts it (task rule of the planning job); file it as `plan-review-1.md`.

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

1. The §2.1 row 11 says "≈ 4" stages. This plan has 14: the discovery count left out the login step, the QR code, the operator rule, the reset CLI, the e2e spec, the security-log kinds, docs and the VPS stage. Each stage keeps one `[risky]` step or 2–4 normal steps.
2. ADR 0026 ties the break-glass owner to "SSO required", which does not exist before identity B. Identity A makes the designation and its TOTP rule (P4); nothing at sign-in changes for a break-glass owner now.
3. The security-log registry `packages/core/src/security-log.ts` (F099 stage 12) is not on `master` at the plan base; its commit is on a job branch. Stage 12 of this plan waits for F099 stages 12 and 13.
4. `apps/web/src/i18n/pl.ts` does not exist at the plan base (F098 stage 02 adds it). The web stages give en and pl texts for every key (D20).
5. `platform/auth.ts` has 500 lines. The 2FA code goes into a new file `platform/auth-two-factor.ts` (D4).
6. The `web.login` audit row comes from `databaseHooks.session.create.after` on `/sign-in/email`. With the plugin, that hook also fires for a sign-in that still waits for its code (Fact F3). Stage 02 moves the row (D5).
7. `web.ts` has old-form log lines. New lines are events (`docs/code-patterns.md` § Logs: "A new log line in any file is an event from now on").
8. This worktree has no `node_modules`; the facts were read in the main checkout's `node_modules` (`better-auth` 1.7.18, the version in `bun.lock`).

## Facts checked (2026-11-14; `better-auth` 1.7.18, `@better-auth/utils` 0.5.1; probes on a throwaway Postgres 18.6 cluster with every repo migration applied, plus the draft SQL of stage 01)

- **F1 Plugin schema.** The `two-factor` plugin adds `user.twoFactorEnabled` (boolean, default false) and a model `twoFactor` with `secret`, `backupCodes`, `userId`, `verified`, `failedVerificationCount`, `lockedUntil` (`plugins/two-factor/schema.mjs`). The option `schema: { user: { fields: { twoFactorEnabled: "two_factor_enabled" } }, twoFactor: { modelName: "auth_two_factors", fields: { userId: "user_id", backupCodes: "backup_codes", failedVerificationCount: "failed_verification_count", lockedUntil: "locked_until" } } }` works with the `pg` pool and the Kysely adapter (probe P1: enable, verify, sign-in, backup code, disable all passed; `incrementOne` works). `tsc --strict` accepts these options and the client calls of D15 (probe P5).
- **F2 Enrolment.** `POST /two-factor/enable { password }` (a session and the password; `method` defaults to `totp`) returns `{ method: "totp", totpURI, backupCodes }` and writes the row with `verified: false`; `users.two_factor_enabled` stays false. The URI is `otpauth://totp/Email Assistant:<email>?secret=<base32, 52 characters>&issuer=…&digits=6&period=30`. `POST /two-factor/verify-totp { code }` with the session sets `verified: true` and `two_factor_enabled: true` and replaces the session (a new session row and cookie). A second `enable` while the row is verified answers `400 TOTP_ALREADY_ENABLED`; while it is not verified, it overwrites the row. `method: "otp"` answers `400 OTP_NOT_CONFIGURED` (no `sendOTP`). The secret and the backup codes are stored encrypted with the auth secret (`symmetricEncrypt`, `storeBackupCodes: "encrypted"` default).
- **F3 Sign-in with a second factor.** `POST /sign-in/email` with the right password for a user with TOTP answers `200 { twoFactorRedirect: true, twoFactorMethods: ["totp"] }`, sets only the signed cookie `ea.two_factor` (10 min), and deletes the session it made. Hook order (`api/dispatch.mjs` `getHooks`): the user `hooks.after` runs first and still sees `ctx.context.newSession` (with `user.twoFactorEnabled: true`); the plugin's after hook then deletes the session and sets `newSession` to null; a plugin listed after `twoFactor` sees `newSession: null` and `returned.twoFactorRedirect: true`. `databaseHooks.session.create.after` fires with `ctx.path = "/sign-in/email"` before the plugin deletes the session (probe P1, case 7).
- **F4 The code step.** `POST /two-factor/verify-totp { code, trustDevice? }` and `POST /two-factor/verify-backup-code { code, trustDevice? }` with the `ea.two_factor` cookie make the session (`databaseHooks.session.create` with the verify path). In an after hook, `ctx.context.session` is null on this sign-in path and set on the enrolment path; `ctx.context.newSession` is set after success on both (probe P2). A backup code works once (`401 INVALID_BACKUP_CODE` on reuse; 9 left after one use, `auth.api.viewBackupCodes({ body: { userId } })`, server only). The same TOTP code works again inside its window (no replay guard; probe P1 case 9). Codes match at ±1 step of 30 s (`@better-auth/utils/otp` `verifyTOTP`, `window = 1`), with `Date.now()`.
- **F5 Code limits.** Per challenge: 5 wrong codes, then `400 TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` and the challenge ends (`401 INVALID_TWO_FACTOR_COOKIE` after). Per account: `accountLockout` default 10 consecutive failed sign-in codes → `locked_until = now + 900 s`; while locked every verify answers `429 ACCOUNT_TEMPORARILY_LOCKED`, also a correct code (probe P1 cases 13–15). Codes checked with a session (enrolment) do not count. The plugin's rate limit is 3 requests per 10 s per client address on `/two-factor/*` (fourth: 429; probe P1 case 12). The plugin uses `Date.now()`, not `AuthDeps.now`.
- **F6 Trusted device.** `trustDevice: true` stores a row in `auth_verifications` (`value` = user id, identifier hashed) for `trustDeviceMaxAge` (default 2 592 000 s) and sets the signed cookie `ea.trust_device`. A later `/sign-in/email` with that cookie returns a session at once, and the plugin renews the row (probe P2 case 4). `ctx.context.adapter.deleteMany({ model: "verification", where: [{ field: "value", value: userId }] })` deletes these rows (probe P4). The identifiers are hashed (`storeIdentifier: "hashed"`), so rows are found only by `value`.
- **F7 Turn off and new codes.** `POST /two-factor/disable { password }` needs a session younger than `freshAge` (default 1 day from `createdAt`, `sensitiveSessionMiddleware`; else `403 SESSION_NOT_FRESH`) and the password (`400 INVALID_PASSWORD`). It sets `two_factor_enabled: false`, deletes the row, replaces the session, and deletes only this device's trust row. `POST /two-factor/generate-backup-codes { password }` returns 10 new codes and replaces the old ones (probe P1 cases 16–17). `POST /two-factor/get-totp-uri { password }` re-shows the secret.
- **F8 Challenge user.** In an after hook of a failed sign-in verify, `ctx.getSignedCookie(ctx.context.createAuthCookie("two_factor").name, ctx.context.secret)` gives the challenge id and `ctx.context.internalAdapter.findVerificationValue(id)` gives `value` = the user id (probe P3). `ctx.context.adapter.findOne({ model: "twoFactor", where: [{ field: "userId", value }] })` returns `failedVerificationCount` and `lockedUntil` (probe P4).
- **F9 Session read.** `auth.api.getSession` returns `user.twoFactorEnabled` (probe P1 cases 2 and 6). No cookie cache is set (`docs/architecture.md` §7), so a change shows at the next request.
- **F10 Password reset and 2FA.** `/reset-password` does not sign in, so a reset link does not skip the code; `/change-password` keeps 2FA on and replaces the session (probe P2 case 5).
- **F11 QR code.** `uqr` 0.1.3 (MIT, no dependencies, npm 2026-11-14): `encode(text, { ecc: "M", border: 2 })` returns `{ size, data: boolean[][] }`; for a 140-character `otpauth` URI, size 53 (probe P5 in a separate folder). No QR library is in `bun.lock` today.
- **F12 Repo.** `AUTH_ALLOWED_PATHS` (`platform/auth.ts:54`) lists 7 paths; `/two-factor/*` answers 404 today. `memberships.role` is `owner` or `assistant`; no code changes a role or deletes a membership (`grep updateTable("memberships")`: only `setDigestTimes`). `requireOperator` and the `/operator` page guard read `web.operatorUserIds` (`platform/http.ts:266`, `:389`). `WebSession` is built in `web.ts:345` and in test fakes (`test/integration/web-helpers.ts:40`, `web-http.test.ts:63,65,195`, `src/platform/http.test.ts:261,323,367,398`). The RLS test checks only tables with `org_id` (`test/integration/rls-policy.test.ts` test 1). E2e address blocks in use: 10, 40, 60, 70, 80, 90, 100 (+100 for desktop); 50 and 150 are free.

## Not verified (the stage that checks it)

- The plugin's behaviour under two parallel enrolments of one user: stage 01 adds `UNIQUE (user_id)`, so the second insert fails; stage 02 test 14 checks that the answer is a 500 with no second row and no log line with a secret.
- The QR code scans in a real authenticator app (Google Authenticator, Aegis, 1Password): stage 14 (owner step U2 on the owner's phone).
- `uqr` in the Astro build (ESM import in a client island): stage 09 runs `bun run web:build`.

## Decisions (D1–D27)

**Plugin and data**

- **D1 Plugin options** (stage 02, `platform/auth-two-factor.ts`): `twoFactor({ issuer: "Email Assistant", trustDeviceMaxAge: 2_592_000, accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 }, backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: "encrypted" }, schema: <F1> })`. No `otpOptions` (no e-mail codes: the auth-mail sender is off on the VPS), no `allowPasswordless`, no `skipVerificationOnEnable`. The numbers are constants `TWO_FACTOR_LOCK = { maxFailedAttempts: 10, durationSeconds: 900 }`, `TRUST_DEVICE_SECONDS = 2_592_000`, `BACKUP_CODE_COUNT = 10`. Why: P2, P3, F2, F5. Rejected: own TOTP code (more security code to own); e-mail codes.
- **D2 Schema** (stage 01, one migration): `users.two_factor_enabled boolean NOT NULL DEFAULT false`; table `auth_two_factors` (`id uuid PK`, `user_id uuid NOT NULL UNIQUE REFERENCES users ON DELETE CASCADE`, `secret text NOT NULL`, `backup_codes text NOT NULL`, `verified boolean NOT NULL DEFAULT false`, `failed_verification_count integer NOT NULL DEFAULT 0 CHECK (>= 0)`, `locked_until timestamptz`, `created_at timestamptz NOT NULL DEFAULT now()`); `memberships.break_glass boolean NOT NULL DEFAULT false` with `CHECK (NOT break_glass OR role = 'owner')` and a partial unique index `(org_id) WHERE break_glass`. Exact SQL in stage 01. No `org_id` in `auth_two_factors`: it belongs to a user and goes with the user by cascade (like `auth_lockouts`). Why: F1, P4. Rejected: `organizations.break_glass_user_id` (it can point at a non-member and needs a trigger when a membership goes; the membership column goes with the membership).
- **D3 Allow-list** (stage 02): `AUTH_ALLOWED_PATHS` gets `/two-factor/enable`, `/two-factor/disable`, `/two-factor/verify-totp`, `/two-factor/verify-backup-code`, `/two-factor/generate-backup-codes`. Every other `/two-factor/*` path stays 404: `get-totp-uri` (it shows the secret again; the setup keeps the URI of `enable` in memory), `send-otp`, `verify-otp`. Why: F2, F7; the allow-list rule of F082. Rejected: a `/two-factor/` prefix.
- **D4 Two files for the 2FA server code**: `apps/server/src/platform/auth-two-factor.ts` holds D1, the sign-in audit plugin (D5, D8, D9) and `twoFactorState` (D14); `platform/auth.ts` only wires it (it has 500 lines). `apps/server/src/platform/auth-two-factor-reset.ts` holds `resetTwoFactorRows` (D13): Kysely SQL only, no `better-auth` import, so the tenancy service that calls it does not load the auth library.

**Sign-in and audit**

- **D5 A trailing plugin writes the sign-in rows** (stage 02): `signInAuditPlugin(report)` with `id: "ea-sign-in-audit"`, listed after `twoFactor` in `plugins`, one after hook (F3 order). It reports:
  - `/sign-in/email`, `newSession` set → `login` with `{ second_factor: "none" }` when `newSession.user.twoFactorEnabled` is not true, else `{ second_factor: "trusted_device" }`.
  - `/two-factor/verify-totp` or `/two-factor/verify-backup-code`, `ctx.context.session` null, `returned` not an `APIError`, `newSession` set → `login` with `{ second_factor: "totp" }` or `{ second_factor: "backup_code" }`; the backup path also reports `backup_code_used` (stage 03).
  - The `databaseHooks.session.create.after` login report goes away (F3: it fires before the code step). `databaseHooks.account.update` (password change) stays.
  Why: F3, F4. Rejected: the database hook with a 2FA check (it cannot know the trusted-device result).
- **D6 Password lockout stays as it is.** A correct password clears the failure count also when a code step follows (the user hook sees `newSession`, F3). The code step has the plugin's own limits (F5). A locked password user still gets the 401 of a wrong password and never reaches the code step. Why: F082 L12, L13; F5.
- **D7 2FA events** (stage 03), reported by the same plugin; `AuthEventKind` gets `two_factor_enabled`, `two_factor_disabled`, `backup_codes_generated`, `backup_code_used`, `two_factor_locked`; `auditEvents` gets `webTwoFactorEnabled: "web.two_factor_enabled"`, `webTwoFactorDisabled: "web.two_factor_disabled"`, `webBackupCodesGenerated: "web.backup_codes_generated"`, `webBackupCodeUsed: "web.backup_code_used"`, `webTwoFactorLocked: "web.two_factor_locked"` (data `locked_until`). Rules:
  - `two_factor_enabled`: `/two-factor/verify-totp` succeeded with `ctx.context.session` set and `newSession` set (enrolment replaces the session, F2; a code check of a user who already has TOTP makes no new session).
  - `two_factor_disabled`: `/two-factor/disable` succeeded (actor `ctx.context.session.user.id`).
  - `backup_codes_generated`: `/two-factor/generate-backup-codes` succeeded.
  - Data of each row: `{ via: "web" }` plus the fields named here; never a code, a secret or a URI.
- **D8 One row per code lock**: after a sign-in verify answers `401` with code `INVALID_CODE` or `INVALID_BACKUP_CODE`, the plugin reads the user id from the challenge cookie (F8) and the row; it reports `two_factor_locked` with `{ locked_until: <ISO> }` when `failedVerificationCount === TWO_FACTOR_LOCK.maxFailedAttempts` and `lockedUntil > now`. Exactly the request whose failure reached 10 sees 10 (atomic increment), so a lock writes at most one row; two parallel failures at the tenth can write none (accepted). No mail. Why: PD-048 "lockouts". Rejected: a `lock_reported_at` column (a second migration change for a rare case).
- **D9 Turning TOTP on ends old trusted devices**: on `two_factor_enabled` (D7), the plugin deletes every `verification` row with `value` = the user id (F6). So after a reset or a turn-off, an old trust cookie never skips the code. It also ends an open reset link of that user (accepted). Why: F6 (`readSignInTwoFactorState` accepts any live trust row of the user).

**Operator, break-glass, reset**

- **D10 Operators need TOTP** (stage 04). `WebSession` gets `twoFactorEnabled: boolean` (from `getSession`, F9). `requireOperator`: a user not in `operatorUserIds` → 404 as today; an operator with `twoFactorEnabled` false → `403 { error: "two_factor_required" }` and `log.warn("operator_two_factor_required", { user_id })`. The `/operator` page guard: non-operator → the 404 page as today; operator without TOTP → `302` to `/settings?two_factor=required`. `/api/me` `operator` does not change. Operator CLIs do not change (ssh to the host is the strong factor). Why: P1, ADR 0027. Rejected: a DB read per request (the session read already holds the user).
- **D11 Break-glass designation** (stage 05): `memberships.break_glass`. Only the operator sets or clears it, with the CLI `org:break-glass --org-id <uuid> [--user-id <uuid> | --clear]` (no option after `--org-id` = list). Tenancy service `setBreakGlassOwner(db, ctx, { userId, actor, now })` → `{ kind: "set" | "unchanged" | "not_found" | "not_owner" | "no_two_factor" }`, `clearBreakGlassOwner(db, ctx, { actor, now, reason })` → `{ kind: "cleared"; userId } | { kind: "none" }`. Set: lock the organization (`lockOrganization`), check the membership is `owner` and `users.two_factor_enabled` is true, clear any other designation of the organization, set this one, audit `org.break_glass_set` (`{ user_id }`) and, when another user lost it, `org.break_glass_cleared` (`{ user_id, reason: "replaced" }`), one transaction. Why: P4. Rejected: an owner choice in the panel (the SSO setup that needs it is operator-only too, PD-041); default, owner to confirm (questions.md Q1).
- **D12 The break-glass owner cannot turn TOTP off** (stage 05): `hooks.before` on `/two-factor/disable` reads the session user (`getSessionFromCtx`) and calls `AuthDeps.keepsTwoFactor(userId)` (absent = false); true → `403` with code `BREAK_GLASS_NEEDS_TWO_FACTOR`, nothing changes. `web.ts` passes `isBreakGlassOwner(db, userId)` (tenancy repo, user-scoped). An operator may turn TOTP off; the console then refuses (D10). A designation and a turn-off at the same second can leave a break-glass owner without TOTP (accepted: identity B's exception asks for TOTP at sign-in anyway, so such an owner gets no bypass). Why: P1; the designation checks TOTP only once.
- **D13 Operator reset** (stage 06): CLI `web:two-factor-reset --org-id <uuid> --user-id <uuid>` → tenancy service `resetTwoFactor(db, ctx, { userId, actor: "cli", now })` in one transaction: `resetTwoFactorRows(trx, userId)` (`platform/auth-two-factor-reset.ts`, D4: delete the `auth_two_factors` row, set `users.two_factor_enabled = false`, delete `auth_verifications` rows with `value` = user id, delete the user's `auth_sessions`; returns `{ hadTwoFactor, sessionsEnded }`), clear `break_glass` on every membership of the user with one `org.break_glass_cleared` row (`{ user_id, reason: "two_factor_reset" }`) in each such organization, and one `web.two_factor_reset` row (`{ via: "cli", sessions_ended }`, actor `cli`) in the given organization. The user then signs in with the password only and can enrol again. A repeat run changes nothing more and still prints the result. It also repairs the two mixed states of D22. Why: a member who lost the phone and the codes must get back in; the operator checks the person out of band (docs, stage 13). `docs/code-patterns.md` gets `resetTwoFactorRows` as the second exception to "only Better Auth touches the auth tables" (stage 13). Rejected: Better Auth internal-adapter calls (no single transaction with the membership change and the audit).

**Status and web**

- **D14 Status route** (stage 07): `GET /api/me/two-factor` (any member, own user; a read, so suspended organizations work) → `twoFactorStatusSchema` in `@ea/core/web`: `{ enabled: boolean, backupCodesLeft: number | null, requiredBy: ("operator" | "break_glass")[] }`. `enabled` = `users.two_factor_enabled`; `backupCodesLeft` = the count from `viewBackupCodes` (never the codes; null when off or when the read fails, with `log.warn("two_factor_codes_unreadable", { user_id })`); `requiredBy` holds `operator` when the user is in `operatorUserIds` and `break_glass` when the user's membership in the session organization has `break_glass`. `TenancyRouteDeps` gets `twoFactor: (userId) => Promise<{ enabled: boolean; backupCodesLeft: number | null }>` (web.ts: `twoFactorState(handle, userId)`). Why: the panel needs the state without `/api/me` changes (F098 stage 04 changes `meSchema`; this keeps the files apart).
- **D15 Web client**: `authClient` gets `plugins: [twoFactorClient()]` from `better-auth/client/plugins` (no options: the login page reads `data.twoFactorRedirect`). Calls: `authClient.twoFactor.enable({ password })`, `.verifyTotp({ code, trustDevice })`, `.verifyBackupCode({ code, trustDevice })`, `.disable({ password })`, `.generateBackupCodes({ password })` (F1, probe P5).
- **D16 Login code step** (stage 08): after `signIn.email` returns `data.twoFactorRedirect`, the login page shows the code step: a 6-digit input (`autocomplete="one-time-code"`, `inputMode="numeric"`), the switch "Trust this device for 30 days" (off by default), the link "Use a backup code" (a second input for `xxxxx-xxxxx`), and "Back". Error map in `lib/two-factor-errors.ts` (exact table in stage 08). Input clean-up: TOTP removes spaces and keeps 6 digits; a backup code is trimmed only (it is case-sensitive).
- **D17 Account card section** (stages 09–10): `components/settings/TwoFactorSection.tsx` under the password form. Off: text, the alert "Your role needs two-factor sign-in" when `requiredBy` is not empty, the button "Turn on" → password → QR code (`uqr`, rendered as one SVG `<path>`; no `dangerouslySetInnerHTML`), the key in groups of 4 and the link "Open in authenticator app" (`href` = the URI) → code → the 10 backup codes once, with "Copy" (Clipboard API) and the button "I saved the codes". On: "Backup codes left: N" (a warning at 3 or fewer), "New backup codes" (password → the new codes once), "Turn off" (password). The page reads `?two_factor=required` and scrolls to the section (`id="two-factor"`).
- **D18 No feature flag.** TOTP is a security control that nothing changes for a user who does not enrol, and the operator rule cannot wait for a flag. Default, owner to confirm (questions.md Q4); it departs from PD-045 like the send limits of F099 (its Q1).
- **D19 QR library** `uqr` 0.1.3, exact pin, in `@ea/web` only (stage 09, the only `bun.lock` change). Default, owner to confirm (questions.md Q3). Rejected: no QR (a 52-character key typed on a phone); a QR service on the internet (the secret would leave the server).
- **D20 Texts** in `apps/web/src/i18n/en.ts`; the stage files give the Polish text of every key. If `apps/web/src/i18n/pl.ts` exists when the stage builds (F098 stage 02 landed), add the Polish texts there too (its type makes it required). If not, add only `en.ts`; the coordinator points the F098 stage 02 worker at the Polish column of F105 stages 08 and 10.
- **D21 Security log kinds** (stage 12, after F099 stages 12–13): `securityEvents` gets `web.two_factor_enabled` → `two_factor_on`, `web.two_factor_disabled` → `two_factor_off`, `web.two_factor_reset` → `two_factor_reset`, `web.backup_codes_generated` → `backup_codes_new`, `web.backup_code_used` → `backup_code_used`, `web.two_factor_locked` → `two_factor_locked`, `org.break_glass_set` → `break_glass_set`, `org.break_glass_cleared` → `break_glass_cleared`; `securityEventKinds` gets the eight kinds; `en.ts` (and `pl.ts`) get `sec_kind_<kind>`. `listSecurityLog` already reads `data.locked_until`, so the code lock shows its end time.

**Edge cases**

- **D22 Crash and repeat.** The plugin writes without a transaction: (a) enrolment verify sets `users.two_factor_enabled` and then `verified`; a crash between leaves a user whose TOTP code fails at sign-in (`TOTP_NOT_ENABLED`) while backup codes still work; (b) disable sets the user flag false and then deletes the row; a crash between leaves "off" in the panel and `TOTP_ALREADY_ENABLED` on the next enable. Both: the operator reset (D13) repairs them; the web maps `TOTP_ALREADY_ENABLED` to "ask the operator to reset two-factor sign-in". Two parallel enrolments: `UNIQUE (user_id)` makes the second fail (stage 02 test 14). The reset (D13) is one transaction and can run again.
- **D23 Two tenants, removed members.** `auth_two_factors` and `users.two_factor_enabled` are per user, not per organization; a user in two organizations has one second factor. `break_glass` is per membership; the unique index holds one per organization. No code removes a membership today (F12); the delete ticket (F106) deletes memberships by cascade, which takes the flag.
- **D24 Clocks.** The plugin uses `Date.now()` (F4, F5): tests compute codes with the real clock (`totpCode(secret)` helper of stage 02) and move a lock into the past with SQL; they never fix the clock for the code step. The password lockout keeps `AuthDeps.now`.
- **D25 Secrets.** A TOTP secret, an `otpauth` URI, a typed code and a backup code never reach a log line, an error text, an audit row, an operator notice or a test snapshot. The server never logs `enable` or `generate-backup-codes` bodies (the HTTP log has method, route, status, ms). `WEB_AUTH_SECRET` encrypts the secrets and codes (F2): a new secret makes every second factor unreadable; `deploy/README.md` says so and names the reset CLI (stage 13).
- **D26 TOTP replay inside the ±30 s window is accepted** (F4): a stolen code needs the password too, and the window is short. Default, owner to confirm (questions.md Q5).
- **D27 Seams for later tickets.** Identity B (F119): "SSO required" refuses password sign-in except for the member with `memberships.break_glass` and TOTP on (`isBreakGlassOwner`, D12), and its console may show the designation. Account data (F106): `auth_two_factors` goes with the user (cascade); `memberships.break_glass` goes with the membership; no address data in either (the DSR map needs no row). The operator console (F099) may later list 2FA states; not in this plan.

## Done when

Every line maps to a stage test or check (stage in brackets).

1. A member enrols in the Account card (password, QR, code), sees 10 backup codes once, and the next sign-in asks for a code [02, 10, 11].
2. Sign-in with password and a right TOTP code or an unused backup code makes a session; a used backup code, a wrong code, an expired challenge or no code makes none [02, 08, 11].
3. Ten wrong sign-in codes lock the code step for 15 minutes (429, also for a right code) and write one `web.two_factor_locked` row [03].
4. A trusted device skips the code for 30 days; after TOTP is turned on again, an old trust cookie no longer skips it [02, 03].
5. Every sign-in writes one `web.login` with `second_factor` `none`, `totp`, `backup_code` or `trusted_device`; a sign-in that waits for its code writes none [02].
6. TOTP on, off, new backup codes, a used backup code, the lock, the reset and each break-glass change write one audit row each, with ids and codes only [03, 05, 06].
7. An operator without TOTP gets `403 two_factor_required` on `/api/operator/*` and a redirect from `/operator` to `/settings?two_factor=required`; a non-operator still gets 404 [04].
8. `org:break-glass` sets one break-glass owner per organization, refuses a non-owner and a user without TOTP; that owner's `/two-factor/disable` answers `403 BREAK_GLASS_NEEDS_TWO_FACTOR` [05].
9. `web:two-factor-reset` turns TOTP off, ends the sessions and trusted devices, clears break-glass, and the user signs in with the password only [06].
10. `GET /api/me/two-factor` gives `enabled`, `backupCodesLeft`, `requiredBy` and never a code [07].
11. No log line, error text, audit row or test snapshot holds a TOTP secret, an `otpauth` URI, a code or a backup code (log capture in stages 02, 03, 06; e2e console check in 11) [02, 03, 06, 11].
12. The owner security log shows the eight new kinds with texts [12]; the docs, the capability page and ADR 0026 describe the landed rules [13]; on the VPS the owner enrols TOTP and the console works [14].

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, `ticket.md`, this file and your stage file first. Build only your stage.
- Format only the files of your stage: `bunx prettier --write <files>`. Never the whole repo.
- **Secrets (D25):** no TOTP secret, `otpauth` URI, typed code, backup code, password, session token or e-mail address in a log line, an error text, an audit row, an operator notice or a test snapshot. Logs hold ids, codes, counts and times. Tests that drive the code step capture the log (`spyOn(console, "log" | "warn" | "error")`, as `web-lockout.test.ts` does) and assert that no captured line holds the secret, any backup code, the typed code or `otpauth`.
- New log lines are events (`log.warn("operator_two_factor_required", { user_id })`), fields from `platform/log-fields.ts` only (`user_id`, `count`, `code`, `kind`, `reason` exist). `platform/` files fail the lint on an old-form line. CLI output goes to `process.stdout.write` (as `org-status.ts` does); CLI errors are event lines.
- The repo is public: no tailnet name, VPS address, real name or real address in a file. Test addresses end in `@x.test`.
- **Better Auth rate limit (F5):** `/two-factor/*` allows 3 requests per 10 s per client address. Every test request carries a fresh `x-client-ip` (`nextIp()` as in `web-lockout.test.ts`); a test that checks the limit uses one fixed address on purpose. E2e: each sign-in in its own browser context with `nextAddress(50 | 150)`.
- **TOTP in tests (D24):** codes come from `totpCode(secretBase32, atMs = Date.now())` in `apps/server/test/totp.ts` (stage 02 adds it; RFC 6238 with `node:crypto`, SHA-1, 6 digits, 30 s). The e2e spec has its own copy in `apps/web/e2e/totp.ts` (stage 11; the e2e runner does not import server test files). Never import `@better-auth/utils` in tests (a transitive dependency).
- A stage that changes a type or a required field fixes every caller and every test fake in the same stage.
- Stage files by explicit path (`git add <paths>`), never `git add -A`. Review `git diff --staged` before each commit.
- Only stage 01 adds a migration. Only stage 09 changes `bun.lock` and `package.json` dependencies. Any other need → stop and ask.
- e2e (stage 11 only): Playwright with the system Chromium. Before the first e2e run, give the job its own e2e database: `sed -i -E '/^E2E_(MIGRATOR_)?DATABASE_URL=/d' .env`, then `bun run db:worktree f105_s11_e2e | grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' | sed 's/^/E2E_/' >> .env`. Never point e2e at the shared `email_assistant_e2e`. Run `test:e2e` only under `flock /tmp/email-assistant-shared-tests.lock` (fixed ports 8081 and 8092).
- A gap or a deviation is a question in your final message, not a choice.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message list as proven only what a saved log shows. `test:int:ci` needs no lock: each job has its own DB (`CLAUDE.md`).

Server and core stages (01–07, 12; NN = the stage number):

```
mkdir -p /tmp/f105-sNN && bun run lint > /tmp/f105-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f105-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f105-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f105-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages (08, 09, 10, and 12 when it changes `en.ts`): the same chain with `&& bun run web:build > /tmp/f105-sNN/web.log 2>&1` before `&& echo PROOF_OK`.

Stage 11 (e2e): the web chain with `&& flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f105-s11/e2e.log 2>&1` before `&& echo PROOF_OK` (the whole suite: the seed change touches every spec).

Stage 13 (docs; `<files>` = the files the stage changed):

```
mkdir -p /tmp/f105-s13 && bunx prettier --check <files> > /tmp/f105-s13/prettier.log 2>&1 && bun run lint > /tmp/f105-s13/lint.log 2>&1 && bun run test:unit:ci > /tmp/f105-s13/unit.log 2>&1 && echo PROOF_OK
```

Stage 14 has its own checks (stage file).

## Owner steps

No owner checkpoint (owner decision 2026-11-13). Owner steps only for the owner's hands:

| #   | Step | When |
| --- | ---- | ---- |
| U1  | None for the shared dev DB: the coordinator runs `bun run db:migrate` in the main checkout after stage 01 lands (no `test:int` running there). | after stage 01 |
| U2  | Sign in to the panel on the VPS, turn on two-factor sign-in in Settings → Account with your phone's authenticator app, keep the backup codes. Until then the operator console answers "two-factor sign-in required" for you. | stage 14, after the deploy |

## Review

- A review job before the land for stages 01, 02, 03, 04, 05, 06 (`[risky]`: migration, auth, security) and 08 (the sign-in page). Model: the board's reviewer (`spec/build.md` TRACK). Other stages land on the worker's proof.
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
| 03  | [2FA audit rows, code lock row, trusted-device end](stages/stage-03-two-factor-events.md) | ~250 lines | A | `[risky]` auth, audit |
| 04  | [Operators need TOTP](stages/stage-04-operator-needs-totp.md) | ~180 lines | B | `[risky]` auth |
| 05  | [Break-glass owner](stages/stage-05-break-glass.md) | ~300 lines | A | `[risky]` auth, data |
| 06  | [Operator reset](stages/stage-06-operator-reset.md) | ~280 lines | A | `[risky]` auth, data |
| 07  | [Status route](stages/stage-07-status-route.md) | ~200 lines | A | |
| 08  | [Login code step](stages/stage-08-login-code-step.md) | ~260 lines | C | review |
| 09  | [QR and setup helpers](stages/stage-09-qr-and-helpers.md) | ~220 lines | C | `bun.lock` |
| 10  | [Account card section](stages/stage-10-account-section.md) | ~300 lines | C | |
| 11  | [E2e seed and spec](stages/stage-11-e2e.md) | ~250 lines | C | |
| 12  | [Security log kinds](stages/stage-12-security-log-kinds.md) | ~120 lines | D | waits for F099 stages 12–13 |
| 13  | [Docs, ADR 0026, capability page](stages/stage-13-docs.md) | ~150 lines | — | |
| 14  | [VPS deploy and checks](stages/stage-14-vps.md) — coordinator only | — | — | `[risky]` real system |

Order and parallel work:

| Stage | Needs (landed) | May run next to | Why not more |
| ----- | -------------- | --------------- | ------------ |
| 01 | — | 09 | the only migration: no other migration of any ticket next to it |
| 02 | 01 | 09 | edits `platform/auth.ts`, `web.ts` |
| 03 | 02 | 04, 08, 09 | edits `platform/auth-two-factor.ts`, `web.ts` (the event map) |
| 04 | 02 | 03, 08, 09 | edits `platform/http.ts`, `web.ts` (`getSession`), test fakes |
| 05 | 03 | 08, 09 | edits `platform/auth.ts` (before hook), `web.ts`, tenancy |
| 06 | 05 | 08, 09 | tenancy service, `auth-two-factor.ts` |
| 07 | 04, 05 | 06, 08, 09 | tenancy routes, `web.ts`, `auth-two-factor.ts` (a new function at the end) |
| 08 | 02 | 03–07, 09 | web only: `LoginPage.tsx`, `auth-client.ts`, `en.ts` |
| 09 | — | 01–08 (not next to another `bun.lock` change of any ticket) | `apps/web/package.json`, `bun.lock` |
| 10 | 07, 08, 09 | 12 | `AccountCard.tsx`, `en.ts` |
| 11 | 10 | 12 | the e2e seed and the whole e2e run |
| 12 | 03, and F099 stages 12–13 | 04–11 | `packages/core/src/security-log.ts`, `en.ts` |
| 13 | 11 (and 12 if landed) | — | docs |
| 14 | 13 | — | VPS |

Migrations: **only stage 01**. `bun.lock`: **only stage 09**.

Advisory overlaps with tickets in build (start the stages anyway; on a land conflict, resume the worker to merge `master` and prove again):
- F098 (Polish UI): `apps/web/src/i18n/en.ts` and `pl.ts` (stages 08, 10, 12), `components/settings/AccountCard.tsx` (F098 stage 04, F105 stage 10), `islands/LoginPage.tsx` (F098 stage 01 landed; later F098 stages may touch the title), `modules/tenancy/routes.ts` (F098 stage 04, F105 stage 07), the e2e seed (F098 stage 03).
- F099 (platform controls): `AccountCard.tsx` (F099 stage 13), `platform/http.ts` (F099 stage 06 landed), `modules/audit/repo.ts` (`auditEvents`), `packages/core/src/security-log.ts` (stage 12 of this plan builds on it).
- F101 (Astro 7): `apps/web/package.json` and `bun.lock` (stage 09 here): never at the same time.
- F103 (log events): `web.ts` and `platform/auth.ts` log lines.

## How to run (coordinator)

1. Before the first spawn: F082 is in `spec/features/done/` (true). Run `scripts/plan-drift.sh spec/features/planned/F105-e7-t6-identity-a-totp-backup-codes-break-glass 163c7b2`; exit 1 → a refresh job first (`spec/build.md` NEXT, plan refresh rule). Move the ticket: `git mv spec/features/planned/F105-e7-t6-identity-a-totp-backup-codes-break-glass spec/features/active/`, commit.
2. Spawn one stage (NN = two digits, `<slug>` from the stage list):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "F105-sNN <slug> · F105" \
     "Implement F105 stage NN. Read spec/features/active/F105-e7-t6-identity-a-totp-backup-codes-break-glass/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f105-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

3. Stage 01: no other migration stage of any ticket in build. Stage 09: no other `bun.lock` change of any ticket in build.
4. When the job finishes: read its final message and `/tmp/f105-sNN/*.log`. For the stages of § Review, spawn the review job and wait for it; a finding → `limen continue <job-id> "<fix>"` with the same engine flags, then review again (at most 2 rounds, then the owner decides).
5. Land: `limen land <job-id> --yes --keep-open` (stage 14: the coordinator closes the ticket with `limen ticket done F105` after its checks). Drop the job DB from the main checkout: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop` (stage 11 also `f105_s11_e2e`). After stage 01 lands: `bun run db:migrate` in the main checkout (U1).
6. Stage 12: spawn it only when F099 stages 12 and 13 are on `master`. If stage 13 is ready first, build 13 and 14 and leave 12 for later; stage 12 then deploys with the next VPS deploy of any ticket, and the ticket closes after stage 12 lands.
7. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass. A check with no proof at all → `limen continue`.

## Cold review

Not run by the planning job (the job's task: "Do not start a review; the coordinator does."). File it as `plan-review-1.md`.

## Log

- 2026-11-14: planned by a `--role planner` job (Opus 5.5) at 163c7b2. Probes P1–P5 (Better Auth 1.7.18 on a throwaway Postgres with the repo migrations; `uqr`; `tsc --strict`).
