import { z } from "../web/zod";

import { noticeGroupNames, type NoticeGroup } from "./push";

// Which channels a notice goes to. One pure rule: the user picks a channel per group (`memberships.notice_routes`), the code
// adds what exists (a Telegram link, a live push device). No Node module here.

/** The values of one group. The database CHECK `memberships_notice_routes_check` allows exactly these three. */
export const noticeRouteValues = ["telegram", "push", "both"] as const;
export type NoticeRouteValue = (typeof noticeRouteValues)[number];
export const noticeRouteValueSchema = z.enum(noticeRouteValues);

/**
 * The stored choice. Strict: only the three group names, so no free text fits (the CHECK keeps the same shape). A missing key
 * means the default of the code (`effectiveRoute`).
 */
export const noticeRoutesSchema = z.strictObject({
  urgent: noticeRouteValueSchema.optional(),
  approvals: noticeRouteValueSchema.optional(),
  updates: noticeRouteValueSchema.optional(),
});
export type NoticeRoutes = z.infer<typeof noticeRoutesSchema>;

// The body of a change: `null` removes the key (back to the default). It is never stored: the stored form is `noticeRoutesSchema`.
// At least one key, so the body changes something.
export const noticeRoutesPatchSchema = z
  .strictObject({
    urgent: noticeRouteValueSchema.nullable().optional(),
    approvals: noticeRouteValueSchema.nullable().optional(),
    updates: noticeRouteValueSchema.nullable().optional(),
  })
  .refine((body) => noticeGroupNames.some((group) => body[group] !== undefined), { message: "routes_empty" });
export type NoticeRoutesPatch = z.infer<typeof noticeRoutesPatchSchema>;

export interface EffectiveRouteInput {
  /** The stored choice of the group, or undefined when the user chose none. */
  stored: NoticeRouteValue | undefined;
  /** The member has a linked Telegram chat. */
  hasChat: boolean;
  /**
   * The member has a live push device. The caller passes `false` while the flag `web_push` is off for the organization: the
   * rule itself knows no flag.
   */
  hasDevice: boolean;
  /** The group of the kind (`noticeGroupOf`); null for a kind that has no push. */
  group: NoticeGroup | null;
}

export interface EffectiveRoute {
  telegram: boolean;
  push: boolean;
}

/**
 * The channels that one notice goes to.
 *
 * - A kind with no group stays on Telegram (and `reply_result` answers a Telegram request): `{ telegram: hasChat, push: false }`.
 * - Missing choice: `both` for `urgent` and `approvals` when the member has a live device, else `telegram`. `updates`: `telegram`.
 * - The chosen channels that exist. When none of them exists, the other channel if it exists (a "Telegram" member with no chat
 *   but a device gets push; a "push" member with no device but a chat gets Telegram). Nothing exists: nothing.
 */
export function effectiveRoute(input: EffectiveRouteInput): EffectiveRoute {
  const { stored, hasChat, hasDevice, group } = input;
  if (group === null) return { telegram: hasChat, push: false };
  const choice: NoticeRouteValue = stored ?? (group !== "updates" && hasDevice ? "both" : "telegram");
  const telegram = (choice === "telegram" || choice === "both") && hasChat;
  const push = (choice === "push" || choice === "both") && hasDevice;
  if (!telegram && !push) return { telegram: hasChat, push: hasDevice };
  return { telegram, push };
}
