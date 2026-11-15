import type { NotifyPatch, NotifyView } from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";
import { listMailboxes } from "../mail";
import { getMemberNotify, isFeatureOn, setMemberQuietHours, setMemberReportChannel } from "../tenancy";

import { getChatLinkForUser } from "./repo";

// F110 stage 18: the own quiet hours and report channel of one member. Both functions take the user id of the session:
// no body names another user.

export async function notifyViewOf(db: Db, ctx: TenantContext, userId: string): Promise<NotifyView | undefined> {
  const prefs = await getMemberNotify(db, ctx, userId);
  if (prefs === undefined) return undefined;
  const mailboxes = (await listMailboxes(db, ctx)).filter((mailbox) => mailbox.status === "active");
  return {
    quietStart: prefs.quiet_start,
    quietEnd: prefs.quiet_end,
    reportChannel: prefs.report_channel,
    reportMailboxId: prefs.report_mailbox_id,
    mailboxes: mailboxes.map((mailbox) => ({ id: mailbox.id, address: mailbox.address })),
    telegramLinked: (await getChatLinkForUser(db, ctx, userId)) !== undefined,
  };
}

export type ChangeNotifyResult =
  | { kind: "ok"; view: NotifyView }
  // The flag of the key group is off, or the user has no row in the organization.
  | { kind: "not_found" }
  // `mail` or `both` needs an active mailbox of the organization.
  | { kind: "no_mailbox" };

// Quiet hours need the flag `user_quiet_hours`, the report channel the flag `report_mail`. A change writes one audit row with
// the names of the changed keys (never a value); a repeat of the stored value writes none.
export async function changeNotify(
  db: Db,
  ctx: TenantContext,
  userId: string,
  body: NotifyPatch,
  now: Date
): Promise<ChangeNotifyResult> {
  const isQuiet = body.quietStart !== undefined;
  if (!(await isFeatureOn(db, ctx, isQuiet ? "user_quiet_hours" : "report_mail"))) return { kind: "not_found" };
  const before = await getMemberNotify(db, ctx, userId);
  if (before === undefined) return { kind: "not_found" };

  // The new row values; the keys that differ from the stored row go to the audit row.
  const next = { ...before };
  if (isQuiet) {
    next.quiet_start = body.quietStart ?? null;
    next.quiet_end = body.quietEnd ?? null;
  } else {
    next.report_channel = body.reportChannel ?? "telegram";
    next.report_mailbox_id = null;
    if (next.report_channel !== "telegram") {
      // The mailbox asked for, else the oldest active one of the organization.
      const active = (await listMailboxes(db, ctx)).filter((mailbox) => mailbox.status === "active");
      const asked = body.reportMailboxId ?? null;
      const chosen = asked === null ? active[0] : active.find((mailbox) => mailbox.id === asked);
      if (chosen === undefined) return { kind: "no_mailbox" };
      next.report_mailbox_id = chosen.id;
    }
  }
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((key) => next[key] !== before[key]);
  await db.transaction().execute(async (trx) => {
    const saved = isQuiet
      ? await setMemberQuietHours(
          trx,
          ctx,
          userId,
          next.quiet_start === null || next.quiet_end === null ? null : { start: next.quiet_start, end: next.quiet_end }
        )
      : await setMemberReportChannel(trx, ctx, userId, {
          channel: next.report_channel,
          mailboxId: next.report_mailbox_id,
        });
    if (saved && changed.length > 0) {
      await recordAudit(trx, ctx, {
        event: auditEvents.memberNotifyChanged,
        actor: userId,
        data: { via: "web", keys: changed.join(",") },
        at: now,
      });
    }
  });
  const view = await notifyViewOf(db, ctx, userId);
  return view === undefined ? { kind: "not_found" } : { kind: "ok", view };
}
