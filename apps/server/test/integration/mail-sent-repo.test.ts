import { createHash } from "node:crypto";

import { DAY_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  deleteSentEmails,
  expireSentTexts,
  getSentSyncState,
  insertSentEmails,
  insertSentSyncState,
  listPendingSentTexts,
  lockSentSyncState,
  markSentPass,
  resetSentCursor,
  updateSentCursor,
  writeSentSwitch,
  writeSentText,
  type NewSentEmail,
} from "../../src/modules/mail";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const AT = new Date("2026-11-20T10:00:00Z");

// `toMatchObject` does not compare the value of a Date: compare the time in ms.
function ms(value: Date | null | undefined): number | undefined {
  return value?.getTime();
}

interface Org {
  ctx: TenantContext;
  mailboxId: string;
}

async function newOrg(trx: Transaction<DB>): Promise<Org> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  return { ctx: { orgId }, mailboxId };
}

function row(org: Org, n: number, extra: Partial<NewSentEmail> = {}): NewSentEmail {
  return {
    mailboxId: org.mailboxId,
    dedupKey: `mid:<s${n}@x.test>:h${n}`,
    path: "Sent",
    uidValidity: 7,
    uid: n,
    messageId: `<s${n}@x.test>`,
    parentMessageId: `<p${n}@x.test>`,
    referencesIds: [`<p${n}@x.test>`, `<q${n}@x.test>`],
    threadKey: `<p${n}@x.test>`,
    fromAddress: "me@corp.test",
    toAddresses: [`to${n}@x.test`],
    ccAddresses: [`cc${n}@x.test`],
    subject: `Subject ${n}`,
    sentAt: new Date(AT.getTime() - n * HOUR_MS),
    internalDate: new Date(AT.getTime() - n * HOUR_MS),
    origin: "user",
    actionId: null,
    content: "pending",
    ...extra,
  };
}

async function rowsOf(trx: Transaction<DB>, org: Org) {
  return trx
    .selectFrom("sent_emails")
    .selectAll()
    .where("org_id", "=", org.ctx.orgId)
    .where("mailbox_id", "=", org.mailboxId)
    .orderBy("uid")
    .execute();
}

async function rowByKey(trx: Transaction<DB>, org: Org, dedupKey: string) {
  return trx
    .selectFrom("sent_emails")
    .selectAll()
    .where("org_id", "=", org.ctx.orgId)
    .where("mailbox_id", "=", org.mailboxId)
    .where("dedup_key", "=", dedupKey)
    .executeTakeFirstOrThrow();
}

