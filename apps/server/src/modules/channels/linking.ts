import { createHash, randomBytes } from "node:crypto";

import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { auditEvents, recordAudit } from "../audit";
import { getMembership } from "../tenancy";

import {
  deleteChatLinks,
  deleteOldTokens,
  findLinkToken,
  insertLinkToken,
  replaceChatLink,
  useLinkToken,
} from "./repo";

export const LINK_TOKEN_TTL_MS = 15 * 60_000;
// 32 random bytes as base64url: 43 characters, the alphabet that a Telegram deep link allows.
export const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const OLD_TOKEN_AGE_MS = 24 * 60 * 60_000;

export type ConsumeResult =
  | { kind: "linked"; orgId: string; userId: string }
  | { kind: "used" }
  | { kind: "expired" }
  | { kind: "unknown" };

// Only the hash is stored; the plain token leaves the server only in the CLI output.
export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function inTransaction<T>(db: Db, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

// A new token makes the older unused tokens of the user invalid.
export async function createLinkToken(
  db: Db,
  ctx: TenantContext,
  userId: string,
  now: Date
): Promise<{ token: string; expiresAt: Date }> {
  if (!(await getMembership(db, ctx, userId))) {
    throw new HardError("user is not a member of this organization");
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + LINK_TOKEN_TTL_MS);
  await inTransaction(db, async (trx) => {
    await deleteOldTokens(trx, ctx, userId, new Date(now.getTime() - OLD_TOKEN_AGE_MS));
    await insertLinkToken(trx, ctx, { tokenHash: hashLinkToken(token), userId, expiresAt, createdAt: now });
  });
  return { token, expiresAt };
}

export async function consumeLinkToken(
  db: Db,
  input: { token: string; chatId: number; now: Date }
): Promise<ConsumeResult> {
  if (!LINK_TOKEN_PATTERN.test(input.token) || !Number.isSafeInteger(input.chatId) || input.chatId <= 0) {
    return { kind: "unknown" };
  }
  const tokenHash = hashLinkToken(input.token);

  return inTransaction(db, async (trx): Promise<ConsumeResult> => {
    const used = await useLinkToken(trx, tokenHash, input.now);
    if (used) {
      const ctx = { orgId: used.orgId };
      const removed = await replaceChatLink(trx, ctx, {
        userId: used.userId,
        chatId: input.chatId,
        linkedAt: input.now,
      });
      // The old member's organization gets its own row; it holds nothing about the new member or the chat.
      for (const row of removed) {
        await recordAudit(
          trx,
          { orgId: row.orgId },
          {
            actor: "system",
            event: auditEvents.chatUnlinked,
            reasonCode: "chat_moved",
            data: { channel: "telegram", user_id: row.userId },
            at: input.now,
          }
        );
      }
      await recordAudit(trx, ctx, {
        actor: used.userId,
        event: auditEvents.chatLinked,
        data: { channel: "telegram" },
        at: input.now,
      });
      return { kind: "linked", orgId: used.orgId, userId: used.userId };
    }
    const found = await findLinkToken(trx, tokenHash);
    if (!found) {
      return { kind: "unknown" };
    }
    return found.usedAt ? { kind: "used" } : { kind: "expired" };
  });
}

export async function unlinkUser(db: Db, ctx: TenantContext, userId: string, now: Date): Promise<number> {
  return inTransaction(db, async (trx) => {
    const deleted = await deleteChatLinks(trx, ctx, userId);
    if (deleted > 0) {
      await recordAudit(trx, ctx, {
        actor: "system",
        event: auditEvents.chatUnlinked,
        data: { channel: "telegram", user_id: userId, links: deleted },
        at: now,
      });
    }
    return deleted;
  });
}
