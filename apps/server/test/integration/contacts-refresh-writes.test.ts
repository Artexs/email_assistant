import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import {
  ago,
  countRows,
  DAY,
  HOUR,
  mailId,
  ms,
  newOrg,
  NOW,
  profileOf,
  refresh,
  type Org,
  type Trx,
} from "./contacts-fixtures";
import { seedSenderActivity } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// A repeat profile pass writes only the rows whose values changed. An UPDATE of an equal row still makes a new tuple and a dead
// one: 5,300 senders would leave 5,300 dead tuples a mailbox an hour. The proof is `ctid`: a row that is not written keeps its
// place; every write (an insert after an update too) moves it.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const tuples = async (trx: Trx, org: Org): Promise<Map<string, string>> => {
  const { rows } = await sql<{ key_hash: string; ctid: string }>`
    SELECT key_hash, ctid::text AS ctid FROM sender_profiles WHERE mailbox_id = ${org.mailboxId}
  `.execute(trx);
  return new Map(rows.map((row) => [row.key_hash, row.ctid]));
};

// A mailbox where every stored value is set: counts, both medians, categories, corrections, bulk signals and all three dates.
async function fullMailbox(trx: Trx, org: Org): Promise<void> {
  const pairs = [10, 20, 30.3, 40, 50].map((hours, index) => ({ id: mailId(`m${index}`), hours, day: 30 - index * 3 }));
  const incoming = pairs.map((_, index) => mailId(`in${index}`));
  await seedSenderActivity(trx, org.ctx, org.mailboxId, {
    address: "anna@acme.pl",
    mails: [
      // Their replies (the median of their delay) and the mails that the user answers (the median of the user's delay).
      ...pairs.map(({ id, hours, day }) => ({ at: ago(day, -hours), inReplyTo: id })),
      ...pairs.map(({ day }, index) => ({
        at: ago(day + 1 + index),
        messageId: incoming[index] ?? "",
        category: "needs_reply" as const,
        answered: true,
        flagged: index === 0,
        headers: { listId: "<anna.acme.pl>" },
        feedback: index === 1 ? [{ verdict: "wrong" as const, trueCategory: "info" as const }] : [],
      })),
    ],
    sent: [
      ...pairs.map(({ id, day }) => ({ at: ago(day), messageId: id, to: ["anna@acme.pl"] })),
      // The user's answers, 3 to 7 hours after the mail.
      ...pairs.map(({ day }, index) => ({
        at: ago(day + 1 + index, -(3 + index)),
        parent: incoming[index] ?? "",
        to: ["anna@acme.pl"],
      })),
    ],
  });
  await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "bob@acme.pl", mails: [{ at: ago(2) }] });
  await seedSenderActivity(trx, org.ctx, org.mailboxId, { sent: [{ at: ago(3), to: ["carl@acme.pl"] }] });
}

// One stored value at a time is changed; the pass must see it, write that row only, and restore the value.
const changes: [string, string][] = [
  ["received", "99"],
  ["moved_back", "99"],
  ["answered", "99"],
  ["flagged", "99"],
  ["unseen_7d", "99"],
  ["user_mails_to", "99"],
  ["delegations_to", "99"],
  ["reply_samples_theirs", "99"],
  ["relation", "'vip'"],
  ["by_category", `'{"spam": 1}'::jsonb`],
  ["corrections", `'{"spam": 1}'::jsonb`],
  ["bulk_signals", "ARRAY['noreply']::text[]"],
  ["median_user_reply_hours", "1"],
  ["median_their_reply_hours", "1"],
  // A median that goes from a value to NULL is a change too (`<>` would read NULL as "unknown", not different).
  ["median_user_reply_hours", "NULL"],
  ["median_their_reply_hours", "NULL"],
  // The date columns widen: a stored first date that is too new, and a last date that is too old, both change.
  ["first_seen_at", "now()"],
  ["last_seen_at", "now() - interval '200 days'"],
  ["last_user_mail_at", "now() - interval '200 days'"],
];

