# F143 stage 09 — auth wiring by part [risky]

Needs: nothing. May run next to every other stage.
Part of [`../plan.md`](../plan.md). Review: Opus, before the land (sign-in, reset, second factor, SSO: security).

## Goal

`createBetterAuth` in `apps/server/src/platform/auth.ts` (a 272-line function; the file is 624 lines) only assembles parts that the `auth-*.ts` files export. Every check runs for the same paths, in the same order, and fails closed as at `HEAD`. Decision D11; quality pass 2 finding 11.

## Step 1 — the part runner

- **File:** `apps/server/src/platform/auth-hooks.ts`.
- **Interface:**
  ```ts
  export interface AuthHookPart {
    name: string;
    /** Before Better Auth handles the request. A value other than undefined is the answer and ends the chain; a throw refuses. */
    before?(ctx: AuthHookCtx): Promise<unknown>;
    /** After Better Auth handled the request. A throw is logged by the part itself, as at HEAD. */
    after?(ctx: AuthHookCtx): Promise<void>;
  }
  export function runBefore(parts: readonly AuthHookPart[], ctx: AuthHookCtx): Promise<unknown>;
  export function runAfter(parts: readonly AuthHookPart[], ctx: AuthHookCtx): Promise<void>;
  ```
  `AuthHookCtx` is the middleware context type that `createAuthMiddleware` gives at `HEAD`.
- `createBetterAuth` keeps one `hooks.before` and one `hooks.after` middleware; each calls the runner with the ordered list.

## Step 2 — the parts

- Each `auth-*.ts` file exports `hooksOf(deps): AuthHookPart[]` and, where it has one, `pluginsOf(deps)`: `auth-sso.ts` (the SSO body check; the SSO plugins), `auth-lockout.ts` (the sign-in lock before, the record after), `auth-two-factor.ts` (the second-factor check; `twoFactorPlugin()`), `auth-sso-required.ts` (the reset and password-sign-in refusal) if it fits there. The reset limiter, the terms check of a reset, the pwned-password check and the revoke reports go to a new `auth-password.ts` if no existing file has their topic.
- **Order:** before the move, write down the order of the checks for each path at `HEAD` (`/sign-in/email`, `/request-password-reset`, `/reset-password`, the new-password paths, the second-factor paths, the SSO sign-in path) and the `after` steps. The assembled list must give the same order for each path. At `HEAD`, a locked user gets the lock answer before the SSO-required refusal; keep it.
- **Plugins:** the order stays `twoFactorPlugin()`, the SSO plugins, the audit plugin last (it reads the result of the code step).
- `databaseHooks`, `emailAndPassword`, the session fields and `onAPIError` may stay in `auth.ts` or move with their topic; no behaviour change.
- `auth.ts` keeps every export it has at `HEAD` (D7). Each `auth*.ts` file ≤ 400 lines.

## Test

`apps/server/src/platform/auth-hooks.test.ts`:
1. Three fake parts, the second returns `{ answer: 1 }`: `runBefore` returns it, the third part does not run.
2. The second part throws `APIError`: `runBefore` rejects with it, the third does not run.
3. All return undefined: all three run in order, the result is undefined.
4. `runAfter` runs every `after` in order; a part with no `after` is skipped.
5. The assembled part names of `createBetterAuth` (export the list builder for the test, or read it from a test hook) equal the fixed list written in step 2, in order.
6. The plugin ids of the assembled config equal the fixed list read at `HEAD`, in order.

Existing integration guards, unchanged and all passing: sign-in lockout, password reset (limiter, SSO-required refusal, terms), two-factor on, off and codes, SSO sign-in and the 12 h end, pwned check, session revoke audit rows (`apps/server/test/integration/web-*.test.ts`, `auth-*.test.ts`; grep for the full set).

Guard check: drop the lockout part from the list in a scratch edit; case 5 and the lockout integration test fail. Revert. Write it in the final message.

## Done when

- Cases 1–6 pass; the guard check fails as stated; `createBetterAuth` ≤ 120 lines.
- Proof: `mkdir -p /tmp/f143-s09 && bun run lint > /tmp/f143-s09/lint.log 2>&1 && bun run typecheck > /tmp/f143-s09/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f143-s09/unit.log 2>&1 && bun run test:int:ci > /tmp/f143-s09/int.log 2>&1 && echo PROOF_OK`

## Out of scope

A new check, a changed path list (`AUTH_ALLOWED_PATHS`), a Better Auth upgrade, `bun.lock`. No history merge: the code moves into files that have their own history.
