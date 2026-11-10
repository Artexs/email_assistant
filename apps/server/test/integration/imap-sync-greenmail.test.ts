import { randomUUID } from "node:crypto";

import { afterAll, expect, test } from "bun:test";

import {
  connectMailbox,
  openImapProvider,
  renderSeedMessage,
  syncMailbox,
  verifySmtpLogin,
  type ImapConnectOptions,
} from "../../src/modules/mail";
import { appendRaw } from "../../src/modules/mail/imap/tools";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
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

test("a mail in a sort folder is stored once with its source folder, also after a second run", async () => {
  await withRollback(db, async (trx) => {
    const suffix = randomUUID();
    const { orgId } = await createOrganizationWithOwner(trx, {
      orgName: `Folder Org ${suffix}`,
      timezone: "Europe/Warsaw",
      email: `folder-${suffix}@x.test`,
      displayName: "Owner",
    });
    const ctx = { orgId };
    const address = `u-${suffix}@localhost`;
    const imap: ImapConnectOptions = { host, port: imapPort, user: address, password: `pw-${suffix}` };
    const { mailboxId } = await connectMailbox(
      { db: trx, secrets, openProvider: openImapProvider, verifySmtp: verifySmtpLogin },
      ctx,
      {
        address,
        password: imap.password,
        secretKind: "password",
        imapHost: host,
        imapPort,
        smtpHost: host,
        smtpPort,
      }
    );
    await appendRaw(
      imap,
      "Oferty",
      renderSeedMessage({
        messageId: `<offer-${suffix}@x.test>`,
        from: "shop@x.test",
        to: [address],
        subject: "Offer",
        date: new Date(),
        text: "Body",
      })
    );

    await appendRaw(
      imap,
      "Wiadomości-śmieci",
      renderSeedMessage({
        messageId: `<junk-${suffix}@x.test>`,
        from: "spam@x.test",
        to: [address],
        subject: "Junk",
        date: new Date(),
        text: "Body",
      })
    );

    const provider = await openImapProvider(imap);
    try {
      const syncDeps = { db: trx, provider, isOwnActionId: async () => false, now: () => new Date() };
      const first = await syncMailbox(syncDeps, ctx, mailboxId);
      expect(first.added).toContain("offers");
      expect(first.failed).toEqual([]);
      const second = await syncMailbox(syncDeps, ctx, mailboxId);
      expect(second.folders.reduce((total, folder) => total + folder.stored, 0)).toBe(0);
    } finally {
      await provider.close();
    }

    const rows = await trx
      .selectFrom("emails")
      .select(["folder", "source_folder"])
      .where("mailbox_id", "=", mailboxId)
      .orderBy("source_folder")
      .execute();
    expect(rows).toEqual([
      { folder: "Oferty", source_folder: "Oferty" },
      { folder: "Wiadomości-śmieci", source_folder: "Wiadomości-śmieci" },
    ]);
  });
});
