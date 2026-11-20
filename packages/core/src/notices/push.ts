import { userLocaleSchema } from "../tenancy";
import { z } from "../web/zod";

import type { NoticeKind } from "./kinds";

// The phone channel. A push holds a kind, a count and an id and nothing else; a tap opens the page of its kind.
// This file runs in the service worker too: no Node module, no import of a module that has one.

/** The three groups of the routing setting. A group is what the user picks a channel for. */
export const noticeGroupNames = ["urgent", "approvals", "updates"] as const;
export type NoticeGroup = (typeof noticeGroupNames)[number];

export const noticeGroups = {
  urgent: ["urgent", "not_triaged"],
  approvals: ["approval", "approval_set", "replies_ready"],
  updates: [
    "send_result",
    "delegation_answered",
    "send_held",
    "action_failed",
    "auth_error",
    "host_blocked",
    "sync_stale",
    "sync_ok",
    "sent_missing",
    "mailbox_removed",
  ],
} as const satisfies Record<NoticeGroup, readonly NoticeKind[]>;

/** The kinds that have a push renderer: every kind of every group. The others stay Telegram (and mail for the report kinds). */
export const pushKinds = [...noticeGroups.urgent, ...noticeGroups.approvals, ...noticeGroups.updates] as const;
export type PushKind = (typeof pushKinds)[number];

/** The group of a kind, or null when the kind has no push. */
export function noticeGroupOf(kind: NoticeKind): NoticeGroup | null {
  for (const group of noticeGroupNames) {
    if ((noticeGroups[group] as readonly NoticeKind[]).includes(kind)) return group;
  }
  return null;
}

/** `test` is the payload of "Send a test notice" (the device card). It is not a notice kind. */
export const pushPayloadKinds = [...pushKinds, "test"] as const;
export type PushPayloadKind = (typeof pushPayloadKinds)[number];

// Strict: a key that is not listed (a subject, a name) makes the payload invalid and the worker shows nothing. A payload with
// the longest values stays under 256 bytes (unit test).
export const pushPayloadSchema = z.strictObject({
  v: z.literal(1),
  id: z.string().min(1).max(64),
  kind: z.enum(pushPayloadKinds),
  count: z.number().int().min(0).max(99_999),
  itemId: z.string().min(1).max(64).nullable(),
  lang: userLocaleSchema,
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The panel page of each kind. `/activity?category=urgent` is the filter of the Activity page, not one mail: the panel has no
// mail page and the mail id never goes into a payload.
const PAGE: Record<NoticeKind | "test", string> = {
  urgent: "/activity?category=urgent",
  not_triaged: "/activity",
  digest: "/activity",
  approval: "/approvals",
  approval_set: "/approvals",
  approval_edit: "/approvals",
  replies_ready: "/approvals",
  reply_prompt: "/approvals",
  reply_result: "/approvals",
  send_result: "/approvals",
  send_held: "/approvals",
  action_failed: "/activity",
  delegation_answered: "/delegations",
  auth_error: "/mailboxes",
  host_blocked: "/mailboxes",
  sync_stale: "/mailboxes",
  sync_ok: "/mailboxes",
  sent_missing: "/mailboxes",
  mailbox_removed: "/mailboxes",
  weekly_report: "/stats",
  trust_report_ready: "/report",
  autonomy_paused: "/settings",
  // Every loop-consent line links to the approvals list (the full view does the same).
  loop_consent: "/approvals",
  test: "/settings",
};

/**
 * The panel path that a tap or a link opens. Only an approval with a UUID `itemId` gets `?id=`; any other `itemId` is dropped (the
 * path never carries text that a payload chose). Always a path on the panel: it starts with one `/`.
 */
export function noticePath(kind: NoticeKind | "test", itemId: string | null): string {
  if (kind === "approval" && itemId !== null && UUID.test(itemId)) return `/approvals?id=${itemId.toLowerCase()}`;
  return PAGE[kind];
}
