import { randomUUID } from "node:crypto";

import { normalizeSenderAddress } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { readProfiles, readSenderActivity } from "../../src/modules/contacts";
import { normalizedAddress } from "../../src/modules/contacts/address-sql";

import {
  ago,
  hashOf,
  HOUR,
  KEY,
  mailId,
  mailsAt,
  ms,
  newOrg,
  NO_TEST,
  NOW,
  profileOf,
  refresh,
  secondMailbox,
  DAY,
  type Org,
  type Trx,
} from "./contacts-fixtures";
import { insertDelegate, insertDelegation, insertDraftAndSend, seedSenderActivity } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// Sender context, profile pass: one lower-case rule on every path, and the guards of the reads (mailbox scope, own sends,
// window edges, recipient rule, newest dates). Each test fails when its guard is removed.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const allRows = (trx: Trx, org: Org) =>
  trx.selectFrom("sender_profiles").selectAll().where("mailbox_id", "=", org.mailboxId).execute();

const activityOf = async (trx: Trx, org: Org) =>
  new Map(
    (await readSenderActivity(trx, org.ctx, org.mailboxId, { now: NOW, testMail: NO_TEST })).map((row) => [
      row.address,
      row,
    ])
  );

// Five mails of one sender with their Message-IDs, received on days 30 to 26.
const fiveMails = (address: string) =>
  [0, 1, 2, 3, 4].map((index) => ({ id: mailId(`in${index}`), at: ago(30 - index), address }));

// The assistant's own mail through a delegation of the mailbox: a mail, a draft and send pair, and the delegation row.
async function delegateTo(trx: Trx, org: Org, delegateId: string, email: string, createdAt: Date): Promise<void> {
  const mail = await seedSenderActivity(trx, org.ctx, org.mailboxId, {
    address: `src-${randomUUID()}@x.pl`,
    mails: [{ at: ago(1) }],
  });
  const { draftId, sendId } = await insertDraftAndSend(trx, org.ctx, org.mailboxId, { delegateId, to: email });
  await insertDelegation(trx, org.ctx, {
    mailboxId: org.mailboxId,
    emailId: mail.emailIds[0] as string,
    delegateId,
    draftActionId: draftId,
    sendActionId: sendId,
    createdAt,
  });
}

// The address as the Sent reader stores it (`cleanAddresses`: trim and JavaScript lower case) next to the address as it
// arrives, with the form that the profile must key on.
const probes = [
  {
    name: "Greek final sigma",
    incoming: ["ΑΝΝΑΣ@x.gr", "αννας@x.gr"],
    sent: "αννας@x.gr",
    key: "αννασ@x.gr",
    reads: ["ΑΝΝΑΣ@X.GR", "αννας@x.gr", "αννασ@x.gr"],
  },
  {
    name: "Turkish dotted I",
    incoming: ["İSTANBUL@x.tr", "i̇stanbul@x.tr"],
    sent: "i̇stanbul@x.tr",
    key: "istanbul@x.tr",
    reads: ["İSTANBUL@X.TR", "i̇stanbul@x.tr", "istanbul@x.tr"],
  },
  {
    name: "Polish letters",
    incoming: ["ŁÓDŹ@x.pl", "łódź@x.pl"],
    sent: "łódź@x.pl",
    key: "łódź@x.pl",
    reads: ["ŁÓDŹ@X.PL", "łódź@x.pl"],
  },
  {
    name: "ASCII",
    incoming: ["Anna@X.PL", "anna@x.pl"],
    sent: "anna@x.pl",
    key: "anna@x.pl",
    reads: ["Anna@X.PL ", "anna@x.pl"],
  },
];

