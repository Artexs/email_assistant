# s6a-customer-core — Stage 8

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A15, S2, "Facts checked" F4 and "Rules for every step" first, and the master plan's D4.

## Stage 8 — `suspended` in the web: every write route answers `403 org_suspended` [risky]

One step. The server decides; the UI mirror is stage 16.

- [ ] **8.1 `refuseSuspendedWrites` and the route matrix**
  - Goal: a member of a `suspended` organization can sign in and read, but every `/api` write route answers `403 { error: "org_suspended" }`, except sign-out, password change and the session routes (Better Auth paths) (D4, S2). A new write route is gated without a change.
  - Files:
    - change `apps/server/src/platform/http.ts` (`WebDeps.isOrgSuspended`, `refuseSuspendedWrites`, `SUSPENDED_WRITE_ALLOW`, mounted in `createApp`);
    - change `apps/server/src/web.ts` (wire `isOrgSuspended`; move the `routers:` closure body, today `web.ts:220-253`, into an exported `apiRouters` without other change);
    - change `packages/core/src/web/errors.ts` (add `"org_suspended"` to `apiErrorCodes`) and its test;
    - change `apps/server/test/integration/web-helpers.ts` (`WebTestOptions.isOrgSuspended`, passed into `WebDeps`);
    - create `apps/server/test/integration/web-suspended.test.ts`;
    - change `docs/code-patterns.md` § "HTTP routes (S5)" (the rule below; code-patterns line 4: code and doc change in the same commit).
  - Interfaces:

    ```ts
    // platform/http.ts
    export interface WebDeps {
      /* … */ isOrgSuspended?: (orgId: string) => Promise<boolean>;
    }
    // S6c adds { method: "DELETE", path: /^\/api\/organization$/ } (delete organization).
    export const SUSPENDED_WRITE_ALLOW: readonly { method: string; path: RegExp }[] = [];
    export const refuseSuspendedWrites: MiddlewareHandler<ApiEnv>;
    // web.ts
    export function apiRouters(
      config: Config,
      db: Db,
      extras: WebExtras,
      now: () => Date
    ): NonNullable<WebDeps["routers"]>;
    ```

  - Decisions:
    - `refuseSuspendedWrites`: reads `web = c.get("web")`; passes when `web.isOrgSuspended` is undefined, or the method is `GET`, `HEAD` or `OPTIONS`, or an allow entry matches `c.req.method` and `c.req.path`; else `if (await web.isOrgSuspended(c.get("ctx").orgId)) return c.json({ error: "org_suspended" }, 403)`. A throw goes to `onError` (`500 internal`): fail closed.
    - Mount: `api.use("*", refuseSuspendedWrites)` right after `api.use("*", requireTenant(…))` (`http.ts:291`), before `web.routers?.(api)`. So it runs before `requireOwner`: an assistant also gets `org_suspended`.
    - `/api/auth/*` is mounted on `app`, outside `api` (`http.ts:282`): sign-out, `change-password`, `revoke-sessions`, `revoke-other-sessions`, `reset-password` keep working (S2). No change there.
    - `web.ts`: `routers: apiRouters(config, db, extras, now)`, `isOrgSuspended: (orgId) => isOrgSuspended(db, { orgId })`.
    - `code-patterns.md` rule (add to § "HTTP routes (S5)"): "Every `/api` write (any method except GET, HEAD, OPTIONS) of a `suspended` organization answers `403 org_suspended` through `refuseSuspendedWrites` (`platform/http.ts`). A write that must work in `suspended` goes into `SUSPENDED_WRITE_ALLOW` with a test."
  - Test (`web-suspended.test.ts`; `webOrg(db)` committed, `cleanup` in `afterAll`; `suspendOrg` by SQL on `orgId` after the setup, the F8 pattern; `testConfig = loadConfig({ DATABASE_URL: process.env.DATABASE_URL, CREDENTIALS_KEY: <the base64 key that the other web tests use; grep `CREDENTIALS_KEY`in`apps/server/test/integration/web-\*.test.ts`>, WEB_BASE_URL: TEST_ORIGIN, WEB_AUTH_SECRET: "x".repeat(32) })`; `extras = { secrets: createSecretBox(…), actionsScope: { kind: "off" }, botUsername: null }`; `app = webTestApp({ db, sessions, routers: apiRouters(testConfig, db, extras, () => new Date()), isOrgSuspended: (id) => isOrgSuspended(db, { orgId: id }) })`):
    1. "every write route answers org_suspended": the list comes from the app: `app.routes.filter((r) => r.path.startsWith("/api/") && !r.path.startsWith("/api/auth") && !["GET", "HEAD", "ALL"].includes(r.method))`; dedupe by method and path; each `:param` replaced by `randomUUID()` (a value does not matter: the gate runs before the handler). Assert: the list holds the 18 routes of F4 (method and path, written out in the test), and each answers `403 { error: "org_suspended" }` for the owner and for the assistant, with a JSON body `{}`.
    2. The other organization (`otherOrgId`, `active`): `PATCH /api/me/digest-times` with a valid body → `200`; `POST /api/mailboxes/<random uuid>/pause` → `404`.
    3. Reads stay: the suspended owner's `GET /api/me` → `200`; `GET /api/mailboxes` → `200`.
    4. Without `isOrgSuspended` (the old helper call) one write route is not `org_suspended`.
    5. `isOrgSuspended` that throws → `500 { error: "internal" }`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the checks pass; test 1 found every F4 route through `app.routes`.
  - Out of scope: the web banner and the read-only mirror (stage 16); "delete organization" (S6c).
