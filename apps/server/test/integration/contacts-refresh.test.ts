import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { insertSenderRule } from "../../src/modules/config";
import { profileLockKey, readProfiles, readSenderActivity, refreshMailboxProfiles } from "../../src/modules/contacts";
import { insertMailbox } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";

import {
  ago,
  countRows,
  deps,
  DAY,
  HOUR,
  hashOf,
  KEY,
  mailId,
  mailsAt,
  ms,
  newOrg,
  NO_TEST,
  NOW,
  profileOf,
  refresh,
} from "./contacts-fixtures";
import { insertDelegate, insertDelegation, insertDraftAndSend, seedSenderActivity, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// Sender context: the profile pass (`readSenderActivity`, `refreshMailboxProfiles`, `readProfiles`). The clock is
// fixed. The key is a test key, so the file needs no `CREDENTIALS_KEY` in the environment.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

describe("refreshMailboxProfiles: counts", () => {
  test("1 a known contact: mails, answers, flags and Sent mail", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: [1, 2, 3, 4, 5, 6, 7, 8].map((day, index) => ({
          at: ago(day),
          answered: index < 6,
          flagged: index < 2,
        })),
        sent: [{ at: ago(2) }, { at: ago(3) }, { at: ago(4) }],
      });
      const result = await refresh(trx, org);
      expect(result).toEqual({ written: 1, zeroed: 0, skipped: false });
      const row = await profileOf(trx, org, "anna@acme.pl");
      expect(row).toMatchObject({
        received: 8,
        answered: 6,
        flagged: 2,
        user_mails_to: 3,
        relation: "known",
        refreshed_at: NOW,
      });
      expect(ms(row?.first_seen_at)).toBe(ago(8).getTime());
      expect(ms(row?.last_seen_at)).toBe(ago(1).getTime());
      expect(ms(row?.last_user_mail_at)).toBe(ago(2).getTime());
    });
  });

  test("2 a mail of 91 days is not counted, a mail of 89 days is", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "old@acme.pl", mails: mailsAt([91]) });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "edge@acme.pl", mails: mailsAt([89]) });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "oldsent@acme.pl", sent: [{ at: ago(91) }] });
      await refresh(trx, org);
      expect(await profileOf(trx, org, "old@acme.pl")).toBeUndefined();
      expect(await profileOf(trx, org, "oldsent@acme.pl")).toBeUndefined();
      expect(await profileOf(trx, org, "edge@acme.pl")).toMatchObject({ received: 1 });
    });
  });

  test("3 their delay: median of 5 samples, none below 5, a whole id only, the second id of In-Reply-To counts", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const mine = [10, 20, 30, 40, 50].map((hours, index) => ({ id: `<mine-${index}@x.test>`, hours }));
      // Anna answers the Sent mails after 10 to 50 hours. The fifth reply names two ids; the Sent mail is the second.
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: mine.map(({ id, hours }, index) => ({
          at: ago(20 - index * 3, -hours),
          inReplyTo: index === 4 ? `<other@x.test> ${id}` : id,
        })),
        sent: mine.map(({ id }, index) => ({ at: ago(20 - index * 3), messageId: id })),
      });
      // A reply that arrives before the Sent mail it names (clock skew) is no sample.
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: [{ at: ago(25), inReplyTo: mine[0]?.id }],
      });
      // Carl answers four of the same Sent mails, and a fifth mail names an id with a suffix: not a match.
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "carl@acme.pl",
        mails: [
          ...mine.slice(0, 4).map(({ id, hours }, index) => ({ at: ago(20 - index * 3, -hours), inReplyTo: id })),
          { at: ago(2), inReplyTo: "<mine-4@x.test.evil>" },
        ],
      });
      await refresh(trx, org);
      const anna = await profileOf(trx, org, "anna@acme.pl");
      expect(anna?.reply_samples_theirs).toBe(5);
      expect(anna?.median_their_reply_hours).toBe(30);
      const carl = await profileOf(trx, org, "carl@acme.pl");
      expect(carl?.reply_samples_theirs).toBe(4);
      expect(carl?.median_their_reply_hours).toBeNull();
    });
  });

  test("4 the user's delay: median of 5 samples; a delay of 0 or less is dropped", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const pairs = [2, 4, 6, 8, 10].map((hours, index) => ({ id: mailId(`in${index}`), hours, day: 30 - index }));
      const mails = pairs.map(({ id, day }) => ({ at: ago(day), messageId: id }));
      const sent = pairs.map(({ id, day, hours }) => ({ at: ago(day, -hours), parent: id }));
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "anna@acme.pl", mails, sent });
      await refresh(trx, org);
      expect((await profileOf(trx, org, "anna@acme.pl"))?.median_user_reply_hours).toBe(6);

      // Clock skew: the Sent mail is one hour before the mail it answers. The pass drops it and still works.
      const skewed = mailId("skew");
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: [{ at: ago(9), messageId: skewed }],
        sent: [{ at: ago(9, 1), parent: skewed }],
      });
      expect((await refresh(trx, org)).skipped).toBe(false);
      expect((await profileOf(trx, org, "anna@acme.pl"))?.median_user_reply_hours).toBe(6);
    });
  });

  test("4b four user delays give no median; a vacation reply is no delay and no user mail", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const pairs = [2, 4, 6, 8].map((hours, index) => ({ id: mailId(`in${index}`), hours }));
      const auto = mailId("auto");
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: [...pairs.map(({ id }) => ({ at: ago(20), messageId: id })), { at: ago(20), messageId: auto }],
        sent: [
          ...pairs.map(({ id, hours }) => ({ at: ago(20, -hours), parent: id })),
          { at: ago(20, -3), parent: auto, autoSubmitted: "auto-replied" },
        ],
      });
      await refresh(trx, org);
      const row = await profileOf(trx, org, "anna@acme.pl");
      expect(row?.median_user_reply_hours).toBeNull();
      expect(row?.user_mails_to).toBe(4);
    });
  });

  test("5 Sent mail only: a row with received 0 and no incoming dates", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        sent: [{ at: ago(5), to: ["bob@beta.pl"], cc: ["BOB@beta.pl"] }],
      });
      await refresh(trx, org);
      const row = await profileOf(trx, org, "bob@beta.pl");
      expect(row).toMatchObject({
        received: 0,
        user_mails_to: 1,
        relation: "known",
        first_seen_at: null,
        last_seen_at: null,
      });
      expect(ms(row?.last_user_mail_at)).toBe(ago(5).getTime());
    });
  });

  test("6 own addresses, Sent From aliases and test mail get no row", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      // A second mailbox of the organization is an own address too.
      const second = `second-${randomUUID()}@x.test`;
      await insertMailbox(trx, org.ctx, {
        id: randomUUID(),
        address: second,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: org.address, mails: mailsAt([1]) });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: second, mails: mailsAt([1]) });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "alias@acme.pl",
        mails: mailsAt([1]),
        sent: [{ at: ago(1), from: "Alias@Acme.pl", to: ["somebody@acme.pl"] }],
      });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "probe@acme.pl",
        mails: [{ at: ago(1), test: true }],
      });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "bot@acme.pl",
        mails: mailsAt([1]),
        sent: [{ at: ago(1) }],
      });
      await refresh(trx, org, NOW, { senders: ["bot@acme.pl"] });
      expect(await profileOf(trx, org, org.address)).toBeUndefined();
      expect(await profileOf(trx, org, second)).toBeUndefined();
      expect(await profileOf(trx, org, "alias@acme.pl")).toBeUndefined();
      expect(await profileOf(trx, org, "probe@acme.pl")).toBeUndefined();
      expect(await profileOf(trx, org, "bot@acme.pl")).toBeUndefined();
      // The one real contact of the pass: the person the alias wrote to.
      expect(await profileOf(trx, org, "somebody@acme.pl")).toMatchObject({ user_mails_to: 1 });
    });
  });

  test("7 bulk: the ratio counts mails whose headers are not cleared; noreply counts at any age", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      // 3 of 4 fresh mails carry List-Id.
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "digest@list.pl",
        mails: [1, 2, 3, 4].map((day, index) => ({
          at: ago(day),
          headers: index < 3 ? { listId: "<digest.list.pl>" } : {},
        })),
      });
      // 13 mails in 90 days: the 9 older ones have cleared headers, the 4 fresh ones carry List-Id.
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "news@letter.pl",
        mails: [
          ...[40, 45, 50, 55, 60, 65, 70, 75, 80].map((day) => ({ at: ago(day), headers: { cleared: true } })),
          ...[1, 2, 3, 4].map((day) => ({
            at: ago(day),
            headers: { listId: "<news.letter.pl>", listUnsubscribe: "<u@x>" },
          })),
        ],
      });
      // A person who writes twice with no list header.
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "jan@acme.pl",
        mails: [1, 2].map((day) => ({ at: ago(day), headers: {} })),
      });
      // A noreply sender: every mail has cleared headers, and still it is bulk.
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "noreply@bank.pl",
        mails: [50, 60, 70].map((day) => ({ at: ago(day), headers: { cleared: true } })),
      });
      await refresh(trx, org);
      expect(await profileOf(trx, org, "digest@list.pl")).toMatchObject({
        relation: "bulk",
        received: 4,
        bulk_signals: ["list_id"],
      });
      expect(await profileOf(trx, org, "news@letter.pl")).toMatchObject({
        relation: "bulk",
        received: 13,
        bulk_signals: ["list_id", "list_unsubscribe"],
      });
      expect(await profileOf(trx, org, "jan@acme.pl")).toMatchObject({ relation: "new", bulk_signals: [] });
      expect(await profileOf(trx, org, "noreply@bank.pl")).toMatchObject({
        relation: "bulk",
        bulk_signals: ["noreply"],
      });
    });
  });

  test("7b an Auto-Submitted header other than no is a bulk signal", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "robot@acme.pl",
        mails: [
          { at: ago(1), headers: { autoSubmitted: "auto-generated" } },
          { at: ago(2), headers: { autoSubmitted: "no" } },
          { at: ago(3), headers: { autoSubmitted: "auto-replied; foo" } },
        ],
      });
      await refresh(trx, org);
      expect(await profileOf(trx, org, "robot@acme.pl")).toMatchObject({
        relation: "bulk",
        bulk_signals: ["auto_submitted"],
      });
    });
  });
});

