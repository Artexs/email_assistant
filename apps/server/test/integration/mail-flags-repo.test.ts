import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  getEmailFlags,
  listFlagTargets,
  touchEmailFlags,
  writeEmailFlags,
  type FlagRead,
} from "../../src/modules/mail";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const SINCE = new Date("2026-10-15T00:00:00Z");
const T1 = new Date("2026-11-10T08:00:00Z");
const T2 = new Date("2026-11-10T08:10:00Z");
const T3 = new Date("2026-11-10T08:20:00Z");

interface Org {
  ctx: TenantContext;
  mailboxId: string;
}

async function newOrg(trx: Transaction<DB>): Promise<Org> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  return { ctx: { orgId }, mailboxId };
}

async function mail(trx: Transaction<DB>, org: Org, uid: number, receivedAt: Date, folder = "INBOX") {
  const emailId = await insertTestEmail(trx, org.ctx, org.mailboxId, {
    uid,
    folder,
    received_at: receivedAt,
    message_id_header: `<m${uid}@x.test>`,
  });
  return emailId;
}

function read(emailId: string, uid: number, flags: Partial<Pick<FlagRead, "seen" | "answered" | "flagged">> = {}) {
  return {
    emailId,
    folder: "INBOX",
    uid,
    messageId: `<m${uid}@x.test>`,
    receivedAt: T1,
    seen: false,
    answered: false,
    flagged: false,
    ...flags,
  } satisfies FlagRead;
}

