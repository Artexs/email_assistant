import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  getEmailFlags,
  refreshFlags,
  type ImapConnectOptions,
  type MailProvider,
  type SeedMessage,
} from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { createMailSyncJob } from "../../src/modules/mail/jobs";
import { insertCredentials } from "../../src/modules/mail/repo";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";

import { createOrgWithMailbox, insertTestEmail, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-03T12:00:00Z");
const MIN = 60_000;
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

interface Box {
  orgId: string;
  mailboxId: string;
  address: string;
}

async function addBox(trx: Transaction<DB>): Promise<Box> {
  const address = `box-${randomUUID()}@x.test`;
  const { orgId, mailboxId } = await createOrgWithMailbox(trx, { address });
  const secret = secrets.encrypt("pw", `mailbox:${mailboxId}`);
  await insertCredentials(
    trx,
    { orgId },
    { mailboxId, encryptedSecret: secret.ciphertext, secretKind: "password", keyVersion: secret.keyVersion }
  );
  return { orgId, mailboxId, address };
}

function seed(n: number): SeedMessage {
  return {
    messageId: `<m${n}@x.test>`,
    from: `sender${n}@x.test`,
    to: ["box@x.test"],
    subject: `Mail ${n}`,
    date: new Date(Date.UTC(2026, 10, 3, 8, 0, n)),
    text: `Body ${n}`,
  };
}

// The job with a clock the test moves; fake providers by address.
function jobWith(trx: Transaction<DB>, fakes: Map<string, MailProvider>, clock: { at: Date }) {
  return createMailSyncJob({
    db: trx,
    secrets,
    openProvider: async (opts: ImapConnectOptions) => {
      const fake = fakes.get(opts.user);
      if (!fake) throw new Error("no fake for this address");
      return fake;
    },
    isOwnActionId: async () => false,
    now: () => clock.at,
  });
}

function deliverTwo(fake: FakeMailProvider): number[] {
  const internalDate = new Date(NOW.getTime() - 3_600_000);
  return [1, 2].map((n) => fake.deliver("INBOX", seed(n), { internalDate }));
}

async function emailIdOf(trx: Transaction<DB>, mailboxId: string, uid: number): Promise<string> {
  const row = await trx
    .selectFrom("emails")
    .select("id")
    .where("mailbox_id", "=", mailboxId)
    .where("uid", "=", String(uid))
    .executeTakeFirstOrThrow();
  return row.id;
}

async function flagRows(trx: Transaction<DB>, orgId: string) {
  return trx.selectFrom("email_flags").selectAll().where("org_id", "=", orgId).orderBy("email_id").execute();
}

describe("flag refresh in the sync job", () => {
  test("1: the first run stores the flags of the synced mail with the first time of each flag", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const fake = createFakeMailProvider({ uidValidity: 7 });
      const [uid1] = deliverTwo(fake);
      await fake.setFlags("INBOX", uid1 as number, { add: ["\\Seen", "\\Answered"] });

      await jobWith(trx, new Map([[box.address, fake]]), { at: NOW }).run();

      expect(await flagRows(trx, box.orgId)).toHaveLength(2);
      const first = await getEmailFlags(trx, { orgId: box.orgId }, await emailIdOf(trx, box.mailboxId, uid1 as number));
      expect(first).toMatchObject({
        seen: true,
        answered: true,
        flagged: false,
        firstSeenAt: NOW,
        firstAnsweredAt: NOW,
        firstFlaggedAt: null,
        checkedAt: NOW,
      });
    });
  });

  test("2: a run 2 min later does not refresh, a run 10 min after the first does", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const fake = createFakeMailProvider({ uidValidity: 7 });
      deliverTwo(fake);
      const clock = { at: NOW };
      const job = jobWith(trx, new Map([[box.address, fake]]), clock);

      await job.run();
      const checked = async () => (await flagRows(trx, box.orgId)).map((row) => row.checked_at);
      expect(await checked()).toEqual([NOW, NOW]);

      clock.at = new Date(NOW.getTime() + 2 * MIN);
      await job.run();
      expect(await checked()).toEqual([NOW, NOW]);

      clock.at = new Date(NOW.getTime() + 10 * MIN);
      await job.run();
      expect(await checked()).toEqual([clock.at, clock.at]);
    });
  });

  test("4: a refresh that fails is one log line and the sync result stays", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      const fake = createFakeMailProvider({ uidValidity: 7 });
      deliverTwo(fake);
      fake.failOn("fetchFlagsIn", new SoftError("lost connection"));
      const warn = spyOn(console, "error").mockImplementation(() => undefined);
      const info = spyOn(console, "log").mockImplementation(() => undefined);
      try {
        await jobWith(trx, new Map([[box.address, fake]]), { at: NOW }).run();
        const lines = warn.mock.calls
          .map((call) => call.join(" "))
          .filter((line) => line.includes("flags_refresh_failed"));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`mailbox_id=${box.mailboxId}`);
        expect(info.mock.calls.some((call) => call.join(" ").includes("flags_refreshed"))).toBe(false);
      } finally {
        warn.mockRestore();
        info.mockRestore();
      }
      const mailbox = await trx
        .selectFrom("mailboxes")
        .select("last_synced_at")
        .where("id", "=", box.mailboxId)
        .executeTakeFirstOrThrow();
      expect(mailbox.last_synced_at).toEqual(NOW);
      const stored = await trx.selectFrom("emails").select("id").where("mailbox_id", "=", box.mailboxId).execute();
      expect(stored).toHaveLength(2);
      expect(await flagRows(trx, box.orgId)).toEqual([]);
    });
  });

  test("5: two mailboxes of two organizations get their own rows", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await addBox(trx);
      const b = await addBox(trx);
      const fakes = new Map<string, MailProvider>();
      for (const box of [a, b]) {
        const fake = createFakeMailProvider({ uidValidity: 7 });
        deliverTwo(fake);
        fakes.set(box.address, fake);
      }

      await jobWith(trx, fakes, { at: NOW }).run();

      for (const [own, other] of [
        [a, b],
        [b, a],
      ] as const) {
        const rows = await flagRows(trx, own.orgId);
        expect(rows).toHaveLength(2);
        const owned = await trx.selectFrom("emails").select("id").where("mailbox_id", "=", own.mailboxId).execute();
        const foreign = await trx.selectFrom("emails").select("id").where("mailbox_id", "=", other.mailboxId).execute();
        expect(rows.every((row) => owned.some((mail) => mail.id === row.email_id))).toBe(true);
        expect(rows.some((row) => foreign.some((mail) => mail.id === row.email_id))).toBe(false);
      }
    });
  });
});

