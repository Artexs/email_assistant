import { senderLabel } from "../digest/text";
import { textTables } from "../texts";
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
  sender: { label: string; external: boolean } | null; // null for a reminder and a follow-up
  recipientInactive: boolean; // the delegate row is inactive (D6)
  subject: string;
  dueDate: string | null;
  body: string; // parts.body
  quote: { text: string; cut: boolean } | null;
  synthetic: boolean;
  // A follow-up, and a reply (see `approvalViewSchema`).
  to?: string[];
  cc?: string[];
  followUpNumber?: 1 | 2;
  version?: number; // the edit version of the send, from 2 on (stage 08 sets it)
  panelUrl?: string; // the panel page of this send (stage 09 sets it)
  copyCheck?: true; // the org flag `draft_copy_check` was on when the card was made: the card line allows an edit in the mail client
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
    // An unknown sender is stored as the English placeholder (plan D19); the approval renderer maps it to the row's language.
    sender:
      draft.kind === "reminder" || draft.kind === "follow_up"
        ? null
        : { label: senderLabel(original.fromAddress, textTables.en), external: input.external },
    recipientInactive: input.recipientInactive,
    subject: message.subject,
    dueDate,
    body: message.parts.body,
    quote: message.parts.quote === null ? null : quoteCut(message.parts.quote),
    synthetic: input.synthetic,
    ...(draft.kind === "follow_up"
      ? {
          to: message.to.map((entry) => entry.address),
          cc: message.cc.map((entry) => entry.address),
          followUpNumber: draft.n,
        }
      : {}),
    // A reply may carry a Cc after "Reply all": the card and the panel spell every recipient out.
    ...(draft.kind === "reply"
      ? { to: message.to.map((entry) => entry.address), cc: message.cc.map((entry) => entry.address) }
      : {}),
  };
}
