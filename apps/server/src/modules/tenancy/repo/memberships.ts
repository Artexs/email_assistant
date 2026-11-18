import {
  membershipRoleSchema,
  noticeRoutesSchema,
  reportChannelSchema,
  userLocaleSchema,
  type MembershipRole,
  type NoticeRoutes,
  type UserLocale,
} from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../../platform/db";

export interface MembershipWithUser {
  org_id: string;
  user_id: string;
  role: MembershipRole;
  digest_times: string[];
  created_at: Date;
  email: string;
  display_name: string;
  break_glass: boolean;
}

export interface UserMembership {
  org_id: string;
  role: MembershipRole;
  created_at: Date;
}

// No TenantContext: the user gives the tenant (the web resolves the organization from the session).
export async function listMembershipsOfUser(db: Db | Transaction<DB>, userId: string): Promise<UserMembership[]> {
  const rows = await db
    .selectFrom("memberships")
    .select(["org_id", "role", "created_at"])
    .where("user_id", "=", userId)
    .orderBy("created_at")
    .orderBy("org_id")
    .execute();
  return rows.map((row) => ({ ...row, role: membershipRoleSchema.parse(row.role) }));
}

export interface OrgOwner {
  userId: string;
  displayName: string;
  /** The language of the owner's panel; null when it is not a locale that the product has (reply drafts read it as Polish). */
  locale: UserLocale | null;
}

// The oldest owner of the organization (the same member that the committer reads as "the owner"), or undefined.
// Reads the name and the locale only; an address never leaves this function.
export async function getOrgOwner(db: Db | Transaction<DB>, ctx: TenantContext): Promise<OrgOwner | undefined> {
  const row = await db
    .selectFrom("memberships")
    .innerJoin("users", "users.id", "memberships.user_id")
    .select(["memberships.user_id", "users.display_name", "users.locale"])
    .where("memberships.org_id", "=", ctx.orgId)
    .where("memberships.role", "=", "owner")
    .orderBy("memberships.created_at")
    .orderBy("users.email")
    .executeTakeFirst();
  if (row === undefined) return undefined;
  const locale = userLocaleSchema.safeParse(row.locale);
  return { userId: row.user_id, displayName: row.display_name, locale: locale.success ? locale.data : null };
}

export async function listMemberships(db: Db | Transaction<DB>, ctx: TenantContext): Promise<MembershipWithUser[]> {
  const rows = await db
    .selectFrom("memberships")
    .innerJoin("users", "users.id", "memberships.user_id")
    .select([
      "memberships.org_id",
      "memberships.user_id",
      "memberships.role",
      "memberships.digest_times",
      "memberships.created_at",
      "users.email",
      "users.display_name",
      "memberships.break_glass",
    ])
    .where("memberships.org_id", "=", ctx.orgId)
    .orderBy("memberships.created_at")
    .orderBy("users.email")
    .execute();
  return rows.map((row) => ({ ...row, role: membershipRoleSchema.parse(row.role) }));
}

// The member count of every organization (an organization with no member has no entry). Counts what `listMemberships` lists.
export async function countMembershipsOfAll(db: Db | Transaction<DB>): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom("memberships")
    .innerJoin("users", "users.id", "memberships.user_id")
    .select(["memberships.org_id", sql<string>`count(*)`.as("count")])
    .groupBy("memberships.org_id")
    .execute();
  return new Map(rows.map((row) => [row.org_id, Number(row.count)]));
}

export async function getMembership(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  userId: string
): Promise<MembershipWithUser | undefined> {
  const row = await db
    .selectFrom("memberships")
    .innerJoin("users", "users.id", "memberships.user_id")
    .select([
      "memberships.org_id",
      "memberships.user_id",
      "memberships.role",
      "memberships.digest_times",
      "memberships.created_at",
      "users.email",
      "users.display_name",
      "memberships.break_glass",
    ])
    .where("memberships.org_id", "=", ctx.orgId)
    .where("memberships.user_id", "=", userId)
    .executeTakeFirst();
  return row ? { ...row, role: membershipRoleSchema.parse(row.role) } : undefined;
}

export async function insertMembership(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { userId: string; role: MembershipRole }
): Promise<void> {
  await db.insertInto("memberships").values({ org_id: ctx.orgId, user_id: input.userId, role: input.role }).execute();
}

export async function setDigestTimes(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  times: readonly string[]
): Promise<boolean> {
  const result = await db
    .updateTable("memberships")
    .set({ digest_times: [...times] })
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

export interface MemberNotify {
  quiet_start: string | null;
  quiet_end: string | null;
  report_channel: "telegram" | "mail" | "both";
  report_mailbox_id: string | null;
  /** The stored choice per notice group. The database CHECK allows only the shape of `noticeRoutesSchema`. */
  notice_routes: NoticeRoutes;
}

// `lock`: the row stays locked until the end of the transaction, so a second change waits and reads the new values.
export async function getMemberNotify(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  opts: { lock?: boolean } = {}
): Promise<MemberNotify | undefined> {
  const query = db
    .selectFrom("memberships")
    .select(["quiet_start", "quiet_end", "report_channel", "report_mailbox_id", "notice_routes"])
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId);
  const row = await (opts.lock === true ? query.forUpdate() : query).executeTakeFirst();
  return (
    row && {
      ...row,
      report_channel: reportChannelSchema.parse(row.report_channel),
      notice_routes: noticeRoutesSchema.parse(row.notice_routes),
    }
  );
}

// The row of the caller only: the user id comes from the session, never from a body.
export async function setMemberQuietHours(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  hours: { start: string; end: string } | null
): Promise<boolean> {
  const result = await db
    .updateTable("memberships")
    .set({ quiet_start: hours?.start ?? null, quiet_end: hours?.end ?? null })
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

export async function setMemberReportChannel(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  input: { channel: "telegram" | "mail" | "both"; mailboxId: string | null }
): Promise<boolean> {
  const result = await db
    .updateTable("memberships")
    .set({ report_channel: input.channel, report_mailbox_id: input.mailboxId })
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// The whole stored object: the caller merges a change into the locked row first. The shape is `NoticeRoutes`, the same as the CHECK.
export async function setMemberNoticeRoutes(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  routes: NoticeRoutes
): Promise<boolean> {
  const result = await db
    .updateTable("memberships")
    .set({ notice_routes: JSON.stringify(noticeRoutesSchema.parse(routes)) })
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// The sender reads the quiet hours of the users of one claimed batch with one query. It walks all
// organizations, as `claimDueOutbox` does; the pair `(org_id, user_id)` is the key. A user without a row is not in the map.
export async function listQuietHoursOf(
  db: Db | Transaction<DB>,
  pairs: readonly { orgId: string; userId: string }[]
): Promise<Map<string, { start: string; end: string }>> {
  const hours = new Map<string, { start: string; end: string }>();
  if (pairs.length === 0) return hours;
  const rows = await db
    .selectFrom("memberships")
    .select(["org_id", "user_id", "quiet_start", "quiet_end"])
    .where("user_id", "in", [...new Set(pairs.map((pair) => pair.userId))])
    .where("org_id", "in", [...new Set(pairs.map((pair) => pair.orgId))])
    .where("quiet_start", "is not", null)
    .where("quiet_end", "is not", null)
    .execute();
  for (const row of rows) {
    if (row.quiet_start !== null && row.quiet_end !== null) {
      hours.set(`${row.org_id}:${row.user_id}`, { start: row.quiet_start, end: row.quiet_end });
    }
  }
  return hours;
}