describe("sent sync state", () => {
  test("1: a mailbox without a row has no state", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      expect(await getSentSyncState(trx, org.ctx, org.mailboxId)).toBeUndefined();
      expect(await lockSentSyncState(trx, org.ctx, org.mailboxId)).toBeUndefined();
    });
  });

  test("2: insert on sets the time once; insert off leaves no time", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      expect(await insertSentSyncState(trx, org.ctx, org.mailboxId, { enabled: true })).toBe(true);
      const first = await getSentSyncState(trx, org.ctx, org.mailboxId);
      expect(first?.enabled).toBe(true);
      expect(first?.enabledAt).toBeInstanceOf(Date);
      expect(first?.path).toBeNull();
      expect(first?.lastErrorCode).toBeNull();
      expect(await insertSentSyncState(trx, org.ctx, org.mailboxId, { enabled: false })).toBe(false);
      expect(await getSentSyncState(trx, org.ctx, org.mailboxId)).toEqual(first);

      const other = await newOrg(trx);
      expect(await insertSentSyncState(trx, other.ctx, other.mailboxId, { enabled: false })).toBe(true);
      const off = await getSentSyncState(trx, other.ctx, other.mailboxId);
      expect(off).toMatchObject({ mailboxId: other.mailboxId, enabled: false, enabledAt: null });
    });
  });

  test("3: the switch clears the folder, the cursor and the pass fields", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: true, at: new Date(AT.getTime() - DAY_MS) });
      await resetSentCursor(trx, org.ctx, org.mailboxId, { path: "Sent" });
      await updateSentCursor(trx, org.ctx, org.mailboxId, { uidValidity: 7, lastUid: 42 }, { firstPassAt: AT });
      await markSentPass(trx, org.ctx, org.mailboxId, { at: AT, errorCode: "failed" });
      expect(await getSentSyncState(trx, org.ctx, org.mailboxId)).toMatchObject({
        path: "Sent",
        uidValidity: 7,
        lastUid: 42,
        lastErrorCode: "failed",
      });

      await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: true, at: AT });
      expect(await getSentSyncState(trx, org.ctx, org.mailboxId)).toEqual({
        mailboxId: org.mailboxId,
        enabled: true,
        enabledAt: AT,
        path: null,
        uidValidity: null,
        lastUid: null,
        firstPassAt: null,
        lastPassAt: null,
        lastErrorCode: null,
      });

      await markSentPass(trx, org.ctx, org.mailboxId, { at: AT, errorCode: "failed" });
      await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: false });
      expect(await getSentSyncState(trx, org.ctx, org.mailboxId)).toEqual({
        mailboxId: org.mailboxId,
        enabled: false,
        enabledAt: null,
        path: null,
        uidValidity: null,
        lastUid: null,
        firstPassAt: null,
        lastPassAt: null,
        lastErrorCode: null,
      });
    });
  });

  test("4: a new path resets the cursor and the first pass; an off row stays", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: true, at: AT });
      await updateSentCursor(trx, org.ctx, org.mailboxId, { uidValidity: 7, lastUid: 42 }, { firstPassAt: AT });
      expect(await resetSentCursor(trx, org.ctx, org.mailboxId, { path: "Wysłane" })).toBe(true);
      expect(await getSentSyncState(trx, org.ctx, org.mailboxId)).toMatchObject({
        path: "Wysłane",
        uidValidity: null,
        lastUid: null,
        firstPassAt: null,
        enabled: true,
      });

      await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: false });
      expect(await resetSentCursor(trx, org.ctx, org.mailboxId, { path: "Wysłane" })).toBe(false);
      expect((await getSentSyncState(trx, org.ctx, org.mailboxId))?.path).toBeNull();
    });
  });

  test("5: the cursor moves; the first pass time is set once", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: true, at: AT });
      expect(
        await updateSentCursor(trx, org.ctx, org.mailboxId, { uidValidity: 7, lastUid: 42 }, { firstPassAt: AT })
      ).toBe(true);
      const state = await getSentSyncState(trx, org.ctx, org.mailboxId);
      expect(state).toMatchObject({ uidValidity: 7, lastUid: 42 });
      expect(ms(state?.firstPassAt)).toBe(AT.getTime());
      const later = new Date(AT.getTime() + HOUR_MS);
      expect(
        await updateSentCursor(trx, org.ctx, org.mailboxId, { uidValidity: 7, lastUid: 43 }, { firstPassAt: later })
      ).toBe(true);
      const kept = await getSentSyncState(trx, org.ctx, org.mailboxId);
      expect(kept?.lastUid).toBe(43);
      expect(ms(kept?.firstPassAt)).toBe(AT.getTime());
      // No first pass time given: the stored time stays.
      expect(await updateSentCursor(trx, org.ctx, org.mailboxId, { uidValidity: 8, lastUid: 1 })).toBe(true);
      const last = await getSentSyncState(trx, org.ctx, org.mailboxId);
      expect(last).toMatchObject({ uidValidity: 8, lastUid: 1 });
      expect(ms(last?.firstPassAt)).toBe(AT.getTime());

      await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: false });
      expect(await updateSentCursor(trx, org.ctx, org.mailboxId, { uidValidity: 7, lastUid: 5 })).toBe(false);
      expect((await getSentSyncState(trx, org.ctx, org.mailboxId))?.lastUid).toBeNull();
    });
  });

  test("6: a pass sets its time and code; an off row stays", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: true, at: AT });
      expect(await markSentPass(trx, org.ctx, org.mailboxId, { at: AT, errorCode: "no_folder" })).toBe(true);
      const pass = await getSentSyncState(trx, org.ctx, org.mailboxId);
      expect(pass?.lastErrorCode).toBe("no_folder");
      expect(ms(pass?.lastPassAt)).toBe(AT.getTime());
      expect(await markSentPass(trx, org.ctx, org.mailboxId, { at: AT, errorCode: null })).toBe(true);
      expect((await getSentSyncState(trx, org.ctx, org.mailboxId))?.lastErrorCode).toBeNull();

      await writeSentSwitch(trx, org.ctx, org.mailboxId, { enabled: false });
      expect(await markSentPass(trx, org.ctx, org.mailboxId, { at: AT, errorCode: "no_folder" })).toBe(false);
      expect((await getSentSyncState(trx, org.ctx, org.mailboxId))?.lastPassAt).toBeNull();
    });
  });

  test("7: another organization sees and changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      await writeSentSwitch(trx, a.ctx, a.mailboxId, { enabled: true, at: AT });
      await updateSentCursor(trx, a.ctx, a.mailboxId, { uidValidity: 7, lastUid: 42 }, { firstPassAt: AT });
      const before = await getSentSyncState(trx, a.ctx, a.mailboxId);

      expect(await getSentSyncState(trx, b.ctx, a.mailboxId)).toBeUndefined();
      expect(await lockSentSyncState(trx, b.ctx, a.mailboxId)).toBeUndefined();
      expect(await resetSentCursor(trx, b.ctx, a.mailboxId, { path: "X" })).toBe(false);
      expect(await updateSentCursor(trx, b.ctx, a.mailboxId, { uidValidity: 1, lastUid: 1 })).toBe(false);
      expect(await markSentPass(trx, b.ctx, a.mailboxId, { at: AT, errorCode: "failed" })).toBe(false);
      expect(await getSentSyncState(trx, a.ctx, a.mailboxId)).toEqual(before);
    });
  });

  test("7b: the switch and the insert with another organization's mailbox fail with 23503", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      await expect(writeSentSwitch(trx, b.ctx, a.mailboxId, { enabled: true })).rejects.toMatchObject({
        code: "23503",
      });
    });
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      await expect(insertSentSyncState(trx, b.ctx, a.mailboxId, { enabled: true })).rejects.toMatchObject({
        code: "23503",
      });
    });
  });
});

