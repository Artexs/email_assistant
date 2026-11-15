import type { HeldBy } from "../digest/approvals";
import { approvalViewSchema } from "../outgoing/view-schema";
import { draftKinds } from "../triage/payloads";

import { z } from "./zod";

// GET /api/approvals and GET /api/approvals/:id (F102 ticket). Every object is strict: the page gets exactly these facts.
// The mail text goes out only in `view` (the card view: the body of the draft and the quote cut at 1500 characters) and in
// `quote` (the full quote, up to 8000 characters, that the committer would send).

export const APPROVAL_LIST_MAX = 100;
// The quote holds at most 8000 characters of the mail (QUOTE_MAX_CHARS) plus a header and a `> ` before each line:
// 3 characters of the answer for each character of the mail, and the header, is a bound that no mail passes.
export const APPROVAL_QUOTE_MAX = 30_000;

export const heldBys = ["scope", "paused", "auth_error", "host_blocked"] as const;
export const heldBySchema = z.enum(heldBys);
// A later change of `HeldBy` breaks the build until the list follows.
const heldByMatches: [HeldBy] extends [(typeof heldBys)[number]]
  ? [(typeof heldBys)[number]] extends [HeldBy]
    ? true
    : false
  : false = true;
void heldByMatches;

export { approvalViewSchema };
// The limits and the cleaning of the edit: the form uses the same rule as the service (a pure module, safe for the browser).
export { cleanUserText, EDIT_BODY_MAX, EDIT_SUBJECT_MAX } from "../outgoing/user-text";

export const approvalListStates = ["waiting", "held"] as const;
export const approvalDetailStates = [
  "waiting",
  "held",
  "sending",
  "sent",
  "rejected",
  "expired",
  "failed",
  "superseded",
] as const;

const itemFields = {
  id: z.uuid(),
  mailboxAddress: z.string(),
  createdAt: z.iso.datetime(),
  delegationId: z.uuid().nullable(),
  setId: z.uuid().nullable(),
};

export const approvalItemSchema = z.strictObject({
  ...itemFields,
  version: z.number().int().min(1),
  state: z.enum(approvalListStates),
  draftReady: z.boolean(),
  kind: z.enum(draftKinds),
  expiresAt: z.iso.datetime(),
  heldBy: heldBySchema.nullable(),
  view: approvalViewSchema,
});
export type ApprovalItem = z.infer<typeof approvalItemSchema>;

export const approvalListSchema = z.strictObject({ items: z.array(approvalItemSchema).max(APPROVAL_LIST_MAX) });
export type ApprovalList = z.infer<typeof approvalListSchema>;

export const approvalDelegateSchema = z.strictObject({ id: z.uuid(), name: z.string(), email: z.string() });
export type ApprovalDelegate = z.infer<typeof approvalDelegateSchema>;

// The detail of any send. `view`, `kind` and `version` are null when retention cleared the payload of the send or of its
// draft. `expiresAt` is set for `waiting` and `held` only.
export const approvalDetailSchema = z.strictObject({
  ...itemFields,
  version: z.number().int().min(1).nullable(),
  state: z.enum(approvalDetailStates),
  draftReady: z.boolean(),
  kind: z.enum(draftKinds).nullable(),
  expiresAt: z.iso.datetime().nullable(),
  heldBy: heldBySchema.nullable(),
  view: approvalViewSchema.nullable(),
  draftRemovable: z.boolean(), // the mailbox has UIDPLUS: an edit or a reject removes the old Drafts copy
  currentId: z.uuid().nullable(), // the newest version, only for `superseded`
  quote: z.string().max(APPROVAL_QUOTE_MAX).nullable(),
  delegates: z.array(approvalDelegateSchema),
});
export type ApprovalDetail = z.infer<typeof approvalDetailSchema>;

// POST /api/approvals/:id/approve, /reject and /edit (F102 ticket). The body of approve and reject is `{}`. The raw limits of the
// edit are wider than the limits of the service (subject 1–200, body 1–3000 characters after cleaning): cleaning removes characters,
// so the service decides the real limit and answers 400 `validation`.
export const APPROVAL_EDIT_SUBJECT_RAW_MAX = 400;
export const APPROVAL_EDIT_BODY_RAW_MAX = 6000;

export const approvalDecisionBodySchema = z.strictObject({});

export const approvalEditBodySchema = z.strictObject({
  subject: z.string().max(APPROVAL_EDIT_SUBJECT_RAW_MAX),
  body: z.string().max(APPROVAL_EDIT_BODY_RAW_MAX),
  delegateId: z.uuid().optional(),
});
export type ApprovalEditBody = z.infer<typeof approvalEditBodySchema>;

// `approved_held`: the send is approved but the committer does not take it now; `heldBy` names the cause.
export const approvalApproveAnswerSchema = z.strictObject({
  status: z.enum(["approved", "approved_held"]),
  heldBy: heldBySchema.optional(),
});
export type ApprovalApproveAnswer = z.infer<typeof approvalApproveAnswerSchema>;

export const approvalRejectAnswerSchema = z.strictObject({ status: z.literal("rejected") });
export type ApprovalRejectAnswer = z.infer<typeof approvalRejectAnswerSchema>;

export const approvalEditAnswerSchema = z.strictObject({ id: z.uuid(), version: z.number().int().min(2) });
export type ApprovalEditAnswer = z.infer<typeof approvalEditAnswerSchema>;

// The 409 body of the write routes: `changed` names the newest version, `closed` names the state of the send.
// `state` of a `closed` answer is one of the names of `approvalDetailStates` (the detail route names the same send the same way), plus
// the three codes that only the edit has. A closed send is never `waiting` (it can be decided) or `superseded` (that is `changed`).
export const approvalClosedStates = ["held", "sending", "sent", "rejected", "expired", "failed"] as const;
export type ApprovalClosedState = (typeof approvalClosedStates)[number];
export const approvalEditClosedCodes = ["payload_gone", "draft_gone", "delegation_closed"] as const;
export type ApprovalEditClosedCode = (typeof approvalEditClosedCodes)[number];
const closedStatesAreDetailStates: [(typeof approvalClosedStates)[number]] extends [
  (typeof approvalDetailStates)[number],
]
  ? true
  : false = true;
void closedStatesAreDetailStates;

export const approvalConflictCodes = ["changed", "closed", "draft_not_ready", "drafts_off"] as const;
export const approvalConflictSchema = z.strictObject({
  error: z.enum(approvalConflictCodes),
  currentId: z.uuid().optional(),
  state: z.enum([...approvalClosedStates, ...approvalEditClosedCodes]).optional(),
});
export type ApprovalConflict = z.infer<typeof approvalConflictSchema>;
