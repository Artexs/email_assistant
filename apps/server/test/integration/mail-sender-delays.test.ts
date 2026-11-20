import { afterAll, describe, expect, test } from "bun:test";

import { theirReplyDelaysBySender, userReplyDelaysBySender, type SenderWindowOptions } from "../../src/modules/mail";

import { ago, HOUR, mailId, newOrg, NOW, secondMailbox, type Org, type Trx } from "./contacts-fixtures";
import { seedSenderActivity, type SeededMail, type SeededSent } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The reply-delay readers of the sender activity pass: values are fixed. The tenant test calls each reader with the context of one
// organization and the mailbox of another. `NOW` and `ago` of `contacts-fixtures.ts` give every date.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const DAY = 24 * HOUR;
const MAX_HOURS = 100_000;

const windowOf = (mailboxId: string): SenderWindowOptions => ({
  mailboxId,
  since: new Date(NOW.getTime() - 90 * DAY),
  until: NOW,
  testMail: { senders: [] },
});

const plus = (date: Date, hours: number): Date => new Date(date.getTime() + hours * HOUR);

const seed = (
  trx: Trx,
  org: Org,
  address: string,
  mails: SeededMail[],
  sent: SeededSent[],
  mailboxId = org.mailboxId
) => seedSenderActivity(trx, org.ctx, mailboxId, { address, mails, sent });

const userDelays = (trx: Trx, org: Org, mailboxId = org.mailboxId, maxHours = MAX_HOURS) =>
  userReplyDelaysBySender(trx, org.ctx, windowOf(mailboxId), { maxHours });
const theirDelays = (trx: Trx, org: Org, mailboxId = org.mailboxId, maxHours = MAX_HOURS) =>
  theirReplyDelaysBySender(trx, org.ctx, windowOf(mailboxId), { maxHours });

// Mails of one sender, each answered after the given hours by a user Sent mail that names the mail's Message-ID.
const answeredAfter = (hours: number[], to?: string[]): { mails: SeededMail[]; sent: SeededSent[] } => {
  const mails: SeededMail[] = [];
  const sent: SeededSent[] = [];
  hours.forEach((delay, index) => {
    const messageId = mailId(`m${index}`);
    const at = ago(10 + index);
    mails.push({ at, messageId });
    sent.push({ at: plus(at, delay), parent: messageId, ...(to === undefined ? {} : { to }) });
  });
  return { mails, sent };
};

