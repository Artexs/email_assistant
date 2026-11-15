# F102 stage 01 — OpenAPI frame

Part of [`../plan.md`](../plan.md). Read D6, D14, F1 and [`../commands.md`](../commands.md). Needs nothing. Changes `bun.lock` (never next to another `bun.lock` change): install with `bash scripts/ci-bun.sh install`; `git diff bun.lock` adds only `hono-openapi` and its dependencies, no other version change (the lock of F101 stage 02 stays).

## Step 1 — Dependency, helper, `/api/openapi.json`

- **Goal:** the server serves an OpenAPI 3.1 file built from the routes' Zod schemas.
- **Files:** `apps/server/package.json`, `bun.lock`, a new `apps/server/src/platform/openapi.ts`, `apps/server/src/platform/http.ts` (the mount).
- **Interfaces:**
  - `hono-openapi` `1.6.0`, exact pin, in `apps/server` only. No other package changes.
  - `apiDoc(spec: { operationId: string; summary: string; tags: string[]; body?: ZodType; query?: ZodType; ok: { status: 200 | 201; schema: ZodType }; errors?: { status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503; codes: string[] }[]; hide?: { reason: string } })` returns the `describeRoute` middleware. Errors use one shared schema `{ error: string, … }` from `@ea/core/web` (create it if none exists). Callers use only `apiDoc`, never `describeRoute`.
  - `GET /api/openapi.json`: mounted after the routers, behind the same session and tenant guards as every `/api` route. `info.title` = `Email assistant API`, `info.version` = `0` (ADR 0023: no versions before E12), `openapi` = `3.1.0`.
- **Decisions:** D6. The routes keep `parseBody` and their own validation; `hono-openapi`'s `validator` is never used (F1: other 400 shape). The operator router and the OpenAPI route itself are hidden. The file covers the `/api/*` routes of the whole `createApp` app, not only `apiRouters` (Q19): `/api/auth/*` is hidden with the reason "Better Auth"; a route before the session guard (F119 stage 11 `GET /api/sign-in-options`, when landed) is described.
- **Test** (unit, server):
  - T1: with no session, `GET /api/openapi.json` answers 401 `unauthorized`.
  - T2: with a session, it answers 200; `openapi` is `3.1.0`; `info` equals `{ title: "Email assistant API", version: "0" }` (other keys allowed).
  - T3: no path of the file starts with `/api/operator`.
  - T4: a test router with one `apiDoc` route (`POST /x/:id`, body `{ a: string }`) appears as `/api/x/{id}` with a `requestBody` and a `200` schema.
- **Done when:** T1–T4 pass.

## Step 2 — Route check

- **Goal:** a unit test fails for an `/api` route without `apiDoc`.
- **Files:** a new `apps/server/src/openapi-routes.test.ts` (it builds `createApp` with the real `apiRouters` and fakes, as `platform/http.test.ts` does; no DB connection), `docs/code-patterns.md` (one rule).
- **Interfaces:**
  - `routeGaps(app, spec, lists: { hidden: Record<string, string>; notDescribedYet: readonly string[] })` returns `{ undescribed: string[]; stale: string[] }`. `app` is the `createApp` app; only `/api/*` keys count. A route key is `"<METHOD> <path with :params>"`.
  - `HIDDEN_ROUTES`: key → reason (operator routes: "operator only, not public (E10)"; `/api/auth/*`: "Better Auth"; the OpenAPI route).
  - `NOT_DESCRIBED_YET`: every other `/api/*` route key at `HEAD`, sorted. Stages 02 and 03 empty it. A new route never goes on it.
- **Checks in the test:**
  - every route is described, hidden or on `NOT_DESCRIBED_YET`;
  - a key on `NOT_DESCRIBED_YET` that is now described is `stale` and fails;
  - every described route has a unique `operationId` and a 2xx response with a JSON schema;
  - a hidden route with an empty reason fails.
- **Test:**
  - T5: a fake app with an undescribed `GET /api/y` → `undescribed` = `["GET /api/y"]`.
  - T6: a fake app whose `GET /api/z` is on `notDescribedYet` and described → `stale` = `["GET /api/z"]`.
  - T7: two described routes with the same `operationId` fail.
  - T8: the real app gives `undescribed` = `[]` and `stale` = `[]`.
  - T9: a described `GET /api/pub` before the session guard of a fake app is in the file; T1 still holds.
- **Code patterns:** add, in the API section: "Every `/api` route has `apiDoc` (`platform/openapi.ts`) with its body and answer schemas from `@ea/core/web`; `openapi-routes.test.ts` fails otherwise (ADR 0023)."
- **Done when:** T5–T9 pass; `NOT_DESCRIBED_YET` holds the route count of `HEAD` (name the count in the final message).
- **Out of scope:** ADR 0023 status (stage 19).

## Done when (stage)

- Steps 1 and 2 hold; `bash scripts/ci-bun.sh install --frozen-lockfile` passes; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s01`).
- The final message lists the resolved `hono-openapi` version and any dependency it added to `bun.lock`.
