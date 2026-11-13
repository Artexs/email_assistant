# F087 stage 05 — Operator flag route [risky]

Part of [`../plan.md`](../plan.md). Read its D5, D7, D15, D17, D18, D24, D25, "Facts checked" (P1, P2) and "Rules for every stage" first. Needs stages 1–4 (`resolveFeature`, `featureSettings`, `configureFeatures`, `upsertOrgFeature`, `requireOperator`, `operatorUserIds`, `WebTestOptions.operatorUserIds`).

`[risky]`: the first web path that reads across organizations. A review job checks it before the land. After this stage lands, the coordinator stops at checkpoint 1.

One step. About 230 changed lines.

- [ ] **5.1 `GET /api/operator/flags`: the flags of every organization**
  - Goal: the operator reads, for every organization, every registry flag with its effective value; the answer holds ids, keys and booleans only.
  - Files:
    - change `apps/server/src/modules/tenancy/repo.ts` (`listOrgFeatureRowsOfAll`);
    - change `apps/server/src/modules/tenancy/features.ts` (`featureStatesOfAll`);
    - add `apps/server/src/modules/tenancy/operator-routes.ts`;
    - change `apps/server/src/modules/tenancy/index.ts` (exports);
    - add `packages/core/src/web/operator.ts`; change `packages/core/src/web/index.ts` (`export * from "./operator";`);
    - change `apps/server/src/web.ts` (`apiRouters` mounts the router; `webDeps` sets `operatorUserIds` and logs the count);
    - change `docs/code-patterns.md` § Data access: one bullet in the list of functions without `TenantContext` (text below);
    - add `apps/server/test/integration/web-operator.test.ts`;
    - change `apps/server/test/integration/web-http.test.ts` (one case in `describe("real webDeps")`).
  - Interfaces:

    ```ts
    // tenancy/repo.ts — no TenantContext: listed in docs/code-patterns.md; only /api/operator/* calls it
    export async function listOrgFeatureRowsOfAll(
      db: Db | Transaction<DB>
    ): Promise<{ org_id: string; flag: string; enabled: boolean }[]>; // ordered by org_id, flag

    // tenancy/features.ts — D18: listOrganizations order × registry order; resolveFeature per pair;
    // rows with a key outside the registry are skipped; the kill list comes from featureSettings() (D24: no settings argument).
    export async function featureStatesOfAll(db: Db | Transaction<DB>): Promise<OperatorFlagRow[]>;

    // packages/core/src/web/operator.ts — types only
    import type { FeatureKey } from "../features";
    export interface OperatorFlagRow {
      orgId: string;
      flag: FeatureKey;
      enabled: boolean;
    }
    export interface OperatorFlags {
      rows: OperatorFlagRow[];
    }

    // tenancy/operator-routes.ts — no app.use("*") here (P1): the platform guard covers the prefix
    export interface OperatorRouteDeps {
      db: Db;
    }
    export function operatorRoutes(deps: OperatorRouteDeps): Hono<ApiEnv>;
    //   app.get("/flags", async (c) => c.json({ rows: await featureStatesOfAll(deps.db) } satisfies OperatorFlags));

    // web.ts, apiRouters, after the tenancy router:
    //   api.route("/operator", operatorRoutes({ db }));
    // web.ts, webDeps: const operators = operatorUserIds(config); log.info(`operator ids: ${operators.size}`);
    //   return { …, operatorUserIds: operators, … }
    ```

    `docs/code-patterns.md` § Data access, a new bullet after the `listOrganizations` bullet:

    > - `listOrgFeatureRowsOfAll` (`tenancy/repo.ts`, F087): `GET /api/operator/flags` lists the flags of every organization. Only routes under `/api/operator`, behind `requireOperator`, call it.

  - Decisions: D5, D7, D15, D17, D18.
  - Test (`web-operator.test.ts`; the real routers, built as in `web-suspended.test.ts`: `apiRouters(testConfig, db, extras, () => new Date(), async () => [])`; `org = await webOrg(db)` in `beforeAll`, `org.cleanup()` in `afterAll`; `operatorUserIds = new Set([org.assistantId])` unless a case says otherwise; sessions `owner`, `assistant`, `other` as in `web-suspended.test.ts`; flag rows written with `upsertOrgFeature(db, …, { setBy: "test", setAt: new Date("2026-11-20T10:00:00Z") })`; `afterEach` deletes the `org_features` rows of both organizations and calls `configureFeatures({ off: [] })`; every assertion on `rows` filters to `org.orgId` and `org.otherOrgId`, never a total count):
    1. No session → 401 `{ error: "unauthorized" }`.
    2. The owner of A (not an operator) → 404, and the body equals the body of `GET /api/no-such-path` for the same user.
    3. The owner of B → 404 `{ error: "not_found" }`.
    4. The operator (A's assistant: the role does not matter) with A `stats_page` = true → 200; for A the rows are `[{ orgId: A, flag: "stats_page", enabled: true }, { orgId: A, flag: "approvals_page", enabled: false }, { orgId: A, flag: "sent_sync", enabled: false }]`; for B all three are `false`; every row has exactly the keys `enabled`, `flag`, `orgId`.
    5. `configureFeatures({ off: ["stats_page"] })`, A `stats_page` = true → the operator sees A `stats_page` `false`.
    6. A raw row `old_flag` = true for A → no row with `flag: "old_flag"`.
    7. Path forms: the owner of A gets 404 on `/api/operator`, `/api/operator/`, `/api/operator/flags/`, `/api/operator//flags`, `/api/operator/%66lags`; the operator gets 404 on `/api/operator/nope`; `POST /api/operator/flags` (with the test origin) → 404 for both.
    8. The prefix guard does not leak (P1): the owner of A gets 200 on `GET /api/me` with the same app.
    9. No membership: a committed user from `insertUser` (deleted in `afterAll`) in `operatorUserIds`, with a session → 403 `{ error: "no_organization" }` (D17).
    10. A suspended own organization: `isOrgSuspended` answers true for A → the operator still gets 200.
    11. `webTestApp` without `operatorUserIds` → the operator user gets 404.
    12. Logs: case 2 writes one `console.error` line with `operator route refused for user <ownerId of A>`; no captured line holds an organization name or an `@x.test` address.
    - `web-http.test.ts`, `describe("real webDeps")`: 13. `webDeps(loadConfig({ …base, OPERATOR_USER_IDS: "0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11" }), db, extras)` → `operatorUserIds` has that id; a captured `console.log` line holds `operator ids: 1` and no line holds the id. Close the runtime in `finally`.
  - Check: `bun test apps/server/test/integration/web-operator.test.ts apps/server/test/integration/web-http.test.ts apps/server/test/integration/web-suspended.test.ts` (the suspended test walks every route: the new GET route and the `ALL` guard entry must not break it); `bun run typecheck`; `bun run lint` (the F086 layer lint must accept `tenancy/operator-routes.ts`).
  - Done when: tests 1–13 pass; `GET /api/operator/flags` is the only route under `/api/operator`.
  - Out of scope: an `operator` module (E7 may move the router behind the F086 layer list); a console page; a write route; `/api/me` flag fields (D22); docs beyond the one bullet (stage 6).

## Done when

- Step 5.1 is done and committed by explicit paths.
- The Proof command of `plan.md` for stage 05 (`/tmp/f087-s05`) prints `PROOF_OK`.
- The final message names checkpoint 1 and the owner steps U2 and U3 as next.
