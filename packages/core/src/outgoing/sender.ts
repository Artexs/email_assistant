import { senderLabel } from "../digest/text";
import type { DraftPayload } from "../triage/payloads";

import type { OriginalMail, OutgoingAddress, OutgoingMessage } from "./message";
import { quoteCut } from "./quote";

// A shared domain proves nothing: anyone can register an address at a public provider, and a From header can be forged.
export function isExternalSender(
  from: string | null,
  ctx: { internalAddresses: readonly string[]; whitelisted: boolean; vip: boolean }
): boolean {
  if (from === null) return true;
  if (ctx.whitelisted || ctx.vip) return false;
  const address = from.trim().toLowerCase();
  return !ctx.internalAddresses.some((internal) => internal.toLowerCase() === address);
}

export interface ApprovalView {
  kind: DraftPayload["kind"];
  recipient: OutgoingAddress;
  sender: { label: string; external: boolean } | null; // null for a reminder
  recipientInactive: boolean; // the delegate row is inactive (D6)
  subject: string;
  dueDate: string | null;
  body: string; // parts.body
  quote: { text: string; cut: boolean } | null;
  synthetic: boolean;
}

export function approvalViewOf(
  message: OutgoingMessage,
  input: {
    draft: DraftPayload;
    original: OriginalMail;
    external: boolean;
    synthetic: boolean;
    recipientInactive: boolean;
  }
): ApprovalView {
  const { draft, original } = input;
  const recipient = message.to[0];
  if (recipient === undefined) throw new Error("message has no recipient");
  const dueDate = "due_date" in draft && draft.due_date !== "" ? draft.due_date : null;
  return {
    kind: draft.kind,
    recipient,
    sender: draft.kind === "reminder" ? null : { label: senderLabel(original.fromAddress), external: input.external },
    recipientInactive: input.recipientInactive,
    subject: message.subject,
    dueDate,
    body: message.parts.body,
    quote: message.parts.quote === null ? null : quoteCut(message.parts.quote),
    synthetic: input.synthetic,
  };
}
