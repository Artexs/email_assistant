import { isAutoSubmitted } from "@ea/core";
import { sql } from "kysely";

import type { TenantContext } from "../../platform/db";

import type { SentFolderReader } from "./port";
import type { DbOrTrx } from "./repo/shared";
import { normalizeMessageId } from "./sync-rules";

// The header step of the Sent read stores no `Auto-Submitted` (only the text step does, later, for mail inside the text window). A reply
// pass that must not treat a vacation reply as an answer (F115 stage 09, review N4) reads that one header for the Sent rows that would
// count as an answer to `emailId` and are still unread (`content = 'pending'`, `auto_submitted` null): the same rows and recipient rule as
// `listUserAnswers`. It reads each mail once (UID, Message-ID check, then the capture), and stores the header only when the mail IS automatic;
// `listUserAnswers` then skips the row. Reads only on the mailbox. An error goes up; the caller decides what a failed read means.
// Returns the number of rows that it marked.
export async function markAutomaticAnswers(
  deps: { db: DbOrTrx; provider: Pick<SentFolderReader, "fetchContent" | "fetchByUidsIn"> },
  ctx: TenantContext,
  emailId: string
): Promise<number> {
  const { rows } = await sql<{ id: string; path: string; uid: string; message_id: string | null }>`
    SELECT s.id, s.path, s.uid::text AS uid, s.message_id
    FROM emails e
    JOIN sent_emails s ON s.org_id = e.org_id AND s.mailbox_id = e.mailbox_id AND s.parent_message_id = e.message_id_header
    LEFT JOIN email_headers h ON h.email_id = e.id AND h.org_id = e.org_id
    WHERE e.org_id = ${ctx.orgId} AND e.id = ${emailId} AND s.org_id = ${ctx.orgId}
      AND s.origin = 'user' AND s.content = 'pending' AND s.auto_submitted IS NULL
      AND (s.to_addresses || s.cc_addresses) && (ARRAY[e.from_address_lower] || COALESCE(h.reply_to, '{}'::text[]))
    ORDER BY s.sent_at, s.id
    LIMIT 5
  `.execute(deps.db);
  let marked = 0;
  for (const row of rows) {
    const uid = Number(row.uid);
    const stored = normalizeMessageId(row.message_id);
    if (stored === null) continue;
    const [meta] = await deps.provider.fetchByUidsIn(row.path, [uid]);
    // The UID must still name the stored mail (a renumbered folder gives another mail).
    if (meta === undefined || normalizeMessageId(meta.messageId) !== stored) continue;
    const content = await deps.provider.fetchContent(row.path, uid);
    const value = content.capture?.autoSubmitted ?? null;
    if (value === null || !isAutoSubmitted(value)) continue;
    const updated = await sql`
      UPDATE sent_emails SET auto_submitted = ${value}
      WHERE org_id = ${ctx.orgId} AND id = ${row.id} AND auto_submitted IS NULL
    `.execute(deps.db);
    marked += Number(updated.numAffectedRows ?? 0n);
  }
  return marked;
}
