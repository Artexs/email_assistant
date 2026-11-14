import { isFeatureKey, userLocaleSchema, type FeatureKey, type OrganizationView, type OrgPlan } from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";

import {
  getBreakGlassUserId,
  getMembership,
  getOrgFeature,
  getUserAuthProfile,
  insertMembership,
  insertOrganization,
  insertUser,
  lockOrganization,
  planStateOfRow,
  setBreakGlassFlag,
  updateOrganization,
  updateOrganizationPlan,
  upsertOrgFeature,
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
  locale: userLocaleSchema.optional(),
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
    const user = await insertUser(trx, {
      email: valid.email,
      displayName: valid.displayName,
      ...(valid.locale ? { locale: valid.locale } : {}),
    });
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
  // Runs in the same transaction when the plan leaves suspended (F079); `now` is the new `resumed_at`.
  // Returns the number of sends that it closed.
  onResumed?: (trx: Transaction<DB>, ctx: TenantContext, input: { now: Date; actor: string }) => Promise<number>;
}

export type SetOrgPlanResult =
  | { kind: "changed"; before: OrgPlanState; after: OrgPlanState; cancelledMessages: number; expiredSends: number }
  | { kind: "unchanged"; state: OrgPlanState }
  | { kind: "not_found" }
  | { kind: "trial_days_needed" }
  | {
      kind: "bad_input";
      reason: "nothing_to_change" | "trial_days_without_trial" | "trial_days_range" | "max_mailboxes_range";
    };

const dayMs = 24 * 60 * 60 * 1000;

// One transaction: the lock, the new state, one audit row, then the suspend or resume hook. A throw in a hook rolls back all.
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
    const expiredSends =
      before.plan === "suspended" && after.plan !== "suspended"
        ? ((await hooks.onResumed?.(trx, ctx, { now: input.now, actor: input.actor })) ?? 0)
        : 0;
    return { kind: "changed", before, after, cancelledMessages, expiredSends };
  };

  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

export interface SetOrgFeatureInput {
  flag: string; // checked here: the CLI passes what the operator typed
  enabled: boolean;
  actor: string; // "cli", or the user id of a later console
  now: Date;
}

export type SetOrgFeatureResult =
  | { kind: "changed"; flag: FeatureKey; before: boolean | null; enabled: boolean } // before null = there was no row
  | { kind: "unchanged"; flag: FeatureKey; enabled: boolean }
  | { kind: "not_found" }
  | { kind: "unknown_flag" };

// One transaction: the organization lock (it orders two writes at once), the row, and the audit row in the same commit (D11).
// A row with the same value is "unchanged": no write, no audit row. An off with no row writes a row.
export async function setOrgFeature(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: SetOrgFeatureInput
): Promise<SetOrgFeatureResult> {
  const { flag, enabled } = input;
  if (!isFeatureKey(flag)) return { kind: "unknown_flag" };

  const run = async (trx: Transaction<DB>): Promise<SetOrgFeatureResult> => {
    if (!(await lockOrganization(trx, ctx))) return { kind: "not_found" };
    const row = await getOrgFeature(trx, ctx, flag);
    if (row === enabled) return { kind: "unchanged", flag, enabled };

    await upsertOrgFeature(trx, ctx, { flag, enabled, setBy: input.actor, setAt: input.now });
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.orgFlagChanged,
      data: { flag, enabled },
      at: input.now,
    });
    log.info(`organization ${ctx.orgId} flag ${flag} ${enabled ? "on" : "off"} by ${input.actor}`);
    return { kind: "changed", flag, before: row ?? null, enabled };
  };

  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

export type SetBreakGlassResult =
  | { kind: "set"; replaced: string | null } // replaced = the user id that lost the mark
  | { kind: "unchanged" }
  | { kind: "not_found" } // no such organization
  | { kind: "not_owner" } // no membership, or the role is assistant
  | { kind: "no_two_factor" }; // users.two_factor_enabled is false

// F105 D11. One transaction: the organization lock, the checks, the old mark off, the new mark on, and one audit row per change.
// The clear runs before the set: the partial unique index never sees two marks.
export async function setBreakGlassOwner(
  db: Db,
  ctx: TenantContext,
  input: { userId: string; actor: string; now: Date }
): Promise<SetBreakGlassResult> {
  return db.transaction().execute(async (trx): Promise<SetBreakGlassResult> => {
    if (!(await lockOrganization(trx, ctx))) return { kind: "not_found" };
    const membership = await getMembership(trx, ctx, input.userId);
    if (!membership || membership.role !== "owner") return { kind: "not_owner" };
    const profile = await getUserAuthProfile(trx, input.userId);
    if (!profile?.twoFactorEnabled) return { kind: "no_two_factor" };

    const current = await getBreakGlassUserId(trx, ctx);
    if (current === input.userId) return { kind: "unchanged" };
    if (current !== null) {
      await setBreakGlassFlag(trx, ctx, current, false);
      await recordAudit(trx, ctx, {
        actor: input.actor,
        event: auditEvents.orgBreakGlassCleared,
        data: { user_id: current, reason: "replaced" },
        at: input.now,
      });
    }
    await setBreakGlassFlag(trx, ctx, input.userId, true);
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.orgBreakGlassSet,
      data: { user_id: input.userId },
      at: input.now,
    });
    log.info("org_break_glass_set", { org_id: ctx.orgId, user_id: input.userId });
    return { kind: "set", replaced: current };
  });
}

export type ClearBreakGlassResult = { kind: "cleared"; userId: string } | { kind: "none" } | { kind: "not_found" };

// Takes a transaction too: the operator reset (F105 stage 07) calls it inside its own.
export async function clearBreakGlassOwner(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { actor: string; now: Date; reason: "cli" | "two_factor_reset" }
): Promise<ClearBreakGlassResult> {
  const run = async (trx: Transaction<DB>): Promise<ClearBreakGlassResult> => {
    if (!(await lockOrganization(trx, ctx))) return { kind: "not_found" };
    const current = await getBreakGlassUserId(trx, ctx);
    if (current === null) return { kind: "none" };
    await setBreakGlassFlag(trx, ctx, current, false);
    await recordAudit(trx, ctx, {
      actor: input.actor,
      event: auditEvents.orgBreakGlassCleared,
      data: { user_id: current, reason: input.reason },
      at: input.now,
    });
    log.info("org_break_glass_cleared", { org_id: ctx.orgId, user_id: current, reason: input.reason });
    return { kind: "cleared", userId: current };
  };

  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
