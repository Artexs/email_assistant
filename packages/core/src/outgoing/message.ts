import { cutText } from "../digest/text";
import type { DraftPayload } from "../triage/payloads";
import { markUntrustedText } from "../triage/untrusted-text";

import { formatDateLabel, quoteOriginal } from "./quote";
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
  subject: string;
  text: string; // parts.body + "\n\n" + parts.quote (when a quote exists)
  inReplyTo: string | null;
  references: string[];
  headers: { "X-EA-Action-Id": string };
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
}

export interface BuildInput {
  draft: DraftPayload;
  draftActionId: string;
  createdAt: Date;
  mailbox: { address: string };
  owner: { displayName: string };
  organization: { styleText: string | null; timezone: string };
  original: OriginalMail;
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
  if (kind === "clarification") {
    return lower.startsWith("re:") || lower.startsWith("odp:") ? subject : `Re: ${subject}`;
  }
  return lower.startsWith("re:") ? subject : `Re: ${outgoingSubject("delegation", originalSubject)}`;
}

// LLM text goes through the marker once more and loses its line breaks: it cannot start a header-like line.
function oneLine(text: string): string {
  return markUntrustedText(text).replace(/\s+/g, " ").trim();
}

function uniqueIds(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null && id !== ""))];
}

export function buildOutgoingMessage(input: BuildInput): OutgoingMessage {
  const { draft, draftActionId, createdAt, mailbox, owner, organization, original } = input;
  const recipient = draft.to[0];
  if (recipient === undefined) throw new Error("draft has no recipient");
  const styleText = organization.styleText?.trim() ?? "";
  const signature = styleText === "" ? owner.displayName : styleText;
  const dueDate = "due_date" in draft && draft.due_date !== "" ? draft.due_date : null;
  const body = renderTemplate(draft.kind, draft.language, {
    task: "task" in draft ? oneLine(draft.task) : undefined,
    question: "question" in draft ? oneLine(draft.question) : undefined,
    dueDate,
    senderLabel: original.fromAddress ?? "(unknown sender)",
    dateLabel: formatDateLabel(original.receivedAt, organization.timezone),
    signature,
  });
  const quote = draft.kind === "reminder" ? null : quoteOriginal(original, draft.language, organization.timezone);

  const chain = uniqueIds([...original.references, original.messageId]);
  let inReplyTo: string | null = null;
  let references = chain;
  if (draft.kind === "clarification") inReplyTo = original.messageId;
  if (draft.kind === "reminder") {
    inReplyTo = draft.thread.in_reply_to;
    references = draft.thread.references;
  }

  return {
    messageId: outgoingMessageId(draftActionId, mailbox.address),
    date: createdAt,
    from: { name: owner.displayName, address: mailbox.address },
    to: [{ name: "delegate_name" in draft ? draft.delegate_name : null, address: recipient }],
    subject: outgoingSubject(draft.kind, original.subject),
    text: quote === null ? body : `${body}\n\n${quote}`,
    inReplyTo,
    references,
    headers: { "X-EA-Action-Id": draftActionId },
    parts: { body, quote },
  };
}
