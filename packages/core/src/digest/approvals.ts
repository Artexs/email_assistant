import { quoteCut } from "../outgoing/quote";
import type { ApprovalView } from "../outgoing/sender";
import { type CoreTexts, textTables } from "../texts";
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

const HEADER_ADDRESS = /[\w.+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}/gi;
const SENDER_LINE = /^(?:From|Od): /;

function hideLinks(text: string): string {
  return removeLinks(text).replace(BARE_DOMAIN, "[link]");
}

// An address stays whole; every other part of the line loses its links.
function hideLinksKeepAddresses(line: string): string {
  let out = "";
  let last = 0;
  for (const match of line.matchAll(HEADER_ADDRESS)) {
    out += hideLinks(line.slice(last, match.index));
    out += match[0];
    last = match.index + match[0].length;
  }
  return out + hideLinks(line.slice(last));
}

// Telegram makes URLs, bare domains and addresses in a plain message tappable: the quote body shows none of them.
// The sender line of the quote header keeps the bare address: the top "From:" line of the message has a label only.
function chatQuoteText(text: string): { text: string; replaced: boolean } {
  const headerEnd = text.indexOf("\n\n");
  const lines = text.split("\n");
  const headerLines = headerEnd === -1 ? lines.length : text.slice(0, headerEnd).split("\n").length;
  const clean = lines
    .map((line, index) => {
      if (index < headerLines && SENDER_LINE.test(line)) {
        const prefix = line.slice(0, line.indexOf(": ") + 2);
        return `${prefix}${hideLinksKeepAddresses(line.slice(prefix.length))}`;
      }
      return hideLinks(line);
    })
    .join("\n");
  return { text: clean, replaced: clean !== text };
}

