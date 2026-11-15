import type { OriginalMail } from "@ea/core";

import type { LoopAnchor } from "./hooks";

// The "original" that `buildOutgoingMessage` reads. One builder per anchor, shared by the committer (`drafts.ts`), the card
// and the panel read model (`channels`) and the panel edit, so the text that an owner sees is the text that is sent.

/** A follow-up has no incoming mail: the loop gives the thread ids; the subject, date and quote come from the payload. */
export function loopOriginal(anchor: LoopAnchor): OriginalMail {
  return {
    fromAddress: null,
    subject: anchor.subject,
    receivedAt: anchor.sentAt,
    messageId: anchor.messageId,
    inReplyTo: null,
    references: anchor.referencesIds,
    bodyText: null,
  };
}

export interface OriginalMailRow {
  from_address: string | null;
  subject: string | null;
  received_at: Date;
  message_id_header: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  body_text: string | null;
}

/** An incoming mail. */
export function mailOriginal(email: OriginalMailRow): OriginalMail {
  return {
    fromAddress: email.from_address,
    subject: email.subject,
    receivedAt: email.received_at,
    messageId: email.message_id_header,
    inReplyTo: email.in_reply_to,
    references: email.references_header?.split(/\s+/).filter((id) => id !== "") ?? [],
    bodyText: email.body_text,
  };
}