describe("refreshMailboxProfiles: second pass", () => {
  test("8 mail older than 90 days: counts go to 0, the dates stay, the relation is new", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: [{ at: ago(60), answered: true, category: "info", headers: {} }],
        sent: [{ at: ago(59) }],
      });
      expect(await refresh(trx, org)).toEqual({ written: 1, zeroed: 0, skipped: false });
      const first = await profileOf(trx, org, "anna@acme.pl");
      expect(first).toMatchObject({ received: 1, answered: 1, user_mails_to: 1, relation: "known" });

      // 40 days later the mail is 100 days old.
      const later = new Date(NOW.getTime() + 40 * DAY);
      expect(await refresh(trx, org, later)).toEqual({ written: 0, zeroed: 1, skipped: false });
      const second = await profileOf(trx, org, "anna@acme.pl");
      expect(second).toMatchObject({
        received: 0,
        answered: 0,
        user_mails_to: 0,
        by_category: {},
        bulk_signals: [],
        median_their_reply_hours: null,
        relation: "new",
        refreshed_at: later,
      });
      expect(ms(second?.first_seen_at)).toBe(ms(first?.first_seen_at));
      expect(ms(second?.last_seen_at)).toBe(ms(first?.last_seen_at));
      expect(ms(second?.last_user_mail_at)).toBe(ms(first?.last_user_mail_at));
      expect(await countRows(trx, org)).toBe(1);

      // A row that is zero already stays as it is.
      expect(await refresh(trx, org, new Date(later.getTime() + HOUR))).toEqual({
        written: 0,
        zeroed: 0,
        skipped: false,
      });
      expect((await profileOf(trx, org, "anna@acme.pl"))?.refreshed_at).toEqual(later);
    });
  });

  test("8b the dates only widen: an older stored first_seen_at stays, the newest last_seen_at wins", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "anna@acme.pl", mails: mailsAt([80]) });
      await refresh(trx, org);
      const first = await profileOf(trx, org, "anna@acme.pl");

      // 20 days later the old mail has left the window; a new mail came 10 days ago.
      const later = new Date(NOW.getTime() + 20 * DAY);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: [{ at: new Date(later.getTime() - 10 * DAY) }],
      });
      await refresh(trx, org, later);
      const second = await profileOf(trx, org, "anna@acme.pl");
      expect(second?.received).toBe(1);
      expect(ms(second?.first_seen_at)).toBe(ms(first?.first_seen_at));
      expect(ms(second?.last_seen_at)).toBe(later.getTime() - 10 * DAY);
      expect(await countRows(trx, org)).toBe(1);
    });
  });

  test("8d last_seen_at never moves back when the newest mail is gone", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const seeded = await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: mailsAt([1, 5]),
      });
      await refresh(trx, org);
      expect(ms((await profileOf(trx, org, "anna@acme.pl"))?.last_seen_at)).toBe(ago(1).getTime());

      // A data-request erase or a delete removes the newest mail.
      await trx
        .deleteFrom("emails")
        .where("id", "=", seeded.emailIds[0] as string)
        .execute();
      await refresh(trx, org);
      const row = await profileOf(trx, org, "anna@acme.pl");
      expect(row?.received).toBe(1);
      expect(ms(row?.last_seen_at)).toBe(ago(1).getTime());
    });
  });

  test("8c a second pass at the same time changes no count", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: mailsAt([1, 2, 3], { answered: true }),
        sent: [{ at: ago(1) }],
      });
      await refresh(trx, org);
      const before = await profileOf(trx, org, "anna@acme.pl");
      expect(await refresh(trx, org)).toEqual({ written: 1, zeroed: 0, skipped: false });
      expect(await profileOf(trx, org, "anna@acme.pl")).toEqual(before);
    });
  });
});

