import type { TenantContext } from "../../platform/db";

import { expireSentTexts, listPendingSentTexts, writeSentText } from "./repo";
import { SENT_TEXT_RUN_LIMIT } from "./sent-rules";
import type { SentSyncDeps } from "./sent-sync";

// The text step of the Sent read. It takes a `SentFolderReader` (reads only, BODY.PEEK in the adapter).
// It writes no log line, and no error text holds a path, subject, address or body.
// Each row gets its own write (no transaction): no mail server call runs inside a lock, and a failure keeps the earlier rows.

/** The same number as the incoming body limit. */
export const SENT_BODY_TEXT_LIMIT = 100_000;

export interface SentTextResult {
  /** Rows that got their text (the text may be null: over the size limit, or a mail without text). */
  stored: number;
  /** Rows whose mail the folder no longer holds. */
  gone: number;
  /** Rows that waited past the text window: they keep their headers and get no text. */
  expired: number;
}

// Cut by UTF-16 units: the cut never gives more code points than the limit; a split pair is made well formed.
function cutText(text: string | null): string | null {
  if (text === null) return null;
  return text.length > SENT_BODY_TEXT_LIMIT ? text.slice(0, SENT_BODY_TEXT_LIMIT).toWellFormed() : text;
}

export async function fetchSentTexts(
  deps: Pick<SentSyncDeps, "db" | "provider" | "now">,
  ctx: TenantContext,
  mailboxId: string,
  input: { path: string; uidValidity: number; textWindowMs: number; limit?: number }
): Promise<SentTextResult> {
  const since = new Date(deps.now().getTime() - input.textWindowMs);
  const result: SentTextResult = { stored: 0, gone: 0, expired: 0 };
  result.expired = await expireSentTexts(deps.db, ctx, mailboxId, { before: since });

  const pending = await listPendingSentTexts(deps.db, ctx, mailboxId, {
    path: input.path,
    uidValidity: input.uidValidity,
    since,
    limit: input.limit ?? SENT_TEXT_RUN_LIMIT,
  });

  for (const row of pending) {
    // An error ends the loop and goes up; the rows written so far stay.
    const content = await deps.provider.fetchContent(input.path, row.uid);
    const read = { path: input.path, uid: row.uid, uidValidity: input.uidValidity };
    if (content.text === null && content.capture === null) {
      if (await writeSentText(deps.db, ctx, row.id, read, { kind: "gone" })) result.gone += 1;
      continue;
    }
    const written = await writeSentText(deps.db, ctx, row.id, read, {
      kind: "stored",
      bodyText: cutText(content.text),
      autoSubmitted: content.capture?.autoSubmitted ?? null,
      precedence: content.capture?.precedence ?? null,
      listId: content.capture?.listId ?? null,
      hasCalendar: content.capture?.hasCalendar ?? null,
    });
    if (written) result.stored += 1;
  }
  return result;
}
