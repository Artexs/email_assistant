import type { ReportMailKind } from "../notices/kinds";
import type { UserLocale } from "../tenancy";
import { textsFor } from "../texts";

import { ACTION_ID_HEADER } from "./headers";
import type { OutgoingAddress } from "./message";

// ADR 0022: the report mail that the system appends to the user's own INBOX. It is a message in the user's own
// mailbox, not a sent mail: nothing here has a recipient other than the mailbox itself, and no SMTP code is near it.

export interface ReportMailMessage {
  messageId: string;
  date: Date;
  from: OutgoingAddress;
  // Exactly the mailbox address: it comes from the mailbox row, never from the text of a notice or a mail.
  to: [OutgoingAddress];
  subject: string;
  text: string;
  html: string;
  // The outbox id: the own-mail check of every sync reads it (`isOwnReportMail`).
  headers: { [ACTION_ID_HEADER]: string };
}

export interface ReportMailInput {
  outboxId: string;
  kind: ReportMailKind;
  mailboxAddress: string;
  locale: UserLocale;
  // The rendered text of the notice (`renderNotice` for the channel `mail`).
  text: string;
  now: Date;
  // `WEB_BASE_URL` (an origin). Only a link that starts with it becomes a link in the HTML part; null: no link at all.
  linkBase: string | null;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const URL_TRAILING = /[.,;:!?)\]]+$/;

// A link is ours when it starts with the base and the next character ends the origin: `https://app.x.test.evil.test` is not.
export function isLinkOfBase(url: string, linkBase: string | null): boolean {
  if (linkBase === null) return false;
  const base = linkBase.replace(/\/+$/, "");
  if (base === "" || !url.startsWith(base)) return false;
  const next = url.charAt(base.length);
  return next === "" || next === "/" || next === "?" || next === "#";
}

// The HTML part: every character escaped, one line per `<br>`. A URL becomes an anchor only when it points at the base.
export function reportMailHtml(text: string, linkBase: string | null): string {
  const lines = text.split(/\r?\n/).map((line) => {
    let html = "";
    let last = 0;
    for (const match of line.matchAll(URL_PATTERN)) {
      const url = match[0].replace(URL_TRAILING, "");
      html += escapeHtml(line.slice(last, match.index));
      html += isLinkOfBase(url, linkBase) ? `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>` : escapeHtml(url);
      last = match.index + url.length;
    }
    return html + escapeHtml(line.slice(last));
  });
  return `<html><body><div style="font-family:sans-serif">${lines.join("<br>\n")}</div></body></html>`;
}

// `<ea-report-<outbox id>@<domain of the mailbox>>`: the same id always gives the same header.
export function reportMailMessageId(outboxId: string, mailboxAddress: string): string {
  const domain = mailboxAddress.slice(mailboxAddress.lastIndexOf("@") + 1).toLowerCase();
  return `<ea-report-${outboxId}@${domain}>`;
}

export function reportMailSubject(kind: ReportMailKind, locale: UserLocale): string {
  const texts = textsFor(locale).reportMail;
  return `${texts.prefix} ${texts.title[kind]}`;
}

export function buildReportMail(input: ReportMailInput): ReportMailMessage {
  const texts = textsFor(input.locale).reportMail;
  const own: OutgoingAddress = { name: texts.sender, address: input.mailboxAddress };
  return {
    messageId: reportMailMessageId(input.outboxId, input.mailboxAddress),
    date: input.now,
    from: own,
    to: [own],
    subject: reportMailSubject(input.kind, input.locale),
    text: input.text,
    html: reportMailHtml(input.text, input.linkBase),
    headers: { [ACTION_ID_HEADER]: input.outboxId },
  };
}
