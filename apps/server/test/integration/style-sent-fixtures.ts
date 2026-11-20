import { randomUUID } from "node:crypto";

import { DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { SYNTHETIC_MESSAGE_ID_DOMAIN } from "../../src/modules/mail";
import type { DB, TenantContext } from "../../src/platform/db";

import { NOW } from "./mail-sent-fixtures";

export { NOW };

export interface SentOpts {
  origin?: "user" | "system";
  content?: "stored" | "headers_only";
  body?: string | null;
  ageMs?: number;
  autoSubmitted?: string | null;
  listId?: string | null;
  precedence?: string | null;
  actionId?: string | null;
  from?: string | null;
  to?: string[];
  cc?: string[];
  subject?: string;
  messageId?: string;
  // Newer first: a row with a larger `order` is older by one minute.
  order?: number;
}

// One `sent_emails` row of a mailbox; by default a good one: the user's own mail, text stored, one hour old.
export async function addSent(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: SentOpts = {}
): Promise<string> {
  const id = randomUUID();
  const at = new Date(NOW.getTime() - (opts.ageMs ?? HOUR_MS) - (opts.order ?? 0) * MINUTE_MS);
  const origin = opts.origin ?? "user";
  const content = origin === "system" ? "headers_only" : (opts.content ?? "stored");
  await trx
    .insertInto("sent_emails")
    .values({
      id,
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      dedup_key: randomUUID(),
      path: "Sent",
      uidvalidity: "1",
      uid: String(Math.floor(Math.random() * 1_000_000_000)),
      message_id: opts.messageId ?? `<${id}@client.test>`,
      thread_key: randomUUID(),
      from_address: opts.from === undefined ? "me@corp.test" : opts.from,
      to_addresses: opts.to ?? ["to@client.test"],
      cc_addresses: opts.cc ?? [],
      subject: opts.subject ?? "A subject",
      sent_at: at,
      internal_date: at,
      origin,
      action_id: opts.actionId ?? (origin === "system" ? randomUUID() : null),
      content,
      // The table allows a text only with `content = stored`.
      body_text:
        content !== "stored"
          ? null
          : opts.body === undefined
            ? `Dzień dobry,\n\nTak, wtorek mi pasuje. Dam znać.\n\nPozdrawiam`
            : opts.body,
      auto_submitted: opts.autoSubmitted ?? null,
      list_id: opts.listId ?? null,
      precedence: opts.precedence ?? null,
    })
    .execute();
  return id;
}

export const syntheticId = (): string => `<${randomUUID()}@${SYNTHETIC_MESSAGE_ID_DOMAIN}>`;
export const fifteenDays = 15 * DAY_MS;
