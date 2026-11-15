import { z } from "zod";

import { localDateTime } from "../digest/local-time";
import { cleanUserText } from "../outgoing/user-text";

import { dueRefSchema } from "./dates";

// The extractor core of the open loops: the answer schema, the code filters before the call and the input of
// the call. Pure code. The call itself is `extractSent` in the server module `loops`.

export const EXTRACT_TEXT_MAX = 80;
export const EXTRACT_BODY_MAX = 8000;
export const SENT_MAX_AGE_DAYS = 14;
export const SENT_MAX_RECIPIENTS = 10;

const DAY_MS = 86_400_000;
const LINK = /https?:|www\./i;
const LONG_DIGITS = /\d(?:[\s.-]?\d){5,}/;

// An ask or a promise is a short phrase. It never holds an address, a link or a long number: the code empties it.
// The result is one line of 1 to 80 characters, else null.
export function cleanExtractText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = cleanUserText(value, { oneLine: true });
  if (text.length === 0 || text.length > EXTRACT_TEXT_MAX) return null;
  if (text.includes("@") || LINK.test(text) || LONG_DIGITS.test(text)) return null;
  return text;
}

// What the model must return. Strict: an extra or a missing key is a schema failure.
const extractorShape = z
  .object({
    expects_reply: z.boolean(),
    ask: z.string().min(1).max(EXTRACT_TEXT_MAX).nullable(),
    due: dueRefSchema.nullable(),
    promise: z.string().min(1).max(EXTRACT_TEXT_MAX).nullable(),
    promise_due: dueRefSchema.nullable(),
    // `other` keeps the result; the product shows English texts for it.
    language: z.enum(["pl", "en", "other"]),
  })
  .strict();

// The code rules run before the shape check, so a bad `ask` costs the field and not the whole answer. `preprocess`
// keeps the JSON schema that the provider gets equal to the shape above.
function normalizeAnswer(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const answer: Record<string, unknown> = { ...value };
  if ("ask" in answer) answer.ask = cleanExtractText(answer.ask);
  if ("promise" in answer) answer.promise = cleanExtractText(answer.promise);
  // A due date needs a question; a promise date needs a promise.
  if (answer.expects_reply !== true && "due" in answer) answer.due = null;
  if (answer.promise === null && "promise_due" in answer) answer.promise_due = null;
  return answer;
}

export const extractorOutputSchema = z.preprocess(normalizeAnswer, extractorShape);
export type ExtractorOutput = z.infer<typeof extractorShape>;

export const skipReasons = [
  "system_draft",
  "no_text",
  "too_old",
  "own_only",
  "too_many",
  "list",
  "auto",
  "calendar",
] as const;
export type SentSkipReason = (typeof skipReasons)[number];

// The facts of one user row of `sent_emails`. A `pending` row never comes here: it waits (stage 12).
export interface SentFacts {
  actionId: string | null;
  content: "stored" | "headers_only" | "gone";
  bodyText: string | null;
  sentAt: Date;
  to: readonly string[];
  cc: readonly string[];
  listId: string | null;
  autoSubmitted: string | null;
  hasCalendar: boolean;
  // The mailbox addresses of the organization.
  ownAddresses: readonly string[];
  now: Date;
}

// The first rule that hits wins; the order is part of the contract.
export function sentSkipReason(facts: SentFacts): SentSkipReason | null {
  if (facts.actionId !== null) return "system_draft";
  if (facts.content !== "stored" || facts.bodyText === null || facts.bodyText.trim() === "") return "no_text";
  if (facts.sentAt.getTime() < facts.now.getTime() - SENT_MAX_AGE_DAYS * DAY_MS) return "too_old";
  const own = new Set(facts.ownAddresses.map((address) => address.toLowerCase()));
  const recipients = [...facts.to, ...facts.cc];
  if (recipients.every((address) => own.has(address.toLowerCase()))) return "own_only";
  if (recipients.length > SENT_MAX_RECIPIENTS) return "too_many";
  if (facts.listId !== null) return "list";
  if (facts.autoSubmitted !== null && facts.autoSubmitted.trim().toLowerCase() !== "no") return "auto";
  if (facts.hasCalendar) return "calendar";
  return null;
}

// What the model sees of a mail: no address, no header other than the subject and the date.
export interface ExtractorInput {
  subject: string;
  // The sent time in the organization's time zone: the local date, the local time and the weekday name.
  sentLocal: { date: string; time: string; weekday: string };
  // The number of To and Cc addresses together.
  recipientCount: number;
  // The first 8,000 characters of the text.
  body: string;
}

const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function extractorInputOf(
  mail: { subject: string | null; bodyText: string; sentAt: Date; to: readonly string[]; cc: readonly string[] },
  timeZone: string
): ExtractorInput {
  const local = localDateTime(mail.sentAt, timeZone);
  return {
    subject: mail.subject ?? "",
    sentLocal: { date: local.date, time: local.time, weekday: weekdayNames[local.weekday] ?? "" },
    recipientCount: mail.to.length + mail.cc.length,
    body: cut(mail.bodyText),
  };
}

// The cut never splits a surrogate pair.
function cut(text: string): string {
  const out = text.slice(0, EXTRACT_BODY_MAX);
  const last = out.charCodeAt(out.length - 1);
  return out.length === EXTRACT_BODY_MAX && last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out;
}