describe("userReplyDelaysBySender", () => {
  test("1 five answered mails give the sample count and the median", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const { mails, sent } = answeredAfter([1, 2, 3, 4, 10]);
      await seed(trx, org, "a@example.com", mails, sent);
      expect(await userDelays(trx, org)).toEqual([{ address: "a@example.com", samples: 5, medianHours: 3 }]);
    });
  });

  test("2 a reply above maxHours is no sample; a reply at maxHours is", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const { mails, sent } = answeredAfter([11, 10]);
      await seed(trx, org, "a@example.com", mails, sent);
      expect(await userDelays(trx, org, org.mailboxId, 10)).toEqual([
        { address: "a@example.com", samples: 1, medianHours: 10 },
      ]);
      expect(await userDelays(trx, org, org.mailboxId, 9)).toEqual([]);
    });
  });

  test("3 a reply before the mail is skipped for the next reply after it", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const messageId = mailId("m");
      const at = ago(5);
      await seed(
        trx,
        org,
        "a@example.com",
        [{ at, messageId }],
        [
          { at: plus(at, -1), parent: messageId },
          { at: plus(at, 2), parent: messageId },
        ]
      );
      expect(await userDelays(trx, org)).toEqual([{ address: "a@example.com", samples: 1, medianHours: 2 }]);
    });
  });

  test("4 two replies to one mail give one sample, the first reply", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const messageId = mailId("m");
      const at = ago(5);
      await seed(
        trx,
        org,
        "a@example.com",
        [{ at, messageId }],
        [
          { at: plus(at, 5), parent: messageId },
          { at: plus(at, 2), parent: messageId },
        ]
      );
      expect(await userDelays(trx, org)).toEqual([{ address: "a@example.com", samples: 1, medianHours: 2 }]);
    });
  });

  test("5 a reply only to another address is no sample; a reply with no stored recipient is", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const forwarded = answeredAfter([3], ["other@example.com"]);
      await seed(trx, org, "a@example.com", forwarded.mails, forwarded.sent);
      expect(await userDelays(trx, org)).toEqual([]);
      const cleared = answeredAfter([4], []);
      await seed(trx, org, "b@example.com", cleared.mails, cleared.sent);
      expect(await userDelays(trx, org)).toEqual([{ address: "b@example.com", samples: 1, medianHours: 4 }]);
    });
  });

  test("6 a system send and an automatic reply are no sample", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const system = mailId("s");
      const auto = mailId("a");
      const at = ago(5);
      await seed(
        trx,
        org,
        "a@example.com",
        [
          { at, messageId: system },
          { at, messageId: auto },
        ],
        [
          { at: plus(at, 1), parent: system, system: true },
          { at: plus(at, 1), parent: auto, autoSubmitted: "auto-replied" },
        ]
      );
      expect(await userDelays(trx, org)).toEqual([]);
    });
  });

  test("7 edge rule: a reply after the end of the window counts", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const messageId = mailId("m");
      const at = plus(NOW, -1);
      await seed(trx, org, "a@example.com", [{ at, messageId }], [{ at: plus(NOW, 2), parent: messageId }]);
      expect(await userDelays(trx, org)).toEqual([{ address: "a@example.com", samples: 1, medianHours: 3 }]);
    });
  });

  test("8 another organization's mailbox read with this context is empty", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const mine = answeredAfter([2]);
      await seed(trx, a, "a@example.com", mine.mails, mine.sent);
      const theirs = answeredAfter([6]);
      await seed(trx, b, "a@example.com", theirs.mails, theirs.sent);
      expect(await userDelays(trx, a)).toEqual([{ address: "a@example.com", samples: 1, medianHours: 2 }]);
      expect(await userDelays(trx, b)).toEqual([{ address: "a@example.com", samples: 1, medianHours: 6 }]);
      expect(await userDelays(trx, a, b.mailboxId)).toEqual([]);
    });
  });

  test("9 a Sent mail of a second mailbox never pairs with a mail of the first, and the reverse", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const other = await secondMailbox(trx, org);
      const first = mailId("first");
      const second = mailId("second");
      const at = ago(5);
      await seed(trx, org, "a@example.com", [{ at, messageId: first }], [], org.mailboxId);
      await seed(trx, org, "a@example.com", [{ at, messageId: second }], [], other.mailboxId);
      // A reply in the second mailbox to a mail of the first, and a reply in the first mailbox to a mail of the second.
      await seed(trx, org, "a@example.com", [], [{ at: plus(at, 2), parent: first }], other.mailboxId);
      await seed(trx, org, "a@example.com", [], [{ at: plus(at, 3), parent: second }], org.mailboxId);
      expect(await userDelays(trx, org)).toEqual([]);
      expect(await userDelays(trx, org, other.mailboxId)).toEqual([]);
      // The own pair of each mailbox still counts.
      await seed(trx, org, "a@example.com", [], [{ at: plus(at, 4), parent: first }], org.mailboxId);
      expect(await userDelays(trx, org)).toEqual([{ address: "a@example.com", samples: 1, medianHours: 4 }]);
    });
  });
});

