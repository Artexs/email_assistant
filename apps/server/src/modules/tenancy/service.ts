import type { OrganizationView, OrgPlan } from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";

import {
  insertMembership,
  insertOrganization,
  insertUser,
  lockOrganization,
  planStateOfRow,
  updateOrganization,
  updateOrganizationPlan,
  type OrganizationRow,
  type OrgPlanState,
} from "./repo";

const log = createLog("tenancy");

export function organizationView(row: OrganizationRow): OrganizationView {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    styleText: row.style_text,
    retentionDays: row.data_retention_days,
  };
}

export function isSupportedTimeZone(timezone: string): boolean {
  return Intl.supportedValuesOf("timeZone").includes(timezone);
}

const createOrganizationInputSchema = z.object({
  orgName: z.string().trim().min(1),
  timezone: z.string().refine(isSupportedTimeZone, "invalid timezone"),
  email: z.email().transform((email) => email.toLowerCase()),
  displayName: z.string().trim().min(1),
});

export type OrgPlanInput = { kind: "active" } | { kind: "trial"; endsAt: Date };

// `plan` absent means active (the DB default).
export type CreateOrganizationInput = z.input<typeof createOrganizationInputSchema> & { plan?: OrgPlanInput };

// Runs in the caller's transaction when it gets one, else opens its own.
export async function createOrganizationWithOwner(
  db: Db | Transaction<DB>,
  input: CreateOrganizationInput
): Promise<{ orgId: string; userId: string }> {
  const valid = createOrganizationInputSchema.parse(input);
  const plan = input.plan;

  const run = async (trx: Db | Transaction<DB>) => {
    const org = await insertOrganization(trx, {
      name: valid.orgName,
      timezone: valid.timezone,
      ...(plan?.kind === "trial" ? { plan: "trial" as const, trialEndsAt: plan.endsAt } : {}),
    });
    const user = await insertUser(trx, { email: valid.email, displayName: valid.displayName });
    await insertMembership(trx, { orgId: org.id }, { userId: user.id, role: "owner" });
    return { orgId: org.id, userId: user.id };
  };

  return db.isTransaction ? run(db) : db.transaction().execute(run);
}

export type UpdateOrganizationResult =
  | { kind: "updated"; organization: OrganizationRow }
  | { kind: "bad_timezone" }
  | { kind: "not_found" };

// One transaction: the lock, the changed fields, one audit row per changed field. The audit row of the signature holds no text.
export async function updateOrganizationSettings(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  patch: { timezone?: string; styleText?: string | null },
  input: { actor: string; now: Date }
): Promise<UpdateOrganizationResult> {
  if (patch.timezone !== undefined && !isSupportedTimeZone(patch.timezone)) return { kind: "bad_timezone" };

  const run = async (trx: Transaction<DB>): Promise<UpdateOrganizationResult> => {
    const current = await lockOrganization(trx, ctx);
    if (!current) return { kind: "not_found" };

    const changes: { timezone?: string; styleText?: string | null } = {};
    if (patch.timezone !== undefined && patch.timezone !== current.timezone) {
      changes.timezone = patch.timezone;
      await recordAudit(trx, ctx, {
        event: auditEvents.orgTimezoneChanged,
        actor: input.actor,
        data: { from: current.timezone, to: patch.timezone },
        at: input.now,
      });
      log.info(`organization ${ctx.orgId} timezone changed by ${input.actor}`);
    }
    if (patch.styleText !== undefined && patch.styleText !== current.style_text) {
      changes.styleText = patch.styleText;
      await recordAudit(trx, ctx, {
        event: auditEvents.orgStyleChanged,
        actor: input.actor,
        data: { set: patch.styleText !== null },
        at: input.now,
      });
      log.info(`organization ${ctx.orgId} signature changed by ${input.actor}`);
    }
    if (Object.keys(changes).length === 0) return { kind: "updated", organization: current };

    const organization = await updateOrganization(trx, ctx, changes);
    return organization ? { kind: "updated", organization } : { kind: "not_found" };
  };

  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

export interface SetOrgPlanInput {
  plan?: OrgPlan;
  trialDays?: number;
  maxMailboxes?: number;
  actor: string;
  now: Date;
}

export interface SetOrgPlanHooks {
  // Runs in the same transaction when the plan moves to suspended; returns the number of cancelled messages.
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

const dayMs = 24 * 60 * 60 * 1000;

// One transaction: the lock, the new state, one audit row, then the suspend hook. A throw in the hook rolls back all.
export async function setOrgPlan(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: SetOrgPlanInput,
  hooks: SetOrgPlanHooks = {}
): Promise<SetOrgPlanResult> {
  const { plan, trialDays, maxMailboxes } = input;
  if (plan === undefined && trialDays === undefined && maxMailboxes === undefined) {
    return { kind: "bad_input", reason: "nothing_to_change" };
  }
  if (trialDays !== undefined && !(Number.isInteger(trialDays) && trialDays >= 1 && trialDays <= 365)) {
    return { kind: "bad_input", reason: "trial_days_range" };
  }
  if (maxMailboxes !== undefined && !(Number.isInteger(maxMailboxes) && maxMailboxes >= 0 && maxMailboxes <= 100)) {
    return { kind: "bad_input", reason: "max_mailboxes_range" };
  }

  const run = async (trx: Transaction<DB>): Promise<SetOrgPlanResult> => {
    const row = await lockOrganization(trx, ctx);
    if (!row) return { kind: "not_found" };
    const before = planStateOfRow(row);

    const targetPlan = plan ?? before.plan;
    if (trialDays !== undefined && targetPlan !== "trial") {
      return { kind: "bad_input", reason: "trial_days_without_trial" };
    }

    let trialEndsAt: Date | null = null;
    if (targetPlan === "trial") {
      if (trialDays !== undefined) {
        trialEndsAt = new Date(input.now.getTime() + trialDays * dayMs);
      } else if (before.plan === "trial") {
        trialEndsAt = before.trialEndsAt;
      } else {
        return { kind: "trial_days_needed" };
      }
    }
    const after: OrgPlanState = {
      plan: targetPlan,
      trialEndsAt,
      maxMailboxes: maxMailboxes ?? before.maxMailboxes,
      resumedAt: before.plan === "suspended" && targetPlan !== "suspended" ? input.now : before.resumedAt,
    };

    const same =
      after.plan === before.plan &&
      after.maxMailboxes === before.maxMailboxes &&
      after.trialEndsAt?.getTime() === before.trialEndsAt?.getTime() &&
      after.resumedAt?.getTime() === before.resumedAt?.getTime();
    if (same) return { kind: "unchanged", state: before };

    await updateOrganizationPlan(trx, ctx, after);
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.orgPlanChanged,
      data: {
        from: before.plan,
        to: after.plan,
        max_from: before.maxMailboxes,
        max_to: after.maxMailboxes,
        trial_ends_at: after.trialEndsAt?.toISOString() ?? null,
      },
      at: input.now,
    });
    log.info(`organization ${ctx.orgId} plan ${before.plan} -> ${after.plan} by ${input.actor}`);

    const cancelledMessages =
      before.plan !== "suspended" && after.plan === "suspended" ? ((await hooks.onSuspended?.(trx, ctx)) ?? 0) : 0;
    return { kind: "changed", before, after, cancelledMessages };
  };

  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
