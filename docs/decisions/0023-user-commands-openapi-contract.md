# 0023 — Every user action is a typed HTTP command described in OpenAPI

- Status: proposed (E4 discovery, 2026-11-13; waits for the owner's answer to decision 8 of `docs/product/stage-2/epics/E04-control-surface.md`)
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
