import { z } from "zod";

import { CHASER_SET_LIMIT, type SendResultKind } from "../digest/approvals";
import { ATTACHMENT_LINE_NAMES } from "../digest/attachment-line";
import { MESSAGE_MAX_CHARS, outButtonsSchema } from "../digest/message";
import type { ApprovalView } from "../outgoing/sender";
import { approvalViewSchema, panelUrlSchema } from "../outgoing/view-schema";
import { sendLimitKinds } from "../send-limits";
import { draftKinds } from "../triage/payloads";
import { actionTypes, moveTargets } from "../triage/planners";
import { suspiciousReasons } from "../triage/suspicious";
import { weekStatsSchema } from "../web/stats";

import type { NoticeKind } from "./kinds";

// Every object is strict: a view holds exactly the facts that its renderer prints (ADR 0032 point 5).
const isoDate = z.iso.datetime().transform((value) => new Date(value));
const id = z.string().min(1);
const draftKind = z.enum(draftKinds);
const text = z.string();
const nullableText = z.string().nullable();
const timeZone = z.string().min(1);

const wouldDoActionSchema = z.strictObject({
  type: z.enum(actionTypes),
  status: text,
  folder: z.enum(moveTargets).nullable(),
  reverse: z.boolean(),
  kind: draftKind.nullable(),
  delegateId: nullableText,
});

const sendResultKindSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("sent"),
    sentCopy: z.enum(["appended", "found", "failed"]),
    draftRemoved: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("rejected_by_server"),
    stage: text,
    responseCode: z.number().nullable(),
  }),
  z.strictObject({
    kind: z.literal("failed"),
    cause: z.enum(["tries", "content_soft", "soft_cap", "compose", "bad_payload"]),
    code: nullableText,
    tries: z.number(),
  }),
  z.strictObject({ kind: z.literal("outcome_unknown") }),
  z.strictObject({
    kind: z.literal("expired"),
    reason: z.enum([
      "timeout",
      "draft_missing",
      "not_notified",
      "not_seen",
      "held_timeout",
      "delegation_closed",
      "policy_changed",
    ]),
    draftRemoved: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("rejected"), byName: nullableText, draftRemoved: z.boolean() }),
]);

export { panelUrlSchema };

// A later change of the TypeScript type breaks the build until the schema follows.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const approvalViewMatches: Same<z.output<typeof approvalViewSchema>, ApprovalView> = true;
const sendResultMatches: Same<z.output<typeof sendResultKindSchema>, SendResultKind> = true;
void approvalViewMatches;
void sendResultMatches;

const digestView = z.strictObject({
  text: z.string().min(1).max(MESSAGE_MAX_CHARS),
  buttons: outButtonsSchema,
});

const attachmentFactSchema = z.strictObject({
  attachments: z
    .array(
      z.strictObject({
        name: z.string().max(200).nullable(),
        type: z.string().max(200),
        size: z.number().min(0),
        inline: z.boolean(),
      })
    )
    .max(ATTACHMENT_LINE_NAMES),
  count: z.number().int().min(1),
});

const urgentView = z.strictObject({
  emailId: id,
  from: nullableText,
  subject: nullableText,
  ai: z.strictObject({ reasonCode: text, reason: nullableText }),
  receivedAt: isoDate,
  synthetic: z.boolean(),
  folderTag: nullableText,
  actions: z.array(wouldDoActionSchema),
  delegateNames: z.record(z.string(), z.string()),
  stayFolder: text,
  // Optional on read: a view queued before F109 has no field.
  suspicious: z.array(z.enum(suspiciousReasons)).optional(),
  // Optional on read, written only when the flag `attachment_line` is on and the mail has an attachment to show (F109 stage 06).
  attachments: attachmentFactSchema.optional(),
  now: isoDate,
  timeZone,
});

const authErrorView = z.strictObject({
  address: text,
  mailboxId: id,
  since: isoDate,
  now: isoDate,
  timeZone,
});

const syncStaleView = z.strictObject({
  address: text,
  lastSyncedAt: isoDate.nullable(),
  now: isoDate,
  timeZone,
});

const syncOkView = z.strictObject({
  address: text,
  lastSyncedAt: isoDate,
  now: isoDate,
  timeZone,
});

