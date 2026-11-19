import { userLocaleSchema, type UserLocale } from "@ea/core";

import { PUSH_KEY_INFIX, type TenantContext } from "../../../platform/db";
import { createLog } from "../../../platform/log";
import { getChatLinkForUser, insertOutbox, type OutboxKind } from "../repo";
import type { DbOrTrx } from "../repo/shared";

const log = createLog("channels");

// The facts of a push row that ended `failed` / `no_device`: what the Telegram row of the same event needs.
export interface EndedPushRow {
  id: string;
  userId: string;
  kind: OutboxKind;
  dedupKey: string;
  view: unknown;
  locale: string;
  mailboxId: string | null;
  emailId: string | null;
  loopId: string | null;
  createdAt: Date;
}

// The Telegram key of an event: the key of its push row without `:push:<device id>`; null when the key is no push key.
export function telegramKeyOfPushKey(dedupKey: string): string | null {
  const at = dedupKey.lastIndexOf(PUSH_KEY_INFIX);
  return at <= 0 ? null : dedupKey.slice(0, at);
}

// The fallback of a push row that ended `no_device` (the device ended, expired, was dropped by the push service or removed). The
// member gets the event by Telegram when all of this holds, else the event is lost for that device and nothing is queued:
// - the row holds no loop. A follow-up kind (`approval`, `send_result` with a `loop_id`) goes by push only for an owner who has not given
//   the loop consent (`splitByLoopConsent`): its Telegram row never existed on purpose, and a fallback would bypass that gate;
// - the member has a linked chat (a push-only member has nowhere to fall back to);
// - no Telegram row of the event exists (a route `both` wrote it already; the dedup key keeps one row per event).
// The row takes the kind, the view, the locale, the mail, the mailbox and the queue time of the push row, and the key without the device part. The sender
// renders it with the detail of the member at send time, as every row. The row is due at once: its event is old already. Returns the
// id of the new row, or null when none was queued.
export async function queueTelegramFallback(
  db: DbOrTrx,
  ctx: TenantContext,
  row: EndedPushRow
): Promise<string | null> {
  if (row.loopId !== null) return null;
  const key = telegramKeyOfPushKey(row.dedupKey);
  if (key === null) return null;
  if ((await getChatLinkForUser(db, ctx, row.userId)) === undefined) return null;
  const locale: UserLocale = userLocaleSchema.parse(row.locale);
  const id = await insertOutbox(db, ctx, {
    userId: row.userId,
    kind: row.kind,
    dedupKey: key,
    ...(row.emailId === null ? {} : { emailId: row.emailId }),
    ...(row.mailboxId === null ? {} : { mailboxId: row.mailboxId }),
    view: row.view as Record<string, unknown>,
    locale,
    createdAt: row.createdAt,
    nextAttemptAt: row.createdAt,
  });
  if (id !== null) log.info("push_fallback_queued", { outbox_id: id, kind: row.kind });
  return id;
}
