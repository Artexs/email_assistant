# s5d-web-activity — Stage 6

Part of [`../s5d-web-activity.md`](../s5d-web-activity.md). Read that file's "Done when", "Owns", A1–A10, "Facts checked", B1–B15, "Rules for every step", "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 6 — `POST /api/feedback`, `POST /api/actions/undo` and their wiring [risky]

One step. The Undo route starts a mailbox change from the browser; the feedback route writes the labels that open the go/no-go gate (S5c).

- [x] **6.1 `triage/routes.ts`, mounted in `web.ts` (B8 b, c)**
  - Goal: every member gives feedback and starts an Undo from the web through the stage 2 services.
  - Files: create `apps/server/src/modules/triage/routes.ts`, `apps/server/test/integration/web-feedback-undo.test.ts`; change `triage/index.ts`, `apps/server/src/web.ts`, `apps/server/src/main.ts`.
  - Interfaces:

    ```ts
    // triage/routes.ts
    export interface TriageRouteDeps {
      db: Db;
      now(): Date;
      actionsScope: ActionsScope;
    }
    export function triageRoutes(deps: TriageRouteDeps): Hono<ApiEnv>;
    ```

  - Decisions:
    - `POST /feedback` (member): `const body = await parseBody(c, feedbackBodySchema)` → `recordWebFeedback(deps.db, c.get("ctx"), { emailId: body.emailId, trueCategory: body.trueCategory, userId: c.get("session").userId })` → `not_found` → `c.json({ error: "not_found" }, 404)`; else `c.json({ saved, verdict, aiCategory })` (200). No log line.
    - `POST /actions/undo` (member): `const body = await parseBody(c, undoBodySchema)` → `undoWithFeedback(deps.db, ctx, body.emailId, { now: deps.now(), userId, scope: deps.actionsScope })` → `not_found` → 404 `{ error: "not_found" }`; `started` → 200 `{ kind: "started", created }`; else 200 `{ kind }`. One `info` line through `createLog("triage")`: `` `web undo ${result.kind} mail ${body.emailId} by user ${userId}` `` (ids only).
    - The origin check of the platform (D5) guards both POSTs (a request with no `Origin` → 403 `bad_origin`); the routes add nothing for it.
    - `web.ts`: `WebExtras` gets `actionsScope: ActionsScope`; `api.route("/", triageRoutes({ db, now, actionsScope: extras.actionsScope }));` after `activityRoutes`; import `triageRoutes` from `./modules/triage`. `main.ts:176` passes `actionsScope: scopeOfActions` (computed at `main.ts:109`); a second `actionsScope(config)` call would log the committer scope line twice (cold review finding 11). Check every other `webDeps(` caller (`grep -rn "webDeps(" apps/server`) and give it the field.
  - Test (`web-feedback-undo.test.ts`; `webTestApp` with `routers: (api) => api.route("/", triageRoutes({ db, now: () => NOW, actionsScope: scope }))` built inside each test by a helper `appWith(scope: ActionsScope)` (the scope is copied when the router is built, so a `let` changed later would not reach it; cold review finding 10), `{ kind: "synthetic" }` unless a case says other; each test builds its own `webOrg` and mail; `webOrg`, `as()`; committed mail as in stage 5, Message-ID `<web-undo-<n>@ea-seed.test>` (synthetic), `move` `ai_notifications` and `mark_read` applied at `NOW − 1 h`; `NOW = 2026-11-11T12:00:00Z`):
    1. Matrix on both routes: no cookie → 401; a POST without `Origin` → 403 `bad_origin`; `{}` → 400 `validation`; `{ emailId: "nope" }` → 400; `/feedback` with `trueCategory: "unsure"` or `"delegation"` → 400 (label categories only, fact 1); a malformed JSON body → 400 `validation` (`invalid_json`); the 400 body never contains the sent values.
    2. Another organization's mail id and a random UUID: `/feedback` → 404 `{ error: "not_found" }`, `/actions/undo` → 404 `{ error: "not_found" }`; no feedback row, no reverse row in either organization.
    3. `/feedback` as the owner with `{ emailId, trueCategory: "notification" }` on the moved `notification` mail → 200 `{ saved: true, verdict: "right", aiCategory: "notification" }` (`feedbackResultSchema` parses); again → `{ saved: false, … }`; as the assistant with `trueCategory: "info"` → `{ saved: true, verdict: "wrong" }`; the rows have `source: "web"` and `user_id` = the caller.
    4. `/actions/undo` as the assistant (any member, D13) on a fresh mail with no feedback → 200 `{ kind: "started", created: 2 }`; two reverse rows; one feedback row `{ verdict: "wrong", true_category: null, source: "undo", user_id: <assistant> }`; a second call → 200 `{ kind: "already" }`, still one feedback row. A second fresh mail with a web ✏️ row (`/feedback` `trueCategory: "info"`) first → the Undo answers `started` and the latest feedback row is still the ✏️ row (`keepLabel`).
    5. `appWith({ kind: "off" })` on a fresh mail → 200 `{ kind: "held" }`, no reverse row (the "not possible now" case of the done-when).
    6. A mail applied 8 days before `NOW` → `{ kind: "too_old" }`; a mail with only `logged` rows → `{ kind: "nothing" }`.
    7. `undoResultSchema` parses every 200 body above.
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; `grep -nE "selectFrom|sql\W" apps/server/src/modules/triage/routes.ts` finds nothing; the only log line holds ids and the kind.
  - Out of scope: the page (stages 8–9).
