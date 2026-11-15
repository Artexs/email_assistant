import { z } from "zod";

import { EDIT_BODY_MAX, EDIT_SUBJECT_MAX } from "../outgoing/user-text";

import { CLARIFICATION_MAX_CHARS, TASK_MAX_CHARS } from "./analysis";

// One strict rule for every recipient in a payload (D2): no space, comma, angle bracket, quote or line break, and no control,
// zero-width or bidi character. The approval card spells a recipient out and the owner decides on it: the address that is shown
// must be the address that is sent, so no character that a renderer would hide or reorder is allowed.
const HIDDEN =
  "\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u034f\\u061c\\u115f-\\u1160\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2069\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\u{e0000}-\\u{e007f}";
export const ADDRESS_PATTERN = new RegExp(`^[^\\s@<>,;"'\\r\\n${HIDDEN}]+@[^\\s@<>,;"'\\r\\n${HIDDEN}]+$`, "u");
export const addressSchema = z.string().regex(ADDRESS_PATTERN);
export const draftLanguageSchema = z.enum(["pl", "en"]);

// The kinds of a draft and of its send: one list for the schemas, the templates and every reader.
export const draftKinds = ["delegation", "clarification", "reminder", "follow_up"] as const;
export type DraftKind = (typeof draftKinds)[number];

const recipientSchema = z.array(addressSchema).length(1);
// A follow-up goes to the To and Cc of the loop (open loops feature): 1 to 10 recipients together.
export const FOLLOW_UP_RECIPIENTS_MAX = 10;
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
  z
    .object({
      kind: z.literal("follow_up"),
      loop_id: z.string().uuid(),
      to: z.array(addressSchema).min(1).max(FOLLOW_UP_RECIPIENTS_MAX),
      cc: z.array(addressSchema).max(FOLLOW_UP_RECIPIENTS_MAX - 1),
      language: draftLanguageSchema,
      // ISO instant of the own mail that the follow-up is about.
      sent_at: z.iso.datetime(),
      subject: z.string().max(300),
      // The own sent text, or null when it is gone (retention): no quote block then.
      quote: z.string().nullable(),
      n: z.union([z.literal(1), z.literal(2)]),
      ...editFields,
    })
    // To and Cc together are at most 10 (the loop row holds them that way).
    .refine((draft) => draft.to.length + draft.cc.length <= FOLLOW_UP_RECIPIENTS_MAX),
]);
export type DraftPayload = z.infer<typeof draftPayloadSchema>;

export function draftVersion(draft: DraftPayload): number {
  return "version" in draft && draft.version !== undefined ? draft.version : 1;
}

export const sendPayloadSchema = z
  .object({
    kind: z.enum(draftKinds),
    to: z.array(addressSchema).min(1).max(FOLLOW_UP_RECIPIENTS_MAX),
    cc: z
      .array(addressSchema)
      .max(FOLLOW_UP_RECIPIENTS_MAX - 1)
      .optional(),
    loop_id: z.string().uuid().optional(),
    delegate_id: z.string().uuid().optional(),
    delegation_id: z.string().uuid().optional(),
    reminder: z.union([z.literal(1), z.literal(2)]).optional(),
    set_id: z.string().uuid().optional(),
  })
  // Only a follow-up has more than one recipient or a Cc (the other kinds write one address).
  .refine((send) => send.kind === "follow_up" || (send.to.length === 1 && send.cc === undefined))
  .refine((send) => send.kind !== "follow_up" || send.loop_id !== undefined)
  // A follow-up is one card: it never joins an approval set (a "Send all" tap must not approve it).
  .refine((send) => send.kind !== "follow_up" || send.set_id === undefined);
export type SendPayload = z.infer<typeof sendPayloadSchema>;

// The send repeats the fields of its draft that name the delegation; keys with no value stay out.
export function sendPayloadFor(draft: DraftPayload): SendPayload {
  const send: SendPayload = { kind: draft.kind, to: draft.to };
  if ("cc" in draft) send.cc = draft.cc;
  if ("loop_id" in draft) send.loop_id = draft.loop_id;
  if ("delegate_id" in draft) send.delegate_id = draft.delegate_id;
  if ("delegation_id" in draft) send.delegation_id = draft.delegation_id;
  if ("reminder" in draft) send.reminder = draft.reminder;
  return send;
}

// Everyone who gets the mail: To, then Cc, each address once (lower-case compare). The envelope, the send limits and the
// `SEND_SCOPE self` filter use this list.
export function sendRecipients(payload: { to: readonly string[]; cc?: readonly string[] | undefined }): string[] {
  const seen = new Set<string>();
  const all: string[] = [];
  for (const address of [...payload.to, ...(payload.cc ?? [])]) {
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(address);
  }
  return all;
}
