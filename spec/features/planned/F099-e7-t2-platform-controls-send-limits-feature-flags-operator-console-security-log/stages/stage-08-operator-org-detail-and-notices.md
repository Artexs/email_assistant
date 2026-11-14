# F099 stage 08 — Organization detail and notices [risky]

Part of [`../plan.md`](../plan.md). Read its D14, D15, D16, D17, D18, D19, D28, "Facts checked" and "Rules for every stage" first. Needs stage 07 (`operator/service.ts`, `llmToday`, `OperatorRouteDeps.now`, the core operator schemas).

`[risky]`: cross-organization reads. A review job checks it before the land.

Two steps. About 300 changed lines.

- [ ] **8.1 The last runs and `listAuditEvents`**
  - Goal: the newest time of each job per organization and one audit read for event lists, each in the module that owns the table.
  - Files:
    - change `apps/server/src/modules/audit/repo.ts`: `listAuditEvents` (if stage 12 landed first, it exists: reuse it, do not add a second one); export from `audit/index.ts`;
    - change `apps/server/src/modules/triage/repo.ts`: `lastTriageAt`; export from `triage/index.ts`;
    - change `apps/server/src/modules/reports/repo.ts`: `lastDigestSentAt`; export from `reports/index.ts`;
    - change the file that holds the send-row queries after F091 (`actions/repo/sends.ts`): `lastSendAppliedAt`; list it in `actions/repo/index.ts` and `actions/index.ts`;
    - change `apps/server/src/modules/channels/repo.ts`: `lastOutboxSentAt`; export from `channels/index.ts`;
    - change `apps/server/test/integration/operator-reads.test.ts`.
  - Interfaces:

    ```ts
    // audit — plan D28: newest first (created_at desc, id desc); `events` must not be empty (return [] at once)
    export interface AuditEventRow {
      id: string; // bigint as text
      event: string;
      actor: string;
      reasonCode: string | null;
      data: AuditData;
      at: Date;
    }
    export async function listAuditEvents(
      db: DbOrTrx,
      ctx: TenantContext,
      opts: { events: readonly string[]; since: Date; limit: number }
    ): Promise<AuditEventRow[]>; // created_at >= since

    // triage — newest triage_results.created_at of the organization, null when none
    export async function lastTriageAt(db: DbOrTrx, ctx: TenantContext): Promise<Date | null>;
    // reports — newest digests.sent_at of the organization, null when none
    export async function lastDigestSentAt(db: DbOrTrx, ctx: TenantContext): Promise<Date | null>;
    // actions — newest applied_at of an applied send of the organization, null when none
    export async function lastSendAppliedAt(db: DbOrTrx, ctx: TenantContext): Promise<Date | null>;
    // channels — newest outbox.sent_at of the organization, null when none
    export async function lastOutboxSentAt(db: DbOrTrx, ctx: TenantContext): Promise<Date | null>;
    ```

  - Decisions: D14, D17, D28.
  - Test (`operator-reads.test.ts`, `withRollback`, two organizations, `NOW = 2026-11-20T10:00:00Z`):
    1. Each `last*` function returns the newest time of A and `null` for an organization with no rows; with the context of B it never returns A's time (tenant filter, one case each).
    2. `listAuditEvents(ctx A, { events: ["operator.notice"], since: NOW − 7 days, limit: 2 })` with three A rows (−1 h, −2 h, −8 days) and one B row (−1 h) → the two A rows of −1 h and −2 h, newest first, with `data` as stored. `events: []` → `[]` with no query.
  - Check: `bun test apps/server/test/integration/operator-reads.test.ts`; `bun run typecheck`.
  - Done when: tests 1–2 pass.
  - Out of scope: the routes (step 8.2).

