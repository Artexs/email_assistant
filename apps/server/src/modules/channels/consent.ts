import { consentCovers, OPEN_LOOPS_CONSENT_SINCE, REPLY_CONSENT_SINCE } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { auditEvents } from "../audit";

type DbOrTrx = Db | Transaction<DB>;

// The consent version of each user: the version in the newest `web.telegram_consent` audit row of the user in this org
// that is newer than the user's last `chat.unlinked` row. An unlink withdraws the consent: a later link with no consent step
// (the CLI) must not find the old row and count it (F116 review 17, N4). A row with the same time as the unlink row is not newer.
// A user with no such row (a chat linked before the F098 consent step) gets null. Every user id of `userIds` is a key of the map.
// The audit actor of the consent event is the user id (routes.ts); the `chat.unlinked` row holds it as `data.user_id`.
// The org filter is explicit, RLS is not the only guard.
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
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("audit_log as unlinked")
            .select("unlinked.id")
            .where("unlinked.org_id", "=", ctx.orgId)
            .where("unlinked.event", "=", auditEvents.chatUnlinked)
            .where(sql<boolean>`unlinked.data->>'user_id' = audit_log.actor`)
            .whereRef("unlinked.created_at", ">=", "audit_log.created_at")
        )
      )
    )
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

// THE gate of open-loop data in Telegram (F116 stage 17 review, N5): the users whose consent covers it. Every sender of a follow-up
// card, a follow-up result, a brief section or a loop button asks here and nowhere else (a test scans the sources for any other use
// of `consentCovers`). A user not in the set gets no recipient, no ask and no promise: a fixed line and the panel link only.
export async function loopConsentOf(db: DbOrTrx, ctx: TenantContext, userIds: readonly string[]): Promise<Set<string>> {
  const versions = await consentVersionsOf(db, ctx, userIds);
  return new Set(
    [...versions].filter(([, version]) => consentCovers(version, OPEN_LOOPS_CONSENT_SINCE)).map(([id]) => id)
  );
}

// THE gate of reply-draft data in Telegram (F115 stage 12, D16): the users whose consent covers the reply drafts that the AI writes and
// the addresses of the other recipients of a mail. The review card of a reply and the Review button ask here and nowhere else. A user
// not in the set gets the count of waiting replies, the panel link and one fixed line.
export async function replyConsentOf(
  db: DbOrTrx,
  ctx: TenantContext,
  userIds: readonly string[]
): Promise<Set<string>> {
  const versions = await consentVersionsOf(db, ctx, userIds);
  return new Set([...versions].filter(([, version]) => consentCovers(version, REPLY_CONSENT_SINCE)).map(([id]) => id));
}

// The own consent version of one user, for the panel (`GET /channels/telegram`, F116 stage 22): the panel shows the "New Telegram
// terms" block when it is older than the current text. It decides nothing about what Telegram receives: that is `loopConsentOf`.
export async function ownConsentVersion(db: DbOrTrx, ctx: TenantContext, userId: string): Promise<string | null> {
  return (await consentVersionsOf(db, ctx, [userId])).get(userId) ?? null;
}