describe("theirReplyDelaysBySender", () => {
  // An incoming mail of the sender that names `inReplyTo`, received `hours` after the Sent mail.
  const reply = (sentAt: Date, hours: number, inReplyTo: string): SeededMail => ({
    at: plus(sentAt, hours),
    inReplyTo,
  });

  test("1 an id in angle brackets and a bare id both match; the median of the samples", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const bracketed = mailId("m1");
      const bare = mailId("m2").slice(1, -1);
      const at = ago(10);
      await seed(
        trx,
        org,
        "b@example.com",
        [reply(at, 2, bracketed), reply(at, 4, bare)],
        [
          { at, messageId: bracketed, to: ["b@example.com"] },
          { at, messageId: `<${bare}>`, to: ["b@example.com"] },
        ]
      );
      expect(await theirDelays(trx, org)).toEqual([{ address: "b@example.com", samples: 2, medianHours: 3 }]);
    });
  });

  test("2 a mail that names two own mails takes the newer one", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const older = mailId("older");
      const newer = mailId("newer");
      const at = ago(10);
      await seed(
        trx,
        org,
        "c@example.com",
        [reply(at, 6, `${older} ${newer}`)],
        [
          { at: plus(at, 1), messageId: older },
          { at: plus(at, 3), messageId: newer },
        ]
      );
      expect(await theirDelays(trx, org)).toEqual([{ address: "c@example.com", samples: 1, medianHours: 3 }]);
    });
  });

  test("3 a Sent mail that is newer than the mail is no pair; a delay above maxHours is no sample", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const later = mailId("later");
      const far = mailId("far");
      const at = ago(10);
      await seed(
        trx,
        org,
        "c@example.com",
        [{ at, inReplyTo: later }, reply(at, 20, far)],
        [
          { at: plus(at, 1), messageId: later },
          { at, messageId: far },
        ]
      );
      expect(await theirDelays(trx, org)).toEqual([{ address: "c@example.com", samples: 1, medianHours: 20 }]);
      expect(await theirDelays(trx, org, org.mailboxId, 19)).toEqual([]);
    });
  });

  test("4 edge rules: the Sent set has no Auto-Submitted filter and no date bound; a system send does not count", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const auto = mailId("auto");
      const old = mailId("old");
      const system = mailId("system");
      const sentAt = ago(95);
      await seed(
        trx,
        org,
        "c@example.com",
        [{ at: ago(89), inReplyTo: old }, reply(ago(10), 5, auto), reply(ago(10), 7, system)],
        [
          { at: sentAt, messageId: old },
          { at: ago(10), messageId: auto, autoSubmitted: "auto-replied" },
          { at: ago(10), messageId: system, system: true },
        ]
      );
      // The old Sent mail (6 days before the mail) and the automatic one (5 h) are samples; the system send is not.
      expect(await theirDelays(trx, org)).toEqual([{ address: "c@example.com", samples: 2, medianHours: 74.5 }]);
    });
  });

  test("5 another organization's mailbox read with this context is empty", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const id = mailId("m");
      const at = ago(10);
      await seed(trx, a, "b@example.com", [reply(at, 2, id)], [{ at, messageId: id }]);
      await seed(trx, b, "b@example.com", [reply(at, 5, id)], [{ at, messageId: id }]);
      expect(await theirDelays(trx, a)).toEqual([{ address: "b@example.com", samples: 1, medianHours: 2 }]);
      expect(await theirDelays(trx, b)).toEqual([{ address: "b@example.com", samples: 1, medianHours: 5 }]);
      expect(await theirDelays(trx, a, b.mailboxId)).toEqual([]);
    });
  });

  test("6 a Sent mail of a second mailbox never pairs with a mail of the first, and the reverse", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const other = await secondMailbox(trx, org);
      const id = mailId("m");
      const at = ago(10);
      await seed(trx, org, "b@example.com", [reply(at, 2, id)], [], org.mailboxId);
      await seed(trx, org, "b@example.com", [], [{ at, messageId: id }], other.mailboxId);
      expect(await theirDelays(trx, org)).toEqual([]);
      // A mail of the second mailbox that names a Sent mail of the first.
      const mine = mailId("mine");
      await seed(trx, org, "b@example.com", [], [{ at, messageId: mine }], org.mailboxId);
      await seed(trx, org, "b@example.com", [reply(at, 9, mine)], [], other.mailboxId);
      expect(await theirDelays(trx, org)).toEqual([]);
    });
  });
});
