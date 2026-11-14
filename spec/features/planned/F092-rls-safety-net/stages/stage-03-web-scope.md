# F092 stage 03 — Web requests run in the scope

Part of [`../plan.md`](../plan.md). `[risky]`: tenant isolation, auth. Decisions D7, D16, D17, D18, D20. Read "Rules for every stage" in `plan.md` first.

Starts after stages 01 and 02 landed (D22): its tests read the policies of stage 01 and the scope of stage 02. Run `bun run db:migrate` in your job DB first (the prepare script made the DB before stage 01 landed only if it ran earlier; a repeat migrate is harmless).

Three steps. After this stage, every `/api` request except `/api/operator/*` sees only the rows of its organization, also when a query forgets its `org_id` filter.

File overlap (advisory, board rule): the platform-controls ticket (F099 stage 06) also edits `platform/http.ts`. If the land conflicts, merge `master` and keep both changes.

## Step 1 — `requireTenant` and `requireOperator` set and clear the scope

**Goal.** The rest of a tenant request runs in `withTenantScope(orgId, …)`; an operator request runs in `withoutTenantScope(…)` after the operator check passes (D16, D17).

**Files.** `apps/server/src/platform/http.ts`, `apps/server/src/platform/http.test.ts`.

**Interfaces.** No signature changes. In `http.ts`:

- import `withoutTenantScope`, `withTenantScope` from `./db` (with the existing `Db`, `TenantContext` types).
- `requireTenant`: keep every line; replace the final `await next();` with `await withTenantScope(first.org_id, () => next());`. The membership lookup stays before the scope (it finds the scope).
- `requireOperator`: keep the refusal; replace the final `await next();` with `await withoutTenantScope(() => next());`.
- One comment line on each: `// RLS safety net (ADR 0011): the rest of the request runs with app.org_id = the session's organization.` and `// Operator routes read across organizations: no tenant scope (ADR 0027).`

Do not move the middleware order in `createApp` (`requireSession`, `requireTenant`, `/operator/*` → `requireOperator`, `refuseSuspendedWrites`, `web.routers`). `/api/auth/*`, `/health` and the page paths stay outside the scope (D17).

**Decisions.** D16, D17.

**Test (added to `http.test.ts`; no DB; `A = "aaaaaaaa-0000-4000-8000-000000000001"`).**

1. `requireTenant` with rows `[{ org_id: A, role: "owner" }]`: a handler that returns `{ scope: currentTenantScope() }` answers `{ scope: A }`.
2. After `app.request` of test 1 returns, `currentTenantScope()` in the test → `null`.
3. `requireTenant` with no rows → `403 no_organization`; a handler spy was not called.
4. `createApp` (the existing `orderApp` helper with `operatorUserIds: new Set(["u-owner"])` and `listMembershipsOfUser` → `[{ org_id: A, role: "owner" }]`; add `api.get("/me-scope", …)` and `api.get("/operator/scope", …)` to its `routers`, both answering `{ scope: currentTenantScope() }`): `GET /api/me-scope` → `{ scope: A }`; `GET /api/operator/scope` → `{ scope: null }`.
5. The same app without the owner in `operatorUserIds`: `GET /api/operator/scope` → `404 not_found` (unchanged guard).
6. `refuseSuspendedWrites` runs inside the scope: with `isOrgSuspended: async () => { seen = currentTenantScope(); return false; }`, a `POST /api/me-scope-write` (add the route) → `seen === A`.

**Check.** `bun test apps/server/src/platform/http.test.ts`.

**Done when.** Tests 1–6 pass; the old `http.test.ts` tests pass unchanged.

**Out of scope.** Any route file, `web.ts`, the order of the middleware.

## Step 2 — the scope reaches every route, and nothing else sets it

**Goal.** A test over the real route list proves acceptance lines 2 and 3 of the ticket; a source test proves that only the three D16 places call the scope functions and only the driver writes `app.org_id`.

**Files.** `apps/server/test/integration/web-tenant-scope.test.ts` (new), `apps/server/src/platform/tenant-scope-sites.test.ts` (new).

**Interfaces and set-up of `web-tenant-scope.test.ts`.**

- `db = testDb()`; `org = await webOrg(db)` in `beforeAll` (committed: organizations A = `org.orgId` and B = `org.otherOrgId`, owners `org.ownerId` and `org.otherOwnerId`); `org.cleanup()` and `db.destroy()` in `afterAll`.
- One committed mailbox per organization: `insertMailbox(db, { orgId }, { id: randomUUID(), address: \`rls-${randomUUID()}@x.test\`, imapHost: "imap.x.test", imapPort: 993, smtpHost: "smtp.x.test", smtpPort: 465, capabilities: testCapabilities, folderMap: { drafts: "Drafts" } })` and `insertInboxFolder(db, { orgId }, id)` (`../../src/modules/mail/repo`, `testCapabilities` from `./fixtures`). The organization delete cascades them.
- `testConfig` and `extras` exactly as in `web-suspended.test.ts` (lines 15–26); `realRouters = apiRouters(testConfig, db, extras, () => new Date(), async () => [])`.
- Walk app: `webTestApp({ db, sessions: { owner: org.ownerId }, operatorUserIds: new Set([org.ownerId]), routers: (api) => { api.use("*", recorder); realRouters(api); } })`, where `recorder` pushes `{ method: c.req.method, path: c.req.path, scope: currentTenantScope() }` into an array and calls `await next()`. The recorder runs after `requireTenant`, `requireOperator` and `refuseSuspendedWrites` (`createApp` registers them before `web.routers`), so it sees what the handlers see.
- Probe app: `webTestApp({ db, sessions: { owner: org.ownerId, other: org.otherOwnerId }, operatorUserIds: new Set([org.ownerId]), routers: (api) => { … } })` with three test-only routes:
  - `GET /rls-probe` and `GET /operator/rls-probe`: `select org_id from mailboxes where org_id in (<A>, <B>) order by org_id` (raw `sql`, through the root `db`; it asks for both organizations, the "deliberately unfiltered" query) → `{ orgIds: string[] }`.
  - `POST /rls-probe-write`: `insertSenderRule(db, { orgId: <B> }, { mailboxId: null, pattern: "rls-probe@x.test", kind: "vip" })` → `{ ok: true }`.
