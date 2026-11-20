import { cleanUserText } from "../outgoing/user-text";
import { REPLY_BLOCK_REASONS } from "../replies/eligibility";
import { MINUTE_MS } from "../time";
import { replyRecipientModes } from "../triage/payloads";

import { approvalEditAnswerSchema, approvalEditClosedCodes, approvalClosedStates } from "./approvals";
import { z } from "./zod";

// The reply routes of the panel: `POST /api/replies`, `POST /api/approvals/:id/redraft`, `POST /api/approvals/:id/recipients` and
// `GET /api/replies/requests/:id`. Every object is strict. The instruction is the user's own line: it goes to the model as data and
// no answer of any route repeats it.

// The instruction of a user is one line of 1 to 300 characters after cleaning. The raw limit is wider (cleaning removes
// characters); the service decides the real limit and answers 400 `validation`. A text over the raw limit never reaches the service.
export const REPLY_INSTRUCTION_RAW_MAX = 1000;
// The instruction of a user is one line of 1 to 300 characters after cleaning (the column holds 300). The panel counts with the same rule
// as the service, so the button turns on only for a line that the service accepts.
export const REPLY_INSTRUCTION_MAX = 300;

// The text of a user, cleaned: control and direction characters gone, one line. null: empty or too long. It is data for the model and is
// never a recipient, a folder or a command.
export function cleanReplyInstruction(text: string): string | null {
  const clean = cleanUserText(text, { oneLine: true });
  const length = Array.from(clean).length;
  return length < 1 || length > REPLY_INSTRUCTION_MAX ? null : clean;
}

// The panel polls the request every 2 seconds for at most one minute.
export const REPLY_POLL_INTERVAL_MS = 2000;
export const REPLY_POLL_MAX_MS = MINUTE_MS;

// POST /api/replies. A missing instruction asks for a plain draft.
export const replyRequestBodySchema = z.strictObject({
  emailId: z.uuid(),
  instruction: z.string().max(REPLY_INSTRUCTION_RAW_MAX).optional(),
});
export type ReplyRequestBody = z.infer<typeof replyRequestBodySchema>;

// POST /api/approvals/:id/redraft. The line is required.
export const replyRedraftBodySchema = z.strictObject({
  instruction: z.string().max(REPLY_INSTRUCTION_RAW_MAX),
});
export type ReplyRedraftBody = z.infer<typeof replyRedraftBodySchema>;

// POST /api/approvals/:id/recipients. `from`: the sender only; `reply_to`: the first Reply-To address that is another address;
// `all`: the sender in To, the other recipients of the mail in Cc (at most 10). `all` never uses the Reply-To of the mail.
export const replyRecipientsBodySchema = z.strictObject({ mode: z.enum(replyRecipientModes) });
export type ReplyRecipientsBody = z.infer<typeof replyRecipientsBodySchema>;

// 202: the request waits for the drafter (poll `GET /api/replies/requests/:id`).
export const replyQueuedAnswerSchema = z.strictObject({ requestId: z.uuid() });
export type ReplyQueuedAnswer = z.infer<typeof replyQueuedAnswerSchema>;
// 200 of `POST /api/replies`: a draft of this mail is open or on its way out.
export const replyOpenAnswerSchema = z.strictObject({ sendId: z.uuid() });
export type ReplyOpenAnswer = z.infer<typeof replyOpenAnswerSchema>;
// 200 of `POST /api/approvals/:id/recipients`: the new version.
export const replyRecipientsAnswerSchema = approvalEditAnswerSchema;
export type ReplyRecipientsAnswer = z.infer<typeof replyRecipientsAnswerSchema>;

// The 409 reasons of a blocked request: the rules of `replyEligibility` and the gates of the mailbox.
export const replyBlockReasons = [...REPLY_BLOCK_REASONS, "policy_changed"] as const;
export const replyConflictCodes = ["blocked", "changed", "closed", "redraft_limit", "drafts_off"] as const;
export const replyConflictSchema = z.strictObject({
  error: z.enum(replyConflictCodes),
  reason: z.enum(replyBlockReasons).optional(),
  currentId: z.uuid().optional(),
  state: z.enum([...approvalClosedStates, ...approvalEditClosedCodes]).optional(),
});
export type ReplyConflict = z.infer<typeof replyConflictSchema>;

// 400 codes of the recipients route besides `validation`.
export const replyRecipientsRefusals = [
  "too_many_recipients",
  "no_reply_to",
  "no_others",
  "bad_recipient",
  "unchanged",
  "not_editable",
] as const;

// GET /api/replies/requests/:id. `sendId`: for `done` the new version; for `superseded` the draft of the thread that waits now;
// else null. `reasonCode` is a code, never text.
export const replyRequestStatuses = [
  "pending",
  "drafting",
  "done",
  "no_draft",
  "failed",
  "cancelled",
  "superseded",
] as const;
export const replyRequestStatusSchema = z.strictObject({
  status: z.enum(replyRequestStatuses),
  reasonCode: z.string().max(60).nullable(),
  sendId: z.uuid().nullable(),
});
export type ReplyRequestStatus = z.infer<typeof replyRequestStatusSchema>;

// Sample drafts (`POST` and `GET /api/mailboxes/:id/reply-samples`): up to three drafts of recent real mail that the owner reads and that are
// never saved in Drafts and never sent. Owner only.
export const REPLY_SAMPLE_COUNT = 3;

// 202 of the POST. `requestIds` has `count` entries: fewer than three when fewer mails qualify (0: none qualifies and no run is used up).
export const replySamplesQueuedSchema = z.strictObject({
  requestIds: z.array(z.uuid()).max(REPLY_SAMPLE_COUNT),
  count: z.number().int().min(0).max(REPLY_SAMPLE_COUNT),
});
export type ReplySamplesQueued = z.infer<typeof replySamplesQueuedSchema>;

// 409 of the POST: `sample_limit` (one run for each mailbox and quota day), `blocked` with the reason (`oauth_mailbox`) or `llm_off` (no
// model client runs on this server).
export const replySamplesConflictSchema = z.strictObject({
  error: z.enum(["blocked", "sample_limit", "llm_off"]),
  reason: z.enum(replyBlockReasons).optional(),
});
export type ReplySamplesConflict = z.infer<typeof replySamplesConflictSchema>;

// GET: the requests of the newest run of the mailbox today, oldest first. `body` is the sample text of a `done` request, else null (also
// after retention). `subject` is the subject of the mail that the sample answers. The panel polls until no item is `pending` or `drafting`.
export const replySampleItemSchema = z.strictObject({
  requestId: z.uuid(),
  status: z.enum(replyRequestStatuses),
  reasonCode: z.string().max(60).nullable(),
  subject: z.string().nullable(),
  body: z.string().nullable(),
});
export const replySamplesViewSchema = z.strictObject({
  items: z.array(replySampleItemSchema).max(REPLY_SAMPLE_COUNT),
});
export type ReplySamplesView = z.infer<typeof replySamplesViewSchema>;