describe("one lower-case rule on every path", () => {
  for (const probe of probes) {
    test(`${probe.name}: the incoming mail, the Sent recipient and readProfiles give one profile and one hash`, async () => {
      await withRollback(db, async (trx) => {
        const org = await newOrg(trx);
        for (const [index, address] of probe.incoming.entries()) {
          await seedSenderActivity(trx, org.ctx, org.mailboxId, { address, mails: [{ at: ago(2 + index) }] });
        }
        await seedSenderActivity(trx, org.ctx, org.mailboxId, { sent: [{ at: ago(1), to: [probe.sent] }] });
        await refresh(trx, org);

        const rows = await allRows(trx, org);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.key_hash).toBe(hashOf(org.ctx.orgId, probe.key));
        expect(rows[0]).toMatchObject({ received: probe.incoming.length, user_mails_to: 1, relation: "known" });

        // Each way to write the address finds the one row.
        for (const address of probe.reads) {
          const one = await readProfiles(
            { db: trx, credentialsKey: KEY },
            org.ctx,
            [{ mailboxId: org.mailboxId, address }],
            NOW
          );
          expect([address, one.size]).toEqual([address, 1]);
        }
        const pairs = probe.reads.map((address) => ({ mailboxId: org.mailboxId, address }));
        const map = await readProfiles({ db: trx, credentialsKey: KEY }, org.ctx, pairs, NOW);
        expect([...map.keys()]).toEqual([`${org.mailboxId}:${probe.key}`]);
        expect(map.get(`${org.mailboxId}:${probe.key}`)).toMatchObject({
          received: probe.incoming.length,
          userMailsTo: 1,
        });
      });
    });
  }

  test("the SQL rule and the core rule give the same form for every probe", async () => {
    const values = [...new Set(probes.flatMap((probe) => [...probe.incoming, probe.sent, ...probe.reads, probe.key]))];
    values.push("  Mixed.Case@Acme.PL  ", "ΣΑΣ@x.gr", "ΟΔΥΣΣΕΥΣ@x.gr", "ISPARTA@x.tr", "ıspar@x.tr");
    const { rows } = await sql<{ value: string; normalized: string }>`
      SELECT p.x AS value, ${normalizedAddress("p.x")} AS normalized FROM unnest(${values}::text[]) AS p(x)
    `.execute(db);
    expect(rows).toHaveLength(values.length);
    for (const row of rows)
      expect({ value: row.value, normalized: row.normalized }).toEqual({
        value: row.value,
        normalized: normalizeSenderAddress(row.value),
      });
  });

  test("the user's reply delay: the Sent recipient in the stored lower case still matches the Greek sender", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const pairs = [2, 4, 6, 8, 10].map((hours, index) => ({ id: mailId(`g${index}`), hours, day: 30 - index }));
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "ΑΝΝΑΣ@x.gr",
        mails: pairs.map(({ id, day }) => ({ at: ago(day), messageId: id })),
        sent: pairs.map(({ id, day, hours }) => ({ at: ago(day, -hours), parent: id, to: ["αννας@x.gr"] })),
      });
      await refresh(trx, org);
      expect((await profileOf(trx, org, "αννασ@x.gr"))?.median_user_reply_hours).toBe(6);
    });
  });

  test("an own mailbox address, a delegate and a test sender match whatever the letter case or sigma form", async () => {
    await withRollback(db, async (trx) => {
      // The stored forms are lower case with the final sigma; the mail arrives in capitals.
      const org = await newOrg(trx, { address: "βοχ-αννας@x.gr" });
      await insertDelegate(trx, org.ctx, { email: "δελεγατες@x.gr" });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "ΒΟΧ-ΑΝΝΑΣ@x.gr", mails: mailsAt([1]) });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "ΔΕΛΕΓΑΤΕΣ@x.gr", mails: mailsAt([1]) });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { sent: [{ at: ago(1), to: ["ΤΕΣΤ-ΑΝΝΑΣ@x.gr"] }] });
      await refresh(trx, org, NOW, { senders: ["τεστ-αννας@x.gr"] });
      const rows = await allRows(trx, org);
      // The own address and the test sender give no row; the delegate does, with the relation delegate.
      expect(rows.map((row) => row.key_hash)).toEqual([hashOf(org.ctx.orgId, "δελεγατεσ@x.gr")]);
      expect(rows[0]?.relation).toBe("delegate");
    });
  });
});

