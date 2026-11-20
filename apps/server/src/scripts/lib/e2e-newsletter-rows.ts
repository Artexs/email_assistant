import { DAY_MS, HOUR_MS } from "@ea/core";
import type { Transaction } from "kysely";

import type { Db, DB, TenantContext } from "../../platform/db";
import { E2E_AUTHSERV_ID, E2E_NEWSLETTER_LINK, E2E_NEWSLETTER_SENDERS } from "../e2e-seed-args";

import { insertMails, inTransaction } from "./e2e-activity-rows";

const FIRST_UID = 940_001;

type SenderKey = keyof typeof E2E_NEWSLETTER_SENDERS;

// How each sender looks in the stored headers of its newest mail: `oneClick` has the post header, an `https` link and a
// `dkim=pass` of the trusted authserv-id; `link` has a link only; `none` has no link; `failed` is a one-click sender with a failed
// request; `markup` has a link and a display name with markup in it.
const HEADERS: Record<SenderKey, { link: string | null; post: boolean; dkim: boolean }> = {
  oneClick: { link: `<${E2E_NEWSLETTER_LINK}>`, post: true, dkim: true },
  link: { link: `<${E2E_NEWSLETTER_LINK}>, <mailto:unsub@news.example>`, post: false, dkim: false },
  none: { link: null, post: false, dkim: false },
  failed: { link: `<${E2E_NEWSLETTER_LINK}>`, post: true, dkim: true },
  markup: { link: `<${E2E_NEWSLETTER_LINK}>`, post: false, dkim: false },
};

// The rows of the newsletters spec for one organization: for each sender `count` triaged `notification` mails in the last 30 days (the
// newest one a few hours old) with a header row, and one failed unsubscribe request for `failed`. Test mail; no job of the e2e
// server reads it.
export async function seedNewsletterRows(db: Db, ctx: TenantContext, mailboxId: string, now: Date): Promise<void> {
  await inTransaction(db, async (trx) => {
    let uid = FIRST_UID;
    for (const [key, sender] of Object.entries(E2E_NEWSLETTER_SENDERS) as [
      SenderKey,
      (typeof E2E_NEWSLETTER_SENDERS)[SenderKey],
    ][]) {
      const mails = Array.from({ length: sender.count }, (_, index) => ({
        uid: uid++,
        // The newest mail first: 3 hours ago, then one more day for each older mail.
        receivedAt: new Date(now.getTime() - 3 * HOUR_MS - index * DAY_MS),
        subject: `E2E newsletter ${key} ${index + 1}`,
        from: sender.address,
        category: "notification" as const,
        confidence: 0.9,
        reasonCode: "newsletter",
        reason: "A newsletter.",
      }));
      const ids = await insertMails(trx, ctx, mailboxId, mails);
      await insertHeaders(trx, ctx, ids, sender.name, HEADERS[key], mails[0]?.receivedAt ?? now);
    }
    await trx
      .insertInto("unsubscribe_requests")
      .values({
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        sender_lower: E2E_NEWSLETTER_SENDERS.failed.address,
        sender_domain: E2E_NEWSLETTER_SENDERS.failed.address.split("@")[1] as string,
        method: "one_click",
        status: "failed",
        code: "http_error",
        created_at: new Date(now.getTime() - 2 * HOUR_MS),
        finished_at: new Date(now.getTime() - 2 * HOUR_MS + 5_000),
      })
      .execute();
  });
}

async function insertHeaders(
  trx: Transaction<DB>,
  ctx: TenantContext,
  emailIds: string[],
  fromName: string,
  headers: { link: string | null; post: boolean; dkim: boolean },
  capturedAt: Date
): Promise<void> {
  await trx
    .insertInto("email_headers")
    .values(
      emailIds.map((emailId) => ({
        email_id: emailId,
        org_id: ctx.orgId,
        from_name: fromName,
        auth_results: headers.dkim ? `${E2E_AUTHSERV_ID}; dkim=pass header.d=news.example` : null,
        list_unsubscribe: headers.link,
        list_unsubscribe_post: headers.post,
        // The one-click sender has a signature that covers both list headers (the rule needs it, RFC 8058).
        dkim_signatures: headers.dkim
          ? JSON.stringify([{ d: "news.example", h: ["from", "list-unsubscribe", "list-unsubscribe-post"] }])
          : null,
        parts_known: true,
        captured_at: capturedAt,
      }))
    )
    .execute();
}
