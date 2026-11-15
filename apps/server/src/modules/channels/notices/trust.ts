import { panelUrlSchema, type NoticeView } from "@ea/core";
import { type Transaction } from "kysely";

import { type DB, type TenantContext } from "../../../platform/db";
import { queueNotice } from "../notice-queue";
import { listLinkedChatsOfOrg } from "../repo";

// The report page of one mailbox: `<WEB_BASE_URL>/report?mailbox=<id>`, with no double slash after a trailing `/`. Only a base
// URL that the view schema accepts gives a link; no base URL, or a refused link, gives null (the text has no link line).
export function trustReportUrlOf(base: string | undefined, mailboxId: string): string | null {
  if (base === undefined) return null;
  const url = panelUrlSchema.safeParse(`${base.replace(/\/+$/, "")}/report?mailbox=${encodeURIComponent(mailboxId)}`);
  return url.success ? url.data : null;
}

// The Settings page of the panel: `<WEB_BASE_URL>/settings`.
export function trustSettingsUrlOf(base: string | undefined): string | null {
  if (base === undefined) return null;
  const url = panelUrlSchema.safeParse(`${base.replace(/\/+$/, "")}/settings`);
  return url.success ? url.data : null;
}

// The input of `queueTrustNotice`. `mailboxId` is the mailbox of the outbox row and must equal `view.mailboxId`. `tripId` is the
// dedup anchor of a pause: one notice per trip (`autonomy_paused:<trip id>`). The report notice is one per mailbox
// (`trust_report:<mailbox id>`).
export type TrustNoticeInput =
  | { kind: "trust_report_ready"; view: NoticeView<"trust_report_ready">; mailboxId: string; now: Date }
  | { kind: "autonomy_paused"; view: NoticeView<"autonomy_paused">; mailboxId: string; tripId: string; now: Date };

// F110 stage 10 (D15, D16): one Telegram row per linked owner of the organization, in the locale of the user. A member who is
// not an owner gets none (E4-B stage 19 adds the mail rows). Runs inside the caller's transaction, so the notice and the event
// that causes it commit together. A second call for the same event queues nothing (the dedup key). Returns the rows queued.
// Quiet hours hold the row in the sender, as for every notice. A view that does not render throws `NoticeViewError`.
export async function queueTrustNotice(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: TrustNoticeInput
): Promise<number> {
  if (input.view.mailboxId !== input.mailboxId) throw new Error("trust notice: view and row name different mailboxes");
  let queued = 0;
  for (const chat of await listLinkedChatsOfOrg(trx, ctx)) {
    if (chat.role !== "owner") continue;
    const base = { userId: chat.userId, locale: chat.locale, mailboxId: input.mailboxId, now: input.now };
    const id =
      input.kind === "trust_report_ready"
        ? await queueNotice(trx, ctx, {
            ...base,
            kind: input.kind,
            view: input.view,
            dedupKey: `trust_report:${input.mailboxId}`,
          })
        : await queueNotice(trx, ctx, {
            ...base,
            kind: input.kind,
            view: input.view,
            dedupKey: `autonomy_paused:${input.tripId}`,
          });
    if (id !== null) queued += 1;
  }
  return queued;
}
