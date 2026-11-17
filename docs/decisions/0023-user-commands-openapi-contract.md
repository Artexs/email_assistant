# 0023 — Every user action is a typed HTTP command described in OpenAPI

- Status: accepted (PD-035, F102)
- Date: 2026-11-13

## Context

The product rule "every user action is a channel-neutral API command" (`docs/product/stage-2/03-product-frame.md` §4) has no check today. The server has Hono routes per module (`apps/server/src/modules/*/routes.ts`); request and response schemas live in `packages/core/src/web/*` (Zod 4) and are shared with the web panel. Telegram handlers and CLIs call service functions directly (for example `actions/approvals.ts` with `via: "telegram" | "cli"`).

Later clients need one contract: identity tier 1 (E7) must cover every command, the PWA (E9) and the mobile app (E12) call the same API, and the E2 scripted executive taps approve, reject and edit through it. E4 adds about 15 commands (approvals, delegates, delegations, review, report, unsubscribe).

`hono-openapi` 1.x builds an OpenAPI 3.1 file from Zod 4 schemas through Standard Schema (release 1.5.0, 2026-10-18), so no second schema set is needed.

## Decision

1. Every user action is an HTTP route under `/api` with an input schema and an output schema from `packages/core/src/web/*`. The route checks the session, the role and the tenant, then calls one service function.
2. Telegram handlers and CLIs call the same service function. The function takes `via` (`web`, `telegram`, `cli`) and writes it to the audit row (and to `approved_via` for sends).
3. `hono-openapi` serves the OpenAPI file at `/api/openapi.json`, behind login. A test lists every `/api` route and fails when one has no schema.
4. No command bus, no event store, no CQRS (PD-008). A command is a route plus a service function.
5. The API is not versioned until a second client ships (E12). Until then a breaking change updates the web panel in the same change.

## Consequences

- The command list is one file that E7, E9 and E12 read.
- The web panel keeps its typed fetch helpers; the OpenAPI file can generate a client later, not now.
- Route files grow by the `describeRoute` metadata; the route check keeps it complete.

## Amendment (F102, 2026-11-15)

Facts of the build that the first text did not hold.

- **Library.** `hono-openapi` 1.6.0, an exact pin, in `apps/server` only (the first text named 1.5.0).
- **The helper.** `apiDoc` (`apps/server/src/platform/openapi.ts`) wraps `describeRoute`. A route gives an `operationId`, a summary, tags, the schema of its body, path parameters or query, the 2xx answer and its error codes. The schemas are the ones of the route and the panel (`@ea/core/web`), never a second copy. The codes of the shared guards (400 `validation` for a body, 401, 403, 413) join every operation.
- **`describeRoute` only.** The `validator` of `hono-openapi` answers a 400 in another shape than `ValidationError`, so no route uses it. Routes keep `parseBody`.
- **The file.** `GET /api/openapi.json` is OpenAPI 3.1, behind the session and the tenant (any member), with `info.version` `"0"` (point 5), built at the first request. It has one cookie scheme, `session`; a public route (`GET /api/sign-in-options`) sets `security: []` and is in the file, because the route check must see every route.
- **Hidden routes.** The file leaves out `/api/operator/*` and `/api/auth/*` (E10 publishes the file, and neither group is a customer command), the redirect target of the mailbox OAuth `GET /api/mailboxes/oauth/:provider/callback` (it answers 303, never JSON) and the file itself. `EXCLUDED_PATHS` removes the operator and auth paths even when a route carries an `apiDoc`.
- **The route test.** `apps/server/src/openapi-routes.test.ts` builds the real app and fails for a route that has no `apiDoc` and no entry with a reason in `HIDDEN_ROUTES`, for a hidden entry that no longer holds, for a repeated `operationId` and for an operation with no 2xx JSON schema. There is no list of gaps: a new route is described in the same change.
- **`via`.** The panel routes pass `via: "web"` (approve, reject, edit, delegates, delegations); `approved_via` and the audit `data.via` keep it.