- [ ] **8.2 `GET /api/operator/orgs/:orgId` and `GET /api/operator/notices`**
  - Goal: the operator opens one organization (mailboxes, last runs, failures, LLM today, flags) and reads the operator notices of all organizations (absorbs F081).
  - Files:
    - change `packages/core/src/web/operator.ts` (schemas below);
    - change `apps/server/src/modules/operator/service.ts` (`getOperatorOrg`, `listOperatorNotices`) and `routes.ts`;
    - run `bun run graph:modules`;
    - add `apps/server/test/integration/web-operator-detail.test.ts`.
  - Interfaces:

    ```ts
    // packages/core/src/web/operator.ts
    export const operatorOrgParamsSchema = z.object({ orgId: z.uuid() });
    export const operatorNoticesQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) });
    export const operatorOrgDetailSchema = z.strictObject({
      orgId: z.uuid(),
      plan: orgPlanSchema,
      trialEndsAt: z.iso.datetime().nullable(),
      resumedAt: z.iso.datetime().nullable(),
      maxMailboxes: z.number().int().min(0),
      mailboxes: z.array(z.strictObject({
        mailboxId: z.uuid(),
        status: z.enum(mailboxStatuses),
        statusChangedAt: z.iso.datetime(),
        lastSyncedAt: z.iso.datetime().nullable(),
      })), // no address (plan D15)
      lastRuns: z.strictObject({
        sync: z.iso.datetime().nullable(),
        triage: z.iso.datetime().nullable(),
        digest: z.iso.datetime().nullable(),
        send: z.iso.datetime().nullable(),
        notice: z.iso.datetime().nullable(),
      }),
      failures24h: z.strictObject({ sends: z.number().int(), outbox: z.number().int() }),
      llmToday: operatorLlmTodaySchema,
      flags: z.array(z.strictObject({ flag: z.string(), enabled: z.boolean(), source: z.enum(["env", "row", "default"]) })),
      at: z.iso.datetime(),
    });
    export const operatorNoticesSchema = z.strictObject({
      notices: z.array(z.strictObject({ orgId: z.uuid(), kind: z.string(), key: z.string(), at: z.iso.datetime() })),
      since: z.iso.datetime(),
    });
    export type OperatorOrgDetail = z.infer<typeof operatorOrgDetailSchema>;
    export type OperatorNotices = z.infer<typeof operatorNoticesSchema>;

    // operator/service.ts
    export async function getOperatorOrg(
      deps: { db: Db; now: () => Date },
      orgId: string
    ): Promise<OperatorOrgDetail | { kind: "not_found" }>;
    //   getOrgPlan({ orgId }) undefined → not_found (the service decides the 404, docs/code-patterns.md § HTTP routes);
    //   flags: featureStates(db, { orgId }) (registry order, with source)
    export async function listOperatorNotices(deps: { db: Db; now: () => Date }, days: number): Promise<OperatorNotices>;
    //   since = now − days × 24 h; for each organization of listOrganizations: listAuditEvents({ orgId },
    //   { events: [auditEvents.operatorNotice], since, limit: 200 }); merge, sort by at desc then orgId, cut to 200;
    //   kind = data.kind, key = data.key (rows whose kind or key is not a string are skipped)

    // operator/routes.ts
    //   app.get("/orgs/:orgId", …)  parse params with operatorOrgParamsSchema (a bad uuid → ValidationError → 400);
    //                               not_found → 404 { error: "not_found" }
    //   app.get("/notices", …)      parseQuery(c, operatorNoticesQuerySchema)
    ```

  - Decisions: D15, D16, D17, D19. Mailbox rows come from `listMailboxes` (its order); `lastRuns.sync` is the newest `last_synced_at` of them.
  - Test (`web-operator-detail.test.ts`; set up as in stage 07's route test; A has one `active` mailbox (`last_synced_at` −5 min), one `auth_error` mailbox (`status_changed_at` −30 h), a triage result −10 min, a sent digest −3 h, an applied send −1 h, a sent outbox row −20 min, `stats_page` on; `operator.notice` rows: A `trial_ending` −1 h, B `llm_cap` −2 h, A `auth_error_24h` −10 days):
    3. Route matrix for both routes: no session → 401; the owner of A → 404; the owner of B → 404.
    4. The operator, `GET /orgs/<A>` → 200; `operatorOrgDetailSchema.parse` passes; `mailboxes` has the two ids with their statuses and times; `lastRuns` = { sync −5 min, triage −10 min, digest −3 h, send −1 h, notice −20 min }; `flags` holds `{ flag: "stats_page", enabled: true, source: "row" }`.
    5. `GET /orgs/<B>` → 200 with `lastRuns` all null and `mailboxes: []`.
    6. `GET /orgs/not-a-uuid` → 400 `validation`; `GET /orgs/<random uuid>` → 404 `{ error: "not_found" }`.
    7. `GET /notices` → the A `trial_ending` row and the B `llm_cap` row (filtered to A and B), newest first, with `kind` and `key` as stored; not the −10 days row. `GET /notices?days=30` → also the −10 days row. `?days=0` and `?days=31` → 400.
    8. Neither body holds an organization name, a mailbox address, `@x.test` or a display name.
  - Check: `bun test apps/server/test/integration/web-operator-detail.test.ts apps/server/test/integration/web-operator-orgs.test.ts apps/server/test/integration/web-operator.test.ts apps/server/test/integration/operator-reads.test.ts`; `bun run typecheck`; `bun run lint`.
  - Done when: tests 1–8 pass.
  - Out of scope: writes (stage 09); the page (stage 10).

## Done when

- Steps 8.1 and 8.2 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 08 (`/tmp/f099-s08`) prints `PROOF_OK`.
