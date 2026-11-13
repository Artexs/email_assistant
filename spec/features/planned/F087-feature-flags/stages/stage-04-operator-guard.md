# F087 stage 04 — Operator check and the flag list route [risky]

Part of [`../plan.md`](../plan.md). Read its D5, D7, D15–D18, "Facts checked" (P1, P2) and "Rules for every stage" first. Needs stages 1–3 (`resolveFeature`, `featureSettings`, `configureFeatures`, `upsertOrgFeature`; stage 3 only for a clean base).

`[risky]`: auth and the first web path that reads across organizations. A review job checks it before the land. After this stage lands, the coordinator stops at checkpoint 1.

Two steps. About 300 changed lines.

- [ ] **4.1 `OPERATOR_USER_IDS` and `requireOperator` for every `/api/operator/*` path**
  - Goal: the server knows who the operator is from env only; every path under `/api/operator` answers a non-operator exactly like a path that does not exist.
  - Files:
    - change `apps/server/src/platform/config.ts` and `config.test.ts`;
    - change `.env.example` (after `FEATURES_OFF`);
    - change `apps/server/src/platform/http.ts` and `http.test.ts`;
    - change `apps/server/test/integration/web-helpers.ts` (one optional field).
  - Interfaces:

    ```ts
    // platform/config.ts, baseSchema
    // Comma list of user ids (users.id, UUID) who may use /api/operator/*. Empty = no operator. Never log the ids.
    OPERATOR_USER_IDS: z.preprocess(emptyAsUndefined, z.string().optional()),
    // superRefine: every parseList entry passes z.uuid(), else
    //   ctx.addIssue({ code: "custom", path: ["OPERATOR_USER_IDS"], message: "each entry must be a user id (UUID)" })
    export function operatorUserIds(config: Config): ReadonlySet<string>; // lower-cased, unique

    // platform/http.ts
    export interface WebDeps {
      // … existing fields …
      operatorUserIds?: ReadonlySet<string>; // D16: absent = nobody is an operator
    }
    // D15: 404 { error: "not_found" } unless the session user is in web.operatorUserIds.
    // A refusal logs log.warn(`operator route refused for user ${userId}`) — the id only.
    export const requireOperator: MiddlewareHandler<ApiEnv>;
    // createApp, the api block, in this order:
    //   api.use("*", requireSession);
    //   api.use("*", requireTenant({ … }));
    //   api.use("/operator/*", requireOperator);   // new: guards the whole prefix (P2)
    //   api.use("*", refuseSuspendedWrites);
    ```

    `.env.example`:

    ```
    # User ids (users.id, UUID, comma list) of the operator: only they reach /api/operator/*, every other user gets 404.
    # A user id, not an e-mail address. Empty = no operator. Never log the ids.
    OPERATOR_USER_IDS=
    ```

    `web-helpers.ts`: `WebTestOptions.operatorUserIds?: ReadonlySet<string>`, passed into `WebDeps` only when set (the same spread as `isOrgSuspended`).
  - Decisions: D5, D15, D16, D17.
  - Test:
    - `config.test.ts`, new `describe("OPERATOR_USER_IDS")` (base `fullEnv`):
      1. Unset and `""` → `operatorUserIds(config).size` is 0.
      2. `"0B0F3B3E-6F1C-4D57-9D0E-3F0A8F6F2A11, 0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11"` → a set with the one lower-case id.
      3. `"0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11,admin"` → `configError(...).keys` equals `["OPERATOR_USER_IDS"]`.
    - `http.test.ts`, new `describe("requireOperator")` (a small `Hono<ApiEnv>` that sets `session` and `web` from headers, as the `requireTenant` tests do, then `use("*", requireOperator)` and `get("/x")`):
      4. User in the set → 200 from the handler.
      5. User not in the set → 404 `{ error: "not_found" }`; one `console.error` line that contains `operator route refused for user u-other`.
      6. `web` without `operatorUserIds` → 404 for every user.
  - Check: `bun test apps/server/src/platform/config.test.ts apps/server/src/platform/http.test.ts`; `bun run typecheck`.
  - Done when: tests 1–6 pass; `createApp` has the guard line in the order above.
  - Out of scope: the route (4.2); TOTP for the operator (ADR 0026); a `/operator` page; letting an operator without a membership through (D17).

- [ ] **4.2 `GET /api/operator/flags`: the flags of every organization**
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
    // rows with a key outside the registry are skipped; unconfigured settings warn once and make no row query.
    export async function featureStatesOfAll(
      db: Db | Transaction<DB>,
      settings: FeatureSettings = featureSettings()
    ): Promise<OperatorFlagRow[]>;

    // packages/core/src/web/operator.ts — types only
    import type { FeatureKey } from "../features";
    export interface OperatorFlagRow { orgId: string; flag: FeatureKey; enabled: boolean }
    export interface OperatorFlags { rows: OperatorFlagRow[] }

    // tenancy/operator-routes.ts — no app.use("*") here (P1): the platform guard covers the prefix
    export interface OperatorRouteDeps { db: Db }
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
  - Out of scope: an `operator` module (E7 may move the router behind the F086 layer list); a console page; a write route; `/api/me` flag fields (D22); docs beyond the one bullet (stage 5).

## Done when

- Steps 4.1 and 4.2 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 04 (`/tmp/f087-s04`) prints `PROOF_OK`.
- The final message names checkpoint 1 and the owner steps U2 and U3 as next.
