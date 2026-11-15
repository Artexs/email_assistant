import type { LabMessage } from "@ea/core";

import { renderSeedMessage } from "../mail";

/**
 * The RFC 5322 text of a lab message. The Message-ID of the message stays as it is: inside the sim stack, lab
 * mail is real mail, so it never gets the synthetic `@ea-seed.test` id.
 */
export function renderLabMessage(message: LabMessage): string {
  return renderSeedMessage({
    messageId: message.messageId,
    from: `${message.from.name} <${message.from.address}>`,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    date: new Date(message.date),
    text: message.text,
    html: message.html,
    inReplyTo: message.inReplyTo,
    references: message.references,
    headers: message.headers,
  });
}