function cutLinks(text: string, max: number, texts: CoreTexts): string {
  const clean = cutText(removeLinks(text), max);
  return clean === "" ? texts.common.noSubject : clean;
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

export function renderApprovalRequest(
  input: {
    actionId: string;
    view: ApprovalView;
    now: Date;
    timeZone: string;
  },
  texts: CoreTexts
): OutMessage {
  const { view, actionId } = input;
  const t = texts.approvals;
  const address = cutText(view.recipient.address, FIELD_MAX_CHARS);
  const name = view.recipient.name === null ? "" : cutText(view.recipient.name, FIELD_MAX_CHARS);
  const nameText = name === "" ? "" : `${name}${view.recipientInactive ? ` ${t.inactive}` : ""} `;
  let title = t.title.delegation(`${nameText}${address}`);
  if (view.kind === "clarification") title = t.title.clarification(address);
  if (view.kind === "reminder") title = t.title.reminder(`${nameText}${address}`);
  const head = [view.synthetic ? `${title} · ${texts.common.test}` : title];
  if (view.sender !== null) {
    // The view stores the English placeholder (plan D19); the renderer prints it in the row's language.
    const stored =
      view.sender.label === textTables.en.common.unknownSender ? texts.common.unknownSender : view.sender.label;
    const label = cutText(removeLinks(stored), FIELD_MAX_CHARS);
    head.push(
      view.sender.external ? `${texts.common.from}: ${label} · ${t.externalSender}` : `${texts.common.from}: ${label}`
    );
  }
  head.push(`${texts.common.subject}: ${cleanSubject(view.subject, texts)}`);
  if (view.dueDate !== null) head.push(`${t.due}: ${view.dueDate}`);

  const build = (body: string, bodyNote: boolean, quote: { text: string; replaced: boolean; cut: boolean } | null) => {
    const lines = [...head, "", t.draft, body];
    if (bodyNote) lines.push(t.bodyCut);
    if (quote !== null) {
      lines.push("", t.quoted, quote.text);
      if (quote.replaced) lines.push(t.linksHidden);
      if (quote.cut) lines.push(t.quoteCut);
    }
    lines.push("", t.sendLine);
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
        { text: t.buttons.send, data: encodeCallback({ kind: "approve", actionId }) },
        { text: t.buttons.reject, data: encodeCallback({ kind: "reject", actionId }) },
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

export function renderApprovalSetRequest(
  input: { setId: string; items: SetItem[]; timeZone: string },
  texts: CoreTexts
): OutMessage {
  const { setId, items, timeZone } = input;
  const t = texts.approvals;
  if (items.length < 1 || items.length > CHASER_SET_LIMIT) {
    throw new RangeError(`a reminder set has 1 to ${CHASER_SET_LIMIT} items, got ${items.length}`);
  }
  const render = (level: (typeof SET_LEVELS)[number]): string => {
    const lines = [t.set.header(items.length), ""];
    for (const item of items) {
      const due = item.dueAt === null ? "" : t.set.dueDay(formatDay(item.dueAt, timeZone, texts.locale));
      const who = `${cutText(item.delegateName, level.name)} ${cutText(item.address, FIELD_MAX_CHARS)}`;
      lines.push(
        `${item.n}. ${who} — ${cutLinks(item.subject ?? "", level.subject, texts)} (${due}${t.set.reminderOf(item.reminder)})`,
        `   ${t.set.task} ${cutText(item.task, level.task)}`
      );
    }
    lines.push("", t.set.footerTemplate, t.set.footerSends);
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
        { text: t.buttons.sendAll, data: encodeCallback({ kind: "approve_set", setId }) },
        { text: t.buttons.skipAll, data: encodeCallback({ kind: "reject_set", setId }) },
      ],
    ],
  };
}

export type SendResultKind =
  | { kind: "sent"; sentCopy: "appended" | "found" | "failed"; draftRemoved: boolean }
  | { kind: "rejected_by_server"; stage: string; responseCode: number | null }
  | {
      kind: "failed";
      cause: "tries" | "content_soft" | "soft_cap" | "compose" | "bad_payload";
      code: string | null;
      tries: number;
    }
  | { kind: "outcome_unknown" }
  | {
      kind: "expired";
      reason:
        | "timeout"
        | "draft_missing"
        | "not_notified"
        | "not_seen"
        | "held_timeout"
        | "delegation_closed"
        | "policy_changed";
      draftRemoved: boolean;
    }
  | { kind: "rejected"; byName: string | null; draftRemoved: boolean };

function words(...parts: string[]): string {
  return parts.filter((part) => part !== "").join(" ");
}

function causeLine(result: Extract<SendResultKind, { kind: "failed" }>, texts: CoreTexts): string {
  const code = result.code === null ? "" : cutText(result.code, 40);
  const causes = texts.approvals.causes;
  switch (result.cause) {
    case "tries":
      return causes.tries(result.tries, code);
    case "content_soft":
      return causes.contentSoft(code);
    case "soft_cap":
      return causes.softCap(code);
    case "compose":
      return causes.compose(result.tries);
    case "bad_payload":
      return causes.badPayload;
  }
}

export function renderSendResult(
  input: {
    actionId: string;
    sendKind: DraftPayload["kind"];
    result: SendResultKind;
    recipient: { name: string | null; address: string };
    subject: string;
    synthetic: boolean;
  },
  texts: CoreTexts
): OutMessage {
  const { actionId, sendKind, result, recipient } = input;
  const t = texts.approvals;
  const to = recipientLabel(recipient);
  const subject = cleanSubject(input.subject, texts);
  const closing = sendKind === "clarification" ? "" : t.closings[sendKind];
  const sendAgain: OutMessage["buttons"] = [
    [{ text: t.buttons.sendAgain, data: encodeCallback({ kind: "send_again", actionId }) }],
  ];
  const draftText = (draftRemoved: boolean): string => (draftRemoved ? t.draftRemoved : t.draftStays);

  let first: string;
  let rest: string[] = [];
  let buttons: OutMessage["buttons"] = [];
  switch (result.kind) {
    case "sent":
      first = t.sendResult.sent(to, subject);
      if (result.sentCopy === "failed") rest.push(t.sendResult.copyFailed);
      if (!result.draftRemoved) rest.push(t.sendResult.draftStaysNoUid);
      break;
    case "rejected_by_server":
      first = t.sendResult.notSent(to, subject);
      rest = [words(t.sendResult.refused(cutText(result.stage, 40), result.responseCode), closing)];
      break;
    case "failed":
      first = t.sendResult.notSent(to, subject);
      rest = [words(t.sendResult.failedStays(causeLine(result, texts)), closing)];
      if (result.cause !== "bad_payload") buttons = sendAgain;
      break;
    case "outcome_unknown":
      first = t.sendResult.unknown(to, subject);
      rest = [words(t.sendResult.unknownRest, closing)];
      // A delegation send that went out stays `cancelled` until the owner says so: only it has a delegation to restore.
      buttons =
        sendKind === "delegation"
          ? [...sendAgain, [{ text: t.buttons.wentOut, data: encodeCallback({ kind: "went_out", actionId }) }]]
          : sendAgain;
      break;
    case "expired": {
      const draft = draftText(result.draftRemoved);
      const both = [words(closing, draft)];
      first = t.sendResult.expired[result.reason](subject);
      // These two reasons say less: no draft line for a missing draft, no closing for a closed delegation.
      if (result.reason === "draft_missing") rest = [closing];
      else if (result.reason === "delegation_closed") rest = [draft];
      else rest = both;
      break;
    }
    case "rejected": {
      const by = result.byName === null ? null : cutText(result.byName, FIELD_MAX_CHARS);
      first = t.sendResult.rejected(by, subject);
      rest = [words(closing, draftText(result.draftRemoved))];
      break;
    }
  }
  const lines = [input.synthetic ? `${first} · ${texts.common.test}` : first, ...rest.filter((line) => line !== "")];
  return { text: lines.join("\n"), buttons };
}

export function renderDelegationAnswered(
  input: {
    delegationId: string;
    delegateName: string;
    subject: string | null;
    receivedAt: Date;
    now: Date;
    timeZone: string;
    synthetic: boolean;
  },
  texts: CoreTexts
): OutMessage {
  const title = texts.approvals.answered.title(
    cutText(input.delegateName, FIELD_MAX_CHARS),
    cleanSubject(input.subject, texts)
  );
  const received = formatClock(input.receivedAt, input.timeZone, input.now, texts.locale);
  return {
    text: [
      input.synthetic ? `${title} · ${texts.common.test}` : title,
      `${texts.notices.received(received)}. ${texts.approvals.answered.tapDone}`,
    ].join("\n"),
    buttons: [
      [
        {
          text: texts.approvals.buttons.done,
          data: encodeCallback({ kind: "delegation_done", delegationId: input.delegationId }),
        },
      ],
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
  | "went_out"
  | "done";

// The edited message: the text and the buttons that stay.
export function approvalEdit(
  input: {
    original: string;
    outcome: ApprovalEditOutcome;
    heldBy?: "scope" | "paused" | "auth_error";
    at: Date;
    timeZone: string;
    actionId?: string;
    counts?: { done: number; skipped: number };
  },
  texts: CoreTexts
): OutMessage {
  const t = texts.approvals;
  const time = localDateTime(input.at, input.timeZone).time;
  const counts = input.counts ?? { done: 0, skipped: 0 };
  let buttons: OutMessage["buttons"] = [];
  let line: string;
  switch (input.outcome) {
    case "approved":
      line = t.edit.approved(time);
      break;
    case "approved_held": {
      if (input.heldBy === undefined) throw new Error("approved_held needs heldBy");
      line = t.edit.approvedHeld(time, t.held[input.heldBy]);
      // A set has no single send to reject: no button.
      if (input.actionId !== undefined) {
        buttons = [[{ text: t.buttons.reject, data: encodeCallback({ kind: "reject", actionId: input.actionId }) }]];
      }
      break;
    }
    case "rejected":
      line = t.edit.rejected(time);
      break;
    case "expired":
      line = t.edit.expired(time);
      break;
    case "approved_set":
      line = t.edit.approvedSet(time, counts.done, counts.skipped);
      break;
    case "rejected_set":
      line = t.edit.rejectedSet(time, counts.done, counts.skipped);
      break;
    case "went_out":
      line = t.edit.wentOut(time);
      break;
    case "done":
      line = t.edit.done(time);
      break;
  }
  const tail = `\n\n${line}`;
  const original = cutEnd(input.original, MESSAGE_MAX_CHARS - tail.length);
  return { text: `${original}${tail}`, buttons };
}