describe("email flags repository", () => {
  test("1: lists the mail of the window with its folder and UID; older mail is left out", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const m1 = await mail(trx, org, 11, new Date("2026-11-01T00:00:00Z"));
      const m2 = await mail(trx, org, 12, new Date("2026-11-02T00:00:00Z"), "Archive");
      const m3 = await mail(trx, org, 13, new Date("2026-11-03T00:00:00Z"));
      await mail(trx, org, 14, new Date("2026-09-01T00:00:00Z"));
      const targets = await listFlagTargets(trx, org.ctx, org.mailboxId, { since: SINCE, limit: 10 });
      expect(targets.map((t) => t.emailId).sort()).toEqual([m1, m2, m3].sort());
      const archived = targets.find((t) => t.emailId === m2);
      expect(archived).toEqual({
        emailId: m2,
        folder: "Archive",
        uid: 12,
        messageId: "<m12@x.test>",
        receivedAt: new Date("2026-11-02T00:00:00Z"),
      });
      expect(await listFlagTargets(trx, org.ctx, org.mailboxId, { since: SINCE, limit: 2 })).toHaveLength(2);
    });
  });

  test("2: mail never checked comes first, then the oldest check", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const m1 = await mail(trx, org, 11, new Date("2026-11-01T00:00:00Z"));
      const m2 = await mail(trx, org, 12, new Date("2026-11-02T00:00:00Z"));
      const m3 = await mail(trx, org, 13, new Date("2026-11-03T00:00:00Z"));
      expect(await writeEmailFlags(trx, org.ctx, [read(m1, 11)], T1)).toBe(1);
      const first = await listFlagTargets(trx, org.ctx, org.mailboxId, { since: SINCE, limit: 10 });
      expect(
        first
          .map((t) => t.emailId)
          .slice(0, 2)
          .sort()
      ).toEqual([m2, m3].sort());
      expect(first[2]?.emailId).toBe(m1);
      await writeEmailFlags(trx, org.ctx, [read(m2, 12), read(m3, 13)], T2);
      const second = await listFlagTargets(trx, org.ctx, org.mailboxId, { since: SINCE, limit: 10 });
      expect(second.map((t) => t.emailId)[0]).toBe(m1);
    });
  });

  test("3: a flag keeps the first time it was seen; the latest read decides the flag", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const m1 = await mail(trx, org, 11, new Date("2026-11-01T00:00:00Z"));
      await writeEmailFlags(trx, org.ctx, [read(m1, 11, { answered: true })], T1);
      await writeEmailFlags(trx, org.ctx, [read(m1, 11, { answered: false })], T2);
      expect(await getEmailFlags(trx, org.ctx, m1)).toMatchObject({
        answered: false,
        firstAnsweredAt: T1,
        checkedAt: T2,
      });
      await writeEmailFlags(trx, org.ctx, [read(m1, 11, { answered: true, seen: true })], T3);
      expect(await getEmailFlags(trx, org.ctx, m1)).toEqual({
        emailId: m1,
        seen: true,
        answered: true,
        flagged: false,
        firstSeenAt: T3,
        firstAnsweredAt: T1,
        firstFlaggedAt: null,
        checkedAt: T3,
        answeredCheck: null,
      });
    });
  });

  test("4: a read of another UID (the mail moved) or folder writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const m1 = await mail(trx, org, 11, new Date("2026-11-01T00:00:00Z"));
      expect(await writeEmailFlags(trx, org.ctx, [read(m1, 99, { seen: true })], T1)).toBe(0);
      expect(await writeEmailFlags(trx, org.ctx, [{ ...read(m1, 11), folder: "Archive" }], T1)).toBe(0);
      expect(await getEmailFlags(trx, org.ctx, m1)).toBeUndefined();
    });
  });

  test("5: another organization's context writes and lists nothing", async () => {
    await withRollback(db, async (trx) => {
      const orgA = await newOrg(trx);
      const orgB = await newOrg(trx);
      const m1 = await mail(trx, orgA, 11, new Date("2026-11-01T00:00:00Z"));
      expect(await writeEmailFlags(trx, orgB.ctx, [read(m1, 11, { seen: true })], T1)).toBe(0);
      expect(await getEmailFlags(trx, orgA.ctx, m1)).toBeUndefined();
      expect(await listFlagTargets(trx, orgB.ctx, orgA.mailboxId, { since: SINCE, limit: 10 })).toEqual([]);
    });
  });

  test("6: a write keeps the answered check", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const m1 = await mail(trx, org, 11, new Date("2026-11-01T00:00:00Z"));
      await writeEmailFlags(trx, org.ctx, [read(m1, 11, { answered: true })], T1);
      await trx
        .updateTable("email_flags")
        .set({ answered_check: "yes", answered_check_at: T1 })
        .where("email_id", "=", m1)
        .execute();
      await writeEmailFlags(trx, org.ctx, [read(m1, 11, { answered: true, flagged: true })], T2);
      expect(await getEmailFlags(trx, org.ctx, m1)).toMatchObject({
        answeredCheck: "yes",
        flagged: true,
        checkedAt: T2,
      });
    });
  });

  test("7: first_seen_at and first_flagged_at never reset or move", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const m1 = await mail(trx, org, 11, new Date("2026-11-01T00:00:00Z"));
      await writeEmailFlags(trx, org.ctx, [read(m1, 11, { seen: true, flagged: true })], T1);
      await writeEmailFlags(trx, org.ctx, [read(m1, 11)], T2);
      expect(await getEmailFlags(trx, org.ctx, m1)).toMatchObject({
        seen: false,
        flagged: false,
        firstSeenAt: T1,
        firstFlaggedAt: T1,
      });
      await writeEmailFlags(trx, org.ctx, [read(m1, 11, { seen: true, flagged: true })], T3);
      expect(await getEmailFlags(trx, org.ctx, m1)).toMatchObject({
        seen: true,
        flagged: true,
        firstSeenAt: T1,
        firstFlaggedAt: T1,
      });
    });
  });

  test("8: another organization's context reads nothing of the row", async () => {
    await withRollback(db, async (trx) => {
      const orgA = await newOrg(trx);
      const orgB = await newOrg(trx);
      const m1 = await mail(trx, orgA, 11, new Date("2026-11-01T00:00:00Z"));
      await writeEmailFlags(trx, orgA.ctx, [read(m1, 11, { seen: true })], T1);
      expect(await getEmailFlags(trx, orgA.ctx, m1)).toBeDefined();
      expect(await getEmailFlags(trx, orgB.ctx, m1)).toBeUndefined();
    });
  });

  test("9: a touch sets checked_at only; a mail without a row gets one with unknown flags; guards hold", async () => {
    await withRollback(db, async (trx) => {
      const orgA = await newOrg(trx);
      const orgB = await newOrg(trx);
      const m1 = await mail(trx, orgA, 11, new Date("2026-11-01T00:00:00Z"));
      const m2 = await mail(trx, orgA, 12, new Date("2026-11-02T00:00:00Z"));
      await writeEmailFlags(trx, orgA.ctx, [read(m1, 11, { seen: true, answered: true, flagged: true })], T1);
      await trx
        .updateTable("email_flags")
        .set({ answered_check: "no", answered_check_at: T1 })
        .where("email_id", "=", m1)
        .execute();
      const targets = [read(m1, 11), read(m2, 12)];
      expect(await touchEmailFlags(trx, orgA.ctx, targets, T2)).toBe(2);
      expect(await getEmailFlags(trx, orgA.ctx, m1)).toEqual({
        emailId: m1,
        seen: true,
        answered: true,
        flagged: true,
        firstSeenAt: T1,
        firstAnsweredAt: T1,
        firstFlaggedAt: T1,
        checkedAt: T2,
        answeredCheck: "no",
      });
      expect(await getEmailFlags(trx, orgA.ctx, m2)).toEqual({
        emailId: m2,
        seen: false,
        answered: false,
        flagged: false,
        firstSeenAt: null,
        firstAnsweredAt: null,
        firstFlaggedAt: null,
        checkedAt: T2,
        answeredCheck: null,
      });
      // Another UID (the mail moved) and another organization touch nothing.
      expect(await touchEmailFlags(trx, orgA.ctx, [read(m1, 99)], T3)).toBe(0);
      expect(await touchEmailFlags(trx, orgB.ctx, [read(m1, 11)], T3)).toBe(0);
      expect(await getEmailFlags(trx, orgA.ctx, m1)).toMatchObject({ checkedAt: T2 });
    });
  });

  test("501 reads go in two statements; a repeated mail writes once", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const reads: FlagRead[] = [];
      for (let uid = 1; uid <= 501; uid++) {
        reads.push(read(await mail(trx, org, uid, new Date("2026-11-01T00:00:00Z")), uid));
      }
      const first = reads[0] as FlagRead;
      expect(await writeEmailFlags(trx, org.ctx, [...reads, { ...first, seen: true }], T1)).toBe(501);
      expect(await getEmailFlags(trx, org.ctx, first.emailId)).toMatchObject({ seen: true });
    });
  });
});