describe("mailbox scope of the reads", () => {
  test("the user's reply delay ignores the Sent mail of another mailbox", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await secondMailbox(trx, a);
      const pairs = fiveMails("anna@acme.pl").map((mail, index) => ({ ...mail, hours: 2 * (index + 1) }));
      await seedSenderActivity(trx, a.ctx, a.mailboxId, {
        address: "anna@acme.pl",
        mails: pairs.map(({ id, at }) => ({ at, messageId: id })),
        sent: pairs.map(({ id, at, hours }) => ({ at: new Date(at.getTime() + hours * HOUR), parent: id })),
      });
      // The other mailbox holds a reply to the same Message-IDs after one hour.
      await seedSenderActivity(trx, b.ctx, b.mailboxId, {
        address: "anna@acme.pl",
        sent: pairs.map(({ id, at }) => ({ at: new Date(at.getTime() + HOUR), parent: id })),
      });
      await refresh(trx, a);
      expect((await profileOf(trx, a, "anna@acme.pl"))?.median_user_reply_hours).toBe(6);
    });
  });

  test("their reply delay ignores the Sent mail of another mailbox", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await secondMailbox(trx, a);
      const mine = [10, 20, 30, 40, 50].map((hours, index) => ({
        id: `<mine-${index}@x.test>`,
        hours,
        day: 20 - index * 3,
      }));
      await seedSenderActivity(trx, a.ctx, a.mailboxId, {
        address: "anna@acme.pl",
        mails: mine.map(({ id, hours, day }) => ({ at: ago(day, -hours), inReplyTo: id })),
        sent: mine.map(({ id, day }) => ({ at: ago(day), messageId: id })),
      });
      // The other mailbox sent a mail with the same Message-ID one hour before each reply.
      await seedSenderActivity(trx, b.ctx, b.mailboxId, {
        sent: mine.map(({ id, hours, day }) => ({ at: ago(day, -(hours - 1)), messageId: id, to: ["x@acme.pl"] })),
      });
      await refresh(trx, a);
      const row = await profileOf(trx, a, "anna@acme.pl");
      expect(row?.reply_samples_theirs).toBe(5);
      expect(row?.median_their_reply_hours).toBe(30);
    });
  });

  test("a Sent From alias of another mailbox is not an own address of this mailbox", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await secondMailbox(trx, a);
      await seedSenderActivity(trx, b.ctx, b.mailboxId, {
        sent: [{ at: ago(1), from: "aliasb@acme.pl", to: ["somebody@acme.pl"] }],
      });
      await seedSenderActivity(trx, a.ctx, a.mailboxId, { address: "aliasb@acme.pl", mails: mailsAt([1]) });
      await refresh(trx, a);
      expect(await profileOf(trx, a, "aliasb@acme.pl")).toMatchObject({ received: 1 });
    });
  });

  test("a delegation of another mailbox is not counted", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await secondMailbox(trx, a);
      const delegateId = await insertDelegate(trx, a.ctx, { email: "dele@corp.pl" });
      await delegateTo(trx, b, delegateId, "dele@corp.pl", ago(2));
      await seedSenderActivity(trx, a.ctx, a.mailboxId, { address: "dele@corp.pl", mails: mailsAt([1]) });
      expect((await activityOf(trx, a)).get("dele@corp.pl")).toMatchObject({ delegationsTo: 0, relation: "delegate" });
    });
  });
});

describe("delegations", () => {
  test("a delegation to an inactive delegate is not counted", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const delegateId = await insertDelegate(trx, org.ctx, { email: "off@corp.pl", active: false });
      await delegateTo(trx, org, delegateId, "off@corp.pl", ago(2));
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "off@corp.pl", mails: mailsAt([1]) });
      expect((await activityOf(trx, org)).get("off@corp.pl")).toMatchObject({ delegationsTo: 0, relation: "new" });
    });
  });

  test("only delegations of the window count: 100 days old and later than now do not", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const delegateId = await insertDelegate(trx, org.ctx, { email: "dele@corp.pl" });
      for (const createdAt of [ago(100), ago(2), NOW, new Date(NOW.getTime() + 1000)]) {
        await delegateTo(trx, org, delegateId, "dele@corp.pl", createdAt);
      }
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "dele@corp.pl", mails: mailsAt([1]) });
      expect((await activityOf(trx, org)).get("dele@corp.pl")?.delegationsTo).toBe(2);
    });
  });
});

describe("sends of the assistant", () => {
  test("a system send is no user mail, no user reply delay and no mail that a reply names", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const pairs = fiveMails("anna@acme.pl");
      // The assistant answered five mails of Anna after two hours, and wrote to Bob.
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: pairs.map(({ id, at }) => ({ at, messageId: id })),
        sent: pairs.map(({ id, at }) => ({ at: new Date(at.getTime() + 2 * HOUR), parent: id, system: true })),
      });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        sent: [{ at: ago(3), to: ["bob@beta.pl"], system: true }],
      });
      // Carl answers five system sends.
      const sends = [0, 1, 2, 3, 4].map((index) => ({ id: `<sys-${index}@x.test>`, day: 20 - index * 3 }));
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "carl@acme.pl",
        mails: sends.map(({ id, day }) => ({ at: ago(day, -5), inReplyTo: id })),
        sent: sends.map(({ id, day }) => ({ at: ago(day), messageId: id, to: ["carl@acme.pl"], system: true })),
      });
      await refresh(trx, org);
      expect(await profileOf(trx, org, "bob@beta.pl")).toBeUndefined();
      expect(await profileOf(trx, org, "anna@acme.pl")).toMatchObject({
        user_mails_to: 0,
        median_user_reply_hours: null,
        relation: "new",
      });
      expect(await profileOf(trx, org, "carl@acme.pl")).toMatchObject({
        reply_samples_theirs: 0,
        median_their_reply_hours: null,
      });
    });
  });
});

