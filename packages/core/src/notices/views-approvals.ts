import { z } from "zod";

import { CHASER_SET_LIMIT } from "../digest/approvals";
import { approvalViewSchema } from "../outgoing/view-schema";

import { draftKind, id, isoDate, nullableText, text, timeZone } from "./view-fields";

export const sendResultKindSchema = z.discriminatedUnion("kind", [
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
    cause: z.enum(["tries", "content_soft", "soft_cap", "compose", "bad_payload", "copy_check", "has_gaps"]),
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
      "draft_changed",
      "answered",
      "sent_by_user",
      "newer_mail",
      "original_moved",
      "suspicious",
    ]),
    draftRemoved: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("rejected"), byName: nullableText, draftRemoved: z.boolean() }),
]);

export const approvalNoticeView = z.strictObject({
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

export const approvalSetView = z.strictObject({
  setId: id,
  items: z.array(approvalSetItem).min(1).max(CHASER_SET_LIMIT),
  timeZone,
});

export const sendResultView = z.strictObject({
  actionId: id,
  sendKind: draftKind,
  result: sendResultKindSchema,
  recipient: z.strictObject({ name: nullableText, address: nullableText }),
  subject: text,
  synthetic: z.boolean(),
  // Optional: rows queued before the flag existed (and those with the flag off) have none.
  mistakeButton: z.boolean().optional(),
});

export const delegationAnsweredView = z.strictObject({
  delegationId: id,
  delegateName: text,
  subject: nullableText,
  receivedAt: isoDate,
  now: isoDate,
  timeZone,
  synthetic: z.boolean(),
});