describe("a repeat pass writes only changed rows", () => {
  test("1 a second pass at the same time writes no row: no new tuple, no dead tuple", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await fullMailbox(trx, org);
      expect(await refresh(trx, org)).toEqual({ written: 3, unchanged: 0, zeroed: 0, skipped: false });
      const anna = await profileOf(trx, org, "anna@acme.pl");
      // The fixture really holds a value in every column that the pass compares.
      expect(anna?.median_their_reply_hours).not.toBeNull();
      expect(anna?.median_user_reply_hours).not.toBeNull();
      expect(anna?.median_their_reply_hours).not.toBe(Math.round(anna?.median_their_reply_hours ?? 0));
      expect(Object.keys(anna?.by_category ?? {})).not.toHaveLength(0);
      expect(Object.keys(anna?.corrections ?? {})).not.toHaveLength(0);
      expect(anna?.bulk_signals).not.toHaveLength(0);
      expect(anna?.flagged).toBeGreaterThan(0);
      expect(anna?.last_user_mail_at).not.toBeNull();

      const before = await tuples(trx, org);
      expect(before.size).toBe(3);
      // A later clock changes nothing the pass compares: the mails stay inside the window.
      expect(await refresh(trx, org, new Date(NOW.getTime() + HOUR))).toEqual({
        written: 0,
        unchanged: 3,
        zeroed: 0,
        skipped: false,
      });
      expect(await tuples(trx, org)).toEqual(before);
    });
  });

  test("2 a zeroed row and a row whose stored dates are newer than the read dates are not written again", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      // The mail leaves the window after 40 days and the row is zeroed. Anna's Sent mail of 80 days leaves it after 20 days:
      // the stored `last_user_mail_at` is then newer than the read value (none), and the widening keeps it.
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "old@acme.pl", mails: [{ at: ago(60) }] });
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "anna@acme.pl",
        mails: [{ at: ago(2) }, { at: ago(1) }],
        sent: [{ at: ago(80) }],
      });
      await refresh(trx, org);
      const later = new Date(NOW.getTime() + 40 * DAY);
      expect(await refresh(trx, org, later)).toEqual({ written: 1, unchanged: 0, zeroed: 1, skipped: false });
      const before = await tuples(trx, org);
      expect(ms((await profileOf(trx, org, "anna@acme.pl"))?.last_user_mail_at)).toBe(ago(80).getTime());
      expect(await refresh(trx, org, new Date(later.getTime() + HOUR))).toEqual({
        written: 0,
        unchanged: 1,
        zeroed: 0,
        skipped: false,
      });
      expect(await tuples(trx, org)).toEqual(before);
    });
  });

  for (const [column, value] of changes) {
    test(`3 a changed ${column} (to ${value}) is written back`, async () => {
      await withRollback(db, async (trx) => {
        const org = await newOrg(trx);
        await fullMailbox(trx, org);
        await refresh(trx, org);
        const good = await profileOf(trx, org, "anna@acme.pl");
        const before = await tuples(trx, org);
        await sql`UPDATE sender_profiles SET ${sql.ref(column)} = ${sql.raw(value)}
          WHERE mailbox_id = ${org.mailboxId} AND id = ${good?.id ?? ""}`.execute(trx);
        const bad = await tuples(trx, org);
        expect(await refresh(trx, org)).toEqual({ written: 1, unchanged: 2, zeroed: 0, skipped: false });
        const after = await tuples(trx, org);
        // Only the changed row moved.
        const moved = [...after].filter(([hash, ctid]) => bad.get(hash) !== ctid).map(([hash]) => hash);
        expect(moved).toEqual([good?.key_hash ?? ""]);
        expect(before.size).toBe(3);
        const healed = await profileOf(trx, org, "anna@acme.pl");
        expect(healed?.[column as keyof typeof healed]).toEqual(good?.[column as keyof typeof good]);
        expect(await countRows(trx, org)).toBe(3);
      });
    });
  }

  test("4 a new mail changes the row that it belongs to and no other", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await fullMailbox(trx, org);
      await refresh(trx, org);
      const before = await tuples(trx, org);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "bob@acme.pl", mails: [{ at: ago(1) }] });
      expect(await refresh(trx, org)).toEqual({ written: 1, unchanged: 2, zeroed: 0, skipped: false });
      const after = await tuples(trx, org);
      const moved = [...after].filter(([hash, ctid]) => before.get(hash) !== ctid);
      expect(moved).toHaveLength(1);
      expect((await profileOf(trx, org, "bob@acme.pl"))?.received).toBe(2);
    });
  });

  test("5 a changed row gets `refreshed_at` of the pass that wrote it; an unchanged row keeps its old value", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await fullMailbox(trx, org);
      await refresh(trx, org);
      const later = new Date(NOW.getTime() + 3 * HOUR);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "bob@acme.pl", mails: [{ at: ago(1) }] });
      expect(await refresh(trx, org, later)).toEqual({ written: 1, unchanged: 2, zeroed: 0, skipped: false });
      expect(ms((await profileOf(trx, org, "bob@acme.pl"))?.refreshed_at)).toBe(later.getTime());
      expect(ms((await profileOf(trx, org, "anna@acme.pl"))?.refreshed_at)).toBe(NOW.getTime());
    });
  });

  test("6 the columns that the pass compares are every column of the table but its keys and `refreshed_at`", async () => {
    // A new column that joins the schema, the insert and the update but not the `CHANGED` list would never be rewritten.
    // The per-column cases above are the proof for each listed column; this test ties the list to the table.
    const { rows } = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sender_profiles'
        AND column_name NOT IN ('id', 'org_id', 'mailbox_id', 'key_hash', 'refreshed_at')
    `.execute(db);
    expect(rows.map((row) => row.column_name).sort()).toEqual([...new Set(changes.map(([column]) => column))].sort());
  });
});
