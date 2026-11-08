# s5a-web-foundation — Stage 8

Part of [`../s5a-web-foundation.md`](../s5a-web-foundation.md). Read that file's "Done when", "Owns", S1–S13, "Facts checked", W1–W20, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first. Decisions named D<n> are in the master plan, W<n> and S<n> in the segment file, "fact <n>" in the segment file's "Facts checked".

## Stage 8 — `requireTenant` and `requireOwner`, `tenancy/routes.ts` with `GET /api/me`, `web.ts` composition, `main.ts` wiring with `idleTimeout` [risky]

- [ ] **8.1 `requireTenant`, `requireOwner`, `tenancy/routes.ts`, the routes rule in the code patterns**
  - Goal: every `/api/*` route after the session has the tenant and the role (D3); `/api/me` returns the W6 shape with the real counts; the "routes are thin" rule enters `docs/code-patterns.md` with the first route.
  - Files: change `apps/server/src/platform/http.ts` (the two middlewares, exported; `requireTenant` wired into the `api` sub-app after `requireSession`), `apps/server/src/platform/http.test.ts`, `apps/server/src/modules/tenancy/index.ts` (`export { tenancyRoutes, type TenancyRouteDeps } from "./routes"`), `apps/server/test/integration/web-http.test.ts` (the `/api/me` line of stage 6 test 3 becomes 200 when a router is mounted), `docs/code-patterns.md`; create `apps/server/src/modules/tenancy/routes.ts`, `apps/server/test/integration/web-me.test.ts`.
  - Interfaces:

    ```ts
    // platform/http.ts
    export function requireTenant(deps: {
      listMembershipsOfUser: WebDeps["listMembershipsOfUser"];
    }): MiddlewareHandler<ApiEnv>;
    // [] → 403 { error: "no_organization" }; else c.set("ctx", { orgId: rows[0].org_id, userId: session.userId }), c.set("role", rows[0].role);
    // more than one row → log.warn(`web: user <id> has <n> memberships; using the oldest`) once per process per user id (a module-level Set)
    export const requireOwner: MiddlewareHandler<ApiEnv>; // c.get("role") !== "owner" → 403 { error: "owner_only" }
    // modules/tenancy/routes.ts
    export interface TenancyRouteDeps {
      db: Db;
      scopes: { triage: ScopeInfo; actions: ScopeInfo; send: ScopeInfo };
      countMailboxes: (ctx: TenantContext) => Promise<{ total: number; inAuthError: number }>; // web.ts implements it with the mail index
    }
    export function tenancyRoutes(deps: TenancyRouteDeps): Hono<ApiEnv>; // GET /me
    ```

  - Decisions:
    - `createApp` (stage 6, step 7) gains `api.use("*", requireTenant({ listMembershipsOfUser: web.listMembershipsOfUser }))` right after `requireSession`, before `web.routers?.(api)`.
    - `/api/me` handler: `ctx = c.get("ctx")`, `role = c.get("role")`; `organization = await getOrganization(db, ctx)` (404 `not_found` when undefined, which cannot happen after `requireTenant` but keeps the type honest); `member = await getMembership(db, ctx, ctx.userId)` for `email` and `display_name`; the counts through `deps.countMailboxes(ctx)` because `tenancy` must not import `mail` (`docs/modules.md` §2 has `api → mail` and `api → tenancy`, no `tenancy → mail`); the response object is built as a `Me` value and returned with `c.json(me)` — **no `meSchema.parse` in the route** (a shape mismatch is a type error at build time; a runtime parse would turn a server bug into a 400 or hide it: cold review of this plan, finding 17); `web-me.test.ts` parses the response with `meSchema` instead.
    - Thin route (D8): no SQL, two repository reads through `./repo` and one injected count; no `org_id` from the request. `routes.ts` imports `./repo` only (never `./index`: a cycle).
    - `requireOwner` is exported now and used from S5b on; the unit test mounts it on a bare `Hono<ApiEnv>`.
    - `docs/code-patterns.md` gets, in this commit, the section "HTTP routes (S5)": "A route file (`routes.ts`) is thin: it parses the body with `parseBody` and a `@ea/core` schema, calls one service or repository function, and maps the result to JSON. No SQL, no business rule, no `org_id` from the request: `requireTenant` sets `ctx` from the session. Every route test covers 401 (no session), 403 (an assistant on an owner route, when the route is owner-only), 404 (another organization's id, when the route takes an id) and 400 (a bad body, `details` without the input). The platform (`platform/http.ts`) imports no module; the composition root (`apps/server/src/web.ts`) wires the module routers."
  - Test:
    1. `http.test.ts` (unit): `requireTenant` with a fake `listMembershipsOfUser` returning `[]` → 403 `no_organization`; two rows → `ctx.orgId` is the first and the log has the `warn` once for two calls; `requireOwner` with `role` `assistant` → 403 `owner_only`, with `owner` → next.
    2. `web-me.test.ts` (integration; the stage 6 fake `getSession` with cookies `good-owner` → owner id, `good-assistant` → assistant id, `good-nobody` → a user without membership; the data must be committed because the app reads through its own `db`: `createOrganizationWithOwner(db, …)`, an `insertUser` + `insertMembership(role "assistant")`, a third `insertUser` without membership, two mailboxes with `insertMailbox` and `setMailboxStatus(…, "auth_error")` on one; `afterEach` deletes the organization and the three users as in stage 3): `GET /api/me` as owner → 200, `meSchema.parse(body)` ok, `role "owner"`, `user.email` the owner's lower-case e-mail, `organization.timezone "Europe/Warsaw"`, `mailboxCount 2`, `mailboxesInAuthError 1`, `scopes.triage` = `{ kind: "off", reason: "env_off" }` (the test deps pass `off` values), `telegram null`, `onboarding null`; as assistant → 200 `role "assistant"`; as nobody → 403 `no_organization`; no cookie → 401.
    3. Stage 6 test 3: "`GET /api/me` with the good cookie → 404" becomes "→ 200" with the tenancy router mounted and a `listMembershipsOfUser` fake that returns one row.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int && bunx prettier --check docs/code-patterns.md`.
  - Done when: the tests pass; `apps/server/src/modules/tenancy/routes.ts` imports only `hono`, `@ea/core`, `../../platform/*` and `./repo`.
  - Out of scope: `onboarding`, `telegram` (S5b); `PATCH /api/organization` (S5c).

- [ ] **8.2 `web.ts`: `webDeps`; `main.ts` wiring (D8, W7), `Bun.serve({ idleTimeout: 90 })` (D5)**
  - Goal: `main.ts` serves the web when `WEB_BASE_URL` is set and stays as today when it is not; the start log says which; the process closes the auth pool on shutdown.
  - Files: change `apps/server/src/web.ts` (stage 3 created it with `auditWebEvent`), `apps/server/src/main.ts`, `apps/server/test/integration/web-http.test.ts` (one test through the real `webDeps`); create `apps/server/src/web.test.ts` (unit: the pure parts).
  - Interfaces:

    ```ts
    // web.ts
    export type WebRuntime = WebDeps & { close(): Promise<void> };
    export function webDeps(config: Config, db: Db): WebRuntime | null;
    export function scopeInfos(config: Config): TenancyRouteDeps["scopes"]; // scopeInfoOf(config.TRIAGE_LLM_SCOPE), scopeInfoOf(config.ACTIONS_SCOPE), scopeInfoOf(config.SEND_SCOPE)
    export function distPath(config: Config, cwd = process.cwd()): string; // resolve(cwd, config.WEB_DIST)
    export function peerAddress(c: Context): string | undefined; // try { return getConnInfo(c).remote.address } catch { return undefined } — @hono/bun throws without the Bun server (app.request in tests)
    // main.ts
    const web = webDeps(config, db);
    const app = createApp({ checkDb: () => checkDb(db), web });
    const server = Bun.serve({ port: config.PORT, idleTimeout: 90, fetch: app.fetch });
    // shutdown: … await server.stop(); await web?.close(); await db.destroy();
    ```

  - Decisions:
    - `webDeps`: `config.WEB_BASE_URL === undefined` → `log.info("web is off (WEB_BASE_URL is empty)")` and `null`. Else: `baseUrl = new URL(config.WEB_BASE_URL)`; `baseUrl.protocol === "http:"` and the hostname not in `["localhost", "127.0.0.1", "[::1]"]` → `log.warn("WEB_BASE_URL is http:// on a non-loopback host: cookies are not Secure")` (D7); `handle = createAuth({ databaseUrl: config.DATABASE_URL, baseUrl: config.WEB_BASE_URL, secret: config.WEB_AUTH_SECRET ?? "" /* the config check guarantees it */, trustedOrigins: [baseUrl.origin, ...webTrustedOrigins(config)], onEvent: auditWebEvent(db) })`; returns `{ auth: { handler: (req) => handle.auth.handler(req), getSession }, db, now: () => new Date(), dist: distPath(config), baseUrl, trustedOrigins: new Set([baseUrl.origin, ...webTrustedOrigins(config)]), trustedProxies: buildTrustedProxies(webTrustedProxies(config)), connInfo: peerAddress, listMembershipsOfUser: (userId) => listMembershipsOfUser(db, userId), routers: (api) => api.route("/", tenancyRoutes({ db, scopes: scopeInfos(config), countMailboxes })), close: () => handle.close() }` where `getSession(headers)` calls `handle.auth.api.getSession({ headers, returnHeaders: true })` and returns `null` for no session, else `{ userId: response.user.id, setCookie: headers.getSetCookie() }` (W17: Better Auth's refreshed cookie reaches the browser; an empty list when nothing changed), and `countMailboxes(ctx)` = `listMailboxes(db, ctx)` → `{ total: rows.length, inAuthError: rows.filter((r) => r.status === "auth_error").length }`. The start log line names the origin and the dist path (`web is on: <origin>, dist <path>`; the origin is not a secret; the secret is never logged).
    - `main.ts`: `Bun.serve({ port, idleTimeout: 90, fetch })` (D5: the connect route of S5b runs logins inside the request; Bun's default is 10 s). `web?.close()` after `server.stop()` in `shutdown`. The order of start lines: config, db role, `web is on|off`, `listening on port`.
    - `getConnInfo` needs the Bun server as the second `fetch` argument (`@hono/bun` `conninfo.js`); `Bun.serve({ fetch: app.fetch })` passes it; `app.request` in tests does not, hence `peerAddress`'s `try`/`catch` (cold review of this plan, finding 4).
    - `scripts/job-run.ts` does not build the web (jobs only).
  - Test:
    1. `web.test.ts` (unit): `scopeInfos` for `TRIAGE_LLM_SCOPE=off, ACTIONS_SCOPE=synthetic, SEND_SCOPE=self` → `off/env_off`, `synthetic/synthetic_only`, `self/test_addresses_only`; `distPath` with `WEB_DIST=apps/web/dist` and `cwd /repo` → `/repo/apps/web/dist`, with `/app/apps/web/dist` → unchanged; `peerAddress` on a context from `app.request` (no Bun server) → `undefined`, no throw.
    2. `web-http.test.ts`: `const env = { ...process.env, WEB_BASE_URL: "http://127.0.0.1:8080", WEB_AUTH_SECRET: "x".repeat(40), WEB_DIST: tempDist }` (the keys `process.env` already holds — `DATABASE_URL`, `CREDENTIALS_KEY` — stay); `webDeps(loadConfig(env), db)` → not null, `baseUrl.origin` `http://127.0.0.1:8080`, `trustedOrigins` has it, `dist` is the temp path; `createApp({ checkDb, web })`: `GET /api/auth/get-session` → 200 `null` (the real Better Auth answers), `POST /api/auth/sign-in/email` with `Origin: http://127.0.0.1:8080` and a wrong password for a nonexistent user → 401 `INVALID_EMAIL_OR_PASSWORD` (the real instance, our origin check passed, `peerAddress` returned undefined without a throw), `POST /api/auth/request-password-reset` → 404; `GET /api/me` with no cookie → 401; then `await web.close()`. With `{ ...process.env, WEB_BASE_URL: "" }` → `webDeps` is `null` and the log has `web is off (WEB_BASE_URL is empty)`.
    3. Manual: `bun run dev` in the worktree without web keys → the log shows `web is off (WEB_BASE_URL is empty)` and nothing else changes; with the keys of user step 1 → `web is on: http://localhost:4321, dist /…/apps/web/dist` and, before stage 9 builds the web, `web: dist folder missing, pages are off`; `curl -s http://127.0.0.1:8080/api/me` → 401 JSON; `curl -sI http://127.0.0.1:8080/mailboxes` → 503.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`; the manual start (both shapes when the keys exist; else the `off` shape and a note in the log line). **Pipeline pause:** the main session asks the user for user step 1 before this manual check.
  - Done when: the tests pass; the manual start shows the lines; Ctrl+C ends within 15 s (the auth pool closes).
  - Out of scope: the web build (stage 9), S5b routes.
