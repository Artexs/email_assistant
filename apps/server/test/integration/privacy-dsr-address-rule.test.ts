import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { refreshMailboxProfiles } from "../../src/modules/contacts";
import { eraseSubjectData, findSubjectData } from "../../src/modules/privacy";
import { senderKeyHash } from "../../src/platform/crypto";

import { KEY, newOrg, NO_TEST, NOW, ago, type Org } from "./contacts-fixtures";
import { insertDelegate, insertTestEmail, seedSenderActivity } from "./fixtures";
import { testDb } from "./helpers";

// One address rule in every data request match. The database `lower()` and the JavaScript `toLowerCase()` differ for the
// Greek final sigma and the Turkish dotted capital I, so a find or an erase that compared the two missed the mail of
// the person. The code points are written as escapes: SIGMA is U+03A3, sigma is U+03C3, FINAL is U+03C2, DOTTED is U+0130.
const db = testDb();

const SIGMA = "\u03a3";
const sigma = "\u03c3";
const FINAL = "\u03c2";
const DOTTED = "\u0130";
const COMBINING_DOT = "\u0307";

const orgIds: string[] = [];
const userIds: string[] = [];
afterEach(async () => {
  if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});
afterAll(async () => {
  await db.destroy();
});

// stored: the address of the mail as the server stored it; asked: the address in the data request.
const CASES: { name: string; stored: string; asked: string }[] = [
  { name: "greek: plain sigma stored, capital sigma asked", stored: `anna${sigma}@x.gr`, asked: `ANNA${SIGMA}@x.gr` },
  { name: "greek: capital sigma stored, capital sigma asked", stored: `ANNA${SIGMA}@x.gr`, asked: `ANNA${SIGMA}@x.gr` },
  { name: "greek: capital sigma stored, final sigma asked", stored: `ANNA${SIGMA}@x.gr`, asked: `anna${FINAL}@x.gr` },
  { name: "greek: final sigma stored, capital sigma asked", stored: `anna${FINAL}@x.gr`, asked: `ANNA${SIGMA}@x.gr` },
  { name: "turkish: plain i stored, dotted capital I asked", stored: "ilker@x.tr", asked: `${DOTTED}LKER@x.tr` },
  {
    name: "turkish: dotted capital I stored, dotted capital I asked",
    stored: `${DOTTED}lker@x.tr`,
    asked: `${DOTTED}LKER@x.tr`,
  },
];

interface World extends Org {
  emailId: string;
}

// An organization with two mails of the person and one of another person; committed (the erase runs its own transaction).
async function seed(stored: string): Promise<World> {
  const world = await db.transaction().execute(async (trx) => {
    const org = await newOrg(trx);
    const { emailIds } = await seedSenderActivity(trx, org.ctx, org.mailboxId, {
      address: stored,
      mails: [{ at: ago(3) }, { at: ago(2) }],
    });
    await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "other@x.test", mails: [{ at: ago(1) }] });
    return { ...org, emailId: emailIds[0] as string };
  });
  orgIds.push(world.ctx.orgId);
  await pass(world);
  return world;
}

const pass = (w: Org) =>
  refreshMailboxProfiles({ db, credentialsKey: KEY, testMail: NO_TEST }, w.ctx, w.mailboxId, { now: NOW });

const mailCount = async (w: Org): Promise<number> =>
  Number(
    (
      await db
        .selectFrom("emails")
        .select(db.fn.countAll().as("n"))
        .where("org_id", "=", w.ctx.orgId)
        .executeTakeFirstOrThrow()
    ).n
  );

const profileCount = async (w: Org): Promise<number> =>
  Number(
    (
      await db
        .selectFrom("sender_profiles")
        .select(db.fn.countAll().as("n"))
        .where("org_id", "=", w.ctx.orgId)
        .executeTakeFirstOrThrow()
    ).n
  );

