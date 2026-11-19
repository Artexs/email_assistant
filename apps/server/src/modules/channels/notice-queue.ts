import {
  encodeNoticeView,
  NoticeViewError,
  renderNotice,
  type NoticeChannel,
  type NoticeDetail,
  type NoticeKind,
  type NoticeView,
  type UserLocale,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

import { detailOfUser } from "./detail";
import { planFanOut, type NoticeOnly } from "./notice-fan-out";
import { pushDedupKey } from "./push";
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
  // When the event happened (a mail triaged, a send that began to wait, a status change). Required for a kind with a push group:
  // a push row goes only to a device that existed then, so a new device gets no burst of old notices.
  eventAt?: Date;
  // Limit the rows to one channel (the loop-consent gate splits a follow-up notice: the real kind goes by push only).
  only?: NoticeOnly;
  now: Date;
  // The `created_at` of the row when it must differ from `now` (the order of the edits of one card, `queueCardEdits`).
  createdAt?: Date;
}

// The only producer path into `outbox` (ADR 0032 point 5): the row stores the view; a view that does not render never
// enters the outbox (the check renders the Telegram text; a push row is checked with the push render), so the caller skips the event as it did when the insert failed.
// With no explicit `channel` the call is the fan-out of one member and event: the Telegram row (the dedup key as it was) and one
// push row per device (`<key>:push:<device id>`), as `planFanOut` decides. An explicit `channel` writes that one row.
// Returns the id of the Telegram row when one was written, else the id of the first push row, else null: null = every row of the
// event exists already.
export async function queueNotice<K extends NoticeKind>(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: QueueNoticeInput<K>
): Promise<string | null> {
  const view = encodeNoticeView(input.kind, input.view);
  // A Telegram row stores the level of the member now and the check render uses it (the sender reads the level again at send time and
  // writes the level of the send). A mail or push row, and a call that writes no Telegram row, stay `full`.
  const detail: NoticeDetail =
    (input.channel === undefined || input.channel === "telegram") && input.only !== "push"
      ? await detailOfUser(db, ctx, input.userId)
      : "full";
  const rendered = renderNotice(input.kind, view, { channel: "telegram", detail, locale: input.locale });
  if (!rendered.ok) throw new NoticeViewError(input.kind);
  const base = {
    userId: input.userId,
    kind: input.kind,
    emailId: input.emailId,
    ...(input.loopId === undefined ? {} : { loopId: input.loopId }),
    mailboxId: input.mailboxId,
    digestId: input.digestId,
    editOfOutboxId: input.editOfOutboxId,
    view,
    locale: input.locale,
    createdAt: input.createdAt ?? input.now,
    nextAttemptAt: input.now,
  };
  if (input.channel !== undefined) {
    return insertOutbox(db, ctx, { ...base, dedupKey: input.dedupKey, channel: input.channel, detail });
  }
  const write = async (trx: Db | Transaction<DB>): Promise<string | null> => {
    const plan = await planFanOut(trx, ctx, {
      userId: input.userId,
      kind: input.kind,
      eventAt: input.eventAt,
      now: input.now,
      ...(input.only === undefined ? {} : { only: input.only }),
    });
    // The push rows take the same view: a view that has no push render never gets a push row (the check of the Telegram text above does not cover it).
    if (plan.deviceIds.length > 0) {
      const pushRendered = renderNotice(input.kind, view, { channel: "push", detail: "full", locale: input.locale });
      if (!pushRendered.ok) throw new NoticeViewError(input.kind);
    }
    const telegramId = plan.telegram
      ? await insertOutbox(trx, ctx, { ...base, dedupKey: input.dedupKey, detail })
      : null;
    let firstPushId: string | null = null;
    for (const deviceId of plan.deviceIds) {
      const pushId = await insertOutbox(trx, ctx, {
        ...base,
        dedupKey: pushDedupKey(input.dedupKey, deviceId),
        channel: "push",
        pushSubscriptionId: deviceId,
      });
      firstPushId ??= pushId;
    }
    return telegramId ?? firstPushId;
  };
  // The rows of one event go together: a failed insert leaves none of them (the caller's own transaction wins when there is one).
  return db.isTransaction ? write(db) : (db as Db).transaction().execute(write);
}
