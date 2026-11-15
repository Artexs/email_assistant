import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { auditEvents } from "../audit";

type DbOrTrx = Db | Transaction<DB>;

// The consent version of each user: the version in the newest `web.telegram_consent` audit row of the user in this org.
// A user with no row (a chat linked before the F098 consent step) gets null. Every user id of `userIds` is a key of the map.
// The audit actor of this event is the user id (routes.ts); the org filter is explicit, RLS is not the only guard.
export async function consentVersionsOf(
  db: DbOrTrx,
  ctx: TenantContext,
  userIds: readonly string[]
): Promise<Map<string, string | null>> {
  const versions = new Map<string, string | null>(userIds.map((userId) => [userId, null]));
  if (userIds.length === 0) return versions;
  const rows = await db
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .distinctOn("actor")
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", auditEvents.webTelegramConsent)
    .where("actor", "in", [...userIds])
    .orderBy("actor")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  for (const row of rows) {
    const version = (row.data as { version?: unknown } | null)?.version;
    versions.set(row.actor, typeof version === "string" && version.length > 0 ? version : null);
  }
  return versions;
}
