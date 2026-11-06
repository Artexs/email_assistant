import { membershipRoleSchema } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

import type { LinkedChat } from "./port";

type DbOrTrx = Db | Transaction<DB>;

const CHANNEL = "telegram";

function selectLinkedChats(db: DbOrTrx) {
  return db
    .selectFrom("chat_links")
    .innerJoin("memberships", (join) =>
      join.onRef("memberships.org_id", "=", "chat_links.org_id").onRef("memberships.user_id", "=", "chat_links.user_id")
    )
    .select([
      "chat_links.org_id",
      "chat_links.user_id",
      "chat_links.external_chat_id",
      "chat_links.linked_at",
      "memberships.role",
    ])
    .where("chat_links.channel", "=", CHANNEL);
}

function toLinkedChat(row: {
  org_id: string;
  user_id: string;
  external_chat_id: string;
  linked_at: Date;
  role: string;
}): LinkedChat {
  return {
    orgId: row.org_id,
    userId: row.user_id,
    role: membershipRoleSchema.parse(row.role),
    // bigint comes back as a string; a chat id has at most 52 bits, so Number is exact.
    chatId: Number(row.external_chat_id),
    linkedAt: row.linked_at,
  };
}

export async function insertLinkToken(
  db: DbOrTrx,
  ctx: TenantContext,
  row: { tokenHash: string; userId: string; expiresAt: Date; createdAt: Date }
): Promise<void> {
  await db
    .insertInto("chat_link_tokens")
    .values({
      token_hash: row.tokenHash,
      org_id: ctx.orgId,
      user_id: row.userId,
      expires_at: row.expiresAt,
      created_at: row.createdAt,
    })
    .execute();
}

// Deletes the unused tokens of the user, and every token of the user created before `createdBefore`.
export async function deleteOldTokens(
  db: DbOrTrx,
  ctx: TenantContext,
  userId: string,
  createdBefore: Date
): Promise<number> {
  const result = await db
    .deleteFrom("chat_link_tokens")
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .where((eb) => eb.or([eb("used_at", "is", null), eb("created_at", "<", createdBefore)]))
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

// Entry point (D18): the token is the only input, so the organization comes from the row.
export async function useLinkToken(
  trx: Transaction<DB>,
  tokenHash: string,
  now: Date
): Promise<{ orgId: string; userId: string } | undefined> {
  const row = await trx
    .updateTable("chat_link_tokens")
    .set({ used_at: now })
    .where("token_hash", "=", tokenHash)
    .where("used_at", "is", null)
    .where("expires_at", ">", now)
    .returning(["org_id", "user_id"])
    .executeTakeFirst();
  return row ? { orgId: row.org_id, userId: row.user_id } : undefined;
}

// Entry point (D18).
export async function findLinkToken(
  db: DbOrTrx,
  tokenHash: string
): Promise<{ usedAt: Date | null; expiresAt: Date } | undefined> {
  const row = await db
    .selectFrom("chat_link_tokens")
    .select(["used_at", "expires_at"])
    .where("token_hash", "=", tokenHash)
    .executeTakeFirst();
  return row ? { usedAt: row.used_at, expiresAt: row.expires_at } : undefined;
}

// D18: the chat moves to the token's member, so the link of this chat in any organization goes first.
export async function replaceChatLink(
  trx: Transaction<DB>,
  ctx: TenantContext,
  row: { userId: string; chatId: number; linkedAt: Date }
): Promise<void> {
  await trx
    .deleteFrom("chat_links")
    .where("channel", "=", CHANNEL)
    .where("external_chat_id", "=", String(row.chatId))
    .execute();
  await trx
    .deleteFrom("chat_links")
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", row.userId)
    .where("channel", "=", CHANNEL)
    .execute();
  await trx
    .insertInto("chat_links")
    .values({
      org_id: ctx.orgId,
      user_id: row.userId,
      channel: CHANNEL,
      external_chat_id: row.chatId,
      linked_at: row.linkedAt,
    })
    .execute();
}

// Entry point (D18): an update brings only the chat id.
export async function findChatLink(db: DbOrTrx, chatId: number): Promise<LinkedChat | undefined> {
  const row = await selectLinkedChats(db).where("chat_links.external_chat_id", "=", String(chatId)).executeTakeFirst();
  return row ? toLinkedChat(row) : undefined;
}

// Scheduler entry point (D18): it walks all organizations.
export async function listLinkedChats(db: DbOrTrx): Promise<LinkedChat[]> {
  const rows = await selectLinkedChats(db).orderBy("chat_links.org_id").orderBy("chat_links.user_id").execute();
  return rows.map(toLinkedChat);
}

export async function getChatLinkForUser(
  db: DbOrTrx,
  ctx: TenantContext,
  userId: string
): Promise<LinkedChat | undefined> {
  const row = await selectLinkedChats(db)
    .where("chat_links.org_id", "=", ctx.orgId)
    .where("chat_links.user_id", "=", userId)
    .executeTakeFirst();
  return row ? toLinkedChat(row) : undefined;
}

export async function deleteChatLinks(db: DbOrTrx, ctx: TenantContext, userId: string): Promise<number> {
  const result = await db
    .deleteFrom("chat_links")
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .where("channel", "=", CHANNEL)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
