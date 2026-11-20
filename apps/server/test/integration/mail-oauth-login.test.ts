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

// A one-connection SMTP server that offers XOAUTH2 and records each AUTH line: GreenMail with auth off cannot show
// which login a client sent.
function startAuthRecordingSmtp(): { port: number; authLines: string[]; stop: () => void } {
  const authLines: string[] = [];
  const server = Bun.listen<{ buffer: string }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buffer: "" };
        socket.write("220 fake ESMTP\r\n");
      },
      data(socket, chunk) {
        socket.data.buffer += chunk.toString("utf8");
        const lines = socket.data.buffer.split("\r\n");
        socket.data.buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("EHLO")) socket.write("250-fake\r\n250 AUTH XOAUTH2\r\n");
          else if (line.startsWith("AUTH ")) {
            authLines.push(line);
            socket.write("235 2.7.0 accepted\r\n");
          } else if (line === "QUIT") socket.end("221 bye\r\n");
          else socket.write("250 ok\r\n");
        }
      },
    },
  });
  return { port: server.port, authLines, stop: () => server.stop(true) };
}

test("an SMTP verifySmtpLogin with an oauth access token passes (GreenMail with auth off accepts any token)", async () => {
  const token = "any-token";
  await expect(
    verifySmtpLogin({
      host,
      port: smtpPort,
      user: `u-${randomUUID()}@localhost`,
      auth: { kind: "oauth", accessToken: token },
      secure: false,
    })
  ).resolves.toBeUndefined();
  // GreenMail cannot show the login it got: a recording server shows that the XOAUTH2 login of the user and token went out.
  const smtp = startAuthRecordingSmtp();
  try {
    const user = `u-${randomUUID()}@localhost`;
    await verifySmtpLogin({ host, port: smtp.port, user, auth: { kind: "oauth", accessToken: token }, secure: false });
    const sent = Buffer.from(`user=${user}\u0001auth=Bearer ${token}\u0001\u0001`).toString("base64");
    expect(smtp.authLines).toEqual([`AUTH XOAUTH2 ${sent}`]);
  } finally {
    smtp.stop();
  }
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
