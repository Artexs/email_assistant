# F099 stage 09 — Operator writes [risky]

Part of [`../plan.md`](../plan.md). Read its D15, D16, D20, D21, "Facts checked" and "Rules for every stage" first. Needs stages 06–08 (the module, the routes, the `SUSPENDED_WRITE_ALLOW` entry).

`[risky]`: the first web writes into other organizations. A review job checks it before the land; the reviewer tries a write as a non-operator, without an origin, and on a foreign id.

Two steps. About 250 changed lines.

- [ ] **9.1 One builder of the plan hooks**
  - Goal: the CLI and the console suspend and resume with exactly the same hooks.
  - Files: change `apps/server/src/composition.ts` (`orgPlanHooks`), `apps/server/src/scripts/org-plan.ts` (use it).
  - Interfaces:

    ```ts
    // composition.ts — the hooks of setOrgPlan for every caller (org:plan, the operator console)
    export function orgPlanHooks(db: Db): SetOrgPlanHooks; // { onSuspended: cancelPendingOutboxOfOrg, onResumed: resumeHook(db) }
    ```

  - Decisions: D20.
  - Test: the existing `org-cli.test.ts` (it runs `org:plan`) passes unchanged.
  - Check: `bun test apps/server/test/integration/org-cli.test.ts apps/server/test/integration/tenancy-plan.test.ts`.
  - Done when: `org-plan.ts` calls `orgPlanHooks(db)`; nothing else changes in it.
  - Out of scope: other CLIs.

