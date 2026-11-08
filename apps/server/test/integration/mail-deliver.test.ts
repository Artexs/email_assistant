import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  connectMailbox,
  deliverTestMail,
  INBOX,
  MailNotFoundError,
  openImapProvider,
  renderSeedMessage,
  type DeliverInput,
  type ImapConnectOptions,
  type MailProvider,
} from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProviderOptions } from "../../src/modules/mail/fake";
import { connectImapClient } from "../../src/modules/mail/imap/client";
import { insertEmail } from "../../src/modules/mail/repo";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";

// Test 10 needs the local GreenMail (bun run dev:up). Auth is off: any password logs in.
const db = testDb();
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");
const config = loadConfig();
const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);

const SENDER = "ea-testmail-75wd@agentmail.to";
const OFFERS = "Oferty";

afterAll(async () => {
  await db.destroy();
});

async function createOrg(trx: Db | Transaction<DB>) {
  const suffix = randomUUID();
  return createOrganizationWithOwner(trx, {
    orgName: `Deliver Org ${suffix}`,
    timezone: "Europe/Warsaw",
    email: `deliver-${suffix}@x.test`,
    displayName: "Owner",
  });
}

async function connectWith(
  trx: Db | Transaction<DB>,
  ctx: TenantContext,
  openProvider: (imap: ImapConnectOptions) => Promise<MailProvider>,
  address = `u-${randomUUID()}@localhost`
) {
  const password = `deliver-pw-${randomUUID()}`;
  const { mailboxId } = await connectMailbox(
    { db: trx, secrets, openProvider, verifySmtp: () => Promise.resolve() },
    ctx,
    {
      address,
      password,
      secretKind: "password",
      imapHost: host,
      imapPort,
      smtpHost: host,
      smtpPort,
    }
  );
  return { mailboxId, address, imap: { host, port: imapPort, user: address, password } };
}

/** A mailbox on a fake; `opened` counts the `openProvider` calls of `deliverTestMail`. */
async function setup(trx: Transaction<DB>, fakeOptions: FakeMailProviderOptions = {}) {
  const { orgId } = await createOrg(trx);
  const ctx = { orgId };
  const fake = createFakeMailProvider(fakeOptions);
  const { mailboxId, address } = await connectWith(trx, ctx, async () => createFakeMailProvider());
  const state = { opened: 0 };
  const deps = {
    db: trx,
    secrets,
    openProvider: async () => {
      state.opened += 1;
      return fake;
    },
  };
  const run = (overrides: Partial<DeliverInput> & Pick<DeliverInput, "wanted">) =>
    deliverTestMail(deps, ctx, mailboxId, { testAddress: address, sender: SENDER, checkOnly: false, ...overrides });
  return { ctx, fake, mailboxId, address, state, run };
}

const NOW = new Date();

function want(...ids: string[]) {
  return ids.map((messageId) => ({ caseId: `case-${messageId}`, messageId: `<${messageId}@t.test>`, sentAt: NOW }));
}

function mail(id: string, from = SENDER) {
  return { messageId: `<${id}@t.test>`, from, to: ["u@localhost"], subject: id, date: NOW, text: id };
}

function ids(fake: ReturnType<typeof createFakeMailProvider>, folder: string): Promise<(string | null)[]> {
  return fake.fetchByUidsIn(folder, [1, 2, 3, 4, 5, 6, 7, 8]).then((metas) => metas.map((meta) => meta.messageId));
}

