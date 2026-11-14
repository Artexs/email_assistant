# F099 stage 07 — Organization list [risky]

Part of [`../plan.md`](../plan.md). Read its D14, D15, D16, D17, D18, "Facts checked" and "Rules for every stage" first. Needs stage 06 (the `operator` module).

`[risky]`: the second web path that reads across organizations. A review job checks it before the land; the reviewer looks for a name, an address or a cross-tenant query.

Two steps. About 300 changed lines.

- [ ] **7.1 Tenant-scoped counts in the owning modules**
  - Goal: each fact of the list comes from the module that owns its table, through one tenant-scoped function.
  - Files:
    - change the file that holds the send-row queries after F091 (`actions/repo/sends.ts`): `countFailedSendsSince`; list it in `actions/repo/index.ts` and `actions/index.ts`;
    - change `apps/server/src/modules/channels/repo.ts`: `countFailedOutboxSince`; export from `channels/index.ts`;
    - change `apps/server/src/modules/audit/repo.ts`: `sumLlmCallsByModelSince`; export from `audit/index.ts`;
    - add `apps/server/test/integration/operator-reads.test.ts` (the repository cases).
  - Interfaces:

    ```ts
    // actions — sends of the organization that ended `failed` after `since` (by updated_at, plan D17)
    export async function countFailedSendsSince(db: DbOrTrx, ctx: TenantContext, since: Date): Promise<number>;
    //   type = 'send' AND status = 'failed' AND updated_at > since AND org_id = ctx.orgId

    // channels — outbox rows of the organization that failed and were created after `since` (plan D17)
    export async function countFailedOutboxSince(db: DbOrTrx, ctx: TenantContext, since: Date): Promise<number>;
    //   status = 'failed' AND created_at > since AND org_id = ctx.orgId
    //   AND (error_code IS NULL OR error_code NOT IN ('outdated', 'expired'))  -- cancellations are not failures

    // audit — `llm.call` rows of the organization at or after `since`, per model (the `countLlmCallsSince` shape)
    export async function sumLlmCallsByModelSince(
      db: DbOrTrx,
      ctx: TenantContext,
      since: Date
    ): Promise<{ model: string; calls: number; tokensIn: number; tokensOut: number }[]>;
    //   GROUP BY data->>'model' (null model → "unknown"); tokens: sum of (data->>'tokens_in')::bigint, null as 0; ordered by model
    ```

  - Decisions: D14, D17, D18.
  - Test (`operator-reads.test.ts`, `withRollback`; `NOW = 2026-11-20T10:00:00Z`; two organizations from `createOrgWithMailbox`):
    1. `countFailedSendsSince(ctx A, NOW − 24 h)`: A has failed sends with `updated_at` −2 h and −30 h, an applied send −1 h → 1. Context B → 0 (tenant filter).
    2. `countFailedOutboxSince`: A has outbox rows `failed` (`error_code` `telegram_error` or any code the sender writes) at −1 h, `failed` at −25 h, `failed` / `outdated` at −1 h, `failed` / `expired` at −1 h, `sent` at −1 h → 1. Context B → 0.
    3. `sumLlmCallsByModelSince(ctx A, 2026-11-20T08:00:00Z)`: `recordLlmCall` rows for A — `gpt-6-luna` × 3 (tokens 100 000 in, 20 000 out each) at 08:00Z, 09:00Z, 09:30Z; `unknown-model` × 2 (tokens null) at 09:00Z; `gpt-6-luna` × 1 at 07:59Z → `[{ model: "gpt-6-luna", calls: 3, tokensIn: 300000, tokensOut: 60000 }, { model: "unknown-model", calls: 2, tokensIn: 0, tokensOut: 0 }]`. Context B → `[]`.
  - Check: `bun test apps/server/test/integration/operator-reads.test.ts`; `bun run typecheck`.
  - Done when: tests 1–3 pass; each function has its tenant-filter case.
  - Out of scope: the route (step 7.2).

