import { z } from "zod";

import { CHASER_SET_LIMIT, type SendResultKind } from "../digest/approvals";
import { ATTACHMENT_LINE_NAMES } from "../digest/attachment-line";
import { MESSAGE_MAX_CHARS, outButtonsSchema } from "../digest/message";
import type { ApprovalView } from "../outgoing/sender";
import { approvalViewSchema, panelUrlSchema } from "../outgoing/view-schema";
import { sendLimitKinds } from "../send-limits";
import { barCategories } from "../triage/metrics";
import { draftKinds } from "../triage/payloads";
import { actionTypes, moveTargets } from "../triage/planners";
import { senderRuleKinds } from "../triage/rules";
import { suspiciousReasons } from "../triage/suspicious";
import { movingCategories, tripReasons } from "../trust";
import { authErrorReasons, mailOAuthProviderKeys, removeAccessPages } from "../web/mail-oauth";
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
      "loop_closed",
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
  // Optional on read, written only when the flag `why_lines` is on (F110 stage 16): the model confidence (null: no model mark)
  // and the sender rule that shaped the result.
  confidence: z.number().min(0).max(1).nullable().optional(),
  rule: z.enum(senderRuleKinds).nullable().optional(),
  now: isoDate,
  timeZone,
});

const authErrorView = z.strictObject({
  address: text,
  mailboxId: id,
  // Optional on read: a view queued before F117 has no field. Set for an OAuth mailbox only.
  oauth: z
    .strictObject({ provider: z.enum(mailOAuthProviderKeys), reason: z.enum(authErrorReasons).nullable() })
    .optional(),
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

const mailActionFailedView = z.strictObject({
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

// A follow-up that did not go out (open loops): a code and the panel link, no recipient and no text. `unknown`: the connection
// broke after the text went out, so the mail may have been sent. A union: a row queued before this kind of view still parses.
const followUpFailedView = z.strictObject({
  followUp: z.strictObject({ cause: z.enum(["failed", "unknown"]), panelUrl: panelUrlSchema.optional() }),
});
const actionFailedView = z.union([mailActionFailedView, followUpFailedView]);

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

// Optional on read: a row queued before F117 has no field (it renders the password text). Set at queue time: the mailbox row is gone
// when the notice renders. `revoked`: the Google revoke call went through (true) or not (false); null when no call was made.
const mailboxRemovedView = z.strictObject({
  access: z.strictObject({ page: z.enum(removeAccessPages), revoked: z.boolean().nullable() }).optional(),
});

const sendHeldView = z.strictObject({
  mailboxId: id,
  address: text,
  limit: z.enum(sendLimitKinds),
  waiting: z.number().int().min(1),
  nextAt: isoDate,
  now: isoDate,
  timeZone,
  // Open loops: the held sends are follow-ups. The renderer says so in a fixed line; the panel link is the way to the details.
  followUps: z.boolean().optional(),
  panelUrl: panelUrlSchema.optional(),
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

// Mail of a VIP or whitelisted sender waits while the AI is paused (F109 stage 15, D17). The sender address only: no
// subject, display name, body or summary (PD-067). The text of the notice is a fixed phrase of ours.
const notTriagedView = z.strictObject({
  emailId: id,
  mailboxId: id,
  sender: text,
});

// The mailbox has shown no sent mail for a long time (F104). The view holds the mailbox address and the start of the
// quiet period only: no subject, no recipient.
const sentMissingView = z.strictObject({
  address: text,
  since: isoDate,
  now: isoDate,
  timeZone,
});

// One line for an owner whose consent does not cover open-loop data (F116 stage 11): it replaces a follow-up card
// (`approval`) or a follow-up result (`result`). No recipient, no text, no id of a loop.
const loopConsentView = z.strictObject({
  about: z.enum(["approval", "result"]),
  panelUrl: panelUrlSchema.optional(),
});

// The history check of a mailbox is ready (F110 stage 10, D15). Counts and category names only: no address, sender, subject or domain.
// `blocked`: the moving categories that the evidence does not support (a count; the Telegram text prints no number for it).
// `reportUrl`: `<WEB_BASE_URL>/report?mailbox=<id>`, null when `WEB_BASE_URL` is not set.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The link of a trust notice is the panel page and nothing else (F110 stage 10 review, D15): http or https, no user info
// (`https://app.test@evil.test/` has the host evil.test), no control, format or bidi character, a fixed path, and no query
// but the mailbox id. An address, a subject or a name cannot ride in the link.
const trustUrl = (path: string, mailbox: "required" | "none") =>
  panelUrlSchema.refine((value) => {
    if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) return false;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (url.username !== "" || url.password !== "" || url.hash !== "" || url.pathname !== path) return false;
    if (mailbox === "none") return url.search === "";
    return /^\?mailbox=[0-9a-f-]{36}$/.test(url.search) && uuidPattern.test(url.search.slice(9));
  });
export const trustReportUrlSchema = trustUrl("/report", "required");
export const trustSettingsUrlSchema = trustUrl("/settings", "none");

const trustReportReadyView = z
  .strictObject({
    mailboxId: z.string().regex(uuidPattern),
    recommended: z
      .array(z.enum(movingCategories))
      .max(movingCategories.length)
      .refine((list) => new Set(list).size === list.length),
    blocked: z.number().int().min(0),
    checked: z.number().int().min(0),
    reportUrl: trustReportUrlSchema.nullable(),
  })
  .refine((view) => view.reportUrl === null || view.reportUrl.endsWith(`?mailbox=${view.mailboxId}`));

// A category lost its `auto` (F110 stage 10, D15). The category and a fixed reason only: no mail data. `corrections` is the count
// that the `corrections` reason prints. `settingsUrl`: `<WEB_BASE_URL>/settings`, null when `WEB_BASE_URL` is not set.
const autonomyPausedView = z.strictObject({
  mailboxId: z.string().regex(uuidPattern),
  category: z.enum(barCategories),
  reason: z.enum(tripReasons),
  corrections: z.number().int().min(0),
  settingsUrl: trustSettingsUrlSchema.nullable(),
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
  not_triaged: notTriagedView,
  sent_missing: sentMissingView,
  loop_consent: loopConsentView,
  trust_report_ready: trustReportReadyView,
  autonomy_paused: autonomyPausedView,
} satisfies Record<NoticeKind, z.ZodType>;

export type NoticeView<K extends NoticeKind> = z.output<(typeof noticeViewSchemas)[K]>;