describe("window edges", () => {
  test("incoming mail: exactly 90 days and exactly now count; one second more or after now do not", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const edges: [string, Date][] = [
        ["edge90@acme.pl", new Date(NOW.getTime() - 90 * DAY)],
        ["over90@acme.pl", new Date(NOW.getTime() - 90 * DAY - 1000)],
        ["atnow@acme.pl", NOW],
        ["afternow@acme.pl", new Date(NOW.getTime() + 1000)],
      ];
      for (const [address, at] of edges)
        await seedSenderActivity(trx, org.ctx, org.mailboxId, { address, mails: [{ at }] });
      await refresh(trx, org);
      expect(await profileOf(trx, org, "edge90@acme.pl")).toMatchObject({ received: 1 });
      expect(await profileOf(trx, org, "atnow@acme.pl")).toMatchObject({ received: 1 });
      expect(await profileOf(trx, org, "over90@acme.pl")).toBeUndefined();
      expect(await profileOf(trx, org, "afternow@acme.pl")).toBeUndefined();
    });
  });

  test("Sent mail: exactly 90 days and exactly now count; one second more or after now do not", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const edges: [string, Date][] = [
        ["sedge90@acme.pl", new Date(NOW.getTime() - 90 * DAY)],
        ["sover90@acme.pl", new Date(NOW.getTime() - 90 * DAY - 1000)],
        ["satnow@acme.pl", NOW],
        ["safternow@acme.pl", new Date(NOW.getTime() + 1000)],
      ];
      for (const [address, at] of edges)
        await seedSenderActivity(trx, org.ctx, org.mailboxId, { sent: [{ at, to: [address] }] });
      await refresh(trx, org);
      expect(await profileOf(trx, org, "sedge90@acme.pl")).toMatchObject({ user_mails_to: 1 });
      expect(await profileOf(trx, org, "satnow@acme.pl")).toMatchObject({ user_mails_to: 1 });
      expect(await profileOf(trx, org, "sover90@acme.pl")).toBeUndefined();
      expect(await profileOf(trx, org, "safternow@acme.pl")).toBeUndefined();
    });
  });
});

describe("the recipient and the delay samples", () => {
  test("a reply to another address is no delay sample; a Sent row with no stored recipient is", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const toOther = fiveMails("anna@acme.pl");
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: toOther.map(({ id, at }) => ({ at, messageId: id })),
        sent: toOther.map(({ id, at }) => ({
          at: new Date(at.getTime() + 3 * HOUR),
          parent: id,
          to: ["other@acme.pl"],
        })),
      });
      // Carl's replies carry no stored recipient (the retention cleared it): they count.
      const cleared = fiveMails("carl@acme.pl");
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "carl@acme.pl",
        mails: cleared.map(({ id, at }) => ({ at, messageId: id })),
        sent: cleared.map(({ id, at }) => ({ at: new Date(at.getTime() + 4 * HOUR), parent: id, to: [] })),
      });
      await refresh(trx, org);
      expect((await profileOf(trx, org, "anna@acme.pl"))?.median_user_reply_hours).toBeNull();
      expect((await profileOf(trx, org, "carl@acme.pl"))?.median_user_reply_hours).toBe(4);
    });
  });

  test("their delay is measured from the newest Sent mail that the reply names", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const rounds = [0, 1, 2, 3, 4].map((index) => ({
        older: `<older-${index}@x.test>`,
        newer: `<newer-${index}@x.test>`,
        day: 20 - index * 3,
      }));
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: rounds.map(({ older, newer, day }) => ({ at: ago(day), inReplyTo: `${older} ${newer}` })),
        sent: rounds.flatMap(({ older, newer, day }) => [
          { at: ago(day, 30), messageId: older },
          { at: ago(day, 10), messageId: newer },
        ]),
      });
      await refresh(trx, org);
      const row = await profileOf(trx, org, "anna@acme.pl");
      expect(row?.reply_samples_theirs).toBe(5);
      expect(row?.median_their_reply_hours).toBe(10);
    });
  });
});

describe("Sent recipients and the newest Sent date", () => {
  test("a recipient with no @ is not an address", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        sent: [{ at: ago(1), to: ["undisclosed-recipients:;", "bob"], cc: ["ok@acme.pl"] }],
      });
      await refresh(trx, org);
      const rows = await allRows(trx, org);
      expect(rows.map((row) => row.key_hash)).toEqual([hashOf(org.ctx.orgId, "ok@acme.pl")]);
    });
  });

  test("last_user_mail_at keeps the newest Sent date when the Sent mail leaves the window", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: mailsAt([20]),
        sent: [{ at: ago(10) }],
      });
      await refresh(trx, org);
      expect(ms((await profileOf(trx, org, "anna@acme.pl"))?.last_user_mail_at)).toBe(ago(10).getTime());

      // 85 days later the Sent mail is 95 days old; Anna still writes.
      const later = new Date(NOW.getTime() + 85 * DAY);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: [{ at: new Date(later.getTime() - DAY) }],
      });
      await refresh(trx, org, later);
      const row = await profileOf(trx, org, "anna@acme.pl");
      expect(row).toMatchObject({ received: 1, user_mails_to: 0 });
      expect(ms(row?.last_user_mail_at)).toBe(ago(10).getTime());
    });
  });
});
