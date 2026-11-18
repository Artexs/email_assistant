// The recipient choices of a reply draft (the "Reply all" and "Use Reply-To" buttons, the panel routes). Pure: the caller reads the
// stored mail. No text of the mail is cut or changed here, only compared (lower case) and listed.

import { REPLY_CC_MAX, sameAddresses, type replyRecipientModes } from "../triage/payloads";

export type ReplyRecipientMode = (typeof replyRecipientModes)[number];

export interface ReplyRecipientFacts {
  // The stored `From` of the mail: the default `to`.
  from: string;
  // The stored To and Cc of the mail.
  toAddresses: readonly string[];
  ccAddresses: readonly string[];
  // The stored Reply-To of the mail.
  replyTo: readonly string[];
  // The addresses of every mailbox of the organization.
  own: readonly string[];
}

export type ReplyRecipients = { to: [string]; cc: string[]; recipients: ReplyRecipientMode };

export type ReplyRecipientsResult =
  | { kind: "ok"; value: ReplyRecipients }
  | { kind: "too_many_recipients" }
  | { kind: "no_reply_to" }
  // `all` has no address to add: the draft would go to the sender only.
  | { kind: "no_others" };

const key = (address: string): string => address.trim().toLowerCase();

// The Reply-To addresses that are a real other recipient: not the sender, not an own mailbox. In the order of the header.
export function otherReplyTo(facts: Pick<ReplyRecipientFacts, "from" | "replyTo" | "own">): string[] {
  const own = new Set(facts.own.map(key));
  const seen = new Set([key(facts.from)]);
  const others: string[] = [];
  for (const address of facts.replyTo) {
    const id = key(address);
    if (id === "" || own.has(id) || seen.has(id)) continue;
    seen.add(id);
    others.push(address.trim());
  }
  return others;
}

// The addresses of To and Cc of the mail without an own mailbox and without the sender, each once (To first), as the mail has them.
export function otherParticipants(
  facts: Pick<ReplyRecipientFacts, "from" | "toAddresses" | "ccAddresses" | "own">
): string[] {
  const own = new Set(facts.own.map(key));
  const seen = new Set([key(facts.from)]);
  const others: string[] = [];
  for (const address of [...facts.toAddresses, ...facts.ccAddresses]) {
    const id = key(address);
    if (id === "" || own.has(id) || seen.has(id)) continue;
    seen.add(id);
    others.push(address.trim());
  }
  return others;
}

// `all`: To is the sender, Cc is every other participant (at most 10, else `too_many_recipients`). `reply_to`: To is the first Reply-To
// address that is not the sender and not an own mailbox, no Cc. `from`: the default.
export function replyRecipients(mode: ReplyRecipientMode, facts: ReplyRecipientFacts): ReplyRecipientsResult {
  const from = facts.from.trim();
  if (mode === "from") return { kind: "ok", value: { to: [from], cc: [], recipients: "from" } };
  if (mode === "reply_to") {
    const [first] = otherReplyTo(facts);
    return first === undefined
      ? { kind: "no_reply_to" }
      : { kind: "ok", value: { to: [first], cc: [], recipients: "reply_to" } };
  }
  const others = otherParticipants(facts);
  if (others.length > REPLY_CC_MAX) return { kind: "too_many_recipients" };
  if (others.length === 0) return { kind: "no_others" };
  return { kind: "ok", value: { to: [from], cc: others, recipients: "all" } };
}

// True when the draft already has these recipients (the same `to` and the same `cc`, ignoring case and order).
export function sameRecipients(
  current: { to: readonly string[]; cc: readonly string[] },
  next: Pick<ReplyRecipients, "to" | "cc">
): boolean {
  return sameAddresses(current.to, next.to) && sameAddresses(current.cc, next.cc);
}
