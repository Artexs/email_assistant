import { DAY_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import {
  repliedBySentBySender,
  sentCountsByRecipient,
  type SenderWindowOptions,
  type SentCountsOptions,
} from "../../src/modules/mail";

import { ago, HOUR, newOrg, NOW, secondMailbox, type Org, type Trx } from "./contacts-fixtures";
import { seedSenderActivity } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The mail readers of the sender activity pass over Sent mail: the user's mails per recipient, and the incoming mails that the
// user answered. The values are fixed; the tenant tests call a reader with the context of one organization and the mailbox of
// another (a test with its own mailbox cannot fail when an `org_id` filter goes, as mailbox ids are unique).
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const since = new Date(NOW.getTime() - 90 * DAY_MS);

const sentOptions = (mailboxId: string, over: Partial<SentCountsOptions> = {}): SentCountsOptions => ({
  mailboxId,
  since,
  until: NOW,
  ...over,
});
const windowOptions = (mailboxId: string, over: Partial<SenderWindowOptions> = {}): SenderWindowOptions => ({
  mailboxId,
  since,
  until: NOW,
  testMail: { senders: [] },
  ...over,
});

const sentOf = async (trx: Trx, org: Org, over: Partial<SentCountsOptions> = {}, mailboxId = org.mailboxId) =>
  (await sentCountsByRecipient(trx, org.ctx, sentOptions(mailboxId, over))).sort((a, b) =>
    a.address < b.address ? -1 : 1
  );
const repliedOf = (trx: Trx, org: Org, over: Partial<SenderWindowOptions> = {}, mailboxId = org.mailboxId) =>
  repliedBySentBySender(trx, org.ctx, windowOptions(mailboxId, over));

describe("sentCountsByRecipient", () => {
  test("1 user mails count once per mail; system sends, automatic replies and recipients without @ do not", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        sent: [
          { at: ago(5), to: ["a@example.com"], cc: ["a@example.com"] },
          { at: ago(2), to: ["A@Example.com "] },
          { at: ago(3), to: ["a@example.com"], system: true },
          { at: ago(4), to: ["a@example.com"], autoSubmitted: "auto-replied" },
          { at: ago(6), to: ["undisclosed"] },
        ],
      });
      expect(await sentOf(trx, org)).toEqual([{ address: "a@example.com", mails: 2, lastAt: ago(2) }]);
    });
  });

  test("2 the range: both ends are in, a minute outside is out", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        sent: [
          { at: since, to: ["a@example.com"] },
          { at: new Date(since.getTime() - MINUTE_MS), to: ["a@example.com"] },
          { at: NOW, to: ["b@example.com"] },
          { at: new Date(NOW.getTime() + MINUTE_MS), to: ["b@example.com"] },
        ],
      });
      const rows = await sentOf(trx, org);
      expect(rows.map((row) => [row.address, row.mails])).toEqual([
        ["a@example.com", 1],
        ["b@example.com", 1],
      ]);
    });
  });

  test("4 another organization never counts: its mailbox id read with this context is empty", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      await seedSenderActivity(trx, a.ctx, a.mailboxId, { sent: [{ at: ago(1), to: ["a@example.com"] }] });
      await seedSenderActivity(trx, b.ctx, b.mailboxId, {
        sent: [1, 2, 3].map((day) => ({ at: ago(day), to: ["a@example.com"] })),
      });
      expect((await sentOf(trx, a)).map((row) => row.mails)).toEqual([1]);
      expect((await sentOf(trx, b)).map((row) => row.mails)).toEqual([3]);
      expect(await sentOf(trx, a, {}, b.mailboxId)).toEqual([]);
    });
  });

  test("5 a second mailbox of the organization is not counted", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const other = await secondMailbox(trx, org);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { sent: [{ at: ago(1), to: ["a@example.com"] }] });
      await seedSenderActivity(trx, org.ctx, other.mailboxId, {
        sent: [1, 2].map((day) => ({ at: ago(day), to: ["a@example.com"] })),
      });
      expect((await sentOf(trx, org)).map((row) => row.mails)).toEqual([1]);
      expect((await sentOf(trx, org, {}, other.mailboxId)).map((row) => row.mails)).toEqual([2]);
    });
  });

  test("6 a domain scope reads the domain and its subdomains, an address scope the one address", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        sent: [
          { at: ago(1), to: ["a@example.com"] },
          { at: ago(1), to: ["b@sub.example.com"] },
          { at: ago(1), to: ["a@example.org"] },
          { at: ago(1), to: ["a@badexample.com"] },
        ],
      });
      const domain = await sentOf(trx, org, { only: { domain: "example.com" } });
      expect(domain.map((row) => row.address)).toEqual(["a@example.com", "b@sub.example.com"]);
      const address = await sentOf(trx, org, { only: { address: "a@example.org" } });
      expect(address.map((row) => row.address)).toEqual(["a@example.org"]);
    });
  });
});

