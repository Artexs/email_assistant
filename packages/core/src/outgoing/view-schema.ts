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
  version: z.number().int().min(1).optional(),
  panelUrl: panelUrlSchema.optional(),
});
