import { quoteCut } from "../outgoing/quote";
import type { ApprovalView } from "../outgoing/sender";
import { type CoreTexts, textTables } from "../texts";
import { removeLinks } from "../triage/untrusted-text";

import { FIELD_MAX_CHARS, cutEnd } from "./approval-text";
import { encodeCallback } from "./callback";
import { formatDay } from "./local-time";
import { MESSAGE_MAX_CHARS, type OutMessage } from "./message";
import { cleanSubject, cutText, withoutEscapeRemains } from "./text";

export { approvalEdit } from "./approval-edit";
export type { ApprovalEditOutcome, HeldBy } from "./approval-edit";
export { renderDelegationAnswered, renderSendResult } from "./approval-results";
export type { SendResultKind } from "./approval-results";

export const APPROVAL_QUOTE_CHARS = 1500;
export const CHASER_SET_LIMIT = 10;

const BARE_DOMAIN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/gi;

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
        return hideLinksKeepAddresses(line);
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

// The address lines of a follow-up card: every address of To and Cc whole, never cut (the recipients are the risk the owner
// decides on). A list that cannot fit one message is refused: the card does not go out, the panel still shows it.
export const FOLLOW_UP_RECIPIENTS_MAX_CHARS = 2400;

function followUpRecipientLines(view: ApprovalView, texts: CoreTexts): string[] {
  const t = texts.approvals.followUp;
  const to = view.to ?? [view.recipient.address];
  const cc = view.cc ?? [];
  const lines = [`${t.to} ${to.join(", ")}`];
  if (cc.length > 0) lines.push(`${t.cc} ${cc.join(", ")}`);
  if (lines.join("\n").length > FOLLOW_UP_RECIPIENTS_MAX_CHARS) {
    throw new RangeError("the recipients of a follow-up do not fit a card");
  }
  return lines;
}

