// The newsletters list of the panel: the senders of `listNewsletterSenders`, each with the unsubscribe method
// and the state of its request. A reader only: it never fetches a URL and never writes. The display name and the link are
// untrusted mail text; the route sends them as data and the panel shows them as plain text.
import {
  NEWSLETTER_NAME_MAX_CHARS,
  type NewsletterItem,
  type NewsletterList,
  type NewsletterMethod,
  type UnsubscribeRequestStatus,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { getMailbox } from "../mail";

import { listNewsletterSenders, type NewsletterSender } from "./newsletter-senders";

export interface NewsletterViewOptions {
  /** `MAIL_TRUSTED_AUTHSERV_IDS` (`mailTrustedAuthservIds(config)`). */
  trustedAuthservIds: readonly string[];
  /** Only the owner gets the link: a member sees the list without actions. */
  isOwner: boolean;
}

/** `one_click` when the one-click rule holds, else `link` for an `https` link, else `none`. */
export function methodOf(sender: Pick<NewsletterSender, "oneClick" | "hasLink">): NewsletterMethod {
  if (sender.oneClick) return "one_click";
  return sender.hasLink ? "link" : "none";
}

// The display name is attacker text: cut it by code points so that no surrogate pair breaks.
function shortName(name: string | null): string | null {
  if (name === null) return null;
  const points = [...name];
  return points.length <= NEWSLETTER_NAME_MAX_CHARS ? name : points.slice(0, NEWSLETTER_NAME_MAX_CHARS).join("");
}

async function requestsOf(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  sendersLower: string[]
): Promise<Map<string, { status: UnsubscribeRequestStatus; at: Date; code: string | null }>> {
  if (sendersLower.length === 0) return new Map();
  const rows = await db
    .selectFrom("unsubscribe_requests")
    .select(["sender_lower", "status", "code", "created_at", "finished_at"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("sender_lower", "in", sendersLower)
    .execute();
  return new Map(
    rows.map((row) => [
      row.sender_lower,
      { status: row.status as UnsubscribeRequestStatus, at: row.finished_at ?? row.created_at, code: row.code },
    ])
  );
}

// null: the mailbox is not in this organization (or does not exist): the route answers 404 for both.
export async function newsletterViewFor(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  now: Date,
  opts: NewsletterViewOptions
): Promise<NewsletterList | null> {
  if ((await getMailbox(db, ctx, mailboxId)) === undefined) return null;
  const senders = await listNewsletterSenders(db, ctx, mailboxId, now, { trustedAuthservIds: opts.trustedAuthservIds });
  const requests = await requestsOf(
    db,
    ctx,
    mailboxId,
    senders.map((sender) => sender.senderLower)
  );
  return {
    senders: senders.map((sender): NewsletterItem => {
      const method = methodOf(sender);
      const request = requests.get(sender.senderLower) ?? null;
      const item: NewsletterItem = {
        senderLower: sender.senderLower,
        fromName: shortName(sender.fromName),
        count: sender.count,
        latestAt: sender.latestAt.toISOString(),
        method,
        request: request === null ? null : { status: request.status, at: request.at.toISOString(), code: request.code },
      };
      // The link goes to the owner only: for `link`, and for `one_click` once a request exists (the page is the way out of a failed request).
      const offer = method === "link" || (method === "one_click" && request !== null);
      if (opts.isOwner && offer && sender.linkUrl !== null) item.linkUrl = sender.linkUrl;
      return item;
    }),
  };
}
