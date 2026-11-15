import { hasPhoneNumber, hasUnreservedAddress, hasUnreservedUrl } from "../testmail/batch";

import { fitsLength } from "./checks";
import { detectLang } from "./lang";
import type { Scenario } from "./scenario";
import { sentAddressOf } from "./sent-blind";
import { sentHardCaseRule } from "./sent-hard-cases";
import type { SentSlot, SentText } from "./sent-slot";

export type SentIssueCode =
  | "missing_text"
  | "slot_unknown"
  | "lang"
  | "length"
  | "signature"
  | "thread_count"
  | "planted_missing"
  | "label_word"
  | "own_only"
  | "address_not_reserved"
  | "url_not_reserved"
  | "phone_number";

// An issue names a case and a code; it never holds mail text.
export interface SentIssue {
  id: string;
  code: SentIssueCode;
}

const isQuoteLine = (line: string) => line.trimStart().startsWith(">");

// The lines the executive wrote: every line that is not part of a quoted mail.
function ownText(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !isQuoteLine(line))
    .join("\n");
}

// A quoted block is a run of lines that start with ">". A line without ">" ends it.
export function quotedBlockCount(body: string): number {
  let count = 0;
  let inside = false;
  for (const line of body.split(/\r?\n/)) {
    const quoted = isQuoteLine(line);
    if (quoted && !inside) count += 1;
    inside = quoted;
  }
  return count;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length;
}

// The labels as the extractor names them. A mail that writes one of them as a field leaks the label:
// an identifier form anywhere ("expects_reply", "promiseDue"), or "promise:", "due:", "expects reply:" at a line start.
const labelIdentifier = /\b(expects_reply|expectsreply|promise_due|promisedue|has_promise|haspromise)\b/i;
const labelField = /^\s*(expects[ _]reply|promise|due)\s*[:=]/im;

export function hasLabelWord(text: string): boolean {
  return labelIdentifier.test(text) || labelField.test(text);
}

// Code checks of one written sent mail against its slot. A text with no slot is the caller's `slot_unknown`.
export function checkSentCase(slot: SentSlot, text: SentText, scenario: Scenario): SentIssue[] {
  const codes: SentIssueCode[] = [];
  const add = (code: SentIssueCode, when: boolean) => {
    if (when) codes.push(code);
  };
  if (text.id !== slot.id) return [{ id: slot.id, code: "slot_unknown" }];

  const parts = [text.subject, text.body];
  const own = ownText(text.body);

  add("address_not_reserved", parts.some(hasUnreservedAddress));
  add("url_not_reserved", parts.some(hasUnreservedUrl));
  add("phone_number", parts.some(hasPhoneNumber));

  const lang = detectLang(`${text.subject} ${own}`);
  add("lang", lang !== "unknown" && lang !== slot.lang);
  add("length", !fitsLength(slot.style.length, wordCount(own)));

  const { signature } = scenario.executive;
  add("signature", slot.style.signature && signature !== "" && !text.body.includes(signature));

  add("thread_count", slot.quoted && quotedBlockCount(text.body) !== slot.thread.length);

  if (slot.hardCases.some((tag) => sentHardCaseRule(tag).kind === "injection")) {
    const planted = text.planted ?? [];
    const lowered = text.body.toLowerCase();
    add("planted_missing", planted.length === 0 || planted.some((p) => !lowered.includes(p.toLowerCase())));
  }

  add("label_word", hasLabelWord(`${text.subject}\n${text.body}`));

  const executive = scenario.executive.address.toLowerCase();
  const recipients = [...slot.to, ...slot.cc].map((key) => sentAddressOf(scenario, key).toLowerCase());
  add("own_only", recipients.includes(executive));

  return codes.map((code) => ({ id: slot.id, code }));
}
