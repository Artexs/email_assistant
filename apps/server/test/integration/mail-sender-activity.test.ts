import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";

import { incomingCountsBySender, ownAddressesOf, type SenderWindowOptions } from "../../src/modules/mail";
import { insertMailbox } from "../../src/modules/mail/repo";

import { ago, newOrg, NOW, secondMailbox, type Org, type Trx } from "./contacts-fixtures";
import { insertTestEmail, seedSenderActivity, testCapabilities, type SeededMail, type SeededSent } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The mail readers of the sender activity pass: the incoming mail window with its counts, and the own addresses. The values are
// fixed; the guard tests call each reader with the context of one organization and the mailbox of another.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const TEST_SENDER = "ea-test@example.com";
const MINUTE = 60_000;
const DAY = 86_400_000;

const options = (mailboxId: string, over: Partial<SenderWindowOptions> = {}) => ({
  mailboxId,
  since: new Date(NOW.getTime() - 90 * DAY),
  until: NOW,
  testMail: { senders: [TEST_SENDER] },
  since30: new Date(NOW.getTime() - 30 * DAY),
  unseenBefore: new Date(NOW.getTime() - 7 * DAY),
  ...over,
});

const seed = (trx: Trx, org: Org, address: string, mails: SeededMail[], mailboxId = org.mailboxId) =>
  seedSenderActivity(trx, org.ctx, mailboxId, { address, mails });

const countsOf = (trx: Trx, org: Org, over: Partial<SenderWindowOptions> = {}, mailboxId = org.mailboxId) =>
  incomingCountsBySender(trx, org.ctx, options(mailboxId, over));

describe("incomingCountsBySender", () => {
  test("1 counts, 30-day counts, flags and unseen mail of one sender", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seed(trx, org, "x@example.com", [
        { at: ago(1), answered: true },
        { at: ago(40), flagged: true, seen: false },
        { at: ago(89) },
      ]);
      const rows = await countsOf(trx, org);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        address: "x@example.com",
        received: 3,
        received30: 1,
        answered: 1,
        answered30: 1,
        flagged: 1,
        flagged30: 0,
        unseen7d: 1,
        firstAt: ago(89),
        lastAt: ago(1),
      });
    });
  });

  test("2 the window: 91 days and one minute after the end are out, exactly 90 days is in", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seed(trx, org, "x@example.com", [
        { at: ago(91) },
        { at: new Date(NOW.getTime() + MINUTE) },
        { at: ago(90) },
      ]);
      const rows = await countsOf(trx, org);
      expect(rows.map((row) => row.received)).toEqual([1]);
    });
  });

  test("3 a test-mail sender and a synthetic Message-ID have no row", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seed(trx, org, TEST_SENDER, [{ at: ago(1) }]);
      await seed(trx, org, "x@example.com", [{ at: ago(2) }, { at: ago(3), test: true }]);
      const rows = await countsOf(trx, org);
      expect(rows.map((row) => [row.address, row.received])).toEqual([["x@example.com", 1]]);
    });
  });

  test("4 another organization with the same address never counts; its mailbox id read with this context is empty", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      await seed(trx, a, "x@example.com", [{ at: ago(1) }, { at: ago(2) }, { at: ago(3) }]);
      await seed(
        trx,
        b,
        "x@example.com",
        [1, 2, 3, 4, 5].map((day) => ({ at: ago(day) }))
      );
      expect((await countsOf(trx, a)).map((row) => row.received)).toEqual([3]);
      expect((await countsOf(trx, b)).map((row) => row.received)).toEqual([5]);
      expect(await countsOf(trx, a, {}, b.mailboxId)).toEqual([]);
    });
  });

  test("5 a second mailbox of the organization is not counted", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const other = await secondMailbox(trx, org);
      await seed(trx, org, "x@example.com", [{ at: ago(1) }, { at: ago(2) }, { at: ago(3) }]);
      await seed(trx, org, "x@example.com", [{ at: ago(1) }, { at: ago(2) }], other.mailboxId);
      expect((await countsOf(trx, org)).map((row) => row.received)).toEqual([3]);
      expect((await countsOf(trx, org, {}, other.mailboxId)).map((row) => row.received)).toEqual([2]);
    });
  });

  test("6 a domain scope reads the domain and its subdomains, an address scope the one address", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      for (const address of ["x@example.com", "y@sub.example.com", "z@example.org", "w@badexample.com"])
        await seed(trx, org, address, [{ at: ago(1) }]);
      const domain = await countsOf(trx, org, { only: { domain: "example.com" } });
      expect(domain.map((row) => row.address).sort()).toEqual(["x@example.com", "y@sub.example.com"]);
      const address = await countsOf(trx, org, { only: { address: "x@example.com" } });
      expect(address.map((row) => row.address)).toEqual(["x@example.com"]);
    });
  });

  test("7 header signals: kept and bulk mails, List-Id, Auto-Submitted", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seed(trx, org, "x@example.com", [
        { at: ago(1), headers: { listId: "<news.example.com>" } },
        { at: ago(2), headers: { autoSubmitted: "auto-replied" } },
        { at: ago(3), headers: { autoSubmitted: "no" } },
        { at: ago(4), headers: { listId: "<old.example.com>", cleared: true } },
        { at: ago(5) },
      ]);
      const [row] = await countsOf(trx, org);
      expect(row).toMatchObject({
        received: 5,
        headersKept: 3,
        headersBulk: 2,
        listId: true,
        listUnsubscribe: false,
        autoSubmitted: true,
      });
    });
  });

  // `from_address_lower` is null or empty on a mail with no sender. The null filter is redundant (a null `<> ''` is not true), so
  // only the empty-string filter can be proven alone: without it the empty address gets a row.
  test("7b a mail with an empty or a missing sender gets no row", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seed(trx, org, "x@example.com", [{ at: ago(1) }]);
      for (const from of ["", null])
        await insertTestEmail(trx, org.ctx, org.mailboxId, {
          status: "triaged",
          received_at: ago(2),
          from_address: from,
        });
      expect((await countsOf(trx, org)).map((row) => [row.address, row.received])).toEqual([["x@example.com", 1]]);
    });
  });
});

