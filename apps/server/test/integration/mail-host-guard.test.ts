import { randomBytes } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";

import {
  configureMailHosts,
  HostNotAllowedError,
  openImapProvider,
  openMailboxProvider,
  openSmtpSender,
  resolveMailHost,
  verifySmtpLogin,
  type LookupAll,
} from "../../src/modules/mail";
import { insertCredentials } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

afterAll(async () => {
  await db.destroy();
});

// The preload (`bunfig.toml`) allows local hosts for GreenMail. These tests set a refusing policy and put it back.
afterEach(() => {
  configureMailHosts({ allowLocal: true });
});

function refuseWith(answer: string): { calls: string[] } {
  const calls: string[] = [];
  const lookup: LookupAll = async (host) => {
    calls.push(host);
    return [{ address: answer, family: 4 }];
  };
  configureMailHosts({ allowLocal: false, lookup });
  return { calls };
}

const imapOptions = { host: "imap.x.test", port: 3143, user: "u@x.test", password: "greenmail-test" };
const smtpOptions = { host: "smtp.x.test", port: 3025, user: "u@x.test", password: "p" };

describe("the mail host guard on every connect", () => {
  test("openImapProvider refuses a name that resolves to a local address", async () => {
    refuseWith("127.0.0.1");
    await expect(openImapProvider(imapOptions)).rejects.toBeInstanceOf(HostNotAllowedError);
  });

  test("verifySmtpLogin and openSmtpSender refuse a name that resolves to a local address", async () => {
    refuseWith("127.0.0.1");
    await expect(verifySmtpLogin(smtpOptions)).rejects.toBeInstanceOf(HostNotAllowedError);
    await expect(openSmtpSender(smtpOptions)).rejects.toBeInstanceOf(HostNotAllowedError);
  });

  test("the sync and send path refuses a stored host that resolves to a private address", async () => {
    refuseWith("10.0.0.7");
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      await trx.updateTable("mailboxes").set({ imap_host: "rebind.x.test" }).where("id", "=", mailboxId).execute();
      const secret = secrets.encrypt("pw", `mailbox:${mailboxId}`);
      await insertCredentials(trx, ctx, {
        mailboxId,
        encryptedSecret: secret.ciphertext,
        secretKind: "password",
        keyVersion: secret.keyVersion,
      });
      await expect(
        openMailboxProvider(
          { db: trx, secrets, openProvider: openImapProvider, openSender: openSmtpSender },
          ctx,
          mailboxId,
          {
            withSender: true,
          }
        )
      ).rejects.toBeInstanceOf(HostNotAllowedError);
    });
  });

  test("a name that answered a public address once and a local address next is refused at the next connect", async () => {
    const calls: string[] = [];
    const answers = ["93.184.216.34", "127.0.0.1"];
    configureMailHosts({
      allowLocal: false,
      lookup: async (host) => {
        calls.push(host);
        return [{ address: answers[Math.min(calls.length, answers.length) - 1] ?? "127.0.0.1", family: 4 }];
      },
    });
    // The first connect would reach the public address; the test checks the lookup only, so no socket opens here.
    expect(await resolveMailHost("rebind.x.test")).toEqual({ host: "93.184.216.34", servername: "rebind.x.test" });
    await expect(openImapProvider({ ...imapOptions, host: "rebind.x.test" })).rejects.toBeInstanceOf(
      HostNotAllowedError
    );
    expect(calls).toEqual(["rebind.x.test", "rebind.x.test"]);
  });
});
