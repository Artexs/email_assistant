import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { INBOX, openImapProvider, renderSeedMessage, type ImapConnectOptions } from "../../src/modules/mail";
import { connectImapClient } from "../../src/modules/mail/imap/client";
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

function seedMail(messageId: string) {
  return {
    messageId,
    from: "boss@example.test",
    to: ["me@example.test"],
    subject: "Leftover",
    date: new Date(),
    text: "Body",
  };
}

function greenmailContract(name: string, forceCopyMove: boolean): void {
  describeMailProviderContract(name, async () => {
    const opts = { ...greenmailUser(), forceCopyMove };
    const provider = await openImapProvider(opts);
    return {
      provider,
      seed: (folder, msg) => appendRaw(opts, folder, renderSeedMessage(msg)),
      cleanup: () => provider.close(),
    };
  });
}

greenmailContract("imap-greenmail", false);
greenmailContract("imap-greenmail-copy-path", true);

test("imap-greenmail: the COPY path leaves no \\Deleted mail in the source folder", async () => {
  const opts = { ...greenmailUser(), forceCopyMove: true };
  const provider = await openImapProvider(opts);
  const client = await connectImapClient(opts);
  try {
    await appendRaw(opts, "INBOX", renderSeedMessage(seedMail("<copy-leftover@example.test>")));
    const uid = (await provider.fetchAbove(INBOX, 0))[0]?.uid ?? 0;
    const folder = await provider.ensureFolder("AI/Leftover");
    await provider.moveMessage("INBOX", uid, folder);
    const lock = await client.getMailboxLock("INBOX");
    try {
      expect(await client.search({ deleted: true }, { uid: true })).toEqual([]);
    } finally {
      lock.release();
    }
    expect(await provider.fetchAbove(INBOX, 0)).toEqual([]);
  } finally {
    await provider.close();
    await client.logout();
  }
});

test("imap-greenmail: ensureFolder makes a nested folder that serverInfo lists", async () => {
  const provider = await openImapProvider(greenmailUser());
  try {
    const path = await provider.ensureFolder("AI/Info");
    expect(path).toMatch(/^AI[./]Info$/);
    const folders = (await provider.serverInfo()).folders.map((f) => f.path);
    expect(folders).toContain(path);
    expect(folders).toContain("AI");
  } finally {
    await provider.close();
  }
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
    expect(await provider.fetchMetaIn("No-such-folder", 1)).toBeNull();
    const metas = await provider.fetchAbove(INBOX, 0);
    expect(metas.map((m) => m.messageId)).toEqual(["<after-missing@example.test>"]);
  } finally {
    await provider.close();
  }
});

test("imap-greenmail: fetchAbove on an empty INBOX gives []", async () => {
  const provider = await openImapProvider(greenmailUser());
  try {
    expect(await provider.fetchAbove(INBOX, 0)).toEqual([]);
  } finally {
    await provider.close();
  }
});
