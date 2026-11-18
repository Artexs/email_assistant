// The recipient choices of a reply draft (the "Reply all" and "Use Reply-To" buttons, the panel routes). Pure: the caller reads the
// stored mail. No text of the mail is cut or changed here, only compared (lower case) and listed.
//
// The rules, one place for the service, the card and the panel (so a button shows only when its service call can work):
// - An address entry of the mail may hold a display name (`Name <a@b>`): only the bare address counts. An entry that holds no
//   address that a draft accepts is not a recipient: it is left out, never sent, and it does not make a button show.
// - An own mailbox is not a recipient, also as a `+tag` variant (`me+x@box` reaches `me@box`).
// - `all` goes to the sender (To) and never uses the Reply-To of the mail. The Reply-To is an unsigned header that the sender (or a
//   forger) sets, and a mail client may use it as the address to answer; this system moves the draft there only on an explicit tap
//   (`reply_to`), and the card and the panel show the address before Send. The decision of 2026-11-19.

import { bareAddress, ownAddressKey, REPLY_CC_MAX, sameAddresses, type replyRecipientModes } from "../triage/payloads";

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

export interface ReplyRecipients {
  to: [string];
  cc: string[];
  recipients: ReplyRecipientMode;
}

export type ReplyRecipientsResult =
  | { kind: "ok"; value: ReplyRecipients }
  | { kind: "too_many_recipients" }
  | { kind: "no_reply_to" }
  // `all` has no address to add: the draft would go to the sender only.
  | { kind: "no_others" }
  // The stored sender is not an address that a draft accepts.
  | { kind: "bad_recipient" };

const key = (address: string): string => address.trim().toLowerCase();

// The bare addresses of a stored list: valid ones only, in the order of the list.
function bareList(entries: readonly string[]): string[] {
  return entries.flatMap((entry) => {
    const bare = bareAddress(entry);
    return bare === null ? [] : [bare];
  });
}

// The Reply-To addresses that are a real other recipient: not the sender, not an own mailbox. In the order of the header.
export function otherReplyTo(facts: Pick<ReplyRecipientFacts, "from" | "replyTo" | "own">): string[] {
  const own = new Set(facts.own.map(ownAddressKey));
  const seen = new Set([key(bareAddress(facts.from) ?? facts.from)]);
  const others: string[] = [];
  for (const address of bareList(facts.replyTo)) {
    const id = key(address);
    if (own.has(ownAddressKey(address)) || seen.has(id)) continue;
    seen.add(id);
    others.push(address);
  }
  return others;
}

// The addresses of To and Cc of the mail without an own mailbox and without the sender, each once (To first), as the mail has them.
export function otherParticipants(
  facts: Pick<ReplyRecipientFacts, "from" | "toAddresses" | "ccAddresses" | "own">
): string[] {
  const own = new Set(facts.own.map(ownAddressKey));
  const seen = new Set([key(bareAddress(facts.from) ?? facts.from)]);
  const others: string[] = [];
  for (const address of bareList([...facts.toAddresses, ...facts.ccAddresses])) {
    const id = key(address);
    if (own.has(ownAddressKey(address)) || seen.has(id)) continue;
    seen.add(id);
    others.push(address);
  }
  return others;
}

// `all`: To is the sender, Cc is every other participant (at most 10, else `too_many_recipients`). `reply_to`: To is the first Reply-To
// address that is not the sender and not an own mailbox, no Cc. `from`: the default.
export function replyRecipients(mode: ReplyRecipientMode, facts: ReplyRecipientFacts): ReplyRecipientsResult {
  const from = bareAddress(facts.from);
  if (from === null) return { kind: "bad_recipient" };
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
