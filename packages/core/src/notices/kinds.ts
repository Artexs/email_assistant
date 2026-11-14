import { z } from "zod";

import type { UserLocale } from "../tenancy";

// The same order as the CHECK list of `outbox.kind`.
export const noticeKinds = [
  "digest",
  "urgent",
  "auth_error",
  "sync_stale",
  "sync_ok",
  "action_failed",
  "approval",
  "approval_set",
  "send_result",
  "delegation_answered",
  "mailbox_removed",
  "send_held",
] as const;
export type NoticeKind = (typeof noticeKinds)[number];
export const noticeKindSchema = z.enum(noticeKinds);

export const noticeChannels = ["telegram"] as const; // E4-B adds "mail", E9b adds "push"
export type NoticeChannel = (typeof noticeChannels)[number];

export const noticeDetails = ["full"] as const; // E9b adds "minimal"
export type NoticeDetail = (typeof noticeDetails)[number];

export interface NoticeRenderOptions {
  channel: NoticeChannel;
  detail: NoticeDetail;
  locale: UserLocale;
}

export const MAILBOX_REMOVED_TEXT = "Mailbox removed. Change its password in your mail provider's settings now.";
