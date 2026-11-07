import { quoteCut } from "../outgoing/quote";
import type { ApprovalView } from "../outgoing/sender";
import type { DraftPayload } from "../triage/payloads";
import { removeLinks } from "../triage/untrusted-text";

import { encodeCallback } from "./callback";
import { formatClock, formatDay, localDateTime } from "./local-time";
import { MESSAGE_MAX_CHARS, type OutMessage } from "./message";
import { cleanSubject, cutText } from "./text";

export const APPROVAL_QUOTE_CHARS = 1500;
export const CHASER_SET_LIMIT = 10;

const FIELD_MAX_CHARS = 80;
const BARE_DOMAIN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/gi;
const LONE_HIGH_SURROGATE = /[\ud800-\udbff]$/;

// Telegram makes URLs, bare domains and addresses in a plain message tappable: the quote shows none of them.
function chatQuoteText(text: string): { text: string; replaced: boolean } {
  const clean = removeLinks(text).replace(BARE_DOMAIN, "[link]");
  return { text: clean, replaced: clean !== text };
}

function cutLinks(text: string, max: number): string {
  const clean = cutText(removeLinks(text), max);
  return clean === "" ? "(no subject)" : clean;
}

function cutEnd(text: string, max: number): string {
  const head = text.slice(0, Math.max(0, max));
  return head.replace(LONE_HIGH_SURROGATE, "");
}

function recipientLabel(recipient: { name: string | null; address: string }): string {
  const address = cutText(recipient.address, FIELD_MAX_CHARS);
  const name = recipient.name === null ? "" : cutText(recipient.name, FIELD_MAX_CHARS);
  return name === "" ? address : `${name} ${address}`;
}

const SEND_LINE = "The system sends it after your tap. Do not send the draft from your mail client.";

export function renderApprovalRequest(input: {
  actionId: string;
  view: ApprovalView;
  now: Date;
  timeZone: string;
}): OutMessage {
  const { view, actionId } = input;
  const address = cutText(view.recipient.address, FIELD_MAX_CHARS);
  const name = view.recipient.name === null ? "" : cutText(view.recipient.name, FIELD_MAX_CHARS);
  const nameText = name === "" ? "" : `${name}${view.recipientInactive ? " (inactive)" : ""} `;
  let title = `📤 Send? Delegation to ${nameText}${address}`;
  if (view.kind === "clarification") title = `📤 Send? Question to the sender ${address}`;
  if (view.kind === "reminder") title = `📤 Send? Reminder to ${nameText}${address}`;
  const head = [view.synthetic ? `${title} · 🧪 test` : title];
  if (view.sender !== null) {
    const label = cutText(removeLinks(view.sender.label), FIELD_MAX_CHARS);
    head.push(view.sender.external ? `From: ${label} · ⚠️ external sender` : `From: ${label}`);
  }
  head.push(`Subject: ${cleanSubject(view.subject)}`);
  if (view.dueDate !== null) head.push(`Due: ${view.dueDate}`);

  const build = (body: string, bodyNote: boolean, quote: { text: string; replaced: boolean; cut: boolean } | null) => {
    const lines = [...head, "", "Draft:", body];
    if (bodyNote) lines.push("(draft text cut; the full text is in the draft)");
    if (quote !== null) {
      lines.push("", "Quoted original:", quote.text);
      if (quote.replaced) lines.push("(links shown as [link]; the draft has them)");
      if (quote.cut) lines.push("(quote cut; the draft has the full text)");
    }
    lines.push("", SEND_LINE);
    return lines.join("\n");
  };
  const quoteAt = (max: number) => {
    if (view.quote === null) return null;
    const cut = quoteCut(view.quote.text, max);
    const shown = chatQuoteText(cut.text);
    return { ...shown, cut: view.quote.cut || cut.cut };
  };

  let body = view.body;
  let bodyNote = false;
  let quote = quoteAt(APPROVAL_QUOTE_CHARS);
  let text = build(body, bodyNote, quote);
  if (text.length > MESSAGE_MAX_CHARS && view.quote !== null) {
    // The quote shrinks until the text fits; its note lines count, because the cut flag is set from the first step on.
    let max = Math.min(APPROVAL_QUOTE_CHARS, Array.from(view.quote.text).length);
    while (text.length > MESSAGE_MAX_CHARS && max > 0) {
      max = Math.max(0, Math.min(max - 1, max - (text.length - MESSAGE_MAX_CHARS)));
      quote = quoteAt(max);
      text = build(body, bodyNote, quote === null ? null : { ...quote, cut: true });
    }
    if (quote !== null) quote = { ...quote, cut: true };
  }
  if (text.length > MESSAGE_MAX_CHARS) {
    // A guard: the templates never make a body this long.
    const others = build("", true, quote === null ? null : { ...quote, text: "" }).length;
    const room = Math.min(MESSAGE_MAX_CHARS - 200, MESSAGE_MAX_CHARS - others - 1);
    body = `${cutEnd(view.body, room - 1)}…`;
    bodyNote = true;
    text = build(body, bodyNote, quote);
    if (text.length > MESSAGE_MAX_CHARS) text = build(body, bodyNote, quote === null ? null : { ...quote, text: "" });
  }
  return {
    text,
    buttons: [
      [
        { text: "📤 Send", data: encodeCallback({ kind: "approve", actionId }) },
        { text: "✖️ Reject", data: encodeCallback({ kind: "reject", actionId }) },
      ],
    ],
  };
}

