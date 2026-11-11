import type { OrganizationView } from "@ea/core";
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
  updateOrganization,
  type OrganizationRow,
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

export type CreateOrganizationInput = z.input<typeof createOrganizationInputSchema>;

// Runs in the caller's transaction when it gets one, else opens its own.
export async function createOrganizationWithOwner(
  db: Db | Transaction<DB>,
  input: CreateOrganizationInput
): Promise<{ orgId: string; userId: string }> {
  const valid = createOrganizationInputSchema.parse(input);

  const run = async (trx: Db | Transaction<DB>) => {
    const org = await insertOrganization(trx, { name: valid.orgName, timezone: valid.timezone });
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
