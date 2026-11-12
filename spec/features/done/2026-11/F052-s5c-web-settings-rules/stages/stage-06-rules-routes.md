# s5c-web-settings-rules — Stage 6

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", S1–S11, "Facts checked", B1–B16, "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first.

## Stage 6 — Rules routes [risky]

One step. A blocklist rule sends a sender's mail to spam; a rule of another organization must never show or change.

- [x] **6.1 `rulesRoutes` in `config/routes.ts`, mounted in `web.ts` (B7, B8)**
  - Goal: the web lists, adds and deletes sender rules through the stage 3 services.
  - Files: change `apps/server/src/modules/config/routes.ts`, `config/index.ts`, `apps/server/src/web.ts`; create `apps/server/test/integration/web-rules.test.ts`.
  - Interfaces:

    ```ts
    // config/routes.ts
    export interface RulesRouteDeps {
      db: Db;
      now(): Date;
    }
    export function rulesRoutes(deps: RulesRouteDeps): Hono<ApiEnv>;
    // a row → the web view
    function ruleView(row: SenderRuleRow): RuleView; // { id, kind, pattern, mailboxId: row.mailbox_id, createdAt: row.created_at.toISOString() }
    ```

  - Decisions:
    - `GET /rules` (member): `rulesQuerySchema.safeParse({ mailboxId: c.req.query("mailboxId") })` (an absent value is `undefined`); a failure → throw `ValidationError` with the mapped issues (the `parseBody` shape: `{ path, code, message }`; export a small `parseQuery(c, schema)` from `platform/http.ts` next to `parseBody`; its test is test 1 below (`?mailboxId=nope` → 400 with `details`); → `listSenderRuleRows(db, ctx, { mailboxId })` → 200 `rows.map(ruleView)`. A foreign or unknown `mailboxId` gives the org-wide rules only (the tenant filter; B8).
    - `POST /rules` (owner): `parseBody(c, ruleBodySchema)` → `addSenderRule(db, ctx, { mailboxId: body.mailboxId ?? null, pattern: body.pattern, kind: body.kind, actor: userId, now: deps.now() })`: `added` → 201 `ruleView(rule)`; `exists` → 409 `rule_exists`; `limit` → 409 `rule_limit`; `mailbox_not_found` → 404 `not_found`.
    - `DELETE /rules/:id` (owner): non-UUID → 404 with no database call → `removeSenderRule(db, ctx, id, { actor: userId, now })`: `removed` → 204; `not_found` → 404.
    - No log line holds a pattern; the routes log nothing (the audit rows record the changes).
    - `web.ts`: `routers` mounts `rulesRoutes({ db, now })` after `settingsRoutes`.
    - The onboarding item "rules" counts every rule (`countSenderRules`, S5b): a web add or delete changes it with no extra code.
  - Test (`web-rules.test.ts`; `webTestApp` with `routers: (api) => api.route("/", rulesRoutes({ db, now: () => NOW }))`, `webOrg`, `as()`, mailboxes M1 (owner's organization) and M2 (other organization) committed as in stage 5):
    1. Matrix: no cookie → 401 on the three routes; the assistant on `POST` and `DELETE` → 403 `owner_only`; `GET` as the assistant → 200; `POST` with `{ kind: "vip", pattern: "@x.pl" }` → 400 `validation`, `details[0]` `{ path: "pattern", message: "pattern_invalid" }`, and the body of the answer does not contain `@x.pl`; `GET ?mailboxId=nope` → 400 `validation` with `details[0].path` `mailboxId` (the `parseQuery` test); `DELETE /rules/not-a-uuid` → 404; a `POST` without `Origin` → 403 `bad_origin`.
    2. `POST { kind: "vip", pattern: " Boss@Firma.TEST " }` → 201, `ruleViewSchema` parses, `pattern` `boss@firma.test`, `mailboxId` null; the same again → 409 `rule_exists`.
    3. `POST { kind: "blocklist", pattern: "spam.test", mailboxId: M1 }` → 201 with `mailboxId` M1; with `mailboxId: M2` → 404; with a random UUID → 404.
    4. `GET` → both rules in creation order; `GET ?mailboxId=M1` → both; add a rule for a second mailbox M3 of the owner, then `GET ?mailboxId=M1` → the org-wide rule and M1's, not M3's; `GET ?mailboxId=M2` → only the org-wide rule.
    5. The other organization's owner: `GET` → `[]`; `DELETE` of the first rule's id → 404, and the owner's `GET` still lists it.
    6. `DELETE` the first rule → 204 with no body; again → 404; the audit log has one `rule.added` per add and one `rule.removed`, all with actor = the owner's id and no pattern in `data`.
    7. Cap: 1000 rows inserted for the organization by SQL (as in stage 3 test 6, committed and cleaned by the organization delete) → `POST` → 409 `rule_limit`.
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; `grep -nE "selectFrom|sql\W" apps/server/src/modules/config/routes.ts` finds nothing (no SQL in the route file); `grep -n "log\." apps/server/src/modules/config/routes.ts` finds no pattern.
  - Out of scope: the page (stage 10).
