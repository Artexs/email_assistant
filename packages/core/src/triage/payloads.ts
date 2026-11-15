import { z } from "zod";

import { EDIT_BODY_MAX, EDIT_SUBJECT_MAX } from "../outgoing/user-text";

import { CLARIFICATION_MAX_CHARS, TASK_MAX_CHARS } from "./analysis";

// One strict rule for every recipient in a payload (D2): no space, comma, angle bracket, quote or line break.
export const ADDRESS_PATTERN = /^[^\s@<>,;"'\r\n]+@[^\s@<>,;"'\r\n]+$/;
export const addressSchema = z.string().regex(ADDRESS_PATTERN);
export const draftLanguageSchema = z.enum(["pl", "en"]);

// The kinds of a draft and of its send: one list for the schemas, the templates and every reader.
export const draftKinds = ["delegation", "clarification", "reminder"] as const;
export type DraftKind = (typeof draftKinds)[number];

const recipientSchema = z.array(addressSchema).length(1);
// `YYYY-MM-DD` or "" for none. The regex checks the shape only.
const dueDateSchema = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/);

// LLM text in a draft holds no address, no link and no long number (the marking removes them; this proves it).
export function textIsClean(text: string): boolean {
  return !/@|http|www\./i.test(text) && !/\d{9,}/.test(text.replace(/[ -]/g, ""));
}

// A panel edit stores the user's own text and a version number. An old payload has none of them (version 1).
const editFields = {
  version: z.number().int().min(1).optional(),
  subject_text: z.string().min(1).max(EDIT_SUBJECT_MAX).optional(),
  body_text: z.string().min(1).max(EDIT_BODY_MAX).optional(),
};

export const draftPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("delegation"),
    delegate_id: z.string().uuid(),
    delegate_name: z.string().min(1),
    to: recipientSchema,
    task: z.string().min(1).max(TASK_MAX_CHARS),
    due_date: dueDateSchema,
    language: draftLanguageSchema,
    ...editFields,
  }),
  z.object({
    kind: z.literal("clarification"),
    to: recipientSchema,
    question: z.string().min(1).max(CLARIFICATION_MAX_CHARS),
    language: draftLanguageSchema,
    ...editFields,
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

export function draftVersion(draft: DraftPayload): number {
  return "version" in draft && draft.version !== undefined ? draft.version : 1;
}

export const sendPayloadSchema = z.object({
  kind: z.enum(draftKinds),
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
