import { randomUUID } from "node:crypto";

import { buildOutgoingMessage } from "@ea/core";
import { expect, test } from "bun:test";

import { composeMessage, INBOX, openImapProvider, openSmtpSender } from "../../src/modules/mail";
import { connectImapClient } from "../../src/modules/mail/imap/client";
import { runMailSenderContract } from "../contract/mail-sender";

// Local GreenMail (bun run dev:up). Auth is off: a login with a new user creates the mailbox.
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";

// The SMTP sender on GreenMail. GreenMail makes a mailbox for each new address and refuses no login, so the
// refused-login case runs against the scripted server of `imap/auth-material.test.ts`.
runMailSenderContract(
  "smtp-greenmail",
  async () => {
    const recipients = { b: `b-${randomUUID()}@localhost`, c: `c-${randomUUID()}@localhost` };
    return {
      recipients: () => recipients,
      open: ({ from }) =>
        openSmtpSender({
          host,
          port: smtpPort,
          user: from,
          auth: { kind: "password", password: "greenmail-test" },
          secure: false,
        }),
      // The mail is in the inbox of its recipient (a short wait: GreenMail delivers after the 250).
      async received(messageId) {
        for (const user of [recipients.b, recipients.c]) {
          const client = await connectImapClient({
            host,
            port: imapPort,
            user,
            auth: { kind: "password", password: "greenmail-test" },
          });
          try {
            const lock = await client.getMailboxLock(INBOX);
            try {
              for (let attempt = 0; attempt < 20; attempt += 1) {
                const [uid] = (await client.search({ header: { "message-id": messageId } }, { uid: true })) || [];
                if (uid !== undefined) {
                  const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
                  if (message !== false && message.source !== undefined) return message.source;
                }
                await Bun.sleep(50);
              }
            } finally {
              lock.release();
            }
          } finally {
            await client.logout().catch(() => client.close());
          }
        }
        return null;
      },
    };
  },
  { noRefusal: "GreenMail with auth off refuses no login; the scripted SMTP server covers it" }
);

test("a composed message reaches the recipient with the action id and the message id", async () => {
  const sender = `u-${randomUUID()}@localhost`;
  const recipient = `v-${randomUUID()}@localhost`;
  const draftActionId = randomUUID();
  const message = buildOutgoingMessage({
    draft: {
      kind: "delegation",
      delegate_id: randomUUID(),
      delegate_name: "Jan Kowalski",
      to: [recipient],
      task: "Przygotuj ofertę",
      due_date: "2026-11-10",
      language: "pl",
    },
    draftActionId,
    createdAt: new Date(),
    mailbox: { address: sender },
    owner: { displayName: "Artek" },
    organization: { timezone: "Europe/Warsaw" },
    original: {
      fromAddress: "klient@example.test",
      subject: "Oferta",
      receivedAt: new Date(),
      messageId: "<orig@example.test>",
      inReplyTo: null,
      references: [],
      bodyText: "Proszę o ofertę.",
    },
  });
  const raw = await composeMessage(message);

  const smtp = await openSmtpSender({
    host,
    port: smtpPort,
    user: sender,
    auth: { kind: "password", password: "greenmail-test" },
    secure: false,
  });
  const result = await smtp.send({ envelope: { from: sender, to: [recipient] }, raw });
  await smtp.close();
  expect(result.response.startsWith("250")).toBe(true);
  expect(result.accepted).toEqual([recipient]);

  const inbox = await openImapProvider({
    host,
    port: imapPort,
    user: recipient,
    auth: { kind: "password", password: "greenmail-test" },
  });
  try {
    const found = (await inbox.fetchAbove(INBOX, 0)).filter((meta) => meta.messageId === message.messageId);
    expect(found).toHaveLength(1);
    expect(found[0]?.actionId).toBe(draftActionId);
  } finally {
    await inbox.close();
  }
});
