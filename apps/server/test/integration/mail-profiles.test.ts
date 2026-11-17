import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { mailboxProfileOf, upsertMailboxProfile } from "../../src/modules/mail";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertMailboxProfile } from "./reply-fixtures";

// F115 stage 03b, step 1: `mailboxProfileOf` and `upsertMailboxProfile` (module `mail`).
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("mailboxProfileOf", () => {
  test("no row gives null; a row gives the three texts, the time and the writer", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const ctx = { orgId: org.orgId };
      expect(await mailboxProfileOf(trx, ctx, org.mailboxId)).toBeNull();

      await insertMailboxProfile(trx, ctx, org.mailboxId, {
        display_name: "Anna Nowak",
        signature: "Pozdrawiam, Anna",
        writing_style: "Short and warm",
        updated_by: org.userId,
      });
      expect(await mailboxProfileOf(trx, ctx, org.mailboxId)).toMatchObject({
        mailboxId: org.mailboxId,
        displayName: "Anna Nowak",
        signature: "Pozdrawiam, Anna",
        writingStyle: "Short and warm",
        updatedBy: org.userId,
      });
    });
  });

  test("a mailbox of another organization reads as no profile", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await insertMailboxProfile(trx, { orgId: b.orgId }, b.mailboxId, { display_name: "Secret Name" });
      expect(await mailboxProfileOf(trx, { orgId: a.orgId }, b.mailboxId)).toBeNull();
      expect(await mailboxProfileOf(trx, { orgId: b.orgId }, b.mailboxId)).toMatchObject({
        displayName: "Secret Name",
      });
    });
  });
});

describe("upsertMailboxProfile", () => {
  test("inserts a row; a later call changes only the fields it passes; null clears a field", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const ctx = { orgId: org.orgId };

      const first = await upsertMailboxProfile(trx, ctx, org.mailboxId, { displayName: "Anna" }, org.userId);
      expect(first).toMatchObject({ displayName: "Anna", signature: null, writingStyle: null, updatedBy: org.userId });

      const second = await upsertMailboxProfile(
        trx,
        ctx,
        org.mailboxId,
        { signature: "Sig", writingStyle: "Style" },
        null
      );
      expect(second).toMatchObject({ displayName: "Anna", signature: "Sig", writingStyle: "Style", updatedBy: null });

      const third = await upsertMailboxProfile(trx, ctx, org.mailboxId, { displayName: null }, org.userId);
      expect(third).toMatchObject({
        displayName: null,
        signature: "Sig",
        writingStyle: "Style",
        updatedBy: org.userId,
      });
      const rows = await trx
        .selectFrom("mailbox_profiles")
        .select("mailbox_id")
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      expect(rows).toHaveLength(1);
    });
  });

  test("a change moves updated_at; a call with no field still counts as a write by its user", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const ctx = { orgId: org.orgId };
      await upsertMailboxProfile(trx, ctx, org.mailboxId, { signature: "Sig" }, null);
      // In one transaction `now()` is fixed: set the stored time back to see the move.
      await sql`update mailbox_profiles set updated_at = '2026-01-01T00:00:00Z' where mailbox_id = ${org.mailboxId}`.execute(
        trx
      );

      const next = await upsertMailboxProfile(trx, ctx, org.mailboxId, {}, org.userId);
      expect(next.updatedAt.getTime()).toBeGreaterThan(new Date("2026-01-01T00:00:00Z").getTime());
      expect(next).toMatchObject({ signature: "Sig", updatedBy: org.userId });
    });
  });

  test("a mailbox of another organization is refused and nothing is written", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await sql`savepoint f115_profile`.execute(trx);
      let state: string | undefined;
      try {
        await upsertMailboxProfile(trx, { orgId: a.orgId }, b.mailboxId, { displayName: "Intruder" }, a.userId);
      } catch (error) {
        state = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "other";
      }
      expect(state).toBe("23503");
      await sql`rollback to savepoint f115_profile`.execute(trx);
      expect(await mailboxProfileOf(trx, { orgId: b.orgId }, b.mailboxId)).toBeNull();
    });
  });

  test("a text over the column limit is refused by the table", async () => {
    await withRollback(db, async (trx) => {
      const org = await createOrgWithMailbox(trx);
      await sql`savepoint f115_profile_len`.execute(trx);
      let state: string | undefined;
      try {
        await upsertMailboxProfile(trx, { orgId: org.orgId }, org.mailboxId, { signature: "x".repeat(1001) }, null);
      } catch (error) {
        state = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "other";
      }
      expect(state).toBe("23514");
      await sql`rollback to savepoint f115_profile_len`.execute(trx);
    });
  });
});
