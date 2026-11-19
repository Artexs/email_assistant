# F102 stage 01 — OpenAPI frame

Part of [`../plan.md`](../plan.md). Read D6, D14, F1 and [`../commands.md`](../commands.md). Needs nothing. Changes `bun.lock` (never next to another `bun.lock` change): install with `bash scripts/ci-bun.sh install`; `git diff bun.lock` adds only `hono-openapi` and its dependencies, no other version change.

## Step 1 — Dependency, helper, `/api/openapi.json`

- **Files:** `apps/server/package.json`, `bun.lock`, a new `apps/server/src/platform/openapi.ts`, `apps/server/src/platform/http.ts` (the mount).
- **Interfaces:**
  - `hono-openapi` `1.6.0`, exact pin, in `apps/server` only.
  - `apiDoc(spec: { operationId: string; summary: string; tags: string[]; body?: ZodType; query?: ZodType; ok: { status: 200 | 201; schema: ZodType }; errors?: { status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503; codes: string[] }[]; public?: true; hide?: { reason: string } })` returns the `describeRoute` middleware. Errors share one schema `{ error: string, … }` in `@ea/core/web`. Callers use only `apiDoc`.
  - `openApiSpec(root: Hono): Promise<OpenAPIV3_1.Document>` builds the file from the whole `createApp` app. The `/api/openapi.json` handler and the route test both call it; `createApp` hands the handler its root app.
  - `GET /api/openapi.json`: inside the session and tenant guards. `info` = `{ title: "Email assistant API", version: "0" }` (ADR 0023: no versions before E12), `openapi` = `3.1.0`.
  - Security (Q21): one cookie scheme `session` as the file's default `security`; an `apiDoc` with `public: true` sets `security: []`.
- **Decisions:** D6. Routes keep `parseBody`; the `validator` of `hono-openapi` is never used (F1: other 400 shape). Hidden: the operator routes, `/api/auth/*` ("Better Auth"), the OpenAPI route. A route before the session guard (F119 stage 11 `GET /api/sign-in-options`, when landed) is described with `public: true` (Q19).
- **Test** (unit, server):
  - T1: with no session, `GET /api/openapi.json` answers 401 `unauthorized`.
  - T2: with a session: 200, `openapi` `3.1.0`, the `info` above (other keys allowed).
  - T3: no path of the file starts with `/api/operator`.
  - T4: a test router with one `apiDoc` route (`POST /x/:id`, body `{ a: string }`) appears as `/api/x/{id}` with a `requestBody` and a `200` schema.
- **Done when:** T1–T4 pass.

## Step 2 — Route check

- **Files:** a new `apps/server/src/openapi-routes.test.ts` (`createApp` with the real `apiRouters` and fakes, as `platform/http.test.ts`; no DB), `docs/code-patterns.md`.
- **Interfaces:**
  - `routeGaps(app, spec, lists: { hidden: Record<string, string>; notDescribedYet: readonly string[] })` returns `{ undescribed: string[]; stale: string[] }`. `app` is the `createApp` app; `spec` comes from `openApiSpec(app)`.
  - Route keys: `"<METHOD> <path with :params>"` under `/api/`, as a set. An entry with method `ALL` and a path that ends in `*` is middleware or the 404 catch-all: it does not count (review 2 found 7). The test fails on an `ALL` entry without `*`, so the filter cannot hide a real route.
  - `HIDDEN_ROUTES`: key → reason (operator routes: "operator only, not public (E10)"; `GET` and `POST /api/auth/*`: "Better Auth"; the OpenAPI route).
  - `NOT_DESCRIBED_YET`: every other key at `HEAD`, sorted. Stages 02 and 03 empty it. A new route never goes on it.
- **Test:**
  - T5: a fake app with an undescribed `GET /api/y` → `undescribed` = `["GET /api/y"]`.
  - T6: a fake app whose `GET /api/z` is listed and described → `stale` = `["GET /api/z"]`.
  - T7: the test fails for two described routes with one `operationId`, a described route without a 2xx JSON schema, and a hidden key with an empty reason.
  - T8: the real app gives `undescribed` = `[]` and `stale` = `[]`; its middleware entries are not keys.
  - T9: a root app with a `public` `GET /api/pub` before the guards: `openApiSpec` lists it with `security: []`. The served file of `createApp` equals its `openApiSpec`.
- **Code patterns:** add, in the API section: "Every `/api` route, also one before the session guard, has `apiDoc` (`platform/openapi.ts`); `openapi-routes.test.ts` fails otherwise (ADR 0023). Never put a new route on `NOT_DESCRIBED_YET`."
- **Done when:** T5–T9 pass; the final message names the key count of `NOT_DESCRIBED_YET`.

## Done when (stage)

- Steps 1 and 2 hold; `bash scripts/ci-bun.sh install --frozen-lockfile` passes; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s01`).
- The final message lists the resolved `hono-openapi` version and each dependency it added to `bun.lock`.
