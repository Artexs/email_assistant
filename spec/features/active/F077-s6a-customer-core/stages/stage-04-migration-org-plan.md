# s6a-customer-core — Stage 4

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A6–A9, A12, "Differences found at collect" item 4 and "Rules for every step" first, and the master plan's D3 and D4.

## Stage 4 — Migration `org_plan`, `db:types`, tenancy read and `setOrgPlan` [risky]

Database of the build: the worktree database. This is the first migration of S6a.

- [ ] **4.1 Migration, types, plan read and change**
  - Goal: each organization has a plan state that the jobs, the edges and the CLIs can read and the operator can change with an audit row, in one transaction.
  - Files:
    - create `db/migrations/20261112100001_org_plan.sql` (the version must be above the highest file in `db/migrations/`; today `20261111000001_delete_mailbox.sql`; if a newer file exists at build time, take the next free version and log it);
    - regenerate `apps/server/src/platform/db/schema.ts` with `bun run db:types` (never by hand);
    - change `packages/core/src/tenancy.ts` (it holds `membershipRoleSchema`) — add `orgPlans` and `orgPlanSchema`, export them from the core index the same way;
    - change `apps/server/src/modules/tenancy/repo.ts` (`insertOrganization` input, `getOrgPlan`, `isOrgSuspended`, `listOrganizations`, `updateOrganizationPlan`), `apps/server/src/modules/tenancy/service.ts` (`createOrganizationWithOwner` input, `setOrgPlan`), `apps/server/src/modules/tenancy/index.ts`;
    - change `apps/server/src/modules/audit/repo.ts` (`auditEvents.orgPlanChanged = "org.plan_changed"`, comment `// data: from, to, max_from, max_to, trial_ends_at`);
    - create `apps/server/test/integration/tenancy-plan.test.ts`;
    - change `docs/code-patterns.md` (the no-`TenantContext` list: `listOrganizations` in `tenancy/repo.ts`, "the retention job, the operator job and `org:status` walk all organizations").
  - Interfaces:

    ```ts
    // packages/core
    export const orgPlans = ["trial", "active", "suspended"] as const;
    export const orgPlanSchema = z.enum(orgPlans);
    export type OrgPlan = z.infer<typeof orgPlanSchema>;

    // tenancy/repo.ts — this module writes `Db | Transaction<DB>` (no `DbOrTrx` alias here); below, `DbOrTrx` means that union
    export interface OrgPlanState {
      plan: OrgPlan;
      trialEndsAt: Date | null;
      maxMailboxes: number;
      resumedAt: Date | null;
    }
    export function getOrgPlan(db: DbOrTrx, ctx: TenantContext): Promise<OrgPlanState | undefined>;
    export function isOrgSuspended(db: DbOrTrx, ctx: TenantContext): Promise<boolean>; // missing org → false
    // No TenantContext: walks all organizations (A8).
    export function listOrganizations(db: DbOrTrx): Promise<
      {
        id: string;
        plan: OrgPlan;
        trialEndsAt: Date | null;
        timezone: string;
        dataRetentionDays: number;
        resumedAt: Date | null;
      }[]
    >;
    export function updateOrganizationPlan(
      trx: Transaction<DB>,
      ctx: TenantContext,
      patch: { plan: OrgPlan; trialEndsAt: Date | null; maxMailboxes: number; resumedAt: Date | null }
    ): Promise<OrganizationRow | undefined>;
    export function insertOrganization(
      db: DbOrTrx,
      input: { name: string; timezone: string; plan?: OrgPlan; trialEndsAt?: Date | null }
    ): Promise<{ id: string }>;

    // tenancy/service.ts
    export type OrgPlanInput = { kind: "active" } | { kind: "trial"; endsAt: Date };
    // CreateOrganizationInput gets `plan?: OrgPlanInput` (absent = active).
    export interface SetOrgPlanInput {
      plan?: OrgPlan;
      trialDays?: number;
      maxMailboxes?: number;
      actor: string;
      now: Date;
    }
    export interface SetOrgPlanHooks {
      onSuspended?: (trx: Transaction<DB>, ctx: TenantContext) => Promise<number>;
    }
    export type SetOrgPlanResult =
      | { kind: "changed"; before: OrgPlanState; after: OrgPlanState; cancelledMessages: number }
      | { kind: "unchanged"; state: OrgPlanState }
      | { kind: "not_found" }
      | { kind: "trial_days_needed" }
      | {
          kind: "bad_input";
          reason: "nothing_to_change" | "trial_days_without_trial" | "trial_days_range" | "max_mailboxes_range";
        };
    export function setOrgPlan(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      input: SetOrgPlanInput,
      hooks?: SetOrgPlanHooks
    ): Promise<SetOrgPlanResult>;
    ```

  - Decisions:
    - Exact SQL (keep the order; the down part undoes it in reverse):

      ```sql
      -- migrate:up
      ALTER TABLE organizations
        ADD COLUMN plan text NOT NULL DEFAULT 'active' CHECK (plan IN ('trial', 'active', 'suspended')),
        ADD COLUMN trial_ends_at timestamptz,
        ADD COLUMN max_mailboxes integer NOT NULL DEFAULT 2 CHECK (max_mailboxes >= 0),
        ADD COLUMN resumed_at timestamptz;
      ALTER TABLE organizations
        ADD CONSTRAINT organizations_trial_end_check CHECK (plan <> 'trial' OR trial_ends_at IS NOT NULL);

      -- migrate:down
      ALTER TABLE organizations DROP CONSTRAINT organizations_trial_end_check;
      ALTER TABLE organizations
        DROP COLUMN resumed_at,
        DROP COLUMN max_mailboxes,
        DROP COLUMN trial_ends_at,
        DROP COLUMN plan;
      ```

      The inline checks get the Postgres names `organizations_plan_check` and `organizations_max_mailboxes_check`; the tests assert these names. No grant lines: `app` already has `UPDATE` on `organizations` (`updateOrganization` uses it). Why the default `active`: A6.

    - `setOrgPlan` rules: A9, word for word. Validation before the transaction: no field given → `bad_input/nothing_to_change`; `trialDays` not an integer 1–365 → `trial_days_range`; `maxMailboxes` not an integer 0–100 → `max_mailboxes_range`; `trialDays` with a target plan other than `trial` (the given `plan`, else the current plan) → `trial_days_without_trial`.
    - In the transaction: `lockOrganization(trx, ctx)` (`FOR NO KEY UPDATE`) → undefined → `not_found`. Compute `after` from `before` and the input (A9). `after` equal to `before` in all four fields → `unchanged` (no write). Else `updateOrganizationPlan`, `recordAudit(trx, ctx, { actor, event: auditEvents.orgPlanChanged, data: { from, to, max_from, max_to, trial_ends_at } })` (`trial_ends_at` = ISO string or `null`), then, only when `before.plan !== "suspended" && after.plan === "suspended"`, `cancelledMessages = await hooks.onSuspended?.(trx, ctx) ?? 0`. A throw in the hook rolls the whole change back.
    - `createOrganizationWithOwner`: `plan` absent or `{ kind: "active" }` → insert without plan fields (DB default); `{ kind: "trial", endsAt }` → `plan = 'trial'`, `trial_ends_at = endsAt`. No audit row at create (as today).
    - `getOrgPlan` maps the row to `OrgPlanState` with `orgPlanSchema.parse(row.plan)`.

  - Test (`tenancy-plan.test.ts`, `withRollback`; fixed `now = new Date("2026-11-12T10:00:00Z")`; a statement that must fail runs in a savepoint, the pattern of `delegation-schema.test.ts`):
    1. Schema: insert an organization with `plan = 'trial'` and no `trial_ends_at` → `23514` with `constraint` `organizations_trial_end_check`; `plan = 'gold'` → `23514` `organizations_plan_check`; `max_mailboxes = -1` → `23514` `organizations_max_mailboxes_check`; a plain insert (name, timezone) → `plan = 'active'`, `max_mailboxes = 2`, `trial_ends_at` and `resumed_at` null.
    2. Existing rows: `select count(*) from organizations where plan <> 'active'` on the worktree DB right after `db:migrate` (before any test) = 0. Run it once by hand and paste the number in the log (it is not a test: tests share the DB).
    3. `createOrganizationWithOwner` with `{ kind: "trial", endsAt: now + 30 d }` → `getOrgPlan` = `trial` with that date; without `plan` → `active`.
    4. `setOrgPlan` active → suspended: result `changed`; `resumed_at` stays null; one `org.plan_changed` row with `{ from: "active", to: "suspended", max_from: 2, max_to: 2, trial_ends_at: null }`; the `onSuspended` hook called once with the same `trx` and `ctx`, its return in `cancelledMessages`.
    5. suspended → active at `now`: `resumed_at = now`; the hook not called.
    6. suspended → trial with `trialDays: 14`: `trial_ends_at = now + 14 d`, `resumed_at = now`.
    7. active → trial without `trialDays` → `trial_days_needed`; nothing written (no audit row).
    8. trial → trial with no `trialDays` and `maxMailboxes: 5` → `changed`, the date kept, max 5; trial → active → `trial_ends_at` null.
    9. same plan, same max → `unchanged`, no audit row; no field → `bad_input/nothing_to_change`; `trialDays: 0` → `trial_days_range`; `maxMailboxes: 101` → `max_mailboxes_range`; `{ plan: "active", trialDays: 5 }` → `trial_days_without_trial`.
    10. `maxMailboxes: 0` with one mailbox in the org → `changed` (below the count is allowed, D3).
    11. A hook that throws → the plan stays `active`, no audit row. This case runs on `db` with a committed organization (F8: create outside `withRollback`, delete in `finally`): inside `withRollback` the service joins the outer transaction, so a throw would not roll back its own writes.
    12. Unknown org id → `not_found`. Tenant filter: `getOrgPlan` and `isOrgSuspended` for org B do not read org A (two orgs, A suspended → `isOrgSuspended(B) = false`).
    13. `listOrganizations` holds both orgs with the mapped fields.
  - Check: `bun run db:migrate` (worktree DB), `bun run db:types`, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`; `git diff --stat apps/server/src/platform/db/schema.ts` shows only the `Organizations` interface.
  - Done when: the checks pass; the test 2 count is 0 in the log.
  - Out of scope: the CLIs (stage 5); the outbox hook implementation and its wiring (stage 5, `cancelPendingOutboxOfOrg`); any reader in the jobs (stage 6).
