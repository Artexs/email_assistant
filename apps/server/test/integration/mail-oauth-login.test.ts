import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { INBOX, openImapProvider, openSmtpSender, verifySmtpLogin } from "../../src/modules/mail";

// Local GreenMail (bun run dev:up). Auth is off, so GreenMail accepts any token: these tests prove that the XOAUTH2
// exchange of the adapters works against a real server, not that a token is checked.
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";

test("an IMAP login with an oauth access token passes (GreenMail with auth off accepts any token)", async () => {
  const address = `u-${randomUUID()}@localhost`;
  const provider = await openImapProvider({
    host,
    port: imapPort,
    user: address,
    auth: { kind: "oauth", accessToken: "any-token" },
  });
  try {
    const info = await provider.serverInfo();
    expect(info.folders.map((folder) => folder.path)).toContain(INBOX);
  } finally {
    await provider.close();
  }
});

test("an SMTP verifySmtpLogin with an oauth access token passes (GreenMail with auth off accepts any token)", async () => {
  await verifySmtpLogin({
    host,
    port: smtpPort,
    user: `u-${randomUUID()}@localhost`,
    auth: { kind: "oauth", accessToken: "any-token" },
    secure: false,
  });
});

test("a send with an oauth access token reaches the recipient (GreenMail with auth off accepts any token)", async () => {
  const sender = `u-${randomUUID()}@localhost`;
  const recipient = `v-${randomUUID()}@localhost`;
  const raw = Buffer.from(
    `Message-ID: <${randomUUID()}@ea.test>\r\nFrom: ${sender}\r\nTo: ${recipient}\r\nSubject: oauth\r\n\r\nhello\r\n`
  );
  const smtp = await openSmtpSender({
    host,
    port: smtpPort,
    user: sender,
    auth: { kind: "oauth", accessToken: "any-token" },
    secure: false,
  });
  const result = await smtp.send({ envelope: { from: sender, to: [recipient] }, raw });
  await smtp.close();
  expect(result.accepted).toEqual([recipient]);
  const inbox = await openImapProvider({
    host,
    port: imapPort,
    user: recipient,
    auth: { kind: "oauth", accessToken: "any-token" },
  });
  try {
    const status = await inbox.folderStatus(INBOX);
    expect(status.highestUid).toBeGreaterThanOrEqual(1);
  } finally {
    await inbox.close();
  }
});
