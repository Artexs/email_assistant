import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { assertTestAddress, probeMove, renderSeedMessage, type ImapConnectOptions } from "../../src/modules/mail";
import { connectImapClient } from "../../src/modules/mail/imap/client";
import { sanitizeAlertText } from "../../src/modules/mail/imap/probe-move";
import { appendRaw } from "../../src/modules/mail/imap/tools";

// Local GreenMail (bun run dev:up). Auth is off: a login with a new user creates the mailbox.
function greenmailUser(): ImapConnectOptions {
  return {
    host: process.env.TEST_IMAP_HOST ?? "127.0.0.1",
    port: Number(process.env.TEST_IMAP_PORT ?? "3143"),
    user: `u-${randomUUID()}@localhost`,
    password: "greenmail-test",
  };
}

const NOW = new Date("2026-11-07T10:00:00Z");

async function listState(opts: ImapConnectOptions, subject: string) {
  const client = await connectImapClient(opts);
  try {
    const folders = (await client.list()).map((entry) => entry.path);
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ subject }, { uid: true });
      return { folders, inboxProbeUids: uids === false ? [] : uids };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

test("probeMove: runs every write on GreenMail and cleans up", async () => {
  const opts = greenmailUser();
  const probeId = randomUUID();
  const report = await probeMove(opts, { probeId, now: NOW });

  expect(report.delimiter === "." || report.delimiter === "/").toBe(true);
  expect(typeof report.namespace.prefix).toBe("string");
  expect(report.append.uid).toBeGreaterThan(0);
  expect(report.copy.uidMapReturned).toBe(true);
  expect(report.targetMeta).toEqual({
    found: true,
    sameSize: true,
    sameInternalDate: true,
    sameEnvelopeDate: true,
    sameMessageId: true,
  });
  expect(report.searchSinceInFolder.found).toBe(true);
  expect(report.expunge.otherDeletedKept).toBe(true);
  expect(report.expunge.inboxOtherDeleted).toBe(0);
  expect(report.expunge.sourceGone).toBe(true);
  expect(report.moveBack.inboxUid).toBeGreaterThan(0);
  expect(report.flags).toEqual({ flaggedKept: true, seenKept: true, flaggedRemoved: true, seenRemoved: true });
  expect(report.folders).toEqual({ nested: true, parentCreateOk: true });
  expect(report.cleanup).toEqual({
    probeMailDeleted: true,
    folderDeleted: true,
    parentFolderCreated: true,
    parentFolderDeleted: true,
  });

  const state = await listState(opts, `EA probe move ${probeId}`);
  expect(state.folders.some((path) => path.includes("Probe-"))).toBe(false);
  expect(state.folders.some((path) => path.toUpperCase() === "AI")).toBe(false);
  expect(state.inboxProbeUids).toEqual([]);
});

test("probeMove: an AI folder of the user stays", async () => {
  const opts = greenmailUser();
  const client = await connectImapClient(opts);
  try {
    await client.mailboxCreate("AI");
  } finally {
    await client.logout().catch(() => client.close());
  }

  const report = await probeMove(opts, { probeId: randomUUID(), now: NOW });

  expect(report.folders).toEqual({ nested: true, parentCreateOk: null });
  expect(report.cleanup.parentFolderCreated).toBe(false);
  expect(report.cleanup.parentFolderDeleted).toBe(false);
  expect(report.cleanup.folderDeleted).toBe(true);
  const state = await listState(opts, "none");
  expect(state.folders).toContain("AI");
});

test("assertTestAddress: another address throws, the same address in other case passes", () => {
  expect(() => assertTestAddress("a@example.test", "b@example.test")).toThrow();
  expect(() => assertTestAddress("a@example.test", undefined)).toThrow();
  expect(() => assertTestAddress("A@Example.test", "a@example.TEST")).not.toThrow();
});

test("probeMove: a \\Deleted mail of the user in INBOX makes the probe skip every INBOX expunge", async () => {
  const opts = greenmailUser();
  const probeId = randomUUID();
  const userSubject = `User deleted mail ${probeId}`;
  await appendRaw(
    opts,
    "INBOX",
    renderSeedMessage({
      messageId: `<user-${probeId}@example.test>`,
      from: "boss@example.test",
      to: [opts.user],
      subject: userSubject,
      date: NOW,
      text: "Marked deleted by the user.",
    }),
    ["\\Deleted"]
  );

  const report = await probeMove(opts, { probeId, now: NOW });

  expect(report.expunge.inboxExpungeSkipped).toBe(true);
  expect(report.expunge.inboxOtherDeleted).toBe(1);
  expect(report.moveBack.sameAsOriginal).toBeNull();
  expect(report.cleanup.probeMailDeleted).toBe(false);
  expect(report.notes.join("\n")).toContain(`EA probe move ${probeId}`);

  // The user's mail is still there; the test removes it and the probe mails itself (UID EXPUNGE).
  const client = await connectImapClient(opts);
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const userUids = await client.search({ subject: userSubject }, { uid: true });
      expect(userUids === false ? [] : userUids).toHaveLength(1);
      const probeUids = await client.search({ subject: `EA probe move ${probeId}` }, { uid: true });
      expect(probeUids === false ? [] : probeUids).toHaveLength(2);
      for (const uid of [...(userUids || []), ...(probeUids || [])]) {
        await client.messageDelete(String(uid), { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
});

test("sanitizeAlertText: printable characters only, collapsed, cut to 200, quoted", () => {
  expect(sanitizeAlertText("Folder\u0000 creation\r\n  not   allowed")).toBe('"Folder creation not allowed"');
  expect(sanitizeAlertText(`${"x".repeat(300)}`)).toBe(`"${"x".repeat(200)}"`);
  expect(sanitizeAlertText(" \u0007 ")).toBeNull();
  expect(sanitizeAlertText(undefined)).toBeNull();
});
