import { z } from "zod";

import type { SendResultKind } from "../digest/approvals";
import { ATTACHMENT_LINE_NAMES } from "../digest/attachment-line";
import type { DigestMinimalFacts } from "../digest/digest";
import { MESSAGE_MAX_CHARS, outButtonsSchema } from "../digest/message";
import type { ApprovalView } from "../outgoing/sender";
import { approvalViewSchema, panelUrlSchema } from "../outgoing/view-schema";
import { sendLimitKinds } from "../send-limits";
import { actionTypes, moveTargets } from "../triage/planners";
import { senderRuleKinds } from "../triage/rules";
import { suspiciousReasons } from "../triage/suspicious";
import { movingCategories, tripReasons } from "../trust";
import { authErrorReasons, mailOAuthProviderKeys, removeAccessPages } from "../web/mail-oauth";
import { weekStatsSchema } from "../web/stats";

import type { NoticeKind } from "./kinds";
import { draftKind, id, isoDate, nullableText, text, timeZone } from "./view-fields";
import {
  approvalNoticeView,
  approvalSetView,
  delegationAnsweredView,
  sendResultKindSchema,
  sendResultView,
} from "./views-approvals";

// Every object is strict: a view holds exactly the facts that its renderer prints (ADR 0032 point 5).
const wouldDoActionSchema = z.strictObject({
  type: z.enum(actionTypes),
  status: text,
  folder: z.enum(moveTargets).nullable(),
  reverse: z.boolean(),
  kind: draftKind.nullable(),
  delegateId: nullableText,
});

export { panelUrlSchema };

// A later change of the TypeScript type breaks the build until the schema follows.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const approvalViewMatches: Same<z.output<typeof approvalViewSchema>, ApprovalView> = true;
const sendResultMatches: Same<z.output<typeof sendResultKindSchema>, SendResultKind> = true;
const digestMinimalMatches: Same<z.output<typeof digestMinimalSchema>, DigestMinimalFacts> = true;
void digestMinimalMatches;
void approvalViewMatches;
void sendResultMatches;

const loopIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The facts of the `minimal` Telegram digest (`DigestMinimalFacts`): counts, flags and the clock, no mail text. Optional on read: a row
// queued before the field existed, and the mail row, have none; the minimal render then prints the fixed "ready" phrase.
const digestCount = z.number().int().min(0);
const digestMinimalSchema = z.strictObject({
  at: isoDate,
  scheduled: z.boolean(),
  late: z.boolean(),
  timeZone,
  action: z.strictObject({
    urgent: digestCount,
    needs_reply: digestCount,
    delegation: digestCount,
    unsure: digestCount,
  }),
  other: z.strictObject({ info: digestCount, notification: digestCount, spam: digestCount }),
  mailboxProblems: digestCount,
  openLoops: z.strictObject({ waiting: digestCount, promised: digestCount }).nullable(),
});

const digestView = z.strictObject({
  text: z.string().min(1).max(MESSAGE_MAX_CHARS),
  buttons: outButtonsSchema,
  // The loops that the brief lines of this digest name: ids only. They let the switch-off of Sent tracking and the
  // erase of a person find the stored copy of a loop line. Absent: no loop line.
  loopIds: z.array(z.string().regex(loopIdPattern)).max(40).optional(),
  // The line number of each loop or delegation that a brief line names: the tap on its buttons edits that line.
  // Numbers only, no text. Absent: no loop line.
  lineOf: z.record(z.string().regex(loopIdPattern), z.number().int().min(0).max(200)).optional(),
  minimal: digestMinimalSchema.optional(),
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
  // Optional on read: a view queued earlier has no field.
  suspicious: z.array(z.enum(suspiciousReasons)).optional(),
  // Optional on read, written only when the flag `attachment_line` is on and the mail has an attachment to show.
  attachments: attachmentFactSchema.optional(),
  // Optional on read, written only when the flag `why_lines` is on: the model confidence (null: no model mark)
  // and the sender rule that shaped the result.
  confidence: z.number().min(0).max(1).nullable().optional(),
  rule: z.enum(senderRuleKinds).nullable().optional(),
  // Optional on read, written (true) only when the Delegate button shows: the flag `delegate_button` is on, the
  // organization has an active delegate and the mailbox is in `assist` with drafts on. A view without it renders as before.
  delegable: z.literal(true).optional(),
  // Optional on read, written (true) only when the Draft reply button shows (see `ReplyDraftable` in the server): the reply drafts
  // are on for the mailbox, the owner's consent covers them, and the mail has no open reply draft.
  draftable: z.literal(true).optional(),
  now: isoDate,
  timeZone,
});