- [ ] **9.2 `POST /api/operator/orgs/:orgId/plan` and `POST /api/operator/orgs/:orgId/flags`**
  - Goal: the operator changes a plan (trial, active, suspended, max mailboxes) and a flag of any organization; the rows and audit rows are the CLI's, with the operator's user id as actor.
  - Files:
    - change `packages/core/src/web/operator.ts` (body and result schemas);
    - change `apps/server/src/modules/operator/service.ts` (`changeOrgPlan`, `changeOrgFlag`) and `routes.ts` (`OperatorRouteDeps.planHooks`, two routes);
    - change `apps/server/src/web.ts` (`operatorRoutes({ db, now, planHooks: orgPlanHooks(db) })`);
    - run `bun run graph:modules` if an import between modules changes;
    - add `apps/server/test/integration/web-operator-writes.test.ts`.
  - Interfaces:

    ```ts
    // packages/core/src/web/operator.ts
    export const operatorPlanBodySchema = z.strictObject({
      plan: orgPlanSchema.optional(),
      trialDays: z.number().int().min(1).max(365).optional(),
      maxMailboxes: z.number().int().min(0).max(100).optional(),
    });
    export const operatorFlagBodySchema = z.strictObject({
      flag: z.string().min(1).max(40),
      enabled: z.boolean(),
    });
    export const operatorPlanResultSchema = z.strictObject({
      result: z.enum(["changed", "unchanged"]),
      plan: orgPlanSchema,
      trialEndsAt: z.iso.datetime().nullable(),
      maxMailboxes: z.number().int().min(0),
      resumedAt: z.iso.datetime().nullable(),
      cancelledMessages: z.number().int().min(0), // 0 when unchanged
      expiredSends: z.number().int().min(0), // 0 when unchanged
    });
    export const operatorFlagResultSchema = z.strictObject({
      result: z.enum(["changed", "unchanged"]),
      flag: z.string(),
      enabled: z.boolean(),
    });

    // operator/service.ts — thin: one service call each (ADR 0027 point 4)
    export async function changeOrgPlan(
      deps: { db: Db; now: () => Date; planHooks: SetOrgPlanHooks },
      input: { orgId: string; actor: string; body: OperatorPlanBody }
    ): Promise<SetOrgPlanResult>; // setOrgPlan(db, { orgId }, { ...body, actor, now: deps.now() }, deps.planHooks)
    export async function changeOrgFlag(
      deps: { db: Db; now: () => Date },
      input: { orgId: string; actor: string; body: OperatorFlagBody }
    ): Promise<SetOrgFeatureResult>; // setOrgFeature(db, { orgId }, { ...body, actor, now: deps.now() })

    // operator/routes.ts — actor = c.get("session").userId; the path id rule of stage 08 (not a UUID → 404, no DB call)
    //   plan:  changed / unchanged → 200 operatorPlanResult; not_found → 404 { error: "not_found" };
    //          trial_days_needed → 400 { error: "trial_days_needed" }; bad_input → 400 { error: <reason> }
    //   flags: changed / unchanged → 200 operatorFlagResult; not_found → 404 { error: "not_found" };
    //          unknown_flag → 400 { error: "unknown_flag" }
    //   one event line per change: log.info("operator_write", { org_id, user_id, kind: "plan" | "flag", status: result.kind })
    ```

  - Decisions: D20 (same service functions, hooks, audit rows in the target organization, no flag clear), D21 (the operator's own organization may be suspended).
  - Test (`web-operator-writes.test.ts`; set up as in stage 07's route test; the operator is A's assistant; `NOW = 2026-11-20T10:00:00Z`; each case restores B's plan to `active` and deletes B's `org_features` rows in `afterEach`):
    1. Route matrix for both routes: no session → 401; the owner of A → 404; the owner of B → 404; no `origin` header → 403 `bad_origin`; a bad body (`{ plan: "gold" }`, `{ flag: "", enabled: true }`, an extra field) → 400 `validation`; path id `not-a-uuid` → 404; a random uuid → 404 `not_found`, no row written.
    2. The operator sets B `stats_page` on → 200 `{ result: "changed", flag: "stats_page", enabled: true }`; B's `org_features` row has `set_by` = the operator's id; one `org.flag_changed` audit row in B with `actor` = the operator's id and data exactly `{ flag: "stats_page", enabled: true }`. Again → `unchanged`, no second audit row. `{ flag: "nope", enabled: true }` → 400 `unknown_flag`, no row.
    3. The operator suspends B (`{ plan: "suspended" }`) with one pending outbox row of B → 200 `result: "changed"`, `plan: "suspended"`, `cancelledMessages: 1`; B is suspended; one `org.plan_changed` audit row in B with `actor` = the operator's id and the data keys of the CLI row (`from`, `to`, `max_from`, `max_to`, `trial_ends_at`).
    4. In one case: the operator suspends B, then resumes B (`{ plan: "active" }`) → `result: "changed"`, `plan: "active"`, `resumedAt` = `NOW`; `expiredSends` is a number (the resume hook ran: 0 with no unseen approval).
    5. Each sub-step starts from an active B (set B back to `active` with `setOrgPlan` between the sub-steps): `{ plan: "trial" }` → 400 `trial_days_needed`; `{ plan: "trial", trialDays: 14 }` → `trialEndsAt` = `2026-12-04T10:00:00.000Z`; `{ trialDays: 5 }` → 400 `trial_days_without_trial`; `{}` → 400 `nothing_to_change`.
    6. With `isOrgSuspended` true for A (the operator's own organization), case 2 still answers 200 (plan D21).
    7. Logs: case 2 writes one `operator_write` line with `org_id`, `user_id`, `kind: "flag"`, `status: "changed"`; no captured line holds an organization name or `@x.test`.
  - Check: `bun test apps/server/test/integration/web-operator-writes.test.ts apps/server/test/integration/web-suspended.test.ts apps/server/test/integration/web-operator.test.ts apps/server/test/integration/org-cli.test.ts`; `bun run typecheck`; `bun run lint`.
  - Done when: tests 1–7 pass.
  - Out of scope: a flag clear; a member or mailbox write; the page (stage 11).

## Done when

- Steps 9.1 and 9.2 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 09 (`/tmp/f099-s09`) prints `PROOF_OK`.
