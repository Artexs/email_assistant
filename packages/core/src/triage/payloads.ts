import { z } from "zod";

import { EDIT_BODY_MAX, EDIT_SUBJECT_MAX } from "../outgoing/user-text";

import { CLARIFICATION_MAX_CHARS, TASK_MAX_CHARS } from "./analysis";

// One strict rule for every recipient in a payload: no space, comma, angle bracket, quote or line break, and no control,
// zero-width or bidi character. The approval card spells a recipient out and the owner decides on it: the address that is shown
// must be the address that is sent, so no character that a renderer would hide or reorder is allowed.
const HIDDEN =
  "\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u034f\\u061c\\u115f-\\u1160\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2069\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\u{e0000}-\\u{e007f}";
// eslint-disable-next-line no-misleading-character-class -- the class lists the invisible characters on purpose
export const ADDRESS_PATTERN = new RegExp(`^[^\\s@<>,;"'\\r\\n${HIDDEN}]+@[^\\s@<>,;"'\\r\\n${HIDDEN}]+$`, "u");
export const addressSchema = z.string().regex(ADDRESS_PATTERN);
export const draftLanguageSchema = z.enum(["pl", "en"]);

// The kinds of a draft and of its send: one list for the schemas, the templates and every reader.
export const draftKinds = ["delegation", "clarification", "reminder", "follow_up", "reply"] as const;
export type DraftKind = (typeof draftKinds)[number];

const recipientSchema = z.array(addressSchema).length(1);
// A follow-up goes to the To and Cc of the loop (open loops feature): 1 to 10 recipients together.
export const FOLLOW_UP_RECIPIENTS_MAX = 10;
// A reply goes to the sender (To, one address) and, after "Reply all", to at most 10 more recipients (Cc).
export const REPLY_CC_MAX = 10;
export const replyRecipientModes = ["from", "reply_to", "all"] as const;
// A real calendar date `YYYY-MM-DD`, or "" for none: `2026-02-30` and `2026-13-01` are refused.
export const dueDateSchema = z.union([z.literal(""), z.iso.date()]);

// The due date of a draft, or "" when the value is no valid due date (a model value or a stored payload that the schema refuses).
export function dueDateOrNone(value: unknown): string {
  const parsed = dueDateSchema.safeParse(value);
  return parsed.success ? parsed.data : "";
}

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
  // A reply draft: the text is `body_text ?? body`. The recipients are never LLM text: the writer sets
  // `to` and `cc` from the stored headers of the mail (`replyRecipientsProblem` checks the rest).
  z.object({
    kind: z.literal("reply"),
    to: recipientSchema,
    cc: z.array(addressSchema).max(REPLY_CC_MAX),
    language: draftLanguageSchema,
    body: z.string().min(1).max(EDIT_BODY_MAX),
    request_id: z.string().uuid(),
    // The folder of the mail when the draft was asked for. A later move of the mail closes the draft.
    folder: z.string().min(1).max(500),
    recipients: z.enum(replyRecipientModes),
    ...editFields,
  }),
]);
export type DraftPayload = z.infer<typeof draftPayloadSchema>;

export function draftVersion(draft: DraftPayload): number {
  return "version" in draft && draft.version !== undefined ? draft.version : 1;
}

export const sendPayloadSchema = z
  .object({
    kind: z.enum(draftKinds),
    to: z.array(addressSchema).min(1).max(FOLLOW_UP_RECIPIENTS_MAX),
    cc: z.array(addressSchema).max(REPLY_CC_MAX).optional(),
    loop_id: z.string().uuid().optional(),
    delegate_id: z.string().uuid().optional(),
    delegation_id: z.string().uuid().optional(),
    reminder: z.union([z.literal(1), z.literal(2)]).optional(),
    set_id: z.string().uuid().optional(),
  })
  // Only a follow-up has more than one To, and only a follow-up or a reply has a Cc (the other kinds write one address).
  .refine((send) => send.kind === "follow_up" || send.to.length === 1)
  .refine((send) => send.cc === undefined || send.kind === "follow_up" || send.kind === "reply")
  // The loop row holds at most 9 Cc; a reply 0 to 10 (the rule of its draft).
  .refine((send) => send.kind !== "follow_up" || (send.cc?.length ?? 0) <= FOLLOW_UP_RECIPIENTS_MAX - 1)
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

// The same addresses, in any order and letter case, each once (a set compare).
export function sameAddresses(a: readonly string[], b: readonly string[]): boolean {
  const keys = (list: readonly string[]) =>
    [...new Set(list.map((address) => address.toLowerCase()))].sort().join("\n");
  return keys(a) === keys(b);
}

// The key of an address for the own-mailbox rule: lower case, and no `+tag` in the local part (`me+x@box` is a way to reach `me@box`).
// Only the own-mailbox rule uses it: another person's `+tag` address stays a different address.
export function ownAddressKey(address: string): string {
  const key = address.trim().toLowerCase();
  const at = key.lastIndexOf("@");
  if (at < 1) return key;
  const local = key.slice(0, at);
  const plus = local.indexOf("+");
  return `${plus < 1 ? local : local.slice(0, plus)}${key.slice(at)}`;
}

// The bare address of one stored address entry: the entry itself, or the part in `<…>` of `Name <address>` (the stored To, Cc and
// Reply-To lists may hold the display name). null: the entry holds no address that a payload accepts (`addressSchema`). It never
// reads the display name, so a name that looks like an address changes nothing.
export function bareAddress(entry: string): string | null {
  const text = entry.trim();
  const angle = /^[^<>]*<([^<>]+)>$/u.exec(text);
  const candidate = (angle?.[1] ?? text).trim();
  return addressSchema.safeParse(candidate).success ? candidate : null;
}

export type ReplyRecipientsProblem = "cc_is_to" | "cc_duplicate" | "cc_own_mailbox";

// The rules of the recipients of a reply that a schema cannot check (the writer calls it): no Cc equal to To, no
// address twice in Cc, and no own mailbox in Cc (a `+tag` variant of an own mailbox is an own mailbox: `ownAddressKey`). `ownAddresses` are
// the mailboxes of the organization. Lower-case compare.
export function replyRecipientsProblem(
  recipients: { to: readonly string[]; cc: readonly string[] },
  ownAddresses: readonly string[]
): ReplyRecipientsProblem | null {
  const own = new Set(ownAddresses.map(ownAddressKey));
  const to = recipients.to.map((address) => address.toLowerCase());
  const seen = new Set<string>();
  for (const value of recipients.cc) {
    const address = value.toLowerCase();
    if (to.includes(address)) return "cc_is_to";
    if (seen.has(address)) return "cc_duplicate";
    if (own.has(ownAddressKey(value))) return "cc_own_mailbox";
    seen.add(address);
  }
  return null;
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