// The recipient lines of a reply card: To (always), Cc (when there is one) and Reply-To (when it differs from the From address).
function replyRecipientLines(view: ApprovalView, texts: CoreTexts): string[] {
  const t = texts.approvals.reply;
  const to = view.to ?? [view.recipient.address];
  const lines = [`${t.to} ${to.join(", ")}`];
  if ((view.cc?.length ?? 0) > 0) lines.push(`${t.cc} ${(view.cc ?? []).join(", ")}`);
  if ((view.replyTo?.length ?? 0) > 0) lines.push(`${t.replyTo} ${(view.replyTo ?? []).join(", ")}`);
  if (lines.join("\n").length > FOLLOW_UP_RECIPIENTS_MAX_CHARS) {
    throw new RangeError("the recipients of a reply do not fit a card");
  }
  return lines;
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
  const followUp = view.kind === "follow_up";
  const address = cutText(view.recipient.address, FIELD_MAX_CHARS);
  const name = view.recipient.name === null ? "" : cutText(view.recipient.name, FIELD_MAX_CHARS);
  const nameText = name === "" ? "" : `${name}${view.recipientInactive ? ` ${t.inactive}` : ""} `;
  let title = t.title.delegation(`${nameText}${address}`);
  if (view.kind === "clarification") title = t.title.clarification(address);
  if (view.kind === "reminder") title = t.title.reminder(`${nameText}${address}`);
  if (view.kind === "reply") title = t.title.reply(address);
  if (followUp) title = t.followUp.title;
  const head = [view.synthetic ? `${title} · ${texts.common.test}` : title];
  if (view.version !== undefined && view.version >= 2) head.push(t.versionLine(view.version));
  if (followUp) head.push(...followUpRecipientLines(view, texts));
  // A reply card names every recipient: To, Cc and the Reply-To of the original when it differs from its From. The
  // addresses are never cut (the owner decides on them), as in a follow-up; a list that cannot fit one message is refused.
  if (view.kind === "reply") head.push(...replyRecipientLines(view, texts));
  if (view.sender !== null) {
    // The view stores the English placeholder; the renderer prints it in the row's language.
    const stored =
      view.sender.label === textTables.en.common.unknownSender ? texts.common.unknownSender : view.sender.label;
    const label = cutText(removeLinks(stored), FIELD_MAX_CHARS);
    head.push(
      view.sender.external ? `${texts.common.from}: ${label} · ${t.externalSender}` : `${texts.common.from}: ${label}`
    );
  }
  // A follow-up shows text of the user's Sent mail: the remains of an escape sequence in it are dropped.
  head.push(
    `${texts.common.subject}: ${cleanSubject(followUp ? withoutEscapeRemains(view.subject) : view.subject, texts)}`
  );
  if (view.dueDate !== null) head.push(`${t.due}: ${view.dueDate}`);
  if (followUp && view.followUpNumber !== undefined) head.push(t.followUp.number(view.followUpNumber));

  const build = (body: string, bodyNote: boolean, quote: { text: string; replaced: boolean; cut: boolean } | null) => {
    const gaps = view.kind === "reply" ? (view.gaps ?? []) : [];
    // The gaps come first: the owner sees what to fill before the text. The line is never cut with the body.
    const lines = [...head, ...(gaps.length > 0 ? ["", t.reply.fill(gaps.join("; "))] : []), "", t.draft, body];
    if (bodyNote) lines.push(t.bodyCut);
    if (quote !== null) {
      lines.push("", t.quoted, quote.text);
      if (quote.replaced) lines.push(t.linksHidden);
      if (quote.cut) lines.push(t.quoteCut);
    }
    lines.push("");
    if (view.panelUrl !== undefined) lines.push(t.panelLine(view.panelUrl));
    // A reply, and every kind while the flag `draft_copy_check` is on (the view says so), may be edited in the mail client.
    lines.push(view.kind === "reply" || view.copyCheck === true ? t.sendLineEditable : t.sendLine);
    // The Sent mail is not read: only `\Answered` on the original shows an answer, so the owner must check by hand.
    if (view.kind === "reply" && view.sentVisible === false) lines.push(t.reply.sentHidden);
    return lines.join("\n");
  };
  const quoteFrom = (source: { text: string; cut: boolean }, max: number) => {
    const cut = quoteCut(source.text, max);
    const shown = chatQuoteText(cut.text);
    return { ...shown, text: followUp ? withoutEscapeRemains(shown.text) : shown.text, cut: source.cut || cut.cut };
  };
  // An empty quote shows no block and no cut note: there is nothing to show and nothing was cut.
  const quoteAt = (max: number) => (view.quote === null || view.quote.text === "" ? null : quoteFrom(view.quote, max));

  let body = view.body;
  let bodyNote = false;
  let quote = quoteAt(APPROVAL_QUOTE_CHARS);
  let text = build(body, bodyNote, quote);
  if (text.length > MESSAGE_MAX_CHARS && quote !== null && view.quote !== null) {
    // The quote shrinks until the text fits; its note lines count, because the cut flag is set from the first step on.
    let max = Math.min(APPROVAL_QUOTE_CHARS, Array.from(view.quote.text).length);
    while (text.length > MESSAGE_MAX_CHARS && max > 0) {
      max = Math.max(0, Math.min(max - 1, max - (text.length - MESSAGE_MAX_CHARS)));
      quote = { ...quoteFrom(view.quote, max), cut: true };
      text = build(body, bodyNote, quote);
    }
  }
  if (text.length > MESSAGE_MAX_CHARS) {
    // A guard: the templates never make a body this long.
    const others = build("", true, quote === null ? null : { ...quote, text: "" }).length;
    const room = Math.min(MESSAGE_MAX_CHARS - 200, MESSAGE_MAX_CHARS - others - 1);
    body = `${cutEnd(view.body, room - 1)}…`;
    bodyNote = true;
    text = build(body, bodyNote, quote);
  }
  // The recipients never shrink (the owner decides on them), so a card that cannot hold them does not render at all.
  if (text.length > MESSAGE_MAX_CHARS) throw new RangeError("the approval card does not fit one message");
  if (view.kind === "reply") {
    // A reply card has no Send button while a gap is open, and a Skip button. The second row changes the draft: a new text from one
    // line, and (only when they make sense) the other recipients or the Reply-To address as the recipient.
    const row: OutMessage["buttons"][number] = [];
    if ((view.gaps ?? []).length === 0)
      row.push({ text: t.buttons.send, data: encodeCallback({ kind: "approve", actionId }) });
    row.push({ text: t.buttons.reject, data: encodeCallback({ kind: "reject", actionId }) });
    row.push({ text: t.reply.skip, data: encodeCallback({ kind: "reply_skip", sendId: actionId }) });
    const change: OutMessage["buttons"][number] = [
      { text: t.reply.redraft, data: encodeCallback({ kind: "reply_redraft", sendId: actionId }) },
    ];
    if (view.canReplyAll === true) {
      change.push({ text: t.reply.replyAll, data: encodeCallback({ kind: "reply_all", sendId: actionId }) });
    }
    if (view.canUseReplyTo === true) {
      change.push({ text: t.reply.useReplyTo, data: encodeCallback({ kind: "reply_use_reply_to", sendId: actionId }) });
    }
    return { text, buttons: [row, change] };
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
