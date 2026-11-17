import { trustReportUrlSchema, trustSettingsUrlSchema, type NoticeView } from "@ea/core";
import { type Transaction } from "kysely";

import { type DB, type TenantContext } from "../../../platform/db";
import { isFeatureOn } from "../../tenancy";
import { queueNotice } from "../notice-queue";
import { listReportMembers, mailDedupKey, reportRoutesOf } from "../report-members";

// The report page of one mailbox: `<WEB_BASE_URL>/report?mailbox=<id>`, with no double slash after a trailing `/`. Only a base
// URL that the view schema accepts gives a link; no base URL, or a refused link, gives null (the text has no link line).
export function trustReportUrlOf(base: string | undefined, mailboxId: string): string | null {
  if (base === undefined) return null;
  const url = trustReportUrlSchema.safeParse(
    `${base.replace(/\/+$/, "")}/report?mailbox=${encodeURIComponent(mailboxId)}`
  );
  return url.success ? url.data : null;
}

// The Settings page of the panel: `<WEB_BASE_URL>/settings`.
export function trustSettingsUrlOf(base: string | undefined): string | null {
  if (base === undefined) return null;
  const url = trustSettingsUrlSchema.safeParse(`${base.replace(/\/+$/, "")}/settings`);
  return url.success ? url.data : null;
}

// The input of `queueTrustNotice`. `mailboxId` is the mailbox of the outbox row and must equal `view.mailboxId`. `tripId` is the
// dedup anchor of a pause: one notice per trip (`autonomy_paused:<trip id>`). The report notice is one per mailbox
// (`trust_report:<mailbox id>`).
export type TrustNoticeInput =
  | { kind: "trust_report_ready"; view: NoticeView<"trust_report_ready">; mailboxId: string; now: Date }
  | { kind: "autonomy_paused"; view: NoticeView<"autonomy_paused">; mailboxId: string; tripId: string; now: Date };

// F110 stage 10 (D15, D16), widened in stage 19 (D14): one row per owner of the organization and channel. The Telegram row goes to
// an owner with a linked chat, in the locale of the user. With the flag `report_mail`, an owner whose report channel is `mail`
// or `both` and who has a report mailbox also gets a mail row (dedup key `<telegram key>:mail`), and a `mail` owner gets that
// row only (no row to a chat). A member who is not an owner gets none. Runs inside the caller's transaction, so the notice and
// the event that causes it commit together. A second call for the same event queues nothing (the dedup keys). Returns the rows
// queued. Quiet hours hold the row in the sender, as for every notice. A view that does not render throws `NoticeViewError`.
export async function queueTrustNotice(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: TrustNoticeInput
): Promise<number> {
  if (input.view.mailboxId !== input.mailboxId) throw new Error("trust notice: view and row name different mailboxes");
  const mailOn = await isFeatureOn(trx, ctx, "report_mail");
  let queued = 0;
  for (const member of await listReportMembers(trx, { includeSuspended: true, orgId: ctx.orgId })) {
    if (member.role !== "owner") continue;
    const routes = reportRoutesOf(member, mailOn);
    const base = { userId: member.userId, locale: member.locale, mailboxId: input.mailboxId, now: input.now };
    const dedupKey =
      input.kind === "trust_report_ready" ? `trust_report:${input.mailboxId}` : `autonomy_paused:${input.tripId}`;
    const rows = [
      ...(routes.telegram ? [{ dedupKey }] : []),
      ...(routes.mailboxId === null
        ? []
        : [{ dedupKey: mailDedupKey(dedupKey), channel: "mail" as const, mailboxId: routes.mailboxId }]),
    ];
    for (const row of rows) {
      // Two calls: the type of the view follows the kind.
      const id =
        input.kind === "trust_report_ready"
          ? await queueNotice(trx, ctx, { ...base, ...row, kind: input.kind, view: input.view })
          : await queueNotice(trx, ctx, { ...base, ...row, kind: input.kind, view: input.view });
      if (id !== null) queued += 1;
    }
  }
  return queued;
}