const actionFailedView = z.strictObject({
  actionType: z.enum(["move", "flag", "mark_read", "create_draft"]),
  reverse: z.boolean(),
  reason: z.enum(["mail_not_found", "bad_payload", "other"]),
  folderName: nullableText,
  sourceFolder: text,
  currentFolder: text,
  from: nullableText,
  subject: nullableText,
  synthetic: z.boolean(),
  attempts: z.number().int().min(0),
});

const approvalNoticeView = z.strictObject({
  actionId: id,
  view: approvalViewSchema,
  now: isoDate,
  timeZone,
});

const approvalSetItem = z.strictObject({
  n: z.number().int().min(1),
  delegateName: text,
  address: text,
  subject: nullableText,
  dueAt: isoDate.nullable(),
  reminder: z.union([z.literal(1), z.literal(2)]),
  task: text,
});

const approvalSetView = z.strictObject({
  setId: id,
  items: z.array(approvalSetItem).min(1).max(CHASER_SET_LIMIT),
  timeZone,
});

const sendResultView = z.strictObject({
  actionId: id,
  sendKind: draftKind,
  result: sendResultKindSchema,
  recipient: z.strictObject({ name: nullableText, address: nullableText }),
  subject: text,
  synthetic: z.boolean(),
  // Optional: rows queued before the flag existed (and those with the flag off) have none.
  mistakeButton: z.boolean().optional(),
});

const delegationAnsweredView = z.strictObject({
  delegationId: id,
  delegateName: text,
  subject: nullableText,
  receivedAt: isoDate,
  now: isoDate,
  timeZone,
  synthetic: z.boolean(),
});

const mailboxRemovedView = z.strictObject({});

const sendHeldView = z.strictObject({
  mailboxId: id,
  address: text,
  limit: z.enum(sendLimitKinds),
  waiting: z.number().int().min(1),
  nextAt: isoDate,
  now: isoDate,
  timeZone,
});

// The numbers of one week (all mailboxes) and the count of replied mails that wait for a check (D23).
const weeklyReportView = z.strictObject({
  week: weekStatsSchema,
  timeZone,
  answeredWaiting: z.number().int().min(0),
});

// The mail host guard refuses a host of the mailbox. The view holds the mailbox address only: no host name, no network address.
const hostBlockedView = z.strictObject({
  address: text,
  since: isoDate,
  now: isoDate,
  timeZone,
});

// The edit of a card that an owner got (F102 stage 06): the input of `renderNoticeEdit`. The sender edits the sent message
// and sends no new one. EXCEPTION to "a view holds no phrase of ours" (docs/code-patterns.md, Notices are facts): `original`
// is the stored text of the target card (`outbox.text`), as the edit after a tap uses it ("the edit after a tap keeps the
// stored text"), so it holds our own phrases and mail text, up to one message. It follows the retention of `outbox.text`.
// `heldBy` is only for `approved_held`; `actionId` (the send) gives that outcome the Reject button.
const approvalEditView = z.strictObject({
  original: z.string().min(1).max(MESSAGE_MAX_CHARS),
  outcome: z.enum(["approved", "approved_held", "rejected", "changed", "expired"]),
  at: isoDate,
  timeZone,
  heldBy: z.enum(["scope", "paused", "auth_error", "host_blocked"]).optional(),
  actionId: id.optional(),
});

// The mailbox has shown no sent mail for a long time (F104). The view holds the mailbox address and the start of the
// quiet period only: no subject, no recipient.
const sentMissingView = z.strictObject({
  address: text,
  since: isoDate,
  now: isoDate,
  timeZone,
});

export const noticeViewSchemas = {
  digest: digestView,
  urgent: urgentView,
  auth_error: authErrorView,
  sync_stale: syncStaleView,
  sync_ok: syncOkView,
  action_failed: actionFailedView,
  approval: approvalNoticeView,
  approval_set: approvalSetView,
  send_result: sendResultView,
  delegation_answered: delegationAnsweredView,
  mailbox_removed: mailboxRemovedView,
  send_held: sendHeldView,
  weekly_report: weeklyReportView,
  host_blocked: hostBlockedView,
  approval_edit: approvalEditView,
  sent_missing: sentMissingView,
} satisfies Record<NoticeKind, z.ZodType>;

export type NoticeView<K extends NoticeKind> = z.output<(typeof noticeViewSchemas)[K]>;
