import { membershipRoleSchema, userLocaleSchema, type MembershipRole, type UserLocale } from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

const reportChannelSchema = z.enum(["telegram", "mail", "both"]);

// One member of an organization with what the report job needs: the chat (null when none is linked), the member's own report
// channel and the mailbox of the report mail. `since` is the start of the membership: a member with no chat has no link time.
export interface ReportMember {
  orgId: string;
  userId: string;
  role: MembershipRole;
  locale: UserLocale;
  chat: { chatId: number; linkedAt: Date } | null;
  since: Date;
  reportChannel: "telegram" | "mail" | "both";
  reportMailboxId: string | null;
}

// Where one report row of the member goes. `mailboxId` is null when no mail row is wanted.
export interface ReportRoutes {
  telegram: boolean;
  mailboxId: string | null;
}

// The channel rule of the report kinds:
// - flag `report_mail` off: Telegram when a chat is linked, whatever the stored channel (a stored `mail` waits for the flag);
// - `telegram`: Telegram when linked;
// - `both`: Telegram when linked, and mail when the member has a report mailbox;
// - `mail`: mail when the member has a report mailbox, and no Telegram row. Without a report mailbox (it was deleted) no mail
//   row can go, so a linked chat gets the row as a fallback: the member does not lose the report in silence.
export function reportRoutesOf(member: ReportMember, flagOn: boolean): ReportRoutes {
  const linked = member.chat !== null;
  if (!flagOn || member.reportChannel === "telegram") return { telegram: linked, mailboxId: null };
  const mailboxId = member.reportMailboxId;
  if (member.reportChannel === "both") return { telegram: linked, mailboxId };
  return { telegram: linked && mailboxId === null, mailboxId };
}

// The dedup key of the mail row of an event: the Telegram key with `:mail` (the Telegram row keeps its key).
export const mailDedupKey = (telegramKey: string): string => `${telegramKey}:mail`;

// Members that a report job visits: a linked chat, or a mail channel with a report mailbox. A suspended organization is left
// out unless `includeSuspended`. `orgId` narrows to one organization. The flag is not read here: the caller decides
// with `reportRoutesOf`, because a member with the flag off and a stored `mail` and no chat gets nothing.
export async function listReportMembers(
  db: DbOrTrx,
  opts: { includeSuspended: boolean; orgId?: string }
): Promise<ReportMember[]> {
  let query = db
    .selectFrom("memberships as m")
    .innerJoin("users as u", "u.id", "m.user_id")
    .innerJoin("organizations as o", "o.id", "m.org_id")
    .leftJoin("chat_links as c", (join) =>
      join.onRef("c.org_id", "=", "m.org_id").onRef("c.user_id", "=", "m.user_id").on("c.channel", "=", "telegram")
    )
    .select([
      "m.org_id",
      "m.user_id",
      "m.role",
      "m.created_at",
      "m.report_channel",
      "m.report_mailbox_id",
      "u.locale",
      "c.external_chat_id",
      "c.linked_at",
    ])
    .where((eb) =>
      eb.or([
        eb("c.user_id", "is not", null),
        eb.and([eb("m.report_channel", "in", ["mail", "both"]), eb("m.report_mailbox_id", "is not", null)]),
      ])
    );
  if (!opts.includeSuspended) query = query.where("o.plan", "<>", "suspended");
  if (opts.orgId !== undefined) query = query.where("m.org_id", "=", opts.orgId);
  const rows = await query.orderBy("m.org_id").orderBy("m.user_id").execute();
  return rows.map((row) => ({
    orgId: row.org_id,
    userId: row.user_id,
    role: membershipRoleSchema.parse(row.role),
    // A user without a locale gets Polish, as the other notices do (`toLinkedChat`).
    locale: userLocaleSchema.nullable().parse(row.locale) ?? "pl",
    // bigint comes back as a string; a chat id has at most 52 bits, so Number is exact.
    chat:
      row.external_chat_id === null || row.linked_at === null
        ? null
        : { chatId: Number(row.external_chat_id), linkedAt: row.linked_at },
    since: row.created_at,
    reportChannel: reportChannelSchema.parse(row.report_channel),
    reportMailboxId: row.report_mailbox_id,
  }));
}
