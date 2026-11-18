import {
  encodeNoticeView,
  NoticeViewError,
  renderNotice,
  type NoticeChannel,
  type NoticeKind,
  type NoticeView,
  type UserLocale,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

import { insertOutbox } from "./repo";

export interface QueueNoticeInput<K extends NoticeKind> {
  userId: string;
  locale: UserLocale;
  kind: K;
  view: NoticeView<K>;
  dedupKey: string;
  emailId?: string;
  loopId?: string;
  mailboxId?: string;
  digestId?: string;
  editOfOutboxId?: string;
  // Absent = `telegram`. A `mail` row holds the same view; only the four report kinds go by mail.
  channel?: NoticeChannel;
  now: Date;
  // The `created_at` of the row when it must differ from `now` (the order of the edits of one card, `queueCardEdits`).
  createdAt?: Date;
}

// The only producer path into `outbox` (ADR 0032 point 5): the row stores the view; a view that does not render never
// enters the outbox (the check renders the Telegram text for every channel: a mail row takes the same view), so the caller skips the event as it did when the insert failed.
// null = the event has a row already (one row per event and member).
export async function queueNotice<K extends NoticeKind>(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: QueueNoticeInput<K>
): Promise<string | null> {
  const view = encodeNoticeView(input.kind, input.view);
  const rendered = renderNotice(input.kind, view, { channel: "telegram", detail: "full", locale: input.locale });
  if (!rendered.ok) throw new NoticeViewError(input.kind);
  return insertOutbox(db, ctx, {
    userId: input.userId,
    kind: input.kind,
    dedupKey: input.dedupKey,
    emailId: input.emailId,
    ...(input.loopId === undefined ? {} : { loopId: input.loopId }),
    mailboxId: input.mailboxId,
    digestId: input.digestId,
    editOfOutboxId: input.editOfOutboxId,
    view,
    locale: input.locale,
    ...(input.channel === undefined ? {} : { channel: input.channel }),
    createdAt: input.createdAt ?? input.now,
    nextAttemptAt: input.now,
  });
}
