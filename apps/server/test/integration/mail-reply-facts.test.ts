import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { KyselyPlugin, Transaction } from "kysely";

import { insertSentEmails, replyFactsOf } from "../../src/modules/mail";
import { insertMailbox } from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// F115 stage 06 step 3: the stored facts of a mail for the reply rules.

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-17T10:00:00Z");

interface Org {
  ctx: TenantContext;
  mailboxId: string;
  address: string;
}

async function newOrg(trx: Transaction<DB>): Promise<Org> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  const row = await trx.selectFrom("mailboxes").select("address").where("id", "=", mailboxId).executeTakeFirstOrThrow();
  return { ctx: { orgId }, mailboxId, address: row.address };
}

async function sentRow(trx: Transaction<DB>, org: Org, parent: string, origin: "user" | "system"): Promise<void> {
  const key = `s-${randomUUID()}`;
  await insertSentEmails(trx, org.ctx, [
    {
      mailboxId: org.mailboxId,
      dedupKey: key,
      path: "Sent",
      uidValidity: 7,
      uid: 1,
      messageId: `<${key}@x.test>`,
      parentMessageId: parent,
      referencesIds: [],
      threadKey: key,
      fromAddress: "me@corp.test",
      toAddresses: ["to@x.test"],
      ccAddresses: [],
      subject: "Re: X",
      sentAt: NOW,
      internalDate: NOW,
      origin,
      actionId: origin === "system" ? randomUUID() : null,
      content: "headers_only",
    },
  ]);
}

function countingPlugin() {
  const counter = { count: 0 };
  const plugin: KyselyPlugin = {
    transformQuery(args) {
      counter.count += 1;
      return args.node;
    },
    async transformResult(args) {
      return args.result;
    },
  };
  return { counter, plugin };
}

