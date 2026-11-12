# F082 stage 05 — Lockout [risky]

Part of [`../plan.md`](../plan.md). Read its F1, F2, L11–L13, B4 and "Rules for every stage" first. Needs stages 1–3 (`auth_lockouts`, the mail tasks, the `hooks.before` dispatcher, `AuthDeps.now`).

Parallel: lane A, after stage 3. Stage 4 and stage 8 may run at the same time.

One step.

- [ ] **5.1 10 failed sign-ins in 15 minutes lock the user for 15 minutes**
  - Goal: password guessing against one account stops after 10 tries; the answer and its time do not show the lock; the user learns it by mail (when the sender is on); a reset ends the lock.
  - Files:
    - add `apps/server/src/platform/auth-lockout.ts`;
    - change `apps/server/src/platform/auth.ts` (`AuthDeps`, `AuthEventKind`, the hooks, `onPasswordReset`) and `auth.test.ts` if a type there changes;
    - change `apps/server/src/modules/audit/repo.ts` (`webLoginLocked: "web.login_locked"`, data `via`, `locked_until`);
    - change `apps/server/src/web.ts` (`eventNames`, `auditWebEvent` data, `lockout`, `sendLockoutMail` wiring);
    - change `docs/code-patterns.md` § Data access (the lockout functions);
    - add `apps/server/test/integration/web-lockout.test.ts`.
  - Interfaces:

    ```ts
    // platform/auth-lockout.ts — user-scoped, no TenantContext (listed in docs/code-patterns.md)
    export const LOCKOUT_MAX_FAILURES = 10;
    export const LOCKOUT_WINDOW_MS = 15 * 60_000;
    export const LOCKOUT_MS = 15 * 60_000;
    export const LOCKOUT_MAILS_PER_DAY = 3;
    export interface LockoutStore {
      isLocked(userId: string, now: Date): Promise<boolean>;
      recordFailure(userId: string, now: Date): Promise<{ lockedUntil: Date } | null>; // non-null only for the failure that locked
      recordSuccess(userId: string, now: Date): Promise<void>;
      clear(userId: string, now: Date): Promise<void>; // after a successful password reset
      claimMail(userId: string, now: Date): Promise<boolean>; // true = this lock may send a mail (max 3 per UTC day)
    }
    export function createLockoutStore(db: Db): LockoutStore;

    // platform/auth.ts
    export type AuthEventKind = "login" | "password_set" | "password_changed" | "login_locked";
    export interface AuthDeps {
      // … stage 3 fields …
      onEvent: (kind: AuthEventKind, userId: string, data?: Record<string, string>) => Promise<void>;
      lockout?: LockoutStore; // absent = no lockout (CLIs; tests that do not test it)
      sendLockoutMail?: (input: { userId: string; email: string }) => void; // never throws, never awaited
    }
    ```

  - SQL (Kysely `sql` template; `windowStart = new Date(now − LOCKOUT_WINDOW_MS)`, `day = now.toISOString().slice(0, 10)`):

    ```sql
    -- recordFailure, statement 1 (RETURNING failed_count)
    INSERT INTO auth_lockouts (user_id, window_started_at, failed_count, updated_at)
    VALUES (${userId}, ${now}, 1, ${now})
    ON CONFLICT (user_id) DO UPDATE SET
      failed_count = CASE WHEN auth_lockouts.window_started_at <= ${windowStart} THEN 1 ELSE auth_lockouts.failed_count + 1 END,
      window_started_at = CASE WHEN auth_lockouts.window_started_at <= ${windowStart} THEN ${now} ELSE auth_lockouts.window_started_at END,
      updated_at = ${now}
    RETURNING failed_count;
    -- recordFailure, statement 2, only when failed_count >= 10 (a conditional update: two parallel 10th failures lock once)
    UPDATE auth_lockouts SET locked_until = ${now + LOCKOUT_MS}, failed_count = 0, window_started_at = ${now}, updated_at = ${now}
    WHERE user_id = ${userId} AND failed_count >= 10
    RETURNING locked_until;
    -- isLocked
    SELECT locked_until FROM auth_lockouts WHERE user_id = ${userId};   -- locked when locked_until > now
    -- recordSuccess
    UPDATE auth_lockouts SET failed_count = 0, updated_at = ${now} WHERE user_id = ${userId} AND failed_count > 0;
    -- clear
    UPDATE auth_lockouts SET failed_count = 0, locked_until = NULL, updated_at = ${now} WHERE user_id = ${userId};
    -- claimMail (true when a row comes back)
    UPDATE auth_lockouts SET
      mail_count = CASE WHEN mail_day = ${day}::date THEN mail_count + 1 ELSE 1 END,
      mail_day = ${day}::date,
      updated_at = ${now}
    WHERE user_id = ${userId} AND (mail_day IS DISTINCT FROM ${day}::date OR mail_count < 3)
    RETURNING mail_count;
    ```

  - Decisions:
    - `hooks.before`, path `/sign-in/email`, only when `deps.lockout` is set (L13). First the input checks of Better Auth's endpoint (`api/routes/sign-in.mjs`: `z.email()` on the raw address, then `assertPasswordNotTooLong`): when `typeof ctx.body?.email !== "string"`, `typeof ctx.body?.password !== "string"`, `!z.email().safeParse(ctx.body.email).success` (no trim: Better Auth does not trim) or `ctx.body.password.length > 128` → return and let the endpoint answer its own 400. Else `found = await ctx.context.internalAdapter.findUserByEmail(ctx.body.email.toLowerCase())`; when `found` and `await deps.lockout.isLocked(found.user.id, now())`: `await ctx.context.password.hash(ctx.body.password)`, then `throw APIError.from("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" })` (F1). An error of `isLocked` is not caught (fail closed: 500). Why the input checks first: without them a locked user would get 401 where any other user gets 400, and that shows the lock (cold review finding 1).
    - `hooks.after`, path `/sign-in/email`, only with `deps.lockout`, inside `try { … } catch (error) { log.error(\`web: lockout: ${describeError(error)}\`) }` (the answer never changes):
      - `ctx.context.returned` is an `APIError` with `statusCode === 401` and `body?.code === "INVALID_EMAIL_OR_PASSWORD"` → find the user with `ctx.body.email.toLowerCase()`; none → nothing; else `lock = await recordFailure(id, now())`; `lock !== null` → `await report("login_locked", id, { locked_until: lock.lockedUntil.toISOString() })`, then, when `deps.sendLockoutMail` is set and `await claimMail(id, now())`, `deps.sendLockoutMail({ userId: id, email: found.user.email })`.
      - not an error and `ctx.context.newSession?.user.id` set → `recordSuccess(that id, now())`.
    - `onPasswordReset`: after `report("password_set", …)`, `await deps.lockout?.clear(user.id, now())` inside `try`/`catch` with `log.error`.
    - `report(kind, userId, data?)` passes `data` to `deps.onEvent`. `auditWebEvent` writes `data: { via: "web", ...data }`; `eventNames.login_locked = auditEvents.webLoginLocked`.
    - `web.ts`: `lockout: createLockoutStore(db)` always; `sendLockoutMail` only with mail tasks: `({ userId, email }) => mailTasks.start({ kind: "lockout", userId, to: email, url: \`${baseUrl.origin}/forgot\` })` (B4: only the user).
    - `docs/code-patterns.md`: add "`createLockoutStore` functions (`platform/auth-lockout.ts`, S6b): the user gives the row; the table `auth_lockouts` has no `org_id` and goes with the user by cascade."
  - Test (`web-lockout.test.ts`; `createAuth` with `lockout: createLockoutStore(db)`, a fake `sendLockoutMail` that records calls, `now: () => clock` with `clock = new Date("2026-11-20T10:00:00Z")`; every sign-in request gets its own `x-client-ip` so the Better Auth rate limit never answers; each test makes its own owner with a password set through a reset as `web-auth.test.ts` does):
    1. 10 wrong passwords → the 10th answers the same 401 body as the 1st; the row has `locked_until = 10:15:00Z`; one `web.login_locked` audit row with `data.locked_until = "2026-11-20T10:15:00.000Z"`; `sendLockoutMail` called once with the user id and address.
    2. Locked: the correct password → `401`, body byte-equal to a wrong-password body, no `set-cookie`; a wrong password during the lock leaves `failed_count = 0`.
    3. `clock = 10:15:01Z` → the correct password → `200` with a session cookie.
    4. Locked, then a password reset (token from `requestPasswordReset`, `resetPassword` with a new password) → `locked_until IS NULL`; the new password signs in at the same `clock`.
    5. Mail cap: four locks on one UTC day (move `clock` 16 min forward before each round of 10 failures) → `sendLockoutMail` called 3 times; a 5th lock at `2026-11-21T00:10:00Z` → called a 4th time.
    6. Window: 9 failures, `clock` + 16 min, 1 failure → `failed_count = 1`, not locked.
    7. A success resets: 9 failures, the correct password (200), 1 failure → `failed_count = 1`, not locked.
    8. An unknown address: 12 sign-ins → twelve `401` with the wrong-password body; no `auth_lockouts` row is made.
    9. Time: 5 wrong-password sign-ins (not locked; a fresh user, under 10) and 5 sign-ins of a locked user → the median time of the locked ones is between 0.5× and 2× the median of the wrong ones.
    10. Parallel: `failed_count = 9` (9 failures), then two wrong sign-ins with `Promise.all` → one `web.login_locked` row; `sendLockoutMail` called once.
    11. Without `deps.lockout` (the `web-auth.test.ts` handle): 11 wrong passwords, then the correct one → `200`.
    12. The log of tests 1–10 has no line with the test password or the address.
    13. Input checks: for a locked user and for a user who is not locked, the address `" <address>"` (a leading space) gives the same `400 INVALID_EMAIL`, and a 129-character password gives the same `400 PASSWORD_TOO_LONG`; neither request counts as a failure.
  - Check: Proof (server form, `/tmp/f082-s05`).
  - Done when: the tests pass, test 9 passes 3 runs in a row (`for i in 1 2 3; do bun test apps/server/test/integration/web-lockout.test.ts -t "median" || break; done`; paste the result), and the Proof printed `PROOF_OK`.
  - Out of scope: a lock of the client address (Better Auth's rate limit does that); a notice to other owners (B4); the lockout text in the panel (the answer stays "Wrong e-mail or password.").
