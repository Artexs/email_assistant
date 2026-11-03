import { expect, test } from "bun:test";

import { MailAuthError, openImapProvider } from "../../src/modules/mail";
import { HardError } from "../../src/platform/errors";

// GreenMail IMAPS has a self-signed certificate: the adapter must refuse it.
// Host "localhost", not "127.0.0.1": for an IP literal imapflow sets `servername: false`, and Bun's
// `tls.connect` throws on that before any certificate check, so the test would pass for the wrong reason.
test("IMAPS with a self-signed certificate is rejected, and not as a login failure", async () => {
  const attempt = openImapProvider({
    host: "localhost",
    port: Number(process.env.TEST_IMAPS_PORT ?? "3993"),
    secure: true,
    user: "tls-check@localhost",
    password: "greenmail-test",
    connectionTimeoutMs: 10_000,
  });
  const error = await attempt.then(
    async (provider) => {
      await provider.close();
      return null;
    },
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(HardError);
  expect(error).not.toBeInstanceOf(MailAuthError);
  const cause = (error as { cause?: { code?: unknown } }).cause;
  expect(String(cause?.code)).toMatch(/CERT|SELF_SIGNED/);
});