describe("refreshMailboxProfiles: privacy and tenants", () => {
  test("9 no column of the row holds the address, the domain or the name", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: [{ at: ago(1), category: "needs_reply", headers: { listId: "<anna.acme.pl>" }, answered: true }],
        sent: [{ at: ago(1), to: ["anna@acme.pl", "Anna@acme.pl"] }],
      });
      await refresh(trx, org);
      const { rows } = await sql<{ text: string }>`
        SELECT row_to_json(p)::text AS text FROM sender_profiles p WHERE p.mailbox_id = ${org.mailboxId}
      `.execute(trx);
      expect(rows).toHaveLength(1);
      const text = (rows[0]?.text ?? "").toLowerCase();
      expect(text).toContain(hashOf(org.ctx.orgId, "anna@acme.pl"));
      for (const secret of ["anna", "acme", "@"]) expect(text).not.toContain(secret);
    });
  });

  test("10 the same address in another organization has its own row and its own hash", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      await seedSenderActivity(trx, a.ctx, a.mailboxId, { address: "anna@acme.pl", mails: mailsAt([1, 2]) });
      await seedSenderActivity(trx, b.ctx, b.mailboxId, { address: "anna@acme.pl", mails: mailsAt([1]) });
      await refresh(trx, a);
      await refresh(trx, b);
      const rowA = await profileOf(trx, a, "anna@acme.pl");
      const rowB = await profileOf(trx, b, "anna@acme.pl");
      expect(rowA?.received).toBe(2);
      expect(rowB?.received).toBe(1);
      expect(rowA?.key_hash).not.toBe(rowB?.key_hash);
      expect(await countRows(trx, a)).toBe(1);
      expect(await countRows(trx, b)).toBe(1);
    });
  });

  test("10b a mailbox of the organization sees no mail of another mailbox", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const otherId = randomUUID();
      await insertMailbox(trx, org.ctx, {
        id: otherId,
        address: `other-${otherId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await seedSenderActivity(trx, org.ctx, otherId, {
        address: "anna@acme.pl",
        mails: mailsAt([1, 2]),
        sent: [{ at: ago(1) }],
      });
      await refresh(trx, org);
      expect(await countRows(trx, org)).toBe(0);
    });
  });
});

describe("refreshMailboxProfiles: mailbox scope", () => {
  test("10c a pass of one mailbox never changes the rows of another mailbox", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const secondId = randomUUID();
      await insertMailbox(trx, org.ctx, {
        id: secondId,
        address: `second-${secondId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await seedSenderActivity(trx, org.ctx, secondId, { address: "anna@acme.pl", mails: mailsAt([1, 2]) });
      await refreshMailboxProfiles(deps(trx), org.ctx, secondId, { now: NOW });
      const before = await trx.selectFrom("sender_profiles").selectAll().where("mailbox_id", "=", secondId).execute();
      expect(before).toHaveLength(1);

      // The first mailbox has no mail: its pass writes nothing and zeroes nothing in the second mailbox.
      expect(await refresh(trx, org)).toEqual({ written: 0, zeroed: 0, skipped: false });
      const after = await trx.selectFrom("sender_profiles").selectAll().where("mailbox_id", "=", secondId).execute();
      expect(after).toEqual(before);
      expect(after[0]?.received).toBe(2);
    });
  });
});

