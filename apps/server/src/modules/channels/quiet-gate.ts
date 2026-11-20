import { isQuietTime, QUIET_HOURS, quietEnd, type QuietHours, MINUTE_MS } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { getOrganization, isFeatureOn, listQuietHoursOf } from "../tenancy";

import type { ClaimedOutbox } from "./repo";

const MIN_HOLD_MS = MINUTE_MS;

export interface QuietGate {
  /** The time zone of the organization, read once per batch. Throws when the organization is gone. */
  timezoneOf(ctx: TenantContext): Promise<string>;
  /** When a row that quiet hours hold must wait until; null when it may go now. At least one minute ahead: a row never goes back with a time that has passed. */
  holdUntil(row: ClaimedOutbox, timezone: string): Promise<Date | null>;
}

// Quiet hours of one claimed batch, shared by the Telegram sender and the report mail sender. The hours of the users of
// the batch are read once. An organization with the flag `user_quiet_hours` off, or a user with no hours of their own, gets the default.
// The caller decides which rows quiet hours hold (never the digest and a card edit).
export function createQuietGate(deps: {
  db: Db | Transaction<DB>;
  now: Date;
  claimed: readonly ClaimedOutbox[];
}): QuietGate {
  const { db, now } = deps;
  const timezones = new Map<string, string>();
  const flagged = new Map<string, boolean>();
  let quietOfUsers: Map<string, QuietHours> | undefined;

  async function quietOf(row: ClaimedOutbox): Promise<QuietHours> {
    let on = flagged.get(row.orgId);
    if (on === undefined) {
      on = await isFeatureOn(db, { orgId: row.orgId }, "user_quiet_hours");
      flagged.set(row.orgId, on);
    }
    if (!on) return QUIET_HOURS;
    quietOfUsers ??= await listQuietHoursOf(
      db,
      deps.claimed.map((claim) => ({ orgId: claim.orgId, userId: claim.userId }))
    );
    return quietOfUsers.get(`${row.orgId}:${row.userId}`) ?? QUIET_HOURS;
  }

  return {
    async timezoneOf(ctx) {
      const cached = timezones.get(ctx.orgId);
      if (cached !== undefined) return cached;
      const org = await getOrganization(db, ctx);
      if (!org) throw new Error("organization not found");
      timezones.set(ctx.orgId, org.timezone);
      return org.timezone;
    },
    async holdUntil(row, timezone) {
      const quiet = await quietOf(row);
      if (!isQuietTime(now, timezone, quiet)) return null;
      const end = quietEnd(now, timezone, quiet);
      return new Date(Math.max(end.getTime(), now.getTime() + MIN_HOLD_MS));
    },
  };
}
