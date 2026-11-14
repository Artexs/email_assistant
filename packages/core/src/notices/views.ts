import { z } from "zod";

import { CHASER_SET_LIMIT, type SendResultKind } from "../digest/approvals";
import { MESSAGE_MAX_CHARS, outButtonsSchema } from "../digest/message";
import type { ApprovalView } from "../outgoing/sender";
import { sendLimitKinds } from "../send-limits";
import { draftKinds } from "../triage/payloads";
import { actionTypes, moveTargets } from "../triage/planners";

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

const approvalViewSchema = z.strictObject({
  kind: draftKind,
  recipient: z.strictObject({ name: nullableText, address: text }),
  sender: z.strictObject({ label: text, external: z.boolean() }).nullable(),
  recipientInactive: z.boolean(),
  subject: text,
  dueDate: nullableText,
  body: text,
  quote: z.strictObject({ text, cut: z.boolean() }).nullable(),
  synthetic: z.boolean(),
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
} satisfies Record<NoticeKind, z.ZodType>;

export type NoticeView<K extends NoticeKind> = z.output<(typeof noticeViewSchemas)[K]>;
