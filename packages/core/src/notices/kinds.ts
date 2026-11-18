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
  "weekly_report",
  "host_blocked",
  "approval_edit",
  "not_triaged",
  "sent_missing",
  "loop_consent",
  "trust_report_ready",
  "autonomy_paused",
  "replies_ready",
  "reply_prompt",
  "reply_result",
] as const;
export type NoticeKind = (typeof noticeKinds)[number];
export const noticeKindSchema = z.enum(noticeKinds);

// `mail` is the report mail of the trust ladder (APPEND into the own INBOX); the phone channel adds "push". Only four kinds go by mail.
export const noticeChannels = ["telegram", "mail"] as const;
export type NoticeChannel = (typeof noticeChannels)[number];

// The kinds that also go by mail. Every other kind goes to Telegram only; `noticeRenderers` has a `mail` renderer for these four.
export const reportMailKinds = ["digest", "weekly_report", "trust_report_ready", "autonomy_paused"] as const;
export type ReportMailKind = (typeof reportMailKinds)[number];

export const noticeDetails = ["full"] as const; // The phone channel adds "minimal"
export type NoticeDetail = (typeof noticeDetails)[number];

export interface NoticeRenderOptions {
  channel: NoticeChannel;
  detail: NoticeDetail;
  locale: UserLocale;
}