const authErrorView = z.strictObject({
  address: text,
  mailboxId: id,
  // Optional on read: a view queued earlier has no field. Set for an OAuth mailbox only.
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

// Optional on read: a row queued earlier has no field (it renders the password text). Set at queue time: the mailbox row is gone
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

// The numbers of one week (all mailboxes) and the count of replied mails that wait for a check.
const weeklyReportView = z.strictObject({
  week: weekStatsSchema,
  timeZone,
  answeredWaiting: z.number().int().min(0),
  // The rule suggestions that wait for the owner (flag `sender_suggestions`): a count and the link to the Rules page. Optional: a
  // row queued before this key, or with the flag off, has none.
  suggestions: z.strictObject({ open: z.number().int().min(0), panelUrl: panelUrlSchema.optional() }).optional(),
});

// The mail host guard refuses a host of the mailbox. The view holds the mailbox address only: no host name, no network address.
const hostBlockedView = z.strictObject({
  address: text,
  since: isoDate,
  now: isoDate,
  timeZone,
});

// The edit of a card that an owner got: the input of `renderNoticeEdit`. The sender edits the sent message
// and sends no new one. EXCEPTION to "a view holds no phrase of ours" (docs/code-patterns.md, Notices are facts): `original`
// is the stored text of the target card (`outbox.text`), as the edit after a tap uses it ("the edit after a tap keeps the
// stored text"), so it holds our own phrases and mail text, up to one message. It follows the retention of `outbox.text`.
// `heldBy` is only for `approved_held`; `actionId` (the send) gives that outcome the Reject button. `sendId` is the send that the
// card asks about: the `minimal` edit links to it in the panel when the card has no link (a card sent at `full`).
const approvalEditView = z.strictObject({
  original: z.string().min(1).max(MESSAGE_MAX_CHARS),
  outcome: z.enum(["approved", "approved_held", "rejected", "changed", "expired"]),
  at: isoDate,
  timeZone,
  heldBy: z.enum(["scope", "paused", "auth_error", "host_blocked"]).optional(),
  actionId: id.optional(),
  sendId: id.optional(),
});

// Mail of a VIP or whitelisted sender waits while the AI is paused. The sender address only: no
// subject, display name, body or summary. The text of the notice is a fixed phrase of ours.
const notTriagedView = z.strictObject({
  emailId: id,
  mailboxId: id,
  sender: text,
});

// The mailbox has shown no sent mail for a long time. The view holds the mailbox address and the start of the
// quiet period only: no subject, no recipient.
const sentMissingView = z.strictObject({
  address: text,
  since: isoDate,
  now: isoDate,
  timeZone,
});

// One line for an owner whose consent does not cover open-loop data: it replaces a follow-up card
// (`approval`) or a follow-up result (`result`). No recipient, no text, no id of a loop.
const loopConsentView = z.strictObject({
  about: z.enum(["approval", "result"]),
  panelUrl: panelUrlSchema.optional(),
});

// Reply drafts (the review stages replace these views). `replies_ready`: a count and the queue time.
// `reply_prompt` and `reply_result` name the mail only by id, as the outbox row does; `reason` is a lower-case code
// (a reply block reason or a request status), never a text.
// `review` is true for an owner whose Telegram consent covers reply data (the Review button); false: the count, the consent line
// and the panel link only. `panelUrl`: the approvals page, when `WEB_BASE_URL` is set and the flag `approvals_page` is on.
const repliesReadyView = z.strictObject({
  count: z.number().int().min(1),
  now: isoDate,
  timeZone,
  review: z.boolean(),
  panelUrl: panelUrlSchema.optional(),
});
const replyPromptView = z.strictObject({ emailId: id });
const replyResultView = z.strictObject({ emailId: id, reason: z.string().regex(/^[a-z_]{1,40}$/) });

// The history check of a mailbox is ready. Counts and category names only: no address, sender, subject or domain.
// `blocked`: the moving categories that the evidence does not support (a count; the Telegram text prints no number for it).
// `reportUrl`: `<WEB_BASE_URL>/report?mailbox=<id>`, null when `WEB_BASE_URL` is not set.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The link of a trust notice is the panel page and nothing else: http or https, no user info
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

// A category lost its `auto`. The category and a fixed reason only: no mail data. `corrections` is the count
// that the `corrections` reason prints. `settingsUrl`: `<WEB_BASE_URL>/settings`, null when `WEB_BASE_URL` is not set.
const autonomyPausedView = z.strictObject({
  mailboxId: z.string().regex(uuidPattern),
  category: z.enum(movingCategories),
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
  replies_ready: repliesReadyView,
  reply_prompt: replyPromptView,
  reply_result: replyResultView,
  trust_report_ready: trustReportReadyView,
  autonomy_paused: autonomyPausedView,
} satisfies Record<NoticeKind, z.ZodType>;

export type NoticeView<K extends NoticeKind> = z.output<(typeof noticeViewSchemas)[K]>;