interface SetItem {
  n: number;
  delegateName: string;
  address: string;
  subject: string | null;
  dueAt: Date | null;
  reminder: 1 | 2;
  task: string;
}

// A "Send all" tap must never approve a reminder that the message did not show: the texts shrink, no item drops out.
const SET_LEVELS = [
  { task: 150, subject: 80, name: 80 },
  { task: 40, subject: 80, name: 80 },
  { task: 40, subject: 60, name: 80 },
  { task: 40, subject: 60, name: 40 },
];

export function renderApprovalSetRequest(input: { setId: string; items: SetItem[]; timeZone: string }): OutMessage {
  const { setId, items, timeZone } = input;
  if (items.length < 1 || items.length > CHASER_SET_LIMIT) {
    throw new RangeError(`a reminder set has 1 to ${CHASER_SET_LIMIT} items, got ${items.length}`);
  }
  const render = (level: (typeof SET_LEVELS)[number]): string => {
    const lines = [items.length === 1 ? "📤 Send 1 reminder?" : `📤 Send ${items.length} reminders?`, ""];
    for (const item of items) {
      const due = item.dueAt === null ? "" : `due ${formatDay(item.dueAt, timeZone)}, `;
      const who = `${cutText(item.delegateName, level.name)} ${cutText(item.address, FIELD_MAX_CHARS)}`;
      lines.push(
        `${item.n}. ${who} — ${cutLinks(item.subject ?? "", level.subject)} (${due}reminder ${item.reminder} of 2)`,
        `   Task: ${cutText(item.task, level.task)}`
      );
    }
    lines.push(
      "",
      "Each reminder is the fixed reminder template with this task; it quotes nothing.",
      "The system sends them after your tap."
    );
    return lines.join("\n");
  };
  let text = "";
  for (const level of SET_LEVELS) {
    text = render(level);
    if (text.length <= MESSAGE_MAX_CHARS) break;
  }
  return {
    text,
    buttons: [
      [
        { text: "📤 Send all", data: encodeCallback({ kind: "approve_set", setId }) },
        { text: "✖️ Skip all", data: encodeCallback({ kind: "reject_set", setId }) },
      ],
    ],
  };
}