- `UNSCOPED_PREFIXES = ["/api/operator/"]`: the one `/api` exception (D17).

**Test (`web-tenant-scope.test.ts`).**

1. Route walk: for each entry of `walkApp.routes` with `path.startsWith("/api/")`, not `/api/auth`, `method !== "ALL"` (deduplicate `method path`): replace each `:param` with `randomUUID()`, clear the recorder, `await walkApp.request(path, as("owner", { method, body: method === "GET" ? undefined : {} }))`. Then the recorder holds at least one entry, and the last entry has `scope === null` when the route path starts with a `UNSCOPED_PREFIXES` entry, else `scope === org.orgId`. Failure message: `<method> <path> ran with scope <scope>`. Mock `console.error` and `console.log` around the walk (handlers may log a 400 or 500).
2. The walked set contains `GET /api/me`, `GET /api/mailboxes`, `POST /api/mailboxes`, `DELETE /api/mailboxes/:id`, `GET /api/operator/flags` (the walk is not empty).
3. Owner A: `GET /api/rls-probe` → `200 { orgIds: [A] }`.
4. Owner B (`as("other")`): `GET /api/rls-probe` → `200 { orgIds: [B] }`.
5. Owner A as operator: `GET /api/operator/rls-probe` → `200 { orgIds: [A, B].sort() }`.
6. Job context: the same SQL run in the test without a scope → both ids; inside `withTenantScope(A, …)` in the test → `[A]`.
7. Owner A: `POST /api/rls-probe-write` (body `{}`) → `500 { error: "internal" }` (mock `console.error`); then, without a scope, `select count(*) from sender_rules where org_id = <B> and pattern = 'rls-probe@x.test'` → 0.
8. Owner A: `DELETE /api/mailboxes/<B's mailbox id>` with body `{ confirmAddress: <B's address> }` → `404 not_found`; B's mailbox still exists (code filter, RLS and the `delete_mailbox` guard together).
9. Owner A: `GET /api/mailboxes` → 200 and the list has exactly A's mailbox id (the filtered path is unchanged).
10. After all requests, `currentTenantScope()` in the test → `null`.

**`tenant-scope-sites.test.ts`** (pattern of `apps/server/src/scripts/mail-hosts-configured.test.ts`: read every `.ts` file under `apps/server/src` recursively with `readdirSync(…, { recursive: true })`, skip `*.test.ts`):

11. Files that contain `withTenantScope(` (with the parenthesis, so the definition `withTenantScope<T>(` does not count): exactly `["platform/http.ts"]`.
12. Files that contain `withoutTenantScope(`: exactly `["platform/http.ts", "platform/scheduler.ts"]`.
13. Files that contain `set_config('app.org_id'` or `app.org_id =`: exactly `["platform/db/scoped-driver.ts"]` (D18: only the driver writes the value).
14. The scan found more than 100 files (it read the tree).

Paths in the assertions are relative to `apps/server/src` with `/` separators.

**Decisions.** D16, D17, D18.

**Check.** `bun test apps/server/test/integration/web-tenant-scope.test.ts apps/server/src/platform/tenant-scope-sites.test.ts`, then every `web-*.test.ts` file: `bun test apps/server/test/integration/web-` (all pass, none changed).

**Done when.** Tests 1–14 pass. A failing existing test is a finding (report it with the route and the query); do not change the test to pass.

**Out of scope.** A change in a route, a service or a repository; a new log line; operator routes beyond `/api/operator/flags`.

## Step 3 — the e2e suite on the scoped path

**Goal.** The browser flows (sign-in, onboarding, mailbox connect against GreenMail, settings, rules, activity, Telegram link) pass with every `/api` request in the scope.

**Files.** None (a run). Your job's `.env` gets its own e2e database lines.

**Set-up (once, before the Proof).** This machine has no Playwright browser: the Proof uses `CHROMIUM_PATH=/usr/bin/chromium`. Give the job its own e2e database; never use the shared `email_assistant_e2e`:

```
sed -i -E '/^E2E_(MIGRATOR_)?DATABASE_URL=/d' .env
bun run db:worktree f092_s03_e2e | grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' | sed 's/^/E2E_/' >> .env
```

The Playwright server command runs `bun run db:migrate` on it. `test:e2e` uses the fixed ports 8081 and 8092: run it only under `flock /tmp/email-assistant-shared-tests.lock` (the Proof does). Never print `.env` lines. Name the e2e DB in your final message so the coordinator drops it.

**Decisions.** D7 (no route changes), D17.

**Check.** The Proof's `web:build` and `test:e2e` parts. A failing e2e test is a finding: report the spec, the step and the server log line (`http_error` with its `route`); do not change the spec.

**Done when.** `/tmp/f092-s03/e2e.log` shows all tests passed.

**Out of scope.** New e2e specs.

## Stage done when

Steps 1–3 are done, and the stage 03 Proof of `plan.md` passes (`/tmp/f092-s03`).