- [ ] **7.2 `GET /api/operator/orgs`**
  - Goal: the operator sees every organization in one list with ids, codes, counts and dates.
  - Files:
    - change `packages/core/src/web/operator.ts` (schemas and types; keep `OperatorFlagRow`, `OperatorFlags`);
    - add `apps/server/src/modules/operator/service.ts` (`listOperatorOrgs`, `llmToday`);
    - change `apps/server/src/modules/operator/routes.ts` (`OperatorRouteDeps.now`, the route) and `operator/index.ts`;
    - change `apps/server/src/web.ts` (`operatorRoutes({ db, now })`);
    - run `bun run graph:modules` (new imports from `operator`);
    - add `apps/server/test/integration/web-operator-orgs.test.ts`.
  - Interfaces:

    ```ts
    // packages/core/src/web/operator.ts — strict objects: no field beyond these (plan D15)
    export const operatorLlmTodaySchema = z.strictObject({
      since: z.iso.datetime(), // the quota day start
      calls: z.number().int().min(0),
      costUsd: z.number().min(0), // priced models only
      unpricedCalls: z.number().int().min(0),
    });
    export const operatorOrgRowSchema = z.strictObject({
      orgId: z.uuid(),
      plan: orgPlanSchema,
      trialEndsAt: z.iso.datetime().nullable(),
      resumedAt: z.iso.datetime().nullable(),
      maxMailboxes: z.number().int().min(0),
      members: z.number().int().min(0),
      linkedChats: z.number().int().min(0),
      mailboxes: z.strictObject({ total: z.number().int(), active: z.number().int(), paused: z.number().int(), authError: z.number().int() }),
      lastSyncAt: z.iso.datetime().nullable(), // newest mailboxes.last_synced_at
      failures24h: z.strictObject({ sends: z.number().int(), outbox: z.number().int() }),
      llmToday: operatorLlmTodaySchema,
    });
    export const operatorOrgListSchema = z.strictObject({ orgs: z.array(operatorOrgRowSchema), at: z.iso.datetime() });
    export type OperatorOrgRow = z.infer<typeof operatorOrgRowSchema>;
    export type OperatorOrgList = z.infer<typeof operatorOrgListSchema>;

    // operator/service.ts
    export async function llmToday(db: Db, ctx: TenantContext, now: Date): Promise<OperatorOrgRow["llmToday"]>;
    //   since = quotaDayStart(now, QUOTA_TIMEZONE); rows = sumLlmCallsByModelSince; for each row
    //   cost = costPerMail(row.model, row.tokensIn, row.tokensOut, now): null → unpricedCalls += calls; else costUsd += cost
    export async function listOperatorOrgs(deps: { db: Db; now: () => Date }): Promise<OperatorOrgList>;
    //   now = deps.now() once; for each organization of listOrganizations (its order): getOrgPlan, listMemberships,
    //   listLinkedChatsOfOrg, listMailboxes, countFailedSendsSince(now − 24 h), countFailedOutboxSince(now − 24 h), llmToday —
    //   all with { orgId }; organizations one after another (no Promise.all over organizations; the reads of one may run together)

    // operator/routes.ts
    export interface OperatorRouteDeps { db: Db; now: () => Date }
    //   app.get("/orgs", async (c) => c.json((await listOperatorOrgs(deps)) satisfies OperatorOrgList));
    ```

  - Decisions: D13, D14 (only tenant-scoped reads), D15, D16, D17, D18. An organization deleted between `listOrganizations` and its reads (a race with a future org delete) is skipped: `getOrgPlan` returns undefined → no row.
  - Test (`web-operator-orgs.test.ts`; built like `web-operator.test.ts`: `apiRouters(testConfig, db, extras, () => NOW, async () => [])`, `org = await webOrg(db)`, `operatorUserIds = new Set([org.assistantId])`; committed rows for A: two mailboxes (one `active` with `last_synced_at` −5 min, one `auth_error`), one linked chat of the owner, one failed send −2 h, one failed outbox row −1 h, the `llm.call` rows of test 3; `afterAll` deletes them and calls `org.cleanup()`; every assertion filters `orgs` to `org.orgId` and `org.otherOrgId`):
    4. No session → 401; the owner of A (not an operator) → 404 `{ error: "not_found" }`; the owner of B → 404.
    5. The operator → 200; `operatorOrgListSchema.parse(body)` passes; A's row: `members: 2`, `linkedChats: 1`, `mailboxes: { total: 2, active: 1, paused: 0, authError: 1 }`, `lastSyncAt` = −5 min, `failures24h: { sends: 1, outbox: 1 }`, `llmToday: { since: "2026-11-20T08:00:00.000Z", calls: 5, costUsd: 0.06, unpricedCalls: 2 }` (compare `costUsd` with `toBeCloseTo(0.06, 10)`); B's row has zeros and `lastSyncAt: null`.
    6. The body as text holds neither organization name (`Web org`, `Web other org`), nor `@x.test`, nor a display name (`Owner`, `Assistant`).
    7. Order: A comes before B (both from `webOrg`, A created first).
    8. Time: the test prints the elapsed time of one `GET /orgs` with `console.info` only when `F099_TIMING=1`; the worker runs it once with that env and reports the milliseconds and the number of organizations in the test DB in the final message (plan.md "Not verified").
  - Check: `bun test apps/server/test/integration/web-operator-orgs.test.ts apps/server/test/integration/web-operator.test.ts apps/server/test/integration/operator-reads.test.ts packages/core/src/web`; `bun run typecheck`; `bun run lint`.
  - Done when: tests 1–8 pass; no new repository function lacks a `TenantContext`.
  - Out of scope: the detail and notice routes (stage 08), the page (stage 10).

## Done when

- Steps 7.1 and 7.2 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 07 (`/tmp/f099-s07`) prints `PROOF_OK`.
