# F143 stage 09 — auth wiring by part [risky]

Needs: nothing. May run next to every other stage.
Part of [`../plan.md`](../plan.md). Review: Opus, before the land (sign-in, reset, second factor, SSO: security).

## Goal

`createBetterAuth` (`apps/server/src/platform/auth.ts`: a 272-line function in a 624-line file) only assembles parts that the `auth-*.ts` files export. Every check runs for the same paths, in the same order, and fails closed as at `HEAD`. Decision D11; quality pass 2 finding 11.

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
- **Part context:** `export interface AuthPartContext { deps: AuthDeps; now: () => Date; report: (kind, userId, data?) => Promise<void>; resetLimiter: AddressLimiter; getCodeApi(): CodeApi | null }`. `createBetterAuth` builds it once per auth instance: the reset limiter is created once (a limiter per request or per call fails open), and `getCodeApi()` reads the second-factor verify API that is set after the instance exists (a value captured when the parts are built is `null`).
- `createBetterAuth` keeps one `hooks.before` and one `hooks.after` middleware; each calls the runner with the ordered list.

## Step 2 — the parts

- Each `auth-*.ts` file exports `hooksOf(part: AuthPartContext): AuthHookPart[]` and, where it has one, `pluginsOf(deps)`: `auth-sso.ts` (the SSO body check; the SSO plugins), `auth-lockout.ts` (the sign-in lock before, the record after), `auth-two-factor.ts` (the second-factor check; `twoFactorPlugin()`), `auth-sso-required.ts` (the reset and password-sign-in refusal) if it fits there. The reset limiter use, the terms check of a reset, the pwned-password check and the revoke reports go to a new `auth-password.ts`, made with `history-copies.sh` from `auth.ts` (D5), so it keeps the history of the moved code.
- **Order:** before the move, write down the order of the checks for each path at `HEAD` (`/sign-in/email`, `/request-password-reset`, `/reset-password`, the new-password paths, the second-factor paths, the SSO sign-in path) and the `after` steps. The assembled list must give the same order for each path. At `HEAD`, a locked user gets the lock answer before the SSO-required refusal; keep it.
- **Plugins:** the order stays `twoFactorPlugin()`, the SSO plugins, the audit plugin last (it reads the result of the code step).
- `auth.ts` keeps every export it has at `HEAD` (D7), and the `expiresIn`, `minPasswordLength` and `maxPasswordLength` lines: `apps/docs/src/reference.test.ts` reads them from `auth.ts`.
- Each `auth*.ts` file ≤ 400 lines. If one is over (`auth.ts`, `auth-two-factor.ts` 365 and `auth-sso.ts` 353 before their parts), move the code of one topic to a new `auth-<topic>.ts` with a history copy; never into a helper file.

## Test

`apps/server/src/platform/auth-hooks.test.ts`:
1. Three fake parts, the second returns `{ answer: 1 }`: `runBefore` returns it, the third part does not run.
2. The second part throws `APIError`: `runBefore` rejects with it, the third does not run.
3. All return undefined: all three run in order, the result is undefined.
4. `runAfter` runs every `after` in order; a part with no `after` is skipped.
5. The assembled part names (export the list builder) equal the fixed list of step 2, in order.
6. The plugin ids of the assembled config equal the fixed list read at `HEAD`, in order.

Existing integration guards, unchanged: the lockout, reset (`web-reset-request.test.ts` catches a limiter built per request), two-factor, SSO, pwned and revoke tests in `apps/server/test/integration/`.

Guard check: drop the lockout part from the list in a scratch edit; case 5 and the lockout integration test fail. Revert. Write it in the final message.

## Done when

- Cases 1–6 pass; the guard check fails as stated; `createBetterAuth` ≤ 150 lines.
- Proof: `plan.md` § Proof with `NN=09`.

## Out of scope

A new check, a changed path list (`AUTH_ALLOWED_PATHS`), a Better Auth upgrade, `bun.lock`.
