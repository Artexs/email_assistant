import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { probeSend, type ImapConnectOptions, type SmtpConnectOptions } from "../../src/modules/mail";
import { connectImapClient } from "../../src/modules/mail/imap/client";
import { isAllowedRecipient } from "../../src/modules/mail/imap/probe-send";
import type { SmtpConnectionLike } from "../../src/modules/mail/imap/smtp";

// Local GreenMail (bun run dev:up). Auth is off: a login with a new user creates the mailbox.
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const NOW = new Date("2026-11-07T10:00:00Z");

function greenmailUser(): { imap: ImapConnectOptions; smtp: SmtpConnectOptions; address: string } {
  const address = `u-${randomUUID()}@localhost`;
  return {
    address,
    imap: { host, port: Number(process.env.TEST_IMAP_PORT ?? "3143"), user: address, password: "greenmail-test" },
    smtp: { host, port: Number(process.env.TEST_SMTP_PORT ?? "3025"), user: address, password: "greenmail-test" },
  };
}

async function probeSubjectUids(opts: ImapConnectOptions, folders: string[], subject: string) {
  const client = await connectImapClient(opts);
  try {
    const found: Record<string, number[]> = {};
    for (const folder of folders) {
      const lock = await client.getMailboxLock(folder);
      try {
        const uids = await client.search({ subject }, { uid: true });
        found[folder] = uids === false ? [] : uids;
      } finally {
        lock.release();
      }
    }
    return found;
  } finally {
    await client.logout().catch(() => client.close());
  }
}

test("probeSend: runs every write on GreenMail and cleans up", async () => {
  const { imap, smtp, address } = greenmailUser();
  const probeId = randomUUID();
  const lines: string[] = [];

  const report = await probeSend(imap, smtp, {
    address,
    to: address,
    probeId,
    now: NOW,
    pollMs: 500,
    inboxTimeoutMs: 20_000,
    sentTimeoutMs: 2000,
    log: (line) => lines.push(line),
  });

  expect(report.capabilities.uidplus).toBe(true);
  expect(typeof report.capabilities.pipelining).toBe("boolean");
  expect(report.folders.created).toEqual(["Drafts", "Sent"]);
  expect(report.folders.drafts).toBe("Drafts");
  expect(report.folders.sent).toBe("Sent");
  expect(report.draft.appendUid).toBeGreaterThan(0);
  expect(report.draft).toMatchObject({
    searchSinceFound: true,
    headerFetched: true,
    envelopeMessageId: true,
    sizeEqualsRaw: true,
    internalDateKept: true,
    flagDraft: true,
    deleted: true,
    goneAfterDelete: true,
  });
  expect(report.send).toMatchObject({ ok: true, responseCode: 250, stage: null, code: null });
  expect(report.send.dataReplyCode).toBe(354);
  expect(report.sentCopy.appendUid).toBeGreaterThan(0);
  expect(report.sentCopy).toMatchObject({ headerFetched: true, searchSinceFound: true, deleted: true });
  expect(report.sentAutosave.foundInSent).toBe(false);
  expect(report.inbox).toMatchObject({ checked: true, ownMailFound: true, headerIntact: true, deleted: true });
  expect(report.inbox.uid).toBeGreaterThan(0);

  const left = await probeSubjectUids(imap, ["INBOX", "Drafts", "Sent"], `EA probe send ${probeId}`);
  expect(left).toEqual({ INBOX: [], Drafts: [], Sent: [] });
  // The log holds booleans, codes and uids; no address, no password, no raw.
  const logged = lines.join("\n");
  expect(logged).not.toContain(address);
  expect(logged).not.toContain("greenmail-test");
  expect(logged).not.toContain("Email assistant send probe");
});

test("isAllowedRecipient: the own address in any case or an address of the list", () => {
  expect(isAllowedRecipient("other@example.test", "me@example.test", undefined)).toBe(false);
  expect(isAllowedRecipient("other@example.test", "me@example.test", "")).toBe(false);
  expect(isAllowedRecipient("ME@Example.test", "me@example.test", undefined)).toBe(true);
  expect(isAllowedRecipient("Other@Example.test", "me@example.test", "a@example.test, other@example.TEST")).toBe(true);
  expect(isAllowedRecipient("third@example.test", "me@example.test", "a@example.test,other@example.test")).toBe(false);
});

test("probeSend: a refused recipient stops before the Sent copy and the INBOX check", async () => {
  const { imap, smtp, address } = greenmailUser();
  const probeId = randomUUID();
  const refused = Object.assign(new Error("refused"), { code: "EENVELOPE", command: "RCPT TO", responseCode: 550 });
  const stub: SmtpConnectionLike = {
    connect: (callback) => callback(),
    login: (_auth, callback) => callback(null),
    send: (_envelope, _message, callback) => callback(refused),
    quit: () => undefined,
    close: () => undefined,
    on: () => undefined,
  };

  const report = await probeSend(imap, smtp, {
    address,
    to: address,
    probeId,
    now: NOW,
    pollMs: 500,
    inboxTimeoutMs: 2000,
    sentTimeoutMs: 1000,
    smtpConnection: () => stub,
  });

  expect(report.draft.deleted).toBe(true);
  expect(report.send).toMatchObject({ ok: false, stage: "envelope", code: "EENVELOPE", responseCode: 550 });
  expect(report.sentCopy.appendUid).toBeNull();
  expect(report.inbox.checked).toBe(false);
  expect(report.capabilities.pipelining).toBeNull();
});