describe("readProfiles", () => {
  test("11 pairs of two mailboxes come back from one query; another organization reads nothing", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const secondId = randomUUID();
      await insertMailbox(trx, org.ctx, {
        id: secondId,
        address: `second-${secondId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: [
          { at: ago(12), category: "info", answered: true, headers: { listId: "<l>" } },
          {
            at: ago(3),
            category: "spam",
            headers: {},
            feedback: [{ verdict: "wrong", trueCategory: "needs_reply" }],
          },
        ],
        sent: [{ at: ago(5) }],
      });
      await seedSenderActivity(trx, org.ctx, secondId, { address: "anna@acme.pl", mails: mailsAt([20, 21, 22]) });
      await refresh(trx, org);
      await refreshMailboxProfiles(deps(trx), org.ctx, secondId, { now: NOW });

      let statements = 0;
      const counted = trx.withPlugin({
        transformQuery: (args) => {
          statements += 1;
          return args.node;
        },
        transformResult: async (args) => args.result,
      });
      const pairs = [
        { mailboxId: org.mailboxId, address: "Anna@Acme.pl " },
        { mailboxId: secondId, address: "anna@acme.pl" },
        { mailboxId: org.mailboxId, address: "nobody@acme.pl" },
      ];
      const map = await readProfiles({ db: counted, credentialsKey: KEY }, org.ctx, pairs, NOW);
      expect(statements).toBe(1);
      expect([...map.keys()].sort()).toEqual([`${org.mailboxId}:anna@acme.pl`, `${secondId}:anna@acme.pl`].sort());
      expect(map.get(`${org.mailboxId}:anna@acme.pl`)).toEqual({
        days: 90,
        received: 2,
        byCategory: { info: 1, spam: 1 },
        corrections: { needs_reply: 1 },
        movedBack: 0,
        answered: 1,
        flagged: 0,
        unseen7d: 0,
        userMailsTo: 1,
        lastUserMailDaysAgo: 5,
        delegationsTo: 0,
        bulkSignals: ["list_id"],
        firstSeenDaysAgo: 12,
        lastSeenDaysAgo: 3,
        medianUserReplyHours: null,
        medianTheirReplyHours: null,
        relation: "known",
      });
      expect(map.get(`${secondId}:anna@acme.pl`)).toMatchObject({
        received: 3,
        relation: "new",
        lastUserMailDaysAgo: null,
      });

      const other = await newOrg(trx);
      expect((await readProfiles(deps(trx), other.ctx, pairs, NOW)).size).toBe(0);

      // The query filters `org_id` by itself: a row of another organization with the hash of this organization is not read.
      await trx
        .insertInto("sender_profiles")
        .values({
          org_id: other.ctx.orgId,
          mailbox_id: other.mailboxId,
          key_hash: hashOf(org.ctx.orgId, "anna@acme.pl"),
          received: 9,
          relation: "new",
          first_seen_at: NOW,
          last_seen_at: NOW,
        })
        .execute();
      const foreign = await readProfiles(
        deps(trx),
        org.ctx,
        [{ mailboxId: other.mailboxId, address: "anna@acme.pl" }],
        NOW
      );
      expect(foreign.size).toBe(0);
    });
  });
});

describe("refreshMailboxProfiles: gates", () => {
  test("12 a lock held by another connection: skipped, no read, no write; then it runs", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      // A stored row that a pass would change. The test transaction takes no lock before the holder does (a transaction lock
      // lasts until the end of the transaction, and the holder would wait for it).
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "anna@acme.pl", mails: mailsAt([1]) });
      await trx
        .insertInto("sender_profiles")
        .values({
          org_id: org.ctx.orgId,
          mailbox_id: org.mailboxId,
          key_hash: hashOf(org.ctx.orgId, "anna@acme.pl"),
          received: 7,
          relation: "new",
          first_seen_at: ago(30),
          last_seen_at: ago(30),
        })
        .execute();
      const before = await profileOf(trx, org, "anna@acme.pl");
      expect(before?.received).toBe(7);

      const { promise: gate, resolve: release } = Promise.withResolvers<undefined>();
      const { promise: held, resolve: locked } = Promise.withResolvers<undefined>();
      // The holder is another pool connection: it takes the lock the way the data-request erase does.
      const holder = db.transaction().execute(async (other) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${profileLockKey(org.mailboxId)}, 0))`.execute(other);
        locked(undefined);
        await gate;
      });
      await held;
      try {
        let statements = 0;
        const counted = trx.withPlugin({
          transformQuery: (args) => {
            statements += 1;
            return args.node;
          },
          transformResult: async (args) => args.result,
        });
        const busy = await refreshMailboxProfiles(
          { db: counted, credentialsKey: KEY, testMail: NO_TEST },
          org.ctx,
          org.mailboxId,
          { now: NOW }
        );
        expect(busy).toEqual({ written: 0, zeroed: 0, skipped: true });
        // The flag read and the try-lock are the only statements: no mail was read.
        expect(statements).toBeLessThanOrEqual(2);
        expect(await profileOf(trx, org, "anna@acme.pl")).toEqual(before);
      } finally {
        release(undefined);
        await holder;
      }
      expect(await refresh(trx, org)).toEqual({ written: 1, zeroed: 0, skipped: false });
      expect((await profileOf(trx, org, "anna@acme.pl"))?.received).toBe(1);
    });
  });

  test("13 the flag sender_context off: no pass for that organization, the other one runs", async () => {
    await withRollback(db, async (trx) => {
      const off = await newOrg(trx, { flag: false });
      const on = await newOrg(trx);
      await seedSenderActivity(trx, off.ctx, off.mailboxId, { address: "anna@acme.pl", mails: mailsAt([1]) });
      await seedSenderActivity(trx, on.ctx, on.mailboxId, { address: "anna@acme.pl", mails: mailsAt([1]) });
      expect(await refresh(trx, off)).toEqual({ written: 0, zeroed: 0, skipped: true });
      expect(await countRows(trx, off)).toBe(0);
      expect(await refresh(trx, on)).toEqual({ written: 1, zeroed: 0, skipped: false });
      expect(await countRows(trx, on)).toBe(1);

      // Turning the flag off again stops the pass; the stored rows stay.
      await setOrgFeature(trx, on.ctx, { flag: "sender_context", enabled: false, actor: "cli", now: NOW });
      await seedSenderActivity(trx, on.ctx, on.mailboxId, { address: "anna@acme.pl", mails: mailsAt([2]) });
      expect(await refresh(trx, on)).toEqual({ written: 0, zeroed: 0, skipped: true });
      expect((await profileOf(trx, on, "anna@acme.pl"))?.received).toBe(1);
    });
  });
});

