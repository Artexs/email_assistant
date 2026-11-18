import { draftKinds } from "../triage/payloads";
import { z } from "../web/zod";

// The strict shape of the approval view (ADR 0032 point 5). The notice views (`notices/views.ts`) and the panel read API
// (`web/approvals.ts`) parse with it, so the card and the page cannot differ in shape.
// The link to the panel page of a send: a text line on the approval card. One line, http or https, no space.
export const panelUrlSchema = z
  .string()
  .max(300)
  .regex(/^https?:\/\/\S+$/);

export const approvalViewSchema = z.strictObject({
  kind: z.enum(draftKinds),
  recipient: z.strictObject({ name: z.string().nullable(), address: z.string() }),
  sender: z.strictObject({ label: z.string(), external: z.boolean() }).nullable(),
  recipientInactive: z.boolean(),
  subject: z.string(),
  dueDate: z.string().nullable(),
  body: z.string(),
  quote: z.strictObject({ text: z.string(), cut: z.boolean() }).nullable(),
  synthetic: z.boolean(),
  // A follow-up, and a reply with a Cc: every address of To and Cc (the card and the panel spell them out; `recipient` is the first To) and its
  // number. Optional: the other kinds and the views queued before open loops have none.
  to: z.array(z.string()).min(1).max(10).optional(),
  cc: z.array(z.string()).max(10).optional(),
  followUpNumber: z.union([z.literal(1), z.literal(2)]).optional(),
  version: z.number().int().min(1).optional(),
  panelUrl: panelUrlSchema.optional(),
  copyCheck: z.literal(true).optional(),
  sentVisible: z.literal(false).optional(),
  // A reply only: the labels of the gaps `[[…]]` that nobody filled (the card shows them first and has no Send button),
  // and the Reply-To addresses of the original when they differ from its From address. Optional: the other kinds and old views have none.
  gaps: z.array(z.string().max(80)).max(20).optional(),
  replyTo: z.array(z.string().max(320)).min(1).max(5).optional(),
  // A reply only: the buttons that change the recipients show. `canReplyAll`: the mail has other recipients (1 to 10) and the draft
  // does not go to them yet. `canUseReplyTo`: the mail has a Reply-To address that is not the sender and the draft does not go to it.
  canReplyAll: z.literal(true).optional(),
  canUseReplyTo: z.literal(true).optional(),
});
