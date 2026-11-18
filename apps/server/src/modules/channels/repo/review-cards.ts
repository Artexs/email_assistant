import {
  noticeChannels,
  noticeDetails,
  userLocaleSchema,
  type NoticeChannel,
  type NoticeDetail,
  type UserLocale,
} from "@ea/core";
import { z } from "zod";

import type { TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

// Readers of the outbox rows of the reply review (F115 stage 12).

// The review cards (`approval:<send>:r<n>`, F115 stage 12) that this user got of one send, oldest first. Tenant and user filter the rows.
export async function findReviewCards(
  db: DbOrTrx,
  ctx: TenantContext,
  userId: string,
  sendId: string
): Promise<{ id: string; status: string }[]> {
  const rows = await db
    .selectFrom("outbox")
    .select(["id", "status"])
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .where("kind", "=", "approval")
    .where("dedup_key", "like", `approval:${sendId}:r%`)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows;
}

// The card of an approval that a tap came from. A tap that names its message (`messageId`) finds the card with that Telegram message id.
// Else (and for a message that is not in the outbox) the newest card of the send for this user: the plain card `approval:<send>` or the
// newest review card `approval:<send>:r<n>`. undefined: this user has no such card.
export async function findApprovalCardOfTap(
  db: DbOrTrx,
  ctx: TenantContext,
  userId: string,
  sendId: string,
  messageId: number | undefined
): Promise<
  | {
      id: string;
      dedupKey: string;
      text: string | null;
      channel: NoticeChannel;
      detail: NoticeDetail;
      locale: UserLocale;
    }
  | undefined
> {
  const base = db
    .selectFrom("outbox")
    .select(["id", "dedup_key", "text", "channel", "detail", "locale"])
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .where("kind", "=", "approval")
    .where((eb) =>
      eb.or([eb("dedup_key", "=", `approval:${sendId}`), eb("dedup_key", "like", `approval:${sendId}:r%`)])
    );
  const byMessage =
    messageId === undefined
      ? undefined
      : await base.where("external_message_id", "=", String(messageId)).executeTakeFirst();
  const row = byMessage ?? (await base.orderBy("created_at", "desc").orderBy("id", "desc").executeTakeFirst());
  if (row === undefined) return undefined;
  return {
    id: row.id,
    dedupKey: row.dedup_key,
    text: row.text,
    channel: z.enum(noticeChannels).parse(row.channel),
    detail: z.enum(noticeDetails).parse(row.detail),
    locale: userLocaleSchema.parse(row.locale),
  };
}

// The newest `replies_ready` row of one user, in any state: the 2-hour gap counts from its queue time (F115 stage 12).
export async function lastRepliesReady(
  db: DbOrTrx,
  ctx: TenantContext,
  userId: string
): Promise<{ createdAt: Date; status: string } | undefined> {
  const row = await db
    .selectFrom("outbox")
    .select(["created_at", "status"])
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .where("kind", "=", "replies_ready")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row === undefined ? undefined : { createdAt: row.created_at, status: row.status };
}
