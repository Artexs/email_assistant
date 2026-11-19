import {
  effectiveRoute,
  noticeGroupNames,
  type NoticeGroup,
  type NoticeRoutes,
  type NotifyPatch,
  type NotifyView,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";
import { listMailboxes } from "../mail";
import {
  getMemberNotify,
  isFeatureOn,
  setMemberNoticeRoutes,
  setMemberQuietHours,
  setMemberReportChannel,
} from "../tenancy";

import { listLiveDeviceIds } from "./push";
import { getChatLinkForUser } from "./repo";

// The own quiet hours, report channel and notice routes of one member. Both functions take the user id of the session:
// no body names another user.

export async function notifyViewOf(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  now: Date
): Promise<NotifyView | undefined> {
  const prefs = await getMemberNotify(db, ctx, userId);
  if (prefs === undefined) return undefined;
  const mailboxes = (await listMailboxes(db, ctx)).filter((mailbox) => mailbox.status === "active");
  const telegramLinked = (await getChatLinkForUser(db, ctx, userId)) !== undefined;
  // With `web_push` off for the organization no device counts: the routes of the member stay stored, and nothing goes by push.
  const hasDevice =
    (await isFeatureOn(db, ctx, "web_push")) && (await listLiveDeviceIds(db, ctx, userId, now)).length > 0;
  const defaultOf = (group: NoticeGroup) =>
    effectiveRoute({ stored: undefined, hasChat: telegramLinked, hasDevice, group });
  return {
    quietStart: prefs.quiet_start,
    quietEnd: prefs.quiet_end,
    reportChannel: prefs.report_channel,
    reportMailboxId: prefs.report_mailbox_id,
    mailboxes: mailboxes.map((mailbox) => ({ id: mailbox.id, address: mailbox.address })),
    telegramLinked,
    routes: prefs.notice_routes,
    routeDefaults: { urgent: defaultOf("urgent"), approvals: defaultOf("approvals"), updates: defaultOf("updates") },
  };
}

export type ChangeNotifyResult =
  | { kind: "ok"; view: NotifyView }
  // The flag of the key group is off, or the user has no row in the organization.
  | { kind: "not_found" }
  // `mail` or `both` needs an active mailbox of the organization.
  | { kind: "no_mailbox" };

// Postgres code of a foreign key violation: the mailbox of the report channel was deleted between the check and the write.
const FOREIGN_KEY_VIOLATION = "23503";

// Quiet hours need the flag `user_quiet_hours`, the report channel the flag `report_mail`, the notice routes the flag `web_push`.
// The read of the row (locked), the check of the mailbox and the write are one transaction, so the changed keys of the audit
// row are true and a second change waits.
// A change writes one audit row with the names of the changed keys (never a value; the routes are the one key `notice_routes`);
// a repeat of the stored value writes none.
export async function changeNotify(
  db: Db,
  ctx: TenantContext,
  userId: string,
  body: NotifyPatch,
  now: Date
): Promise<ChangeNotifyResult> {
  const isQuiet = body.quietStart !== undefined;
  const isRoutes = body.routes !== undefined;
  const flag = isRoutes ? "web_push" : isQuiet ? "user_quiet_hours" : "report_mail";
  if (!(await isFeatureOn(db, ctx, flag))) return { kind: "not_found" };
  try {
    return await db.transaction().execute(async (trx): Promise<ChangeNotifyResult> => {
      const before = await getMemberNotify(trx, ctx, userId, { lock: true });
      if (before === undefined) return { kind: "not_found" };

      // The new row values; the keys that differ from the stored row go to the audit row.
      const next = { ...before };
      if (body.routes !== undefined) {
        next.notice_routes = mergeRoutes(before.notice_routes, body.routes);
      } else if (isQuiet) {
        next.quiet_start = body.quietStart ?? null;
        next.quiet_end = body.quietEnd ?? null;
      } else {
        next.report_channel = body.reportChannel ?? "telegram";
        next.report_mailbox_id = null;
        if (next.report_channel !== "telegram") {
          // The mailbox asked for, else the oldest active one of the organization.
          const active = (await listMailboxes(trx, ctx)).filter((mailbox) => mailbox.status === "active");
          const asked = body.reportMailboxId ?? null;
          const chosen = asked === null ? active[0] : active.find((mailbox) => mailbox.id === asked);
          if (chosen === undefined) return { kind: "no_mailbox" };
          next.report_mailbox_id = chosen.id;
        }
      }
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter((key) =>
        key === "notice_routes"
          ? noticeGroupNames.some((group) => next.notice_routes[group] !== before.notice_routes[group])
          : next[key] !== before[key]
      );
      const saved = isRoutes
        ? await setMemberNoticeRoutes(trx, ctx, userId, next.notice_routes)
        : isQuiet
          ? await setMemberQuietHours(
              trx,
              ctx,
              userId,
              next.quiet_start === null || next.quiet_end === null
                ? null
                : { start: next.quiet_start, end: next.quiet_end }
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
      const view = await notifyViewOf(trx, ctx, userId, now);
      return view === undefined ? { kind: "not_found" } : { kind: "ok", view };
    });
  } catch (error) {
    // A mailbox deleted after the check: the foreign key of the report mailbox refuses the write. Nothing was stored.
    if ((error as { code?: unknown }).code === FOREIGN_KEY_VIOLATION) return { kind: "no_mailbox" };
    throw error;
  }
}

// A key of the body replaces the stored value of its group; `null` removes the key; a group that is not in the body stays.
function mergeRoutes(stored: NoticeRoutes, patch: NonNullable<NotifyPatch["routes"]>): NoticeRoutes {
  const merged: NoticeRoutes = {};
  for (const group of noticeGroupNames) {
    const value = patch[group] === undefined ? stored[group] : patch[group];
    if (value !== null && value !== undefined) merged[group] = value;
  }
  return merged;
}
