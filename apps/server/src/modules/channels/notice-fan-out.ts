import { effectiveRoute, noticeGroupOf, type MembershipRole, type NoticeKind, type UserLocale } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { getMemberNotify, isFeatureOn } from "../tenancy";

import { listLiveDeviceIds } from "./push";
import { getChatLinkForUser } from "./repo";

type DbOrTrx = Db | Transaction<DB>;

// One member that the notice detectors write for. A member with a linked chat has `since` = the link time; a push-only member
// (no chat, a live device, the flag `web_push` on) has `since` = the oldest live device. `hasChat` tells the two apart.
export interface NoticeRecipient {
  userId: string;
  role: MembershipRole;
  locale: UserLocale;
  since: Date;
  hasChat: boolean;
}

export class MissingEventAtError extends Error {
  constructor(kind: NoticeKind) {
    super(`queueNotice: the kind ${kind} has a push group and needs eventAt`);
    this.name = "MissingEventAtError";
  }
}

export type NoticeOnly = "telegram" | "push";

// The rows of one notice for one member: whether a Telegram row goes, and the devices that get a push row.
export interface FanOutPlan {
  telegram: boolean;
  deviceIds: string[];
}

// Where one notice of a member goes. The one place that reads the flag, the stored routes, the chat link and
// the live devices; `queueNotice` and the detectors that split owners ask here.
//
// - A kind with no push group (digest, reports, taps, the consent line): one Telegram row, as before. `only: "push"` leaves none.
// - A kind with a group and the flag `web_push` off for the organization: one Telegram row, as before. No device counts.
// - A kind with a group and the flag on: `effectiveRoute` says which channels. A member with neither a chat nor a device keeps the
//   Telegram row of before (it ends `no_chat`). A push row goes to each live device that was reachable at `eventAt` (the device and
//   its session existed: `boundAt`): a new device, or a device bound again to a new session, gets no burst of old notices, so
//   `eventAt` is required.
// - `only` limits the rows to one channel. `only: "telegram"` reads nothing and needs no `eventAt`: the answer to a tap in Telegram
//   stays in that chat. The loop-consent gate is a Telegram gate, so a gated owner gets the consent line on Telegram and the real
//   kind with `only: "push"`.
export async function planFanOut(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { userId: string; kind: NoticeKind; eventAt: Date | undefined; now: Date; only?: NoticeOnly }
): Promise<FanOutPlan> {
  const group = noticeGroupOf(input.kind);
  if (group === null) return { telegram: input.only !== "push", deviceIds: [] };
  // A row for Telegram only has no device to filter: the time of the event matters for a push row alone.
  if (input.only === "telegram") return { telegram: true, deviceIds: [] };
  if (input.eventAt === undefined) throw new MissingEventAtError(input.kind);
  const eventAt = input.eventAt;
  if (!(await isFeatureOn(db, ctx, "web_push"))) return { telegram: input.only !== "push", deviceIds: [] };

  // The route sees every live device, not only the ones of the event: a member whose only device is newer than the event still
  // has a phone, so a Telegram row that the route drops stays dropped for the old event too (no row, no burst).
  const live = await listLiveDeviceIds(db, ctx, input.userId, input.now);
  const devices = live.filter((device) => device.boundAt.getTime() <= eventAt.getTime());
  const hasChat = (await getChatLinkForUser(db, ctx, input.userId)) !== undefined;
  const routes = (await getMemberNotify(db, ctx, input.userId))?.notice_routes ?? {};
  const route = effectiveRoute({ stored: routes[group], hasChat, hasDevice: live.length > 0, group });
  const neither = !route.telegram && !route.push;
  return {
    telegram: (route.telegram || neither) && input.only !== "push",
    deviceIds: route.push ? devices.map((device) => device.id) : [],
  };
}
