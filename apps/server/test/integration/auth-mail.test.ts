import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { INBOX, openImapProvider } from "../../src/modules/mail";
import { createAuthMailer } from "../../src/platform/auth-mail";
import type { AuthMailSettings } from "../../src/platform/config";

// Local GreenMail (bun run dev:up). Auth is off: a login with a new user creates the mailbox.
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");

const settings: AuthMailSettings = {
  host,
  port: smtpPort,
  security: "tls",
  user: "auth",
  password: "greenmail-test",
  from: "noreply@x.test",
};

test("an invite in Polish reaches the recipient inbox", async () => {
  const to = `auth-mail-${randomUUID()}@x.test`;
  const result = await createAuthMailer(settings).send({
    kind: "invite",
    userId: randomUUID(),
    to,
    locale: "pl",
    url: "https://x.test/setup/token",
  });
  expect(result).toEqual({ ok: true });

  const inbox = await openImapProvider({ host, port: imapPort, user: to, password: "greenmail-test" });
  try {
    const messages = await inbox.fetchAbove(INBOX, 0);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.subject).toBe("Twoje konto w Email Assistant");
  } finally {
    await inbox.close();
  }
});

test("a port where nothing listens gives a failed result with a code", async () => {
  const result = await createAuthMailer({ ...settings, host: "127.0.0.1", port: 1 }).send({
    kind: "reset",
    userId: randomUUID(),
    to: "nobody@x.test",
    locale: "en",
    url: "https://x.test/reset",
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toMatch(/^[A-Z][A-Z_]{1,19}$/);
});
