import { cutText } from "../digest/text";
import { quoteReply } from "../replies/quote";
import type { DraftPayload } from "../triage/payloads";
import { markUntrustedText } from "../triage/untrusted-text";

import { ACTION_ID_HEADER } from "./headers";
import { cleanFromAddress, formatDateLabel, formatSentDate, quoteOriginal, quoteSent } from "./quote";
import { renderTemplate } from "./templates";

export interface OutgoingAddress {
  name: string | null;
  address: string;
}

export interface OutgoingMessage {
  messageId: string;
  date: Date;
  from: OutgoingAddress;
  to: OutgoingAddress[];
  cc: OutgoingAddress[];
  subject: string;
  text: string; // parts.body + "\n\n" + parts.quote (when a quote exists)
  inReplyTo: string | null;
  references: string[];
  headers: { [ACTION_ID_HEADER]: string };
  parts: { body: string; quote: string | null };
}

export interface OriginalMail {
  fromAddress: string | null;
  subject: string | null;
  receivedAt: Date;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[]; // emails.references_header split on whitespace
  bodyText: string | null;
  // The display name of the sender (`email_headers.from_name`); absent or null: none known. Only a reply reads it (the quote line).
  fromName?: string | null;
}

// The name and the signature of the sending mailbox (reply drafts): the row of `mailbox_profiles`, or null for a mailbox with no row.
export interface SenderProfile {
  displayName: string | null;
  signature: string | null;
}

export interface BuildInput {
  draft: DraftPayload;
  draftActionId: string;
  createdAt: Date;
  mailbox: { address: string };
  owner: { displayName: string };
  organization: { timezone: string };
  original: OriginalMail;
  // Absent or null: no profile row. Name: profile → owner name (the caller falls back to the address). Signature: profile → owner name.
  profile?: SenderProfile | null;
}

function nonBlank(text: string | null | undefined): string | null {
  return text === null || text === undefined || text.trim() === "" ? null : text;
}

export function outgoingMessageId(draftActionId: string, mailboxAddress: string): string {
  const domain = mailboxAddress.slice(mailboxAddress.lastIndexOf("@") + 1).toLowerCase();
  return `<ea-${draftActionId}@${domain}>`;
}

export function outgoingSubject(kind: DraftPayload["kind"], originalSubject: string | null): string {
  const cut = cutText(originalSubject ?? "", 200);
  const subject = cut === "" ? "(no subject)" : cut;
  const lower = subject.toLowerCase();
  if (kind === "delegation") {
    return lower.startsWith("fwd:") || lower.startsWith("fw:") ? subject : `Fwd: ${subject}`;
  }
  if (kind === "clarification" || kind === "follow_up" || kind === "reply") {
    return lower.startsWith("re:") || lower.startsWith("odp:") ? subject : `Re: ${subject}`;
  }
  return `Re: ${outgoingSubject("delegation", originalSubject)}`;
}

// LLM text goes through the marker once more and loses its line breaks and its control and bidi characters:
// it cannot start a header-like line. It is cleaned before the marker, so no hidden character splits a pattern.
function oneLine(text: string): string {
  return cutText(markUntrustedText(cutText(text, Infinity)), Infinity);
}

// The References of a follow-up: the thread of the own mail, then its Message-ID, at most the last 20 ids.
export const FOLLOW_UP_REFERENCES_MAX = 20;

function uniqueIds(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null && id !== ""))];
}

export function buildOutgoingMessage(input: BuildInput): OutgoingMessage {
  const { draft, draftActionId, createdAt, mailbox, owner, organization, original, profile = null } = input;
  const recipients = draft.to;
  if (recipients[0] === undefined) throw new Error("draft has no recipient");
  const signature = nonBlank(profile?.signature)?.trim() ?? owner.displayName;
  const senderName = nonBlank(profile?.displayName)?.trim() ?? owner.displayName;
  const dueDate = "due_date" in draft && draft.due_date !== "" ? draft.due_date : null;
  const editedBody = "body_text" in draft ? draft.body_text : undefined;
  const editedSubject = "subject_text" in draft ? draft.subject_text : undefined;
  const followUp = draft.kind === "follow_up" ? draft : null;
  const body =
    editedBody ??
    (draft.kind === "reply"
      ? `${draft.body}\n\n${signature}`
      : renderTemplate(draft.kind, draft.language, {
          task: "task" in draft ? oneLine(draft.task) : undefined,
          question: "question" in draft ? oneLine(draft.question) : undefined,
          dueDate,
          ...(followUp === null ? {} : { subject: cutText(followUp.subject, 200), followUpNumber: followUp.n }),
          senderLabel: cleanFromAddress(original.fromAddress),
          dateLabel:
            followUp === null
              ? formatDateLabel(original.receivedAt, organization.timezone, draft.language)
              : formatSentDate(new Date(followUp.sent_at), organization.timezone, draft.language),
          signature,
        }));
  let quote: string | null;
  if (followUp !== null) {
    quote = quoteSent(followUp.quote, new Date(followUp.sent_at), draft.language, organization.timezone);
  } else if (draft.kind === "reply") {
    quote = quoteReply(original, draft.language, organization.timezone) || null;
  } else {
    quote = draft.kind === "reminder" ? null : quoteOriginal(original, draft.language, organization.timezone);
  }

  const chain = uniqueIds([...original.references, original.messageId]);
  let inReplyTo: string | null = null;
  let references = chain;
  if (draft.kind === "clarification" || draft.kind === "follow_up" || draft.kind === "reply")
    inReplyTo = original.messageId;
  if (draft.kind === "follow_up" || draft.kind === "reply") references = chain.slice(-FOLLOW_UP_REFERENCES_MAX);
  if (draft.kind === "reminder") {
    inReplyTo = draft.thread.in_reply_to;
    references = draft.thread.references;
  }

  return {
    messageId: outgoingMessageId(draftActionId, mailbox.address),
    date: createdAt,
    from: { name: senderName, address: mailbox.address },
    to: recipients.map((address) => ({ name: "delegate_name" in draft ? draft.delegate_name : null, address })),
    cc: "cc" in draft ? draft.cc.map((address) => ({ name: null, address })) : [],
    subject: editedSubject ?? outgoingSubject(draft.kind, followUp === null ? original.subject : followUp.subject),
    text: quote === null ? body : `${body}\n\n${quote}`,
    inReplyTo,
    references,
    headers: { [ACTION_ID_HEADER]: draftActionId },
    parts: { body, quote },
  };
}
