import { HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { syncMailbox, type MailProvider } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { forceRescan } from "../../src/modules/mail/repo";
import type { DB, Db } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";
import { UID_VALIDITY, type Setup, setup, deps, seed, withDebugLines } from "./mail-sync-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// The sync lines are events with ids, folder keys and counts only.
describe("syncMailbox: log lines", () => {
  const OFFERS = "Oferty";
  const FOLDER_NOW = new Date("2026-11-08T12:00:00Z");
  const MARKER_SUBJECT = "MARKER-SUBJECT canary-3d9f";
  const ago = (hours: number): { internalDate: Date } => ({
    internalDate: new Date(FOLDER_NOW.getTime() - hours * HOUR_MS),
  });
  const folderDeps = (trx: Db | Transaction<DB>, provider: MailProvider) =>
    deps(trx, provider, { now: () => FOLDER_NOW });
  const ids = async (trx: Transaction<DB>, mailboxId: string) =>
    (await trx.selectFrom("emails").select("id").where("mailbox_id", "=", mailboxId).orderBy("uid").execute()).map(
      (row) => row.id
    );

  async function offersRow(trx: Transaction<DB>, s: Setup): Promise<void> {
    await trx
      .insertInto("mailbox_folders")
      .values({
        org_id: s.ctx.orgId,
        mailbox_id: s.mailboxId,
        key: "offers",
        path: OFFERS,
        role: "sort",
        enabled: true,
        uidvalidity: 1,
        last_uid: 0,
      })
      .execute();
  }

  function globalUidFake(keepUidOnUserMove: boolean): FakeMailProvider {
    return createFakeMailProvider({
      uidValidity: UID_VALIDITY,
      globalUids: true,
      keepUidOnUserMove,
      uidNextValue: 1,
      capabilities: { move: false },
    });
  }

  test("each folder writes sync_folder_done with its key, its mode and the nine counts, never a subject", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: globalUidFake(true) };
      await offersRow(trx, s);
      await s.fake.ensureFolder(OFFERS);
      s.fake.deliver("INBOX", seed(1, { subject: MARKER_SUBJECT }), ago(1));
      const lines = await withDebugLines(async () => {
        await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      });

      const mine = `[mail] sync_folder_done org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId}`;
      const zero = "relocated=0 cross_copies=0 move_in_flight=0 skipped_own=0 ignored_below_cursor=0";
      expect(lines.filter((line) => line.includes("sync_folder_done"))).toEqual([
        `${mine} folder_key=inbox sync_mode=incremental fetched=1 stored=1 uid_updated=0 returned=0 ${zero}`,
        `${mine} folder_key=offers sync_mode=incremental fetched=0 stored=0 uid_updated=0 returned=0 ${zero}`,
      ]);
      expect(lines.join("\n")).not.toContain("MARKER");
    });
  });

  test("an update of a UID that changes no row writes sync_uid_update_no_row with the mail id", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: globalUidFake(true) };
      s.fake.deliver("INBOX", seed(1), ago(2));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      const [first] = await ids(trx, s.mailboxId);
      expect(await forceRescan(trx, s.ctx, s.mailboxId)).toBe(true);
      const second = s.fake.deliver("INBOX", seed(2, { subject: MARKER_SUBJECT }), ago(1));
      // The first mail is planned as an update. While the second mail's body is read, the first row leaves INBOX.
      const provider: MailProvider = {
        ...s.fake,
        fetchContent: async (folder, uid) => {
          if (uid === second) {
            await trx
              .updateTable("emails")
              .set({ folder: "Elsewhere" })
              .where("id", "=", first as string)
              .execute();
          }
          return s.fake.fetchContent(folder, uid);
        },
      };

      const lines = await withDebugLines(async () => {
        const result = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
        expect(result.mode).toBe("rescan");
        expect(result.uidUpdated).toBe(0);
        expect(result.stored).toBe(1);
      });

      expect(lines.filter((line) => line.includes("_no_row"))).toEqual([
        `[mail] sync_uid_update_no_row org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} email_id=${first}`,
      ]);
      expect(lines.join("\n")).not.toContain("MARKER");
    });
  });

  test("a return that changes no row writes sync_return_no_row with the mail id", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = s.fake.deliver("INBOX", seed(1));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      const [first] = await ids(trx, s.mailboxId);
      await trx.updateTable("emails").set({ folder: "AI/Info" }).where("mailbox_id", "=", s.mailboxId).execute();
      const archived = s.fake.userMove("INBOX", uid, "AI/Info");
      s.fake.userMove("AI/Info", archived, "INBOX");
      const second = s.fake.deliver("INBOX", seed(2, { subject: MARKER_SUBJECT }));
      // The first mail is planned as returned. While the second mail's body is read, the row is back in its source folder.
      const provider: MailProvider = {
        ...s.fake,
        fetchContent: async (folder, readUid) => {
          if (readUid === second) {
            await trx
              .updateTable("emails")
              .set({ folder: "INBOX" })
              .where("id", "=", first as string)
              .execute();
          }
          return s.fake.fetchContent(folder, readUid);
        },
      };

      const lines = await withDebugLines(async () => {
        const result = await syncMailbox(deps(trx, provider), s.ctx, s.mailboxId);
        expect(result.returned).toBe(0);
        expect(result.stored).toBe(1);
      });

      expect(lines.filter((line) => line.includes("_no_row"))).toEqual([
        `[mail] sync_return_no_row org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} email_id=${first}`,
      ]);
      expect(lines.join("\n")).not.toContain("MARKER");
    });
  });

  test("a move between folders that changes no row writes sync_move_no_row with the mail id", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: globalUidFake(false) };
      await offersRow(trx, s);
      await s.fake.ensureFolder(OFFERS);
      const uid = s.fake.deliver("INBOX", seed(1), ago(2));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      const [first] = await ids(trx, s.mailboxId);
      s.fake.userMove("INBOX", uid, OFFERS);
      const second = s.fake.deliver(OFFERS, seed(2, { subject: MARKER_SUBJECT }), ago(1));
      // The first mail is planned as relocated. While the second mail's body is read, the row leaves INBOX.
      const provider: MailProvider = {
        ...s.fake,
        fetchContent: async (folder, readUid) => {
          if (readUid === second) {
            await trx
              .updateTable("emails")
              .set({ folder: "Elsewhere" })
              .where("id", "=", first as string)
              .execute();
          }
          return s.fake.fetchContent(folder, readUid);
        },
      };

      const lines = await withDebugLines(async () => {
        const result = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
        expect(result.failed).toEqual([]);
        expect(result.folders.find((item) => item.folder === "offers")?.relocated).toBe(0);
      });

      expect(lines.filter((line) => line.includes("_no_row"))).toEqual([
        `[mail] sync_move_no_row org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} email_id=${first}`,
      ]);
      expect(lines.join("\n")).not.toContain("MARKER");
    });
  });
});
