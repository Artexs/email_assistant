import { z } from "zod";

import { CLARIFICATION_MAX_CHARS, TASK_MAX_CHARS } from "./analysis";

// One strict rule for every recipient in a payload (D2): no space, comma, angle bracket, quote or line break.
export const ADDRESS_PATTERN = /^[^\s@<>,;"'\r\n]+@[^\s@<>,;"'\r\n]+$/;
export const addressSchema = z.string().regex(ADDRESS_PATTERN);
export const draftLanguageSchema = z.enum(["pl", "en"]);

const recipientSchema = z.array(addressSchema).length(1);
// `YYYY-MM-DD` or "" for none. The regex checks the shape only.
const dueDateSchema = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/);

export const draftPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("delegation"),
    delegate_id: z.string().uuid(),
    delegate_name: z.string().min(1),
    to: recipientSchema,
    task: z.string().min(1).max(TASK_MAX_CHARS),
    due_date: dueDateSchema,
    language: draftLanguageSchema,
  }),
  z.object({
    kind: z.literal("clarification"),
    to: recipientSchema,
    question: z.string().min(1).max(CLARIFICATION_MAX_CHARS),
    language: draftLanguageSchema,
  }),
  z.object({
    kind: z.literal("reminder"),
    delegate_id: z.string().uuid(),
    delegate_name: z.string().min(1),
    to: recipientSchema,
    task: z.string().min(1).max(TASK_MAX_CHARS),
    due_date: dueDateSchema,
    language: draftLanguageSchema,
    delegation_id: z.string().uuid(),
    reminder: z.union([z.literal(1), z.literal(2)]),
    thread: z.object({ in_reply_to: z.string().nullable(), references: z.array(z.string()) }),
  }),
]);
export type DraftPayload = z.infer<typeof draftPayloadSchema>;

export const sendPayloadSchema = z.object({
  kind: z.enum(["delegation", "clarification", "reminder"]),
  to: recipientSchema,
  delegate_id: z.string().uuid().optional(),
  delegation_id: z.string().uuid().optional(),
  reminder: z.union([z.literal(1), z.literal(2)]).optional(),
  set_id: z.string().uuid().optional(),
});
export type SendPayload = z.infer<typeof sendPayloadSchema>;

// The send repeats the fields of its draft that name the delegation; keys with no value stay out.
export function sendPayloadFor(draft: DraftPayload): SendPayload {
  const send: SendPayload = { kind: draft.kind, to: draft.to };
  if ("delegate_id" in draft) send.delegate_id = draft.delegate_id;
  if ("delegation_id" in draft) send.delegation_id = draft.delegation_id;
  if ("reminder" in draft) send.reminder = draft.reminder;
  return send;
}