describe("replyFactsOf", () => {
  test("1: email_flags.answered true gives answered; false, or no flags row, gives not answered", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const flagged = await insertTestEmail(trx, org.ctx, org.mailboxId);
      const unflagged = await insertTestEmail(trx, org.ctx, org.mailboxId);
      const noRow = await insertTestEmail(trx, org.ctx, org.mailboxId);
      for (const [emailId, answered] of [
        [flagged, true],
        [unflagged, false],
      ] as const) {
        await trx
          .insertInto("email_flags")
          .values({ email_id: emailId, org_id: org.ctx.orgId, seen: true, answered, flagged: false, checked_at: NOW })
          .execute();
      }
      const facts = await replyFactsOf(trx, org.ctx, [flagged, unflagged, noRow]);
      expect(facts.get(flagged)?.answered).toBe(true);
      expect(facts.get(unflagged)?.answered).toBe(false);
      expect(facts.get(noRow)?.answered).toBe(false);
    });
  });

  test("2: a user Sent row whose parent matches answers the mail; a system Sent row does not", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      // The sender of the mail is the recipient of the Sent row (`to@x.test`): the reply went to the sender.
      const byUser = await insertTestEmail(trx, org.ctx, org.mailboxId, {
        message_id_header: "<u@a.test>",
        from_address: "to@x.test",
      });
      const bySystem = await insertTestEmail(trx, org.ctx, org.mailboxId, {
        message_id_header: "<s@a.test>",
        from_address: "to@x.test",
      });
      await sentRow(trx, org, "<u@a.test>", "user");
      await sentRow(trx, org, "<s@a.test>", "system");
      const facts = await replyFactsOf(trx, org.ctx, [byUser, bySystem]);
      expect(facts.get(byUser)?.answered).toBe(true);
      expect(facts.get(bySystem)?.answered).toBe(false);
    });
  });

  test("3: no email_headers row gives headers null and no reply-to; a row gives the header facts", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const bare = await insertTestEmail(trx, org.ctx, org.mailboxId);
      const captured = await insertTestEmail(trx, org.ctx, org.mailboxId);
      await trx
        .insertInto("email_headers")
        .values({
          email_id: captured,
          org_id: org.ctx.orgId,
          list_id: "news.x",
          list_unsubscribe: "<mailto:u@x.test>",
          auto_submitted: "auto-replied",
          precedence: "bulk",
          has_calendar: true,
          reply_to: ["other@x.test"],
          parts_known: true,
          captured_at: NOW,
        })
        .execute();
      const facts = await replyFactsOf(trx, org.ctx, [bare, captured]);
      expect(facts.get(bare)?.headers).toBeNull();
      expect(facts.get(bare)?.replyTo).toEqual([]);
      expect(facts.get(captured)?.headers).toEqual({
        listId: "news.x",
        listUnsubscribe: "<mailto:u@x.test>",
        autoSubmitted: "auto-replied",
        precedence: "bulk",
        hasCalendar: true,
      });
      expect(facts.get(captured)?.replyTo).toEqual(["other@x.test"]);
    });
  });

  test("4: the mail fields, the junk source and the own addresses of every mailbox of the organization", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const secondId = randomUUID();
      const secondAddress = `Second-${secondId}@X.test`;
      await insertMailbox(trx, org.ctx, {
        id: secondId,
        address: secondAddress,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await trx
        .insertInto("mailbox_folders")
        .values({ org_id: org.ctx.orgId, mailbox_id: org.mailboxId, key: "junk", path: "Spam", role: "junk" })
        .execute();
      const received = new Date("2026-11-16T08:00:00Z");
      const fromJunk = await insertTestEmail(trx, org.ctx, org.mailboxId, {
        source_folder: "Spam",
        folder: "INBOX",
        from_address: "Anna@Client.test",
        thread_key: "t-1",
        to_addresses: ["me@x.test"],
        cc_addresses: ["c@x.test"],
        received_at: received,
      });
      const fromInbox = await insertTestEmail(trx, org.ctx, org.mailboxId, { source_folder: "INBOX" });
      // The junk path belongs to the first mailbox: the same path in the second mailbox is not junk.
      const otherBox = await insertTestEmail(trx, org.ctx, secondId, { source_folder: "Spam" });

      const facts = await replyFactsOf(trx, org.ctx, [fromJunk, fromInbox, otherBox]);
      const junk = facts.get(fromJunk);
      expect(junk).toMatchObject({
        emailId: fromJunk,
        mailboxId: org.mailboxId,
        fromJunk: true,
        fromAddress: "Anna@Client.test",
        folder: "INBOX",
        threadKey: "t-1",
        toAddresses: ["me@x.test"],
        ccAddresses: ["c@x.test"],
      });
      expect(junk?.receivedAt.getTime()).toBe(received.getTime());
      expect([...(junk?.ownAddresses ?? [])].sort()).toEqual([org.address, secondAddress.toLowerCase()].sort());
      expect(facts.get(fromInbox)?.fromJunk).toBe(false);
      expect(facts.get(otherBox)?.fromJunk).toBe(false);
    });
  });

  test("5: a mail of another organization is absent, and so are its flags and Sent rows", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const own = await insertTestEmail(trx, a.ctx, a.mailboxId, { message_id_header: "<same@x.test>" });
      const foreign = await insertTestEmail(trx, b.ctx, b.mailboxId, { message_id_header: "<same@x.test>" });
      await sentRow(trx, b, "<same@x.test>", "user");
      await trx
        .insertInto("email_flags")
        .values({ email_id: foreign, org_id: b.ctx.orgId, seen: true, answered: true, flagged: false, checked_at: NOW })
        .execute();
      const facts = await replyFactsOf(trx, a.ctx, [own, foreign]);
      expect([...facts.keys()]).toEqual([own]);
      expect(facts.get(own)?.answered).toBe(false);
      expect(facts.get(own)?.ownAddresses).toEqual([a.address]);
    });
  });

  test("6: ids go in chunks of 500, and no ids run no query", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const real = await insertTestEmail(trx, org.ctx, org.mailboxId);
      const unknown = (count: number) => Array.from({ length: count }, () => randomUUID());
      const queriesFor = async (ids: string[]): Promise<number> => {
        const { counter, plugin } = countingPlugin();
        expect([...(await replyFactsOf(trx.withPlugin(plugin), org.ctx, ids)).keys()]).toEqual([real]);
        return counter.count;
      };
      // 500 ids are one chunk; one more id makes a second chunk, which costs one more query (the mails of an empty chunk).
      const one = await queriesFor([real, ...unknown(499)]);
      const two = await queriesFor([real, ...unknown(500)]);
      expect(two).toBe(one + 1);
      const { counter, plugin } = countingPlugin();
      expect((await replyFactsOf(trx.withPlugin(plugin), org.ctx, [])).size).toBe(0);
      expect(counter.count).toBe(0);
    });
  });
});