describe("one address rule in the data request match", () => {
  for (const { name, stored, asked } of CASES) {
    test(`find: ${name}`, async () => {
      const w = await seed(stored);
      const found = await findSubjectData(db, { orgId: w.ctx.orgId, address: asked, credentialsKey: KEY, now: NOW });
      expect(found.kind).toBe("found");
      if (found.kind !== "found") return;
      expect(found.counts.mails).toBe(2);
      expect(found.counts.sender_profiles).toBe(1);
    });

    test(`erase: ${name}`, async () => {
      const w = await seed(stored);
      expect(await mailCount(w)).toBe(3);
      expect(await profileCount(w)).toBe(2);
      const result = await eraseSubjectData(db, {
        orgId: w.ctx.orgId,
        address: asked,
        confirm: asked,
        credentialsKey: KEY,
        now: NOW,
      });
      expect(result.kind).toBe("erased");
      // The two mails and the profile of the person go; the mail and the profile of the other person stay.
      expect(await mailCount(w)).toBe(1);
      expect(await profileCount(w)).toBe(1);
      // A later profile pass does not write the profile back: no mail of the person is left.
      await pass(w);
      expect(await profileCount(w)).toBe(1);
      const rows = await db
        .selectFrom("sender_profiles")
        .select("key_hash")
        .where("org_id", "=", w.ctx.orgId)
        .execute();
      expect(rows.map((row) => row.key_hash)).toEqual([senderKeyHash(KEY, w.ctx.orgId, "other@x.test")]);
    });
  }

  // A kept mail names the person in its text, in the capital, the final sigma and the dotted forms: the scrub removes each.
  for (const { name, stored, asked, written } of [
    {
      name: "greek",
      stored: `anna${sigma}@x.gr`,
      asked: `anna${sigma}@x.gr`,
      written: [`ANNA${SIGMA}@x.gr`, `anna${FINAL}@x.gr`, `anna${sigma}@x.gr`],
    },
    {
      name: "turkish",
      stored: "ilker@x.tr",
      asked: "ilker@x.tr",
      written: [`${DOTTED}LKER@x.tr`, `${DOTTED}lker@x.tr`, `i${COMBINING_DOT}lker@x.tr`, "ILKER@x.tr"],
    },
  ]) {
    test(`scrub: ${name} forms of the address in the text of a kept mail`, async () => {
      const w = await seed(stored);
      const keptId = await db.transaction().execute((trx) =>
        insertTestEmail(trx, w.ctx, w.mailboxId, {
          status: "pending",
          received_at: ago(1),
          from_address: "other@x.test",
          body_text: written.map((form) => `write to ${form} today`).join("\n"),
        })
      );
      const result = await eraseSubjectData(db, {
        orgId: w.ctx.orgId,
        address: asked,
        confirm: asked,
        credentialsKey: KEY,
        now: NOW,
      });
      expect(result.kind).toBe("erased");
      const kept = await db.selectFrom("emails").select("body_text").where("id", "=", keptId).executeTakeFirstOrThrow();
      expect(kept.body_text).not.toMatch(/@x\.(gr|tr)/i);
      expect(kept.body_text?.split("\n")).toHaveLength(written.length);
    });
  }

  // Every rule of the registry compares through the one address rule, not only the sender column.
  test("the other columns: Reply-To, sent mail, recipients, return path, delegate, own mailbox", async () => {
    const own = `box${FINAL}@x.gr`;
    const w = await db.transaction().execute(async (trx) => newOrg(trx, { address: own }));
    orgIds.push(w.ctx.orgId);
    const owner = await db
      .selectFrom("memberships")
      .select("user_id")
      .where("org_id", "=", w.ctx.orgId)
      .executeTakeFirstOrThrow();
    userIds.push(owner.user_id);
    await db
      .updateTable("users")
      .set({ email: `chef${FINAL}@x.gr` })
      .where("id", "=", owner.user_id)
      .execute();
    const ids = await db.transaction().execute(async (trx) => {
      // The person is the only Reply-To of a mail from a contact form: the mail goes.
      const replyTo = await insertTestEmail(trx, w.ctx, w.mailboxId, {
        from_address: "form@x.test",
        received_at: ago(2),
      });
      await trx
        .insertInto("email_headers")
        .values({
          email_id: replyTo,
          org_id: w.ctx.orgId,
          reply_to: [`anna${FINAL}@x.gr`],
          parts_known: true,
          captured_at: NOW,
        })
        .execute();
      // A kept mail names the person as a recipient next to another person and holds her address as the return path.
      const kept = await insertTestEmail(trx, w.ctx, w.mailboxId, {
        from_address: "other@x.test",
        to_addresses: [`anna${FINAL}@x.gr`, "third@x.test"],
        received_at: ago(1),
      });
      await trx
        .insertInto("email_headers")
        .values({
          email_id: kept,
          org_id: w.ctx.orgId,
          return_path: `anna${FINAL}@x.gr`,
          parts_known: true,
          captured_at: NOW,
        })
        .execute();
      // A sent mail between the own mailbox (stored with a final sigma) and the person goes.
      const sentValues = (extra: { from_address: string; to_addresses: string[] }) => ({
        org_id: w.ctx.orgId,
        mailbox_id: w.mailboxId,
        dedup_key: `mid:<s-${randomUUID()}@x.test>:h1`,
        path: "Sent",
        uidvalidity: 7,
        uid: 1,
        thread_key: "<s@x.test>",
        origin: "user" as const,
        content: "pending" as const,
        sent_at: NOW,
        internal_date: NOW,
        ...extra,
      });
      // Sent mail between the own mailbox and the person goes, whichever of them is the sender.
      const sent = await trx
        .insertInto("sent_emails")
        .values([
          sentValues({ from_address: `box${sigma}@x.gr`, to_addresses: [`anna${FINAL}@x.gr`] }),
          sentValues({ from_address: `anna${FINAL}@x.gr`, to_addresses: [`box${sigma}@x.gr`] }),
        ])
        .returning("id")
        .execute();
      const delegate = await insertDelegate(trx, w.ctx, { email: `anna${FINAL}@x.gr` });
      return { replyTo, kept, sent: sent.map((row) => row.id), delegate };
    });
    const ask = `ANNA${SIGMA}@x.gr`;
    const found = await findSubjectData(db, { orgId: w.ctx.orgId, address: ask, credentialsKey: KEY, now: NOW });
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    expect(found.counts.mails).toBe(1);
    expect(found.counts.sent_mails).toBe(2);
    expect(found.counts.mentions["emails.to_addresses"]).toBe(1);
    expect(found.counts.mentions["email_headers.return_path"]).toBe(1);
    expect(found.counts.listed.delegates).toBe(1);

    const result = await eraseSubjectData(db, {
      orgId: w.ctx.orgId,
      address: ask,
      confirm: ask,
      credentialsKey: KEY,
      now: NOW,
    });
    expect(result.kind).toBe("erased");
    const mails = await db
      .selectFrom("emails")
      .select(["id", "to_addresses"])
      .where("org_id", "=", w.ctx.orgId)
      .execute();
    expect(mails.map((row) => row.id)).toEqual([ids.kept]);
    expect(mails[0]?.to_addresses).toEqual(["third@x.test"]);
    const header = await db
      .selectFrom("email_headers")
      .select("return_path")
      .where("email_id", "=", ids.kept)
      .executeTakeFirstOrThrow();
    expect(header.return_path ?? "").toBe("");
    const sentLeft = await db.selectFrom("sent_emails").select("id").where("org_id", "=", w.ctx.orgId).execute();
    expect(sentLeft).toEqual([]);

    // The address of an own mailbox and of a member is refused in every form, and nothing changes.
    for (const own of [`BOX${SIGMA}@x.gr`, `box${FINAL}@x.gr`, `CHEF${SIGMA}@x.gr`]) {
      const refused = await findSubjectData(db, { orgId: w.ctx.orgId, address: own, credentialsKey: KEY, now: NOW });
      expect(refused.kind).toBe("own_address");
    }
  });

  test("a plus address stays a separate address: the erase of the plain address leaves its mail", async () => {
    const w = await seed(`anna${sigma}@x.gr`);
    await db.transaction().execute((trx) =>
      insertTestEmail(trx, w.ctx, w.mailboxId, {
        status: "pending",
        received_at: ago(1),
        from_address: `anna+news${sigma}@x.gr`,
      })
    );
    const result = await eraseSubjectData(db, {
      orgId: w.ctx.orgId,
      address: `ANNA${SIGMA}@x.gr`,
      confirm: `ANNA${SIGMA}@x.gr`,
      credentialsKey: KEY,
      now: NOW,
    });
    expect(result.kind).toBe("erased");
    expect(await mailCount(w)).toBe(2);
  });
});
