import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";

import type { ImapConnectOptions, SmtpConnectOptions } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { openMailboxProvider } from "../../src/modules/mail/open";
import { insertCredentials } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import { HardError } from "../../src/platform/errors";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

afterAll(async () => {
  await db.destroy();
});

describe("openMailboxProvider", () => {
  test("decrypts the password and passes host, port, user and password to openProvider", async () => {
    await withRollback(db, async (trx) => {
      const address = `box-${randomUUID()}@x.test`;
      const { orgId, mailboxId } = await createOrgWithMailbox(trx, { address });
      const ctx = { orgId };
      const secret = secrets.encrypt("s3cret-pw", `mailbox:${mailboxId}`);
      await insertCredentials(trx, ctx, {
        mailboxId,
        encryptedSecret: secret.ciphertext,
        secretKind: "password",
        keyVersion: secret.keyVersion,
      });
      const seen: ImapConnectOptions[] = [];
      const fake = createFakeMailProvider();
      const deps = {
        db: trx,
        secrets,
        openProvider: async (opts: ImapConnectOptions) => {
          seen.push(opts);
          return fake;
        },
      };

      const { provider, mailbox } = await openMailboxProvider(deps, ctx, mailboxId);
      expect(provider).toBe(fake);
      expect(mailbox.id).toBe(mailboxId);
      expect(seen).toEqual([
        { host: mailbox.imap_host, port: mailbox.imap_port, user: address, password: "s3cret-pw" },
      ]);
    });
  });

  test("withSender opens the SMTP sender with the same password and the smtp host and port", async () => {
    await withRollback(db, async (trx) => {
      const address = `box-${randomUUID()}@x.test`;
      const { orgId, mailboxId } = await createOrgWithMailbox(trx, { address });
      const ctx = { orgId };
      const secret = secrets.encrypt("s3cret-pw", `mailbox:${mailboxId}`);
      await insertCredentials(trx, ctx, {
        mailboxId,
        encryptedSecret: secret.ciphertext,
        secretKind: "password",
        keyVersion: secret.keyVersion,
      });
      const seen: SmtpConnectOptions[] = [];
      const fakeSender = createFakeMailSender();
      const fake = createFakeMailProvider();
      const deps = {
        db: trx,
        secrets,
        openProvider: async () => fake,
        openSender: async (opts: SmtpConnectOptions) => {
          seen.push(opts);
          return fakeSender;
        },
      };

      const without = await openMailboxProvider(deps, ctx, mailboxId);
      expect(without.sender).toBeNull();
      expect(seen).toEqual([]);

      const { sender, mailbox } = await openMailboxProvider(deps, ctx, mailboxId, { withSender: true });
      expect(sender).toBe(fakeSender);
      expect(seen).toEqual([
        { host: mailbox.smtp_host, port: mailbox.smtp_port, user: address, password: "s3cret-pw" },
      ]);

      const failing = {
        ...deps,
        openSender: async () => {
          throw new HardError("smtp");
        },
      };
      fake.closed = false;
      await expect(openMailboxProvider(failing, ctx, mailboxId, { withSender: true })).rejects.toBeInstanceOf(
        HardError
      );
      expect(fake.closed).toBe(true);
    });
  });

  test("throws HardError for a missing mailbox, another org's mailbox and a missing password", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const deps = { db: trx, secrets, openProvider: async () => createFakeMailProvider() };

      await expect(openMailboxProvider(deps, { orgId: a.orgId }, randomUUID())).rejects.toBeInstanceOf(HardError);
      await expect(openMailboxProvider(deps, { orgId: b.orgId }, a.mailboxId)).rejects.toBeInstanceOf(HardError);
      await expect(openMailboxProvider(deps, { orgId: a.orgId }, a.mailboxId)).rejects.toBeInstanceOf(HardError);
    });
  });
});