export type SendResultKind =
  | { kind: "sent"; sentCopy: "appended" | "found" | "failed"; draftRemoved: boolean }
  | { kind: "rejected_by_server"; stage: string; responseCode: number | null }
  | {
      kind: "failed";
      cause: "tries" | "content_soft" | "compose" | "bad_payload";
      code: string | null;
      tries: number;
    }
  | { kind: "outcome_unknown" }
  | {
      kind: "expired";
      reason: "timeout" | "draft_missing" | "not_notified" | "held_timeout" | "delegation_closed" | "policy_changed";
      draftRemoved: boolean;
    }
  | { kind: "rejected"; byName: string | null; draftRemoved: boolean };

const CLOSINGS: Record<DraftPayload["kind"], string> = {
  delegation: "The delegation was cancelled.",
  clarification: "",
  reminder: "The delegation stays open.",
};

function words(...parts: string[]): string {
  return parts.filter((part) => part !== "").join(" ");
}

function causeLine(result: Extract<SendResultKind, { kind: "failed" }>): string {
  const code = result.code === null ? "" : cutText(result.code, 40);
  switch (result.cause) {
    case "tries":
      return `The send failed ${result.tries} times${code === "" ? "" : ` (${code})`}`;
    case "content_soft":
      return `The mail server refused the content for now (code ${code === "" ? "unknown" : code}); the system never retries after the content`;
    case "compose":
      return `The mail could not be built ${result.tries} times`;
    case "bad_payload":
      return "The stored send data is not valid; nothing was sent";
  }
}

export function renderSendResult(input: {
  actionId: string;
  sendKind: DraftPayload["kind"];
  result: SendResultKind;
  recipient: { name: string | null; address: string };
  subject: string;
  synthetic: boolean;
}): OutMessage {
  const { actionId, sendKind, result, recipient } = input;
  const to = recipientLabel(recipient);
  const subject = cleanSubject(input.subject);
  const closing = CLOSINGS[sendKind];
  const sendAgain: OutMessage["buttons"] = [
    [{ text: "📤 Send again", data: encodeCallback({ kind: "send_again", actionId }) }],
  ];
  const draftText = (draftRemoved: boolean): string =>
    draftRemoved ? "The draft was removed." : "The draft stays in Drafts.";

  let first: string;
  let rest: string[] = [];
  let buttons: OutMessage["buttons"] = [];
  switch (result.kind) {
    case "sent":
      first = `✅ Sent to ${to} · ${subject}`;
      if (result.sentCopy === "failed") rest.push("No copy in Sent: the server refused the copy.");
      if (!result.draftRemoved) rest.push("The draft stays in Drafts (no UIDPLUS on this server).");
      break;
    case "rejected_by_server": {
      first = `❌ Not sent to ${to} · ${subject}`;
      const code = result.responseCode === null ? "" : `, code ${result.responseCode}`;
      rest = [
        words(`The mail server refused it (${cutText(result.stage, 40)}${code}). The draft stays in Drafts.`, closing),
      ];
      break;
    }
    case "failed":
      first = `❌ Not sent to ${to} · ${subject}`;
      rest = [words(`${causeLine(result)}. The draft stays in Drafts.`, closing)];
      if (result.cause !== "bad_payload") buttons = sendAgain;
      break;
    case "outcome_unknown":
      first = `⚠️ Unknown whether the mail to ${to} went out · ${subject}`;
      rest = [
        words(
          "The connection broke after the content was sent. Check Sent or ask the recipient before you send again.",
          closing
        ),
      ];
      buttons = sendAgain;
      break;
    case "expired": {
      const draft = draftText(result.draftRemoved);
      const both = [words(closing, draft)];
      switch (result.reason) {
        case "timeout":
          first = `⌛ Not sent: the approval expired (48 h) · ${subject}`;
          rest = both;
          break;
        case "draft_missing":
          first = `❌ Not sent: the draft could not be created · ${subject}`;
          rest = [closing];
          break;
        case "not_notified":
          first = `⌛ Not sent: no approval request could go out within 7 days (no linked owner, or the draft was not created) · ${subject}`;
          rest = both;
          break;
        case "held_timeout":
          first = `⌛ Not sent: it waited 48 h after your approval and was not sent (held by SEND_SCOPE or the mailbox state) · ${subject}`;
          rest = both;
          break;
        case "delegation_closed":
          first = `⌛ Not sent: the delegation was closed · ${subject}`;
          rest = [draft];
          break;
        case "policy_changed":
          first = `⌛ Not sent: the setting was changed · ${subject}`;
          rest = both;
          break;
      }
      break;
    }
    case "rejected": {
      const by = result.byName === null ? "" : ` by ${cutText(result.byName, FIELD_MAX_CHARS)}`;
      first = `✖️ Rejected${by} · ${subject}`;
      rest = [words(closing, draftText(result.draftRemoved))];
      break;
    }
  }
  const lines = [input.synthetic ? `${first} · 🧪 test` : first, ...rest.filter((line) => line !== "")];
  return { text: lines.join("\n"), buttons };
}