describe("ownAddressesOf", () => {
  const sentFrom = (from: string, days: number): SeededSent => ({ at: ago(days), from, to: ["x@example.com"] });
  const addMailbox = (trx: Trx, org: Org, address: string) =>
    insertMailbox(trx, org.ctx, {
      id: randomUUID(),
      address,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: {},
    });

  test("8 mailbox addresses of the organization and the Sent From aliases of this mailbox, in the rule form", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx, { address: "me@example.com" });
      await addMailbox(trx, org, "Other@Example.com");
      const far = await secondMailbox(trx, org);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { sent: [sentFrom("alias@example.com", 1)] });
      await seedSenderActivity(trx, org.ctx, far.mailboxId, { sent: [sentFrom("far@example.com", 1)] });
      const own = await ownAddressesOf(trx, org.ctx, org.mailboxId, { maxAliases: 100 });
      expect(own).toEqual(new Set(["me@example.com", "other@example.com", far.address, "alias@example.com"]));
    });
  });

  test("9 maxAliases keeps the alias with the newest Sent mail", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx, { address: "me@example.com" });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        sent: [sentFrom("abe@example.com", 5), sentFrom("zed@example.com", 1)],
      });
      const own = await ownAddressesOf(trx, org.ctx, org.mailboxId, { maxAliases: 1 });
      expect(own).toEqual(new Set(["me@example.com", "zed@example.com"]));
    });
  });

  test("10 another organization's mailbox and aliases never count; its mailbox id read with this context has no aliases", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, { address: "me@example.com" });
      const b = await newOrg(trx, { address: "me2@example.com" });
      await seedSenderActivity(trx, a.ctx, a.mailboxId, { sent: [sentFrom("alias@example.com", 1)] });
      await seedSenderActivity(trx, b.ctx, b.mailboxId, { sent: [sentFrom("alias2@example.com", 1)] });
      expect(await ownAddressesOf(trx, a.ctx, a.mailboxId, { maxAliases: 100 })).toEqual(
        new Set(["me@example.com", "alias@example.com"])
      );
      expect(await ownAddressesOf(trx, a.ctx, b.mailboxId, { maxAliases: 100 })).toEqual(new Set(["me@example.com"]));
    });
  });

  // The null filter is redundant with the blank filter (a null `btrim(...) <> ''` is not true), so only the blank one is proven
  // alone: without it the empty address joins the set.
  test("11 a Sent mail with a blank From adds no address", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx, { address: "me@example.com" });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { sent: [sentFrom("alias@example.com", 1)] });
      for (const from of ["   ", ""]) {
        const { sentIds } = await seedSenderActivity(trx, org.ctx, org.mailboxId, {
          sent: [sentFrom("tmp@example.com", 2)],
        });
        await trx.updateTable("sent_emails").set({ from_address: from }).where("id", "in", sentIds).execute();
      }
      expect(await ownAddressesOf(trx, org.ctx, org.mailboxId, { maxAliases: 100 })).toEqual(
        new Set(["me@example.com", "alias@example.com"])
      );
    });
  });
});
