import { randomUUID } from "node:crypto";

import { buildOutgoingMessage } from "@ea/core";
import { expect, test } from "bun:test";

import { composeMessage, INBOX, openImapProvider, openSmtpSender } from "../../src/modules/mail";

// Local GreenMail (bun run dev:up). Auth is off: a login with a new user creates the mailbox.
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";

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
    organization: { styleText: null, timezone: "Europe/Warsaw" },
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

  const smtp = await openSmtpSender({ host, port: smtpPort, user: sender, password: "greenmail-test", secure: false });
  const result = await smtp.send({ envelope: { from: sender, to: [recipient] }, raw });
  await smtp.close();
  expect(result.response.startsWith("250")).toBe(true);
  expect(result.accepted).toEqual([recipient]);

  const inbox = await openImapProvider({ host, port: imapPort, user: recipient, password: "greenmail-test" });
  try {
    const found = (await inbox.fetchAbove(INBOX, 0)).filter((meta) => meta.messageId === message.messageId);
    expect(found).toHaveLength(1);
    expect(found[0]?.actionId).toBe(draftActionId);
  } finally {
    await inbox.close();
  }
});