describe("repliedBySentBySender", () => {
  test("2 a reply to another address counts; a reply dated before the mail does not", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const answered = "<answered@x.test>";
      const early = "<early@x.test>";
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "b@example.com",
        mails: [
          { at: ago(5), messageId: answered },
          { at: ago(4), messageId: early },
        ],
        sent: [
          { at: ago(5, -2), to: ["reply-to@example.com"], parent: answered },
          { at: ago(4, 2), to: ["reply-to@example.com"], parent: early },
        ],
      });
      expect(await repliedOf(trx, org)).toEqual([{ address: "b@example.com", mails: 1 }]);
    });
  });

  test("3 two replies to one mail count the mail once", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const id = "<twice@x.test>";
      const at = ago(5);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "c@example.com",
        mails: [{ at, messageId: id }],
        sent: [
          { at: new Date(at.getTime() + 2 * HOUR), to: ["c@example.com"], parent: id },
          { at: new Date(at.getTime() + 5 * HOUR), to: ["c@example.com"], parent: id },
        ],
      });
      expect(await repliedOf(trx, org)).toEqual([{ address: "c@example.com", mails: 1 }]);
    });
  });

  test("4 another organization never counts: its mailbox id read with this context is empty", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      for (const [org, id] of [
        [a, "<a-mail@x.test>"],
        [b, "<b-mail@x.test>"],
      ] as const)
        await seedSenderActivity(trx, org.ctx, org.mailboxId, {
          address: "c@example.com",
          mails: [{ at: ago(5), messageId: id }],
          sent: [{ at: ago(5, -1), to: ["c@example.com"], parent: id }],
        });
      expect(await repliedOf(trx, a)).toEqual([{ address: "c@example.com", mails: 1 }]);
      expect(await repliedOf(trx, a, {}, b.mailboxId)).toEqual([]);
    });
  });

  test("5 a Sent mail of a second mailbox does not pair with a mail of the first", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const other = await secondMailbox(trx, org);
      const id = "<shared@x.test>";
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "c@example.com",
        mails: [{ at: ago(5), messageId: id }],
      });
      await seedSenderActivity(trx, org.ctx, other.mailboxId, {
        sent: [{ at: ago(5, -1), to: ["c@example.com"], parent: id }],
      });
      expect(await repliedOf(trx, org)).toEqual([]);
    });
  });

  test("6 the scope narrows the window: a domain scope reads one domain", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      for (const address of ["a@example.com", "a@example.org"]) {
        const id = `<${address}>`;
        await seedSenderActivity(trx, org.ctx, org.mailboxId, {
          address,
          mails: [{ at: ago(5), messageId: id }],
          sent: [{ at: ago(5, -1), to: [address], parent: id }],
        });
      }
      const rows = await repliedOf(trx, org, { only: { domain: "example.com" } });
      expect(rows).toEqual([{ address: "a@example.com", mails: 1 }]);
    });
  });

  test("7 the edges: a reply after `until` counts; an automatic or a system reply does not", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const until = ago(10);
      const late = "<late@x.test>";
      const auto = "<auto@x.test>";
      const system = "<system@x.test>";
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "d@example.com",
        mails: [
          { at: ago(20), messageId: late },
          { at: ago(21), messageId: auto },
          { at: ago(22), messageId: system },
        ],
        sent: [
          // After `until`: counts, as the read has no upper bound on `sent_at`.
          { at: ago(1), to: ["d@example.com"], parent: late },
          { at: ago(21, -1), to: ["d@example.com"], parent: auto, autoSubmitted: "auto-replied" },
          { at: ago(22, -1), to: ["d@example.com"], parent: system, system: true },
        ],
      });
      expect(await repliedOf(trx, org, { until })).toEqual([{ address: "d@example.com", mails: 1 }]);
    });
  });
});