describe("refreshFlags", () => {
  // Stored mail that matches the fake mail with the same uid.
  async function storeLike(trx: Transaction<DB>, box: Box, fake: FakeMailProvider, uid: number, folder = "INBOX") {
    const meta = await fake.fetchMetaIn(folder, uid);
    if (meta === null) throw new Error("no such mail in the fake");
    return insertTestEmail(trx, { orgId: box.orgId }, box.mailboxId, {
      uid,
      folder,
      message_id_header: meta.messageId,
      received_at: meta.internalDate,
    });
  }

  test("3: a mail that the user moved to another folder counts as not found and its row stays", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      const ctx = { orgId: box.orgId };
      const fake = createFakeMailProvider({ uidValidity: 7 });
      const [uid1, uid2] = deliverTwo(fake) as [number, number];
      const m1 = await storeLike(trx, box, fake, uid1);
      await storeLike(trx, box, fake, uid2);
      const deps = { db: trx, provider: fake, now: () => NOW };
      expect(await refreshFlags(deps, ctx, box.mailboxId)).toEqual({
        checked: 2,
        written: 2,
        notFound: 0,
        mismatch: 0,
      });

      await fake.setFlags("INBOX", uid1, { add: ["\\Flagged"] });
      fake.userMove("INBOX", uid1, "Archive");
      const later = { ...deps, now: () => new Date(NOW.getTime() + 11 * MIN) };
      expect(await refreshFlags(later, ctx, box.mailboxId)).toEqual({
        checked: 2,
        written: 1,
        notFound: 1,
        mismatch: 0,
      });
      expect(await getEmailFlags(trx, ctx, m1)).toMatchObject({ flagged: false, checkedAt: NOW });
    });
  });

  test("6: a UID that names another mail (other Message-ID) writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      const ctx = { orgId: box.orgId };
      const fake = createFakeMailProvider({ uidValidity: 7 });
      const [uid1, uid2] = deliverTwo(fake) as [number, number];
      const m1 = await storeLike(trx, box, fake, uid1);
      // The stored row of mail 1 now holds the UID of mail 2 (the server renumbered after a UIDVALIDITY change).
      await trx.updateTable("emails").set({ uid: uid2 }).where("id", "=", m1).execute();

      const result = await refreshFlags({ db: trx, provider: fake, now: () => NOW }, ctx, box.mailboxId);
      expect(result).toEqual({ checked: 1, written: 0, notFound: 0, mismatch: 1 });
      // Nothing of the other mail's flags is written; the row only says "tried, flags unknown" (N1).
      expect(await getEmailFlags(trx, ctx, m1)).toMatchObject({
        seen: false,
        answered: false,
        flagged: false,
        firstSeenAt: null,
        checkedAt: NOW,
      });
    });
  });

  test("a mail without a Message-ID is the stored one when the INTERNALDATE is equal to the second", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      const ctx = { orgId: box.orgId };
      const fake = createFakeMailProvider({ uidValidity: 7 });
      const date = new Date("2026-11-03T08:00:00.400Z");
      const uid = fake.deliver("INBOX", { ...seed(1), messageId: "" }, { internalDate: date });
      const same = await insertTestEmail(trx, ctx, box.mailboxId, {
        uid,
        received_at: new Date("2026-11-03T08:00:00.900Z"),
        message_id_header: null,
      });
      const deps = { db: trx, provider: fake, now: () => NOW };
      expect(await refreshFlags(deps, ctx, box.mailboxId)).toMatchObject({ written: 1, mismatch: 0 });
      expect(await getEmailFlags(trx, ctx, same)).toBeDefined();

      await trx
        .updateTable("emails")
        .set({ received_at: new Date("2026-11-03T08:00:05Z") })
        .where("id", "=", same)
        .execute();
      expect(await refreshFlags(deps, ctx, box.mailboxId)).toMatchObject({ written: 0, mismatch: 1 });
    });
  });

  test("N3: a UID with a Message-ID on one side only is a mismatch, even with an equal INTERNALDATE", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      const ctx = { orgId: box.orgId };
      const fake = createFakeMailProvider({ uidValidity: 7 });
      const date = new Date("2026-11-03T08:00:00Z");
      const withId = fake.deliver("INBOX", seed(1), { internalDate: date });
      const withoutId = fake.deliver("INBOX", { ...seed(2), messageId: "" }, { internalDate: date });
      // The stored mail has no Message-ID but the server mail has one; and the reverse.
      const a = await insertTestEmail(trx, ctx, box.mailboxId, {
        uid: withId,
        received_at: date,
        message_id_header: null,
      });
      const b = await insertTestEmail(trx, ctx, box.mailboxId, {
        uid: withoutId,
        received_at: date,
        message_id_header: "<m2@x.test>",
      });
      const result = await refreshFlags({ db: trx, provider: fake, now: () => NOW }, ctx, box.mailboxId);
      expect(result).toMatchObject({ checked: 2, written: 0, mismatch: 2 });
      // Both are only touched: the rows say "tried, flags unknown".
      expect(await getEmailFlags(trx, ctx, a)).toMatchObject({ seen: false, firstSeenAt: null, checkedAt: NOW });
      expect(await getEmailFlags(trx, ctx, b)).toMatchObject({ seen: false, firstSeenAt: null, checkedAt: NOW });
    });
  });

  test("N1: a gone mail does not hold the head of the queue; live mail is checked in a later run", async () => {
    await withRollback(db, async (trx) => {
      const box = await addBox(trx);
      const ctx = { orgId: box.orgId };
      const fake = createFakeMailProvider({ uidValidity: 7 });
      const [uid1] = deliverTwo(fake) as [number, number];
      const live = await storeLike(trx, box, fake, uid1);
      await fake.setFlags("INBOX", uid1, { add: ["\\Answered"] });
      // The newest mail is gone from the server (uid 999 is not in the fake), so it sorts first among the never-checked mail.
      const gone = await insertTestEmail(trx, ctx, box.mailboxId, {
        uid: 999,
        received_at: new Date(NOW.getTime() - 60_000),
        message_id_header: "<gone@x.test>",
      });
      const at = (run: number) => new Date(NOW.getTime() + run * 11 * MIN);
      const run = (n: number) =>
        refreshFlags({ db: trx, provider: fake, now: () => at(n), runLimit: 1 }, ctx, box.mailboxId);

      expect(await run(0)).toEqual({ checked: 1, written: 0, notFound: 1, mismatch: 0 });
      expect(await getEmailFlags(trx, ctx, live)).toBeUndefined();
      expect(await getEmailFlags(trx, ctx, gone)).toMatchObject({
        answered: false,
        firstAnsweredAt: null,
        checkedAt: at(0),
      });

      // The gone mail was tried, so the live mail is the head now and gets its first check.
      expect(await run(1)).toEqual({ checked: 1, written: 1, notFound: 0, mismatch: 0 });
      expect(await getEmailFlags(trx, ctx, live)).toMatchObject({
        answered: true,
        firstAnsweredAt: at(1),
        checkedAt: at(1),
      });
      expect(await getEmailFlags(trx, ctx, gone)).toMatchObject({ checkedAt: at(0) });

      // Then the queue rotates by the oldest try: the gone mail again, the live mail untouched.
      expect(await run(2)).toMatchObject({ checked: 1, notFound: 1 });
      expect(await getEmailFlags(trx, ctx, live)).toMatchObject({ checkedAt: at(1) });
    });
  });
});
