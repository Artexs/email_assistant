import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { openImapProvider, renderSeedMessage, type ImapConnectOptions } from "../../src/modules/mail";
import { appendRaw } from "../../src/modules/mail/imap/tools";
import { describeMailProviderContract } from "../contract/mail-provider";

// Local GreenMail (bun run dev:up). Auth is off: a login with a new user creates the mailbox.
function greenmailUser(): ImapConnectOptions {
  return {
    host: process.env.TEST_IMAP_HOST ?? "127.0.0.1",
    port: Number(process.env.TEST_IMAP_PORT ?? "3143"),
    user: `u-${randomUUID()}@localhost`,
    password: "greenmail-test",
  };
}

describeMailProviderContract("imap-greenmail", async () => {
  const opts = greenmailUser();
  const provider = await openImapProvider(opts);
  return {
    provider,
    seed: (folder, msg) => appendRaw(opts, folder, renderSeedMessage(msg)),
    cleanup: () => provider.close(),
  };
});

test("imap-greenmail: INBOX works again after a lookup in a missing folder", async () => {
  const opts = greenmailUser();
  const provider = await openImapProvider(opts);
  try {
    await appendRaw(
      opts,
      "INBOX",
      renderSeedMessage({
        messageId: "<after-missing@example.test>",
        from: "boss@example.test",
        to: ["me@example.test"],
        subject: "After missing",
        date: new Date(),
        text: "Body",
      })
    );
    expect(await provider.findByMessageId("No-such-folder", "<after-missing@example.test>")).toBeNull();
    const metas = await provider.fetchAbove(0);
    expect(metas.map((m) => m.messageId)).toEqual(["<after-missing@example.test>"]);
  } finally {
    await provider.close();
  }
});

test("imap-greenmail: fetchAbove on an empty INBOX gives []", async () => {
  const provider = await openImapProvider(greenmailUser());
  try {
    expect(await provider.fetchAbove(0)).toEqual([]);
  } finally {
    await provider.close();
  }
});
