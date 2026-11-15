# F102 stage 02 — Describe routes A

Part of [`../plan.md`](../plan.md). Read D6 and stage 01. Needs stage 01 landed.

Two steps, no behaviour change: only `apiDoc` metadata, and Zod answer schemas where a route has none.

## Step 1 — Tenancy, privacy, mail

- **Goal:** the routes of `tenancyRoutes`, `privacyRoutes` and `mailRoutes` are in the OpenAPI file.
- **Files:** the route files of the modules `tenancy`, `privacy` and `mail`; `packages/core/src/web/*` only when an answer has no schema; `apps/server/src/openapi-routes.test.ts` (remove the keys).
- **Decisions:**
  - D6. The body schema is the one the route passes to `parseBody`; the answer schema is the one the web parses in `apps/web/src/lib/` (`api()` with a schema of `@ea/core/web`). Use the same object; never write a second schema.
  - A route whose answer has no Zod schema yet gets one in `@ea/core/web`, typed so the existing `c.json<T>` call still compiles (a `Same<>` check as in `packages/core/src/notices/views.ts`, or `satisfies`). The web keeps its own parse.
  - Error codes: list the codes the route answers today (read the handler); the shared guards (401, 403 `no_organization`, 403 `bad_origin`, 403 `org_suspended`, 413) are added by `apiDoc` for every route, not listed per route.
  - `operationId`: camelCase verb plus noun (`getMe`, `patchOrganization`, `postMailbox`, `deleteMailbox`).
  - `tags`: the router name without `Routes` (`tenancy`, `privacy`, `mail`).
- **Test:**
  - T1: `NOT_DESCRIBED_YET` holds no key of these three routers.
  - T2: the stage 01 checks pass (unique `operationId`, a 2xx schema each).
  - T3: `POST /api/mailboxes` in the file has a `requestBody` whose JSON schema `required` list equals that of the connect body schema (compare with `z.toJSONSchema` of the same schema).
  - T4: `PATCH /api/me/locale` answers 200 as before (the existing integration test still passes unchanged).
- **Done when:** T1–T4 pass.

## Step 2 — Settings and rules

- **Goal:** the routes of `settingsRoutes` and `rulesRoutes` (module `config`) are in the file.
- **Files:** the route files of module `config`; `packages/core/src/web/settings.ts` and `rules.ts` only when needed; the route test.
- **Decisions:** as Step 1; tags `settings`, `rules`.
- **Test:**
  - T5: `NOT_DESCRIBED_YET` holds no key of these two routers.
  - T6: `PATCH /api/settings/{mailboxId}/mode` has a path parameter `mailboxId` and a `requestBody`.
- **Done when:** T5, T6 pass; the existing web integration tests of these routers pass unchanged.

## Out of scope

- The other routers (stage 03). Any change of a route's behaviour, path, status code or answer: that is a question.

## Done when (stage)

- Steps 1 and 2 hold. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s02`).
- The final message names each answer schema that this stage added to `@ea/core/web`.
