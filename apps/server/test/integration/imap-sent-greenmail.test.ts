import { randomUUID } from "node:crypto";

import { HOUR_MS } from "@ea/core";
import { afterAll, beforeEach, expect, test } from "bun:test";

import {
  connectMailbox,
  openImapProvider,
  renderSeedMessage,
  verifySmtpLogin,
  type ImapConnectOptions,
} from "../../src/modules/mail";
import { appendRaw } from "../../src/modules/mail/imap/tools";
import { setFolderMapEntry, writeSentSwitch } from "../../src/modules/mail/repo";
import { syncSentFolder } from "../../src/modules/mail/sent-sync";
import { configureFeatures, createOrganizationWithOwner, upsertOrgFeature } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";

import { testDb, withRollback } from "./helpers";

// Needs the local GreenMail (bun run dev:up). Auth is off: any password logs in.
const db = testDb();
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");
const config = loadConfig();
const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);

afterAll(async () => {
  await db.destroy();
});

beforeEach(() => {
  configureFeatures({ off: [] });
});

test("the Sent pass keeps the flags, the UIDs and the numbering of the Sent folder on a real server", async () => {
  await withRollback(db, async (trx) => {
    const suffix = randomUUID();
    const { orgId } = await createOrganizationWithOwner(trx, {
      orgName: `Sent Org ${suffix}`,
      timezone: "Europe/Warsaw",
      email: `sent-${suffix}@x.test`,
      displayName: "Owner",
    });
    const ctx = { orgId };
    const address = `u-${suffix}@localhost`;
    const imap: ImapConnectOptions = {
      host,
      port: imapPort,
      user: address,
      auth: { kind: "password", password: `pw-${suffix}` },
    };
    const { mailboxId } = await connectMailbox(
      { db: trx, secrets, openProvider: openImapProvider, verifySmtp: verifySmtpLogin },
      ctx,
      {
        address,
        password: `pw-${suffix}`,
        secretKind: "password",
        imapHost: host,
        imapPort,
        smtpHost: host,
        smtpPort,
      }
    );
    const now = new Date();
    await upsertOrgFeature(trx, ctx, { flag: "sent_sync", enabled: true, setBy: "test", setAt: now });
    await writeSentSwitch(trx, ctx, mailboxId, { enabled: true, at: new Date(now.getTime() - 2 * HOUR_MS) });
    await setFolderMapEntry(trx, ctx, mailboxId, "sent", "Sent");

    const sentAt = new Date(now.getTime() - HOUR_MS);
    const parent = `<parent-${suffix}@x.test>`;
    await appendRaw(
      imap,
      "Sent",
      renderSeedMessage({
        messageId: `<reply-${suffix}@x.test>`,
        from: address,
        to: ["boss@x.test"],
        subject: "Re: plan",
        date: sentAt,
        inReplyTo: parent,
        text: "First text",
      })
    );
    await appendRaw(
      imap,
      "Sent",
      renderSeedMessage({
        messageId: `<note-${suffix}@x.test>`,
        from: address,
        to: ["team@x.test"],
        subject: "Notes",
        date: sentAt,
        text: "Second text",
      }),
      ["\\Seen"]
    );

    const provider = await openImapProvider(imap);
    try {
      const uids = (await provider.fetchAbove("Sent", 0)).map((meta) => meta.uid);
      expect(uids).toHaveLength(2);
      const [first, second] = uids as [number, number];
      const before = { status: await provider.folderStatus("Sent"), flags: await provider.fetchFlagsIn("Sent", uids) };

      const result = await syncSentFolder(
        { db: trx, provider, sentOriginOf: async () => null, now: () => now },
        ctx,
        mailboxId
      );
      expect(result).toMatchObject({ status: "done", stored: 2 });
      expect(result.texts.stored).toBe(2);

      const after = { status: await provider.folderStatus("Sent"), flags: await provider.fetchFlagsIn("Sent", uids) };
      const flagsOf = (list: typeof before.flags) => list.map((entry) => [entry.uid, [...entry.flags].sort()]);
      expect(flagsOf(after.flags)).toEqual(flagsOf(before.flags));
      expect(flagsOf(after.flags)).toEqual([
        [first, []],
        [second, ["\\Seen"]],
      ]);
      expect(after.status).toEqual(before.status);

      const rows = await trx
        .selectFrom("sent_emails")
        .select(["uid", "parent_message_id", "body_text", "content"])
        .where("mailbox_id", "=", mailboxId)
        .orderBy("uid")
        .execute();
      expect(rows.map((row) => Number(row.uid))).toEqual(uids);
      expect(rows[0]?.parent_message_id).toBe(parent);
      expect(rows[0]?.content).toBe("stored");
      expect(rows[1]?.body_text).toContain("Second text");
      expect(rows[0]?.body_text).toContain("First text");
    } finally {
      await provider.close();
    }
  });
});