describe("sent mail rows", () => {
  test("1: inserts new rows with every column as given", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const input = [
        row(org, 1),
        row(org, 2, { origin: "system", actionId: crypto.randomUUID(), content: "headers_only" }),
      ];
      // The action id is not a foreign key: a free uuid is fine.
      expect(await insertSentEmails(trx, org.ctx, input)).toBe(2);
      const stored = await rowsOf(trx, org);
      expect(stored).toHaveLength(2);
      for (const [i, expected] of input.entries()) {
        const got = stored[i];
        expect(ms(got?.sent_at)).toBe(expected.sentAt.getTime());
        expect(ms(got?.internal_date)).toBe(expected.internalDate.getTime());
        expect(got).toMatchObject({
          org_id: org.ctx.orgId,
          mailbox_id: expected.mailboxId,
          dedup_key: expected.dedupKey,
          path: expected.path,
          uidvalidity: String(expected.uidValidity),
          uid: String(expected.uid),
          message_id: expected.messageId,
          parent_message_id: expected.parentMessageId,
          references_ids: expected.referencesIds,
          thread_key: expected.threadKey,
          from_address: expected.fromAddress,
          to_addresses: expected.toAddresses,
          cc_addresses: expected.ccAddresses,
          subject: expected.subject,
          origin: expected.origin,
          action_id: expected.actionId,
          content: expected.content,
          body_text: null,
        });
      }
    });
  });

  test("2: a known key moves only the location and counts as no new row", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await insertSentEmails(trx, org.ctx, [row(org, 1), row(org, 2)]);
      const before = await rowByKey(trx, org, row(org, 1).dedupKey);
      const moved = [
        row(org, 1, { path: "Wysłane", uid: 11, uidValidity: 8, subject: "Changed", toAddresses: ["z@x.test"] }),
        row(org, 2, { path: "Wysłane", uid: 12, uidValidity: 8 }),
      ];
      expect(await insertSentEmails(trx, org.ctx, moved)).toBe(0);
      const after = await rowByKey(trx, org, row(org, 1).dedupKey);
      expect(after).toMatchObject({ id: before.id, path: "Wysłane", uid: "11", uidvalidity: "8" });
      expect(after).toMatchObject({
        subject: before.subject,
        to_addresses: before.to_addresses,
        content: before.content,
      });
      expect(ms(after.internal_date)).toBe(ms(before.internal_date));
      expect(ms(after.created_at)).toBe(ms(before.created_at));
      expect(await rowsOf(trx, org)).toHaveLength(2);
      // A new key next to a known key counts once.
      expect(await insertSentEmails(trx, org.ctx, [row(org, 1), row(org, 3)])).toBe(1);
    });
  });

  test("3: an empty list runs no query", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      expect(await insertSentEmails(trx, org.ctx, [])).toBe(0);
      expect(await rowsOf(trx, org)).toHaveLength(0);
    });
  });

  test("4: lists pending rows of the path and numbering, inside the window, oldest first", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const day = (n: number) => new Date(AT.getTime() - n * DAY_MS);
      await insertSentEmails(trx, org.ctx, [
        row(org, 1, { internalDate: day(1) }),
        row(org, 2, { internalDate: day(3) }),
        row(org, 3, { internalDate: day(20) }),
        row(org, 4, { internalDate: day(2), uidValidity: 8 }),
        row(org, 5, { internalDate: day(2), path: "Old" }),
        row(org, 6, { internalDate: day(1), origin: "user", content: "headers_only" }),
      ]);
      const key = { path: "Sent", uidValidity: 7, since: day(14) };
      const two = await listPendingSentTexts(trx, org.ctx, org.mailboxId, { ...key, limit: 2 });
      expect(two.map((r) => r.uid)).toEqual([2, 1]);
      expect(typeof two[0]?.id).toBe("string");
      const one = await listPendingSentTexts(trx, org.ctx, org.mailboxId, { ...key, limit: 1 });
      expect(one.map((r) => r.uid)).toEqual([2]);
      // The id breaks a tie in the date.
      await insertSentEmails(
        trx,
        org.ctx,
        [10, 11, 12, 13, 14, 15].map((n) => row(org, n, { internalDate: day(5) }))
      );
      const tie = await listPendingSentTexts(trx, org.ctx, org.mailboxId, { ...key, limit: 20 });
      const tied = tie.filter((r) => r.uid >= 10).map((r) => r.id);
      expect(tied).toHaveLength(6);
      expect([...tied].sort()).toEqual(tied);
    });
  });

  test("5: a stored text is written once", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await insertSentEmails(trx, org.ctx, [row(org, 1)]);
      const [pending] = await listPendingSentTexts(trx, org.ctx, org.mailboxId, {
        path: "Sent",
        uidValidity: 7,
        since: new Date(0),
        limit: 5,
      });
      const read = { path: "Sent", uid: 1, uidValidity: 7 };
      const write = {
        kind: "stored",
        bodyText: "Hi",
        autoSubmitted: "no",
        precedence: "bulk",
        listId: "<l.x.test>",
        hasCalendar: true,
      } as const;
      expect(await writeSentText(trx, org.ctx, pending?.id ?? "", read, write)).toBe(true);
      expect(await rowByKey(trx, org, row(org, 1).dedupKey)).toMatchObject({
        content: "stored",
        body_text: "Hi",
        auto_submitted: "no",
        precedence: "bulk",
        list_id: "<l.x.test>",
        has_calendar: true,
      });
      expect(await writeSentText(trx, org.ctx, pending?.id ?? "", read, { ...write, bodyText: "Other" })).toBe(false);
      expect((await rowByKey(trx, org, row(org, 1).dedupKey)).body_text).toBe("Hi");
    });
  });

  test("6: a write for another place stays out; gone clears the text", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await insertSentEmails(trx, org.ctx, [row(org, 1)]);
      const stored = await rowByKey(trx, org, row(org, 1).dedupKey);
      const write = {
        kind: "stored",
        bodyText: "Hi",
        autoSubmitted: null,
        precedence: null,
        listId: null,
        hasCalendar: null,
      } as const;
      for (const read of [
        { path: "Sent", uid: 2, uidValidity: 7 },
        { path: "Other", uid: 1, uidValidity: 7 },
        { path: "Sent", uid: 1, uidValidity: 8 },
      ]) {
        expect(await writeSentText(trx, org.ctx, stored.id, read, write)).toBe(false);
        expect(await writeSentText(trx, org.ctx, stored.id, read, { kind: "gone" })).toBe(false);
      }
      expect((await rowByKey(trx, org, row(org, 1).dedupKey)).content).toBe("pending");

      expect(
        await writeSentText(trx, org.ctx, stored.id, { path: "Sent", uid: 1, uidValidity: 7 }, { kind: "gone" })
      ).toBe(true);
      expect(await rowByKey(trx, org, row(org, 1).dedupKey)).toMatchObject({ content: "gone", body_text: null });
    });
  });

  test("7: expire turns old pending rows into headers only", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const day = (n: number) => new Date(AT.getTime() - n * DAY_MS);
      await insertSentEmails(trx, org.ctx, [
        row(org, 1, { internalDate: day(1) }),
        row(org, 2, { internalDate: day(20) }),
        row(org, 3, { internalDate: day(20), content: "headers_only" }),
      ]);
      const done = await rowByKey(trx, org, row(org, 3).dedupKey);
      expect(
        await writeSentText(trx, org.ctx, done.id, { path: "Sent", uid: 3, uidValidity: 7 }, { kind: "gone" })
      ).toBe(false);
      // A stored row of the same age stays as it is.
      await insertSentEmails(trx, org.ctx, [row(org, 4, { internalDate: day(20) })]);
      const four = await rowByKey(trx, org, row(org, 4).dedupKey);
      await writeSentText(
        trx,
        org.ctx,
        four.id,
        { path: "Sent", uid: 4, uidValidity: 7 },
        { kind: "stored", bodyText: "Hi", autoSubmitted: null, precedence: null, listId: null, hasCalendar: null }
      );

      expect(await expireSentTexts(trx, org.ctx, org.mailboxId, { before: day(14) })).toBe(1);
      expect((await rowByKey(trx, org, row(org, 2).dedupKey)).content).toBe("headers_only");
      expect((await rowByKey(trx, org, row(org, 1).dedupKey)).content).toBe("pending");
      expect(await rowByKey(trx, org, row(org, 4).dedupKey)).toMatchObject({ content: "stored", body_text: "Hi" });
      expect(await expireSentTexts(trx, org.ctx, org.mailboxId, { before: day(14) })).toBe(0);
    });
  });

  test("8: delete removes the rows of one mailbox", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      await insertSentEmails(trx, a.ctx, [row(a, 1), row(a, 2)]);
      await insertSentEmails(trx, b.ctx, [row(b, 1)]);
      expect(await deleteSentEmails(trx, a.ctx, a.mailboxId)).toBe(2);
      expect(await rowsOf(trx, a)).toHaveLength(0);
      expect(await rowsOf(trx, b)).toHaveLength(1);
      expect(await deleteSentEmails(trx, a.ctx, a.mailboxId)).toBe(0);
    });
  });

  test("9: another organization finds and changes nothing; its insert fails with 23503", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      await insertSentEmails(trx, a.ctx, [row(a, 1, { internalDate: new Date(AT.getTime() - DAY_MS) })]);
      const mine = await rowByKey(trx, a, row(a, 1).dedupKey);
      const key = { path: "Sent", uidValidity: 7, since: new Date(0), limit: 5 };
      expect(await listPendingSentTexts(trx, b.ctx, a.mailboxId, key)).toEqual([]);
      expect(
        await writeSentText(
          trx,
          b.ctx,
          mine.id,
          { path: "Sent", uid: 1, uidValidity: 7 },
          { kind: "stored", bodyText: "Hi", autoSubmitted: null, precedence: null, listId: null, hasCalendar: null }
        )
      ).toBe(false);
      expect(await expireSentTexts(trx, b.ctx, a.mailboxId, { before: AT })).toBe(0);
      expect(await deleteSentEmails(trx, b.ctx, a.mailboxId)).toBe(0);
      expect(await rowByKey(trx, a, row(a, 1).dedupKey)).toMatchObject({ content: "pending", body_text: null });
    });
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      await expect(insertSentEmails(trx, b.ctx, [row(a, 1)])).rejects.toMatchObject({ code: "23503" });
    });
  });

  test("10: a key with a tombstone inserts nothing, the other keys of the call insert", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const erased = row(org, 1);
      const hash = createHash("sha256").update(erased.dedupKey).digest("hex");
      await sql`insert into dsr_tombstones (org_id, key_hash) values (${org.ctx.orgId}::uuid, ${hash})`.execute(trx);
      expect(await insertSentEmails(trx, org.ctx, [erased, row(org, 2)])).toBe(1);
      expect((await rowsOf(trx, org)).map((r) => r.uid)).toEqual(["2"]);
    });
  });
});