describe("deliverTestMail", () => {
  test("refuses a missing or other test address and opens no connection", async () => {
    await withRollback(db, async (trx) => {
      const { run, state } = await setup(trx);
      await expect(run({ wanted: want("a"), testAddress: undefined })).rejects.toThrow(
        "TEST_MAILBOX_ADDRESS is not set"
      );
      await expect(run({ wanted: want("a"), testAddress: "other@localhost" })).rejects.toThrow("not the test mailbox");
      expect(state.opened).toBe(0);
    });
  });

  test("refuses the mailbox as sender, a sender outside agentmail.to, and 0 or 201 wanted, before any connection", async () => {
    await withRollback(db, async (trx) => {
      const { run, address, state, fake } = await setup(trx);
      await expect(run({ wanted: want("a"), sender: address })).rejects.toThrow("deliver refused");
      await expect(run({ wanted: want("a"), sender: "x@other.test" })).rejects.toThrow("deliver refused");
      await expect(run({ wanted: [] })).rejects.toThrow("deliver refused");
      await expect(run({ wanted: want(...Array.from({ length: 201 }, (_, n) => `m${n}`)) })).rejects.toThrow(
        "deliver refused"
      );
      expect(state.opened).toBe(0);
      expect(fake.calls).toEqual([]);
    });
  });

  test("refuses an invalid sentAt or an empty messageId before any connection", async () => {
    await withRollback(db, async (trx) => {
      const { run, state, fake } = await setup(trx);
      const item = { caseId: "case-a", messageId: "<a@t.test>", sentAt: NOW };
      await expect(run({ wanted: [{ ...item, sentAt: new Date("nope") }] })).rejects.toThrow("deliver refused");
      await expect(run({ wanted: [{ ...item, messageId: "  " }] })).rejects.toThrow("deliver refused");
      expect(state.opened).toBe(0);
      expect(fake.calls).toEqual([]);
    });
  });

  test("moves a from Oferty, leaves b, skips c (synced) and d, and ignores e from another sender", async () => {
    await withRollback(db, async (trx) => {
      const { run, fake, ctx, mailboxId } = await setup(trx);
      await fake.ensureFolder(OFFERS);
      fake.deliver(OFFERS, mail("a"));
      fake.deliver(INBOX, mail("b"));
      fake.deliver(OFFERS, { ...mail("a"), from: "other@x.test" }); // e: the id of a, another sender
      await insertEmail(trx, ctx, {
        mailbox_id: mailboxId,
        dedup_key: "mid:c",
        message_id_header: "<c@t.test>",
        content_hash: "hc",
        uid: 1,
        thread_key: "<c@t.test>",
        from_address: SENDER,
        subject: "c",
        received_at: NOW,
      });

      const result = await run({ wanted: want("a", "b", "c", "d") });

      expect(result.map((item) => item.result)).toEqual(["moved", "in_inbox", "synced", "not_found"]);
      expect(await ids(fake, INBOX)).toEqual(["<b@t.test>", "<a@t.test>"]);
      expect((await fake.fetchByUidsIn(OFFERS, [1, 2, 3])).map((meta) => meta.from)).toEqual(["other@x.test"]);
      expect(fake.closed).toBe(true);
    });
  });

  test("copy path: a failed delete leaves both copies, the next run removes the duplicate", async () => {
    await withRollback(db, async (trx) => {
      const { run, fake } = await setup(trx, { capabilities: { move: false, uidplus: true } });
      await fake.ensureFolder(OFFERS);
      fake.deliver(OFFERS, mail("a"));
      fake.failOn("deleteMessage", new Error("delete failed"));

      await expect(run({ wanted: want("a") })).rejects.toThrow("delete failed");
      expect(fake.closed).toBe(true);
      expect(await ids(fake, INBOX)).toEqual(["<a@t.test>"]);
      expect(await ids(fake, OFFERS)).toEqual(["<a@t.test>"]);

      const second = await run({ wanted: want("a") });
      expect(second.map((item) => item.result)).toEqual(["duplicate_removed"]);
      expect(await ids(fake, OFFERS)).toEqual([]);
      expect(await ids(fake, INBOX)).toEqual(["<a@t.test>"]);
    });
  });

  test("synced ids: the Oferty copy goes only when an INBOX copy exists", async () => {
    await withRollback(db, async (trx) => {
      const { run, fake, ctx, mailboxId } = await setup(trx);
      await fake.ensureFolder(OFFERS);
      for (const id of ["a", "b"]) {
        await insertEmail(trx, ctx, {
          mailbox_id: mailboxId,
          dedup_key: `mid:${id}`,
          message_id_header: `<${id}@t.test>`,
          content_hash: `h${id}`,
          uid: 1,
          thread_key: `<${id}@t.test>`,
          from_address: SENDER,
          subject: id,
          received_at: NOW,
        });
      }
      fake.deliver(INBOX, mail("a"));
      fake.deliver(OFFERS, mail("a")); // uid 1
      fake.deliver(OFFERS, mail("b")); // uid 2

      const result = await run({ wanted: want("a", "b") });

      expect(result.map((item) => item.result)).toEqual(["synced", "synced"]);
      expect(await ids(fake, INBOX)).toEqual(["<a@t.test>"]);
      expect(await ids(fake, OFFERS)).toEqual(["<b@t.test>"]);
      expect(fake.calls.filter((call) => call === "deleteMessage")).toHaveLength(1);
    });
  });

  test("a move that finds no message gives not_found, skips the deletes of its case and goes on", async () => {
    await withRollback(db, async (trx) => {
      const { run, fake } = await setup(trx);
      await fake.ensureFolder(OFFERS);
      fake.deliver(OFFERS, mail("a")); // uid 1
      fake.deliver(OFFERS, mail("a")); // uid 2, a duplicate in the same folder
      fake.deliver(OFFERS, mail("b"));
      fake.failOn("moveMessage", new MailNotFoundError("gone"));

      const result = await run({ wanted: want("a", "b") });

      expect(result.map((item) => item.result)).toEqual(["not_found", "moved"]);
      expect(await ids(fake, OFFERS)).toEqual(["<a@t.test>", "<a@t.test>"]);
      expect(await ids(fake, INBOX)).toEqual(["<b@t.test>"]);
      expect(fake.calls).not.toContain("deleteMessage");
    });
  });

  test("finds the mail in the \\Junk folder", async () => {
    await withRollback(db, async (trx) => {
      const { run, fake } = await setup(trx, { folderSpecialUse: { "Wiadomości-śmieci": "\\Junk" } });
      fake.deliver("Wiadomości-śmieci", mail("a"));

      const result = await run({ wanted: want("a") });

      expect(result.map((item) => [item.result, item.folder])).toEqual([["moved", "junk"]]);
      expect(await ids(fake, INBOX)).toEqual(["<a@t.test>"]);
    });
  });

  test("checkOnly reports the plan and writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { run, fake } = await setup(trx);
      await fake.ensureFolder(OFFERS);
      fake.deliver(OFFERS, mail("a"));

      const result = await run({ wanted: want("a"), checkOnly: true });

      expect(result).toEqual([
        {
          caseId: "case-a",
          result: "moved",
          folder: "offers",
          ops: [{ op: "move", folder: "offers", uid: 1 }],
        },
      ]);
      expect(await ids(fake, OFFERS)).toEqual(["<a@t.test>"]);
      expect(fake.calls).not.toContain("moveMessage");
      expect(fake.calls).not.toContain("deleteMessage");
    });
  });

  test("a sender outside agentmail.to throws before any provider call", async () => {
    await withRollback(db, async (trx) => {
      const { run, fake } = await setup(trx);
      await expect(run({ wanted: want("a"), sender: "x@other.test" })).rejects.toThrow("deliver refused");
      expect(fake.calls).toEqual([]);
    });
  });

  test("GreenMail: the sender's mail moves from Oferty into INBOX, the other mail stays, a repeat gives in_inbox", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrg(trx);
      const ctx = { orgId };
      const { mailboxId, address, imap } = await connectWith(trx, ctx, openImapProvider);
      const provider = await openImapProvider(imap);
      const own = `<own-${randomUUID()}@t.test>`;
      const other = `<other-${randomUUID()}@t.test>`;
      try {
        await provider.ensureFolder(OFFERS);
        const base = { to: [address], date: new Date(), text: "x" };
        await provider.appendMessage(
          OFFERS,
          Buffer.from(renderSeedMessage({ ...base, messageId: own, from: SENDER, subject: "own" })),
          [],
          new Date()
        );
        await provider.appendMessage(
          OFFERS,
          Buffer.from(renderSeedMessage({ ...base, messageId: other, from: "other@x.test", subject: "other" })),
          [],
          new Date()
        );
      } finally {
        await provider.close();
      }
      const input = {
        testAddress: address,
        sender: SENDER,
        wanted: [{ caseId: "own", messageId: own, sentAt: new Date() }],
        checkOnly: false,
      };
      const deps = { db: trx, secrets };

      const first = await deliverTestMail(deps, ctx, mailboxId, input);
      expect(first.map((item) => item.result)).toEqual(["moved"]);
      expect(await folderMessageIds(imap, INBOX)).toEqual([own]);
      expect(await folderMessageIds(imap, OFFERS)).toEqual([other]);

      const second = await deliverTestMail(deps, ctx, mailboxId, input);
      expect(second.map((item) => item.result)).toEqual(["in_inbox"]);
    });
  });
});

async function folderMessageIds(imap: ImapConnectOptions, path: string): Promise<string[]> {
  const client = await connectImapClient(imap);
  try {
    const lock = await client.getMailboxLock(path);
    try {
      const found: string[] = [];
      if (client.mailbox && client.mailbox.exists === 0) return found;
      for await (const message of client.fetch("1:*", { envelope: true })) {
        found.push(message.envelope?.messageId ?? "");
      }
      return found;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}
