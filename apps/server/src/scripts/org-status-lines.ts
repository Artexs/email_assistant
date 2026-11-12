import { QUOTA_TIMEZONE, quotaDayStart } from "@ea/core";
import type { Transaction } from "kysely";

import { countLlmCallsSince } from "../modules/audit";
import { listLinkedChatsOfOrg } from "../modules/channels";
import { listMailboxes } from "../modules/mail";
import { getOrgPlan, listOrganizations } from "../modules/tenancy";
import type { DB, Db } from "../platform/db";

const iso = (date: Date | null | undefined): string | undefined => date?.toISOString();

// Per organization three lines: ids, codes, dates and counts only, never a name or an address.
// null when `orgId` is given and unknown.
export async function orgStatusLines(
  db: Db | Transaction<DB>,
  opts: { orgId?: string; now: Date }
): Promise<string[] | null> {
  const all = await listOrganizations(db);
  const orgs = opts.orgId === undefined ? all : all.filter((org) => org.id === opts.orgId);
  if (opts.orgId !== undefined && orgs.length === 0) return null;

  const since = quotaDayStart(opts.now, QUOTA_TIMEZONE);
  const blocks: string[] = [];
  for (const org of orgs) {
    const ctx = { orgId: org.id };
    const state = await getOrgPlan(db, ctx);
    const mailboxes = await listMailboxes(db, ctx);
    const chats = await listLinkedChatsOfOrg(db, ctx);
    let llmCalls = 0;
    for (const mailbox of mailboxes) llmCalls += await countLlmCallsSince(db, ctx, mailbox.id, since);

    const count = (status: string): number => mailboxes.filter((mailbox) => mailbox.status === status).length;
    const lastSync = mailboxes.reduce<Date | null>(
      (newest, mailbox) =>
        mailbox.last_synced_at !== null && (newest === null || mailbox.last_synced_at > newest)
          ? mailbox.last_synced_at
          : newest,
      null
    );

    blocks.push(
      [
        `org ${org.id} plan=${org.plan} trial_ends_at=${iso(org.trialEndsAt) ?? "-"} max_mailboxes=${state?.maxMailboxes ?? "-"} resumed_at=${iso(org.resumedAt) ?? "-"}`,
        `  mailboxes total=${mailboxes.length} active=${count("active")} paused=${count("paused")} auth_error=${count("auth_error")} last_sync=${iso(lastSync) ?? "never"}`,
        `  llm_calls_today=${llmCalls} telegram_chats=${chats.length}`,
      ].join("\n")
    );
  }
  return blocks.length === 0 ? [] : blocks.join("\n\n").split("\n");
}
