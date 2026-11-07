import type { OutgoingAddress, OutgoingMessage } from "@ea/core";
import MailComposer from "nodemailer/lib/mail-composer";

function toAddress(address: OutgoingAddress): { name?: string; address: string } {
  return address.name === null ? { address: address.address } : { name: address.name, address: address.address };
}

/** The MIME bytes of an outgoing message. The same message always gives the same bytes: the draft and the send share them. */
export async function composeMessage(message: OutgoingMessage): Promise<Buffer> {
  const composer = new MailComposer({
    from: toAddress(message.from),
    to: message.to.map(toAddress),
    subject: message.subject,
    // nodemailer keeps bare LF in a quoted-printable body; the wire format needs CRLF.
    text: message.text.replace(/\r?\n/g, "\r\n"),
    messageId: message.messageId,
    date: message.date,
    inReplyTo: message.inReplyTo ?? undefined,
    references: message.references.length > 0 ? message.references.join(" ") : undefined,
    headers: message.headers,
  });
  return composer.compile().build();
}