describe("readSenderActivity", () => {
  test("14 the 30-day and 90-day sub-counts, corrections, rescues and suspicious mail", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "eve@corp.pl",
        mails: [
          // Corrected away from spam.
          {
            at: ago(5),
            category: "spam",
            answered: true,
            feedback: [{ verdict: "wrong", trueCategory: "needs_reply" }],
          },
          // Moved back by the user.
          {
            at: ago(40),
            category: "notification",
            flagged: true,
            feedback: [{ verdict: "wrong", source: "imap_move" }],
          },
          // Corrected to spam.
          { at: ago(10), category: "info", feedback: [{ verdict: "wrong", trueCategory: "spam" }] },
          // A later "right" replaces the earlier correction; suspicious; unseen for more than 7 days.
          {
            at: ago(20),
            category: "urgent",
            suspicious: true,
            seen: false,
            feedback: [{ verdict: "wrong", trueCategory: "needs_reply" }, { verdict: "right" }],
          },
          // Unseen for less than 7 days: not counted as unseen_7d.
          { at: ago(3), seen: false },
        ],
      });
      const [eve] = await readSenderActivity(trx, org.ctx, org.mailboxId, { now: NOW, testMail: NO_TEST });
      expect(eve).toMatchObject({
        address: "eve@corp.pl",
        received: 5,
        received30: 4,
        answered: 1,
        answered30: 1,
        flagged: 1,
        flagged30: 0,
        unseen7d: 1,
        movedBack: 1,
        rescued90: 2,
        correctedToSpam90: 1,
        suspicious90: 1,
        byCategory: { spam: 1, notification: 1, info: 1, urgent: 1 },
        corrections: { needs_reply: 1, spam: 1 },
      });
    });
  });

  test("15 a delegate has the relation delegate and a VIP rule the relation vip; delegations count", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const delegateId = await insertDelegate(trx, org.ctx, { email: "dele@corp.pl" });
      await insertDelegate(trx, org.ctx, { email: "gone@corp.pl", active: false });
      const mine = await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "boss@corp.pl",
        mails: mailsAt([1]),
      });
      const { draftId, sendId } = await insertDraftAndSend(trx, org.ctx, org.mailboxId, {
        delegateId,
        to: "dele@corp.pl",
      });
      await insertDelegation(trx, org.ctx, {
        mailboxId: org.mailboxId,
        emailId: mine.emailIds[0] as string,
        delegateId,
        draftActionId: draftId,
        sendActionId: sendId,
        createdAt: ago(2),
      });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "dele@corp.pl", mails: mailsAt([1]) });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "gone@corp.pl", mails: mailsAt([1]) });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "vip@big.pl", mails: mailsAt([1]) });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "sub@vipdomain.pl", mails: mailsAt([1]) });
      await insertSenderRule(trx, org.ctx, { mailboxId: null, pattern: "vip@big.pl", kind: "vip" });
      await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "vipdomain.pl", kind: "vip" });
      const rows = new Map(
        (await readSenderActivity(trx, org.ctx, org.mailboxId, { now: NOW, testMail: NO_TEST })).map((row) => [
          row.address,
          row,
        ])
      );
      expect(rows.get("dele@corp.pl")).toMatchObject({ relation: "delegate", delegationsTo: 1 });
      expect(rows.get("gone@corp.pl")).toMatchObject({ relation: "new", delegationsTo: 0 });
      expect(rows.get("vip@big.pl")?.relation).toBe("vip");
      expect(rows.get("sub@vipdomain.pl")?.relation).toBe("vip");
      expect(rows.get("boss@corp.pl")?.relation).toBe("new");
    });
  });

  test("16 the number of statements does not depend on the number of senders", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      let statements = 0;
      const counted = trx.withPlugin({
        transformQuery: (args) => {
          statements += 1;
          return args.node;
        },
        transformResult: async (args) => args.result,
      });
      const read = async (): Promise<number> => {
        statements = 0;
        await readSenderActivity(counted, org.ctx, org.mailboxId, { now: NOW, testMail: NO_TEST });
        return statements;
      };
      const none = await read();
      for (let index = 0; index < 3; index += 1) {
        await seedSenderActivity(trx, org.ctx, org.mailboxId, {
          address: `few${index}@acme.pl`,
          mails: [{ at: ago(1), category: "info", answered: true, headers: {} }],
          sent: [{ at: ago(1) }],
        });
      }
      const few = await read();
      for (let index = 0; index < 25; index += 1) {
        await seedSenderActivity(trx, org.ctx, org.mailboxId, {
          address: `many${index}@acme.pl`,
          mails: [{ at: ago(1), category: "info", answered: true, headers: {} }],
          sent: [{ at: ago(1) }],
        });
      }
      const many = await read();
      expect(few).toBe(none);
      expect(many).toBe(none);
      expect(none).toBeGreaterThan(0);
    });
  });
});
