import { z } from "./zod";

// GET /api/loops and the POST routes of one loop (ADR 0023, `docs/capabilities/open-loops.md`). Every object is strict. The loop texts (`text`,
// `subject`, `counterpart`) are mail data: they never go to a log; they are null after the retention cleared them.
export const loopKinds = ["waiting", "promised", "delegated"] as const;
export type LoopKindName = (typeof loopKinds)[number];

export const loopFilters = ["open", "due", "closed"] as const;
export type LoopFilterName = (typeof loopFilters)[number];
export const LOOP_DEFAULT_FILTER: LoopFilterName = "open";
export const LOOP_PAGE_SIZE = 50;
export const LOOP_MAX_LIMIT = 100;

export const loopCloseReasons = [
  "replied",
  "replied_subject",
  "done",
  "dropped",
  "untracked",
  "stale",
  "later_reply",
  "expired",
  "sent_off",
] as const;

// The code of the reason line of a loop: the panel owns the words.
export const loopReasons = ["asked_no_answer", "promised", "forwarded_to_delegate"] as const;
export type LoopReason = (typeof loopReasons)[number];

// `kind` is required: the page has one list per kind. `before` is the `next` cursor of the last page.
export const loopListQuerySchema = z.object({
  kind: z.enum(loopKinds),
  filter: z.enum(loopFilters).optional(),
  before: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(LOOP_MAX_LIMIT).optional(),
});
export type LoopListQuery = z.infer<typeof loopListQuerySchema>;

export const loopItemSchema = z.strictObject({
  kind: z.enum(loopKinds),
  id: z.uuid(),
  status: z.enum(["open", "closed"]),
  closeReason: z.enum(loopCloseReasons).nullable(),
  counterpart: z.string().nullable(),
  // Only for `delegated`.
  delegate: z.strictObject({ id: z.uuid(), name: z.string() }).nullable(),
  // The ask or the promise; null after retention.
  text: z.string().nullable(),
  subject: z.string().nullable(),
  dueAt: z.iso.datetime(),
  dueSource: z.enum(["stated", "default"]),
  // When the wait began: the Sent time of the mail that opened the loop or last restarted the wait.
  sentAt: z.iso.datetime(),
  // Later taps left (3 at most in all).
  laterLeft: z.number().int().min(0).max(3),
  followUpsSent: z.number().int().min(0).max(2),
  // A follow-up send of this loop waits for a tap or is on its way out.
  followUpWaiting: z.boolean(),
  // The waiting send that the page links to `/approvals?id=`, else null.
  sendId: z.uuid().nullable(),
  // The loop closed because of a reply with the same subject in another thread.
  matchedBySubject: z.boolean(),
  // Only an auto-reply came so far: the loop stays open.
  autoReplyOnly: z.boolean(),
  reason: z.enum(loopReasons),
});
export type LoopItem = z.infer<typeof loopItemSchema>;

export const loopListSchema = z.strictObject({
  items: z.array(loopItemSchema).max(LOOP_MAX_LIMIT),
  next: z.string().nullable(),
});
export type LoopList = z.infer<typeof loopListSchema>;

// The body of every POST route of a loop is empty (`{}`); a strict object refuses any field.
export const loopActionBodySchema = z.strictObject({});

// The follow-up planned a draft and a send that waits for a tap, or (shadow mode) only said it would.
export const loopFollowUpAnswerSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("planned"), sendId: z.uuid() }),
  z.strictObject({ status: z.literal("would_draft") }),
]);
export type LoopFollowUpAnswer = z.infer<typeof loopFollowUpAnswerSchema>;
export const loopLaterAnswerSchema = z.strictObject({ status: z.literal("ok"), dueAt: z.iso.datetime() });
export type LoopLaterAnswer = z.infer<typeof loopLaterAnswerSchema>;
export const loopOkAnswerSchema = z.strictObject({ status: z.literal("ok") });
export type LoopOkAnswer = z.infer<typeof loopOkAnswerSchema>;

// POST /api/emails/:id/delegate (flag `delegate_button`).
export const delegateMailBodySchema = z.strictObject({ delegateId: z.uuid() });
export type DelegateMailBody = z.infer<typeof delegateMailBodySchema>;
export const delegateMailAnswerSchema = z.strictObject({ sendId: z.uuid(), delegationId: z.uuid() });
export type DelegateMailAnswer = z.infer<typeof delegateMailAnswerSchema>;

// PATCH /api/settings/:mailboxId/loop-wait. The wait in working days before a waiting loop is due; the limits are the CHECK of the column.
export const LOOP_WAIT_MIN = 1;
export const LOOP_WAIT_MAX = 10;
export const loopWaitBodySchema = z.strictObject({ days: z.number().int().min(LOOP_WAIT_MIN).max(LOOP_WAIT_MAX) });
export type LoopWaitBody = z.infer<typeof loopWaitBodySchema>;
