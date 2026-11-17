// The newsletter senders of one mailbox (F110 stage 22, D17, PD-063). A reader only: it never fetches a URL and never writes.
// A link in a mail is untrusted text. This module reads two facts from the stored headers (is there an `https` link, does the
// header allow one-click) and returns flags. The URL itself does not leave the headers; stage 24 reads it again and checks it
// before any request.
import { hasTrustedAlignedDkimPass } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { suspiciousSendersOf } from "../triage";

export const NEWSLETTER_WINDOW_DAYS = 30;
export const NEWSLETTER_MAX_SENDERS = 200;
const DAY_MS = 24 * 3_600_000;

export interface NewsletterSender {
  senderLower: string;
  /** The display name of the newest mail; null when it has none (or retention cleared it). */
  fromName: string | null;
  /** Mails of the sender in the window that have a result. */
  count: number;
  latestAt: Date;
  latestEmailId: string;
  /**
   * D17: the newest mail has `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, an `https` link in `List-Unsubscribe`, and
   * a `dkim=pass` for the From domain (or a parent) in an `Authentication-Results` header of a trusted authserv-id.
   */
  oneClick: boolean;
  /** The newest mail has an `https` link in `List-Unsubscribe` (the user may open it; the server does nothing). */
  hasLink: boolean;
}

interface Row {
  sender: string;
  email_id: string;
  received_at: Date;
  n: string;
  from_name: string | null;
  auth_results: string | null;
  list_unsubscribe: string | null;
  list_unsubscribe_post: boolean | null;
}

// True when `List-Unsubscribe` holds an `https` URI with a host (`<https://host/path>`, separated by commas). Nothing else
// is read from it; the check is not a safety check of the target (stage 24 does that).
export function hasHttpsUnsubscribeLink(header: string | null): boolean {
  if (header === null) return false;
  for (const match of header.matchAll(/<([^<>]*)>/g)) {
    try {
      const url = new URL((match[1] ?? "").trim());
      if (url.protocol === "https:" && url.hostname !== "") return true;
    } catch {
      // Not a URL: skip this element.
    }
  }
  return false;
}

// The senders of the last 30 days that the newsletters view may list, most mails first (then newest mail), at most 200. A sender is
// listed only when every mail of the window that has a result is `info` or `notification` (P6): one `spam`, `urgent`, `unsure`
// or other mail, or one mail with a suspicious reason (`suspiciousSendersOf`), leaves the sender out. Mail with no result yet
// does not count. `trustedAuthservIds` is `MAIL_TRUSTED_AUTHSERV_IDS` (lower case); an empty list gives `oneClick: false` for
// every sender. Queries `from_address_lower`, never `lower(from_address)`.
export async function listNewsletterSenders(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  now: Date,
  opts: { trustedAuthservIds: readonly string[] }
): Promise<NewsletterSender[]> {
  const since = new Date(now.getTime() - NEWSLETTER_WINDOW_DAYS * DAY_MS);
  const { rows } = await sql<Row>`
    WITH mails AS (
      SELECT e.id, e.org_id, e.from_address_lower AS sender, e.received_at, latest.category
      FROM emails e
      JOIN LATERAL (
        SELECT tr.category
        FROM triage_results tr
        WHERE tr.org_id = e.org_id AND tr.email_id = e.id
        ORDER BY tr.created_at DESC, tr.id DESC
        LIMIT 1
      ) latest ON true
      WHERE e.org_id = ${ctx.orgId}
        AND e.mailbox_id = ${mailboxId}
        AND e.from_address_lower IS NOT NULL
        AND e.received_at >= ${since}
    ), senders AS (
      SELECT sender, count(*) AS n
      FROM mails
      GROUP BY sender
      HAVING bool_and(category IN ('info', 'notification'))
    )
    SELECT DISTINCT ON (m.sender)
      m.sender, m.id AS email_id, m.received_at, s.n::text AS n,
      h.from_name, h.auth_results, h.list_unsubscribe, h.list_unsubscribe_post
    FROM mails m
    JOIN senders s ON s.sender = m.sender
    LEFT JOIN email_headers h ON h.email_id = m.id AND h.org_id = m.org_id
    ORDER BY m.sender, m.received_at DESC, m.id DESC
  `.execute(db);
  if (rows.length === 0) return [];

  const flagged = await suspiciousSendersOf(
    db,
    ctx,
    mailboxId,
    rows.map((row) => row.sender),
    since
  );
  return rows
    .filter((row) => !flagged.has(row.sender))
    .map((row): NewsletterSender => {
      const hasLink = hasHttpsUnsubscribeLink(row.list_unsubscribe);
      const fromDomain = row.sender.slice(row.sender.lastIndexOf("@") + 1);
      return {
        senderLower: row.sender,
        fromName: row.from_name,
        count: Number(row.n),
        latestAt: row.received_at,
        latestEmailId: row.email_id,
        oneClick:
          row.list_unsubscribe_post === true &&
          hasLink &&
          hasTrustedAlignedDkimPass(row.auth_results, opts.trustedAuthservIds, fromDomain),
        hasLink,
      };
    })
    .sort(
      (a, b) =>
        b.count - a.count || b.latestAt.getTime() - a.latestAt.getTime() || (a.senderLower < b.senderLower ? -1 : 1)
    )
    .slice(0, NEWSLETTER_MAX_SENDERS);
}
