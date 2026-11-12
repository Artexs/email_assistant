# F082 stage 03 — Reset request: open with the sender, same answer, limits, not awaited, 1 h [risky]

Part of [`../plan.md`](../plan.md). Read its F2–F4, L7–L10 and "Rules for every stage" first. Needs stages 1 and 2.

Parallel: lane A, after stage 2. Stage 8 may run at the same time.

One step.

- [ ] **3.1 `/request-password-reset` behind the sender, with the D8 rules**
  - Goal: with the sender on, anyone can ask for a reset link; the answer never shows whether the address has an account; the request does not wait for the mail; limits stop floods; the server link lives 1 hour. With the sender off nothing changes from S5 (404).
  - Files:
    - change `apps/server/src/platform/auth.ts` (`AuthDeps`, `isAllowedAuthPath`, `createAddressLimiter`, `RESET_REQUEST_ANSWER`, `hooks.before`, `rateLimit.customRules`, `resetPasswordTokenExpiresIn`) and `auth.test.ts`;
    - change `apps/server/src/platform/auth-mail.ts` (`createAuthMailTasks`) and `auth-mail.test.ts`;
    - change `apps/server/src/platform/http.ts` (`WebDeps.resetRequestOpen`, the `/api/auth/*` route);
    - change `apps/server/src/web.ts` (`WebExtras.onAuthMailFailed`, `authMailFailedHandler`, `webDeps` wiring, `close`);
    - change `apps/server/src/main.ts` (pass `onAuthMailFailed`);
    - change every `createAuth` caller for the new required field: `scripts/web-invite.ts`, `scripts/e2e-seed.ts`, and the tests that call `createAuth` (`grep -rln "createAuth(" apps/server`);
    - add `apps/server/test/integration/web-reset-request.test.ts`; add cases to `web-http.test.ts`.
  - Interfaces:

    ```ts
    // platform/auth.ts
    export interface AuthDeps {
      // … existing fields …
      resetLinkTtlSeconds: number; // required: 3_600 in the server, 86_400 in the CLIs and the e2e seed
      now?: () => Date; // default () => new Date(); the address limit (and stage 5) read it
      sendResetPassword?: (input: { userId: string; email: string; url: string }) => Promise<void>; // `email` is new
    }
    export const RESET_REQUEST_PATH = "/request-password-reset";
    export const RESET_REQUEST_ANSWER = {
      status: true,
      message: "If this email exists in our system, check your email for the reset link",
    } as const; // equals Better Auth's own answer (F3)
    export function isAllowedAuthPath(method: string, path: string, opts?: { resetRequest: boolean }): boolean;
    export interface AddressLimiter { take(key: string): boolean } // true = allowed; it records the request
    export function createAddressLimiter(opts: { max: number; windowMs: number; now: () => Date }): AddressLimiter;

    // platform/auth-mail.ts
    export interface AuthMailTasks {
      start(mail: Omit<AuthMail, "locale">): void; // never throws; reads the locale, sends, reports a failure
      idle(): Promise<void>; // resolves when no send is running (tests, shutdown)
    }
    export function createAuthMailTasks(deps: {
      mailer: AuthMailer;
      localeOf: (userId: string) => Promise<UserLocale>; // a failure → "pl"
      onFailed: (userId: string, kind: AuthMailKind, code: string) => void;
    }): AuthMailTasks;

    // platform/http.ts — WebDeps
    resetRequestOpen?: boolean; // absent = false: /request-password-reset answers 404

    // web.ts
    export interface WebExtras { /* … */ onAuthMailFailed?: (ctx: TenantContext, userId: string, kind: AuthMailKind, code: string) => void }
    // Finds the user's oldest membership (listMembershipsOfUser), then calls notify. Never throws; no membership → nothing.
    export function authMailFailedHandler(db: Db, notify: WebExtras["onAuthMailFailed"]): (userId: string, kind: AuthMailKind, code: string) => void;
    ```

  - Decisions:
    - `isAllowedAuthPath` (L9): the eight paths as today; `POST /request-password-reset` only when `opts?.resetRequest === true`; `GET /request-password-reset` never. `AUTH_ALLOWED_PATHS` keeps its 8 entries. `createApp` passes `{ resetRequest: web.resetRequestOpen === true }`.
    - `hooks.before` (one `createAuthMiddleware` dispatcher in `createBetterAuth`; later stages add paths to it): on `RESET_REQUEST_PATH`, `key = String(ctx.body?.email ?? "").trim().toLowerCase()`; `if (!resetLimiter.take(key)) { log.info("web: reset request over the address limit"); return ctx.json(RESET_REQUEST_ANSWER); }` (F2). `resetLimiter = createAddressLimiter({ max: 3, windowMs: 3_600_000, now })` per `createAuth` call (L10).
    - `createAddressLimiter`: a `Map<string, number[]>` of request times; `take` drops times older than `now − windowMs`, returns `false` when `max` remain, else pushes `now` and returns `true`. When the map holds more than 10 000 keys, `take` first deletes every key whose times are all old.
    - `rateLimit.customRules` gets `"/request-password-reset": { window: 900, max: 3 }`. `resetPasswordTokenExpiresIn: deps.resetLinkTtlSeconds`.
    - `sendResetPassword` of Better Auth passes `{ userId: user.id, email: user.email, url }` to `deps.sendResetPassword`.
    - `createAuthMailTasks` (L8): `start` creates one promise `(async () => { const locale = await localeOf(userId).catch(() => "pl"); const result = await mailer.send({ ...mail, locale }); if (!result.ok) onFailed(mail.userId, mail.kind, result.code); })()`, wrapped so it never rejects (a throw → `log.error` with `describeError`, no address); it is kept in a `Set` until it settles; `idle` waits for the set to be empty.
    - `webDeps` (`web.ts`): `const settings = authMailSettings(config)`; `const mailer = settings === null ? null : createAuthMailer(settings)`; with a mailer, `mailTasks = createAuthMailTasks({ mailer, localeOf: async (userId) => (await getUserAuthProfile(db, userId))?.locale ?? "pl", onFailed: authMailFailedHandler(db, extras.onAuthMailFailed) })`. `createAuth({ …, resetLinkTtlSeconds: 3_600, sendResetPassword: mailTasks === null ? undefined : async ({ userId, email, url }) => { mailTasks.start({ kind: "reset", userId, to: email, url }); } })`. `resetRequestOpen: mailer !== null`. Log once: `auth mail: on (reset by e-mail is open)` or `auth mail: off (the CLI prints invite and reset links)`. `close()` (when `mailTasks` is set) awaits `Promise.race([mailTasks.idle(), new Promise((resolve) => setTimeout(resolve, 5_000))])` (the shutdown of `main.ts` already waits up to 40 s; its whole grace is 45 s) and then `handle.close()`.
    - `main.ts`: `webDeps(config, db, { …, onAuthMailFailed: (ctx, userId, kind, code) => operator.authMailFailed(ctx, userId, kind, code, new Date()) })`.
    - CLIs and the e2e seed pass `resetLinkTtlSeconds: 86_400` (their links stay 24 h). Tests that call `createAuth` pass `86_400` unless the test is about the 1 h value.
  - Test (`web-reset-request.test.ts` uses `createAuth` and `auth.handler(new Request(…))` as `web-auth.test.ts` does, with `origin: BASE_URL` and a distinct `x-client-ip` per request unless the test says otherwise):
    1. A known address and an unknown address → both `200`, the bodies are byte-equal, and equal `JSON.stringify(RESET_REQUEST_ANSWER)`.
    2. Not awaited: `sendResetPassword` = `tasks.start(…)` with a fake mailer whose `send` waits 3 000 ms → the request answers in under 1 000 ms; after `await tasks.idle()` the fake got one mail with `kind "reset"`, the user id, `to` = the address, a `url` holding `/api/auth/reset-password/`, and the locale from `localeOf`.
    3. Per address: 4 requests for one known address from 4 client addresses → four `200` with equal bodies; the fake mailer got 3 mails. The 4th request uses the address in upper case and still counts.
    4. Per client: 4 requests from one `x-client-ip` for 4 different unknown addresses → the 4th answers `429`.
    5. Expiry: with `resetLinkTtlSeconds: 3_600`, the new `auth_verifications` row of the user (`WHERE value = <user id>`) has `expires_at − created_at` between 3 595 and 3 605 seconds.
    6. A fake mailer that returns `{ ok: false, code: "EAUTH" }` → `onFailed` called once with `(userId, "reset", "EAUTH")`.
    7. `authMailFailedHandler`: a user with a membership → `notify` called with the oldest organization; a user without one → not called, no throw.
    8. `web-http.test.ts`: `webDeps(loadConfig(env), …)` with the six `AUTH_*` keys set to `""` on top of `...process.env` (a dev `.env` may hold real keys) → `POST /api/auth/request-password-reset` answers `404 {"error":"not_found"}`; with the four keys (`AUTH_SMTP_HOST=127.0.0.1`, `AUTH_SMTP_PORT=1`, user, password, from) → `200` and the body of test 1.
    9. `auth.test.ts`: `isAllowedAuthPath("POST", "/request-password-reset")` → `false`; with `{ resetRequest: true }` → `true`; `GET` with `{ resetRequest: true }` → `false`; `AUTH_ALLOWED_PATHS.size === 8`.
    10. `auth.test.ts`: `createAddressLimiter({ max: 3, windowMs: 3_600_000, now })`: three `take("a")` → `true`, the 4th → `false`; `take("b")` → `true`; with `now` + 61 min → `take("a")` → `true`.
    11. The log captured during tests 1–6 has no line holding the test address, `reset-password/` or a token.
  - Check: Proof (server form, `/tmp/f082-s03`).
  - Done when: the tests pass, every earlier test still passes, and the Proof printed `PROOF_OK`.
  - Out of scope: the `/forgot` page (stage 10); the invite CLIs (stage 4); the lockout mail (stage 5).
