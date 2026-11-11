# s5d-web-activity — Stage 5

Part of [`../s5d-web-activity.md`](../s5d-web-activity.md). Read that file's "Done when", "Owns", A1–A10, "Facts checked", B1–B15, "Rules for every step", "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 5 — `GET /api/activity` and its wiring [risky]

One step. This is the first route that returns mail subjects and senders to the browser.

- [ ] **5.1 `reports/routes.ts`, mounted in `web.ts` (B8 a, c)**
  - Goal: the web reads a page of activity items through a thin route over `listActivity`.
  - Files: create `apps/server/src/modules/reports/routes.ts`, `apps/server/test/integration/web-activity.test.ts`; change `reports/index.ts`, `apps/server/src/web.ts`.
  - Interfaces:

    ```ts
    // reports/routes.ts
    export interface ActivityRouteDeps {
      db: Db;
      now(): Date;
    }
    export function activityRoutes(deps: ActivityRouteDeps): Hono<ApiEnv>;
    ```

  - Decisions:
    - `GET /activity` (member; no `requireOwner`): `const q = parseQuery(c, activityQuerySchema)` (400 `validation` with `details`; `parseQuery` from `platform/http.ts`); when `q.before !== undefined`: `const cursor = decodeActivityCursor(q.before)`; `null` → `throw new ValidationError([{ path: "before", code: "invalid_cursor", message: "invalid cursor" }])` (`platform/http.ts`: `new ValidationError(details: { path; code; message }[])`, status 400); then `c.json(await listActivity(deps.db, c.get("ctx"), { mailboxId: q.mailboxId, categories: q.categories, notRated: q.notRated === "true", since: q.since === undefined ? undefined : new Date(q.since), cursor, limit: q.limit }, deps.now()))`.
    - The route file has no SQL and no rule beyond the mapping (code patterns, D8). It logs nothing.
    - `web.ts`: in `routers`, `api.route("/", activityRoutes({ db, now }));` after the rules routes. Import `activityRoutes` from `./modules/reports`.
  - Test (`web-activity.test.ts`; `webTestApp` with `routers: (api) => api.route("/", activityRoutes({ db, now: () => NOW }))`, `webOrg`, `as()`; committed rows: one mailbox per organization (the `addMailbox` helper of `web-settings.test.ts`), mails committed with `await db.transaction().execute((trx) => insertTriagedWithActions(trx, ctx, m1, { … }))` (the pattern of `web-settings.test.ts:264-270`); `org.cleanup()` in `afterEach` deletes both organizations, and the cascade removes the mail; `NOW = 2026-11-11T12:00:00Z`):
    1. Matrix: no cookie → 401; the owner → 200; the assistant → 200 (member route); `?limit=0` → 400 `validation` with `details[0].path` `limit`; `?categories=bogus` → 400; `?before=%%%` → 400 with `details[0]` `{ path: "before", code: "invalid_cursor" }`; `?mailboxId=nope` → 400.
    2. The owner's organization has 3 mails (one moved `notification`, one `needs_reply`, one `unsure`) and the other organization 1: the owner gets 3 items (`activityPageSchema` parses the body), newest first; the other organization's owner gets only its own 1; `?mailboxId=<other org's mailbox>` as the owner → 200 `{ items: [], nextBefore: null }`.
    3. `?categories=urgent,needs_reply,unsure` → the two matching items; `?notRated=true` after a feedback row on one of them → that one is gone.
    4. `?limit=2` → 2 items and a `nextBefore`; `?limit=2&before=<nextBefore>` → the third item and `nextBefore: null`.
    5. The answer body of the 400 for `?categories=` with a long junk value does not contain the junk value (`details` never hold the input, D9).
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; `grep -nE "selectFrom|sql\W" apps/server/src/modules/reports/routes.ts` finds nothing.
  - Out of scope: the write routes (stage 6); the page (stage 8).