export function renderDelegationAnswered(input: {
  delegationId: string;
  delegateName: string;
  subject: string | null;
  receivedAt: Date;
  now: Date;
  timeZone: string;
  synthetic: boolean;
}): OutMessage {
  const title = `📩 ${cutText(input.delegateName, FIELD_MAX_CHARS)} answered · ${cleanSubject(input.subject)}`;
  const received = formatClock(input.receivedAt, input.timeZone, input.now);
  return {
    text: [
      input.synthetic ? `${title} · 🧪 test` : title,
      `Received ${received}. Tap Done when the task is closed.`,
    ].join("\n"),
    buttons: [
      [{ text: "✅ Done", data: encodeCallback({ kind: "delegation_done", delegationId: input.delegationId }) }],
    ],
  };
}

export type ApprovalEditOutcome =
  | "approved"
  | "approved_held"
  | "rejected"
  | "expired"
  | "approved_set"
  | "rejected_set"
  | "done";

const HELD_TEXTS = {
  scope: "Sending is held by SEND_SCOPE on the server",
  paused: "The mailbox is paused, so the send waits",
  auth_error: "The mailbox login fails, so the send waits",
};

// The edited message: the text and the buttons that stay.
export function approvalEdit(input: {
  original: string;
  outcome: ApprovalEditOutcome;
  heldBy?: "scope" | "paused" | "auth_error";
  at: Date;
  timeZone: string;
  actionId?: string;
  counts?: { done: number; skipped: number };
}): OutMessage {
  const time = localDateTime(input.at, input.timeZone).time;
  const counts = input.counts ?? { done: 0, skipped: 0 };
  let buttons: OutMessage["buttons"] = [];
  let line: string;
  switch (input.outcome) {
    case "approved":
      line = `⏳ Approved ${time}, sending.`;
      break;
    case "approved_held": {
      if (input.heldBy === undefined) throw new Error("approved_held needs heldBy");
      line = `⏳ Approved ${time}. ${HELD_TEXTS[input.heldBy]}; /status shows it. It expires 48 h after the tap if it is still held.`;
      // A set has no single send to reject: no button.
      if (input.actionId !== undefined) {
        buttons = [[{ text: "✖️ Reject", data: encodeCallback({ kind: "reject", actionId: input.actionId }) }]];
      }
      break;
    }
    case "rejected":
      line = `✖️ Rejected ${time}.`;
      break;
    case "expired":
      line = `⌛ Expired ${time}. The mail was not sent.`;
      break;
    case "approved_set":
      line = `⏳ Approved ${time}: ${counts.done} sending, ${counts.skipped} skipped.`;
      break;
    case "rejected_set":
      line = `✖️ Skipped ${time}: ${counts.done} rejected, ${counts.skipped} skipped.`;
      break;
    case "done":
      line = `✅ Done ${time}.`;
      break;
  }
  const tail = `\n\n${line}`;
  const original = cutEnd(input.original, MESSAGE_MAX_CHARS - tail.length);
  return { text: `${original}${tail}`, buttons };
}
