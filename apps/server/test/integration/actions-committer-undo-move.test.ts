import { MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { createCommitterJob } from "../../src/modules/actions";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { insertSyncFolders } from "../../src/modules/mail/repo";
import { contentHash } from "../../src/modules/mail/sync-rules";
import type { DB } from "../../src/platform/db";
import { HardError } from "../../src/platform/errors";

import { NOW, RECEIVED, secrets, addBox, openerFor, jobFor, actionState } from "./actions-committer-helpers";
import { insertAction, insertTriagedWithActions, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("the Undo of a move into a sort folder (U11)", () => {
  const OFFERS = "Oferty";
  const JUNK = "Wiadomości-śmieci";
  const LATER = new Date(NOW.getTime() + 30 * MINUTE_MS);

  // A mail whose source folder is `Oferty`, moved into AI/Info, with a `ready` reverse. The mail sits in AI/Info on the fake.
  async function movedFromOffers(trx: Transaction<DB>, enabled: boolean) {
    await pauseOtherMailboxes(trx);
    const box = await addBox(trx);
    box.fake = createFakeMailProvider({
      capabilities: { move: false, uidplus: true },
      keepUidOnCopy: false,
      keepUidOnUserMove: true,
    });
    const ctx = { orgId: box.orgId };
    await insertSyncFolders(
      trx,
      ctx,
      box.mailboxId,
      [
        { key: "offers", path: OFFERS, role: "sort" },
        { key: "junk", path: JUNK, role: "junk" },
      ],
      NOW
    );
    if (!enabled) {
      await trx
        .updateTable("mailbox_folders")
        .set({ enabled: false })
        .where("mailbox_id", "=", box.mailboxId)
        .where("key", "=", "offers")
        .execute();
    }
    const message = {
      messageId: "<u11@x.test>",
      from: "sender@x.test",
      to: [box.address],
      subject: "s",
      date: RECEIVED,
    };
    const offersUid = box.fake.deliver(OFFERS, message, { internalDate: RECEIVED });
    const infoUid = box.fake.userMove(OFFERS, offersUid, "AI/Info");
    const meta = await box.fake.fetchMetaIn("AI/Info", infoUid);
    const mail = await insertTriagedWithActions(trx, ctx, box.mailboxId, {
      category: "info",
      createdAt: RECEIVED,
      receivedAt: RECEIVED,
      from: "sender@x.test",
      messageId: "<u11@x.test>",
      folder: "AI/Info",
      sourceFolder: OFFERS,
      uid: infoUid,
      sourceUid: offersUid,
      contentHash: contentHash(meta as NonNullable<typeof meta>),
      movedAt: RECEIVED,
      actions: [{ type: "move", status: "applied", payload: { folder: "ai_info" }, appliedAt: RECEIVED }],
    });
    const reverseId = await insertAction(trx, ctx, mail.emailId, {
      type: "move",
      status: "ready",
      payload: { folder: "ai_info" },
      reversesActionId: mail.actionIds[0],
      createdAt: new Date(RECEIVED.getTime() + MINUTE_MS),
    });
    return { box, ctx, mail, reverseId, offersUid };
  }

  async function emailState(trx: Transaction<DB>, id: string) {
    return trx.selectFrom("emails").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  }

  for (const enabled of [true, false]) {
    test(`(2) the reverse goes back into Oferty by APPEND (row ${enabled ? "enabled" : "disabled"})`, async () => {
      await withRollback(db, async (trx) => {
        const { box, mail, reverseId } = await movedFromOffers(trx, enabled);
        box.fake.calls.length = 0;

        await jobFor(trx, openerFor([box]), { kind: "all" }).run();

        expect(box.fake.calls).toContain("transferByAppend");
        expect(box.fake.calls).not.toContain("moveMessage");
        const inOffers = await box.fake.searchSinceIn(OFFERS, new Date(RECEIVED.getTime() - DAY_MS));
        expect(inOffers).toHaveLength(1);
        const email = await emailState(trx, mail.emailId);
        expect(email).toMatchObject({ folder: OFFERS, source_folder: OFFERS, moved_at: null, move_pending_at: null });
        expect(Number(email.uid)).toBe(inOffers[0] as number);
        expect(Number(email.source_uid)).toBe(inOffers[0] as number);
        expect(await actionState(trx, reverseId)).toMatchObject({
          status: "applied",
          provider_result: { by_append: true },
        });
        expect((await actionState(trx, mail.actionIds[0] as string)).status).toBe("undone");
      });
    });
  }

  test("(2b) a crash between the APPEND and the EXPUNGE: the next claim deletes the AI/Info copy", async () => {
    await withRollback(db, async (trx) => {
      const { box, mail, reverseId } = await movedFromOffers(trx, true);
      const opener = openerFor([box]);
      box.fake.failOn("deleteMessage", new HardError("x"));
      const scope = { kind: "all" } as const;

      await jobFor(trx, opener, scope).run();

      const since = new Date(RECEIVED.getTime() - DAY_MS);
      expect(await box.fake.searchSinceIn(OFFERS, since)).toHaveLength(1);
      expect(await box.fake.searchSinceIn("AI/Info", since)).toHaveLength(1);
      expect(await actionState(trx, reverseId)).toMatchObject({ status: "ready", locked_at: null });

      await createCommitterJob({
        db: trx,
        secrets,
        openProvider: opener.openProvider,
        scope,
        now: () => LATER,
      }).run();

      const inOffers = await box.fake.searchSinceIn(OFFERS, since);
      expect(inOffers).toHaveLength(1);
      expect(await box.fake.searchSinceIn("AI/Info", since)).toEqual([]);
      expect(box.fake.calls.filter((call) => call === "transferByAppend")).toHaveLength(1);
      expect(await actionState(trx, reverseId)).toMatchObject({ status: "applied" });
      expect(Number((await emailState(trx, mail.emailId)).uid)).toBe(inOffers[0] as number);
    });
  });

  test("(2c) a failing sync folder load releases the batch and makes no IMAP call", async () => {
    await withRollback(db, async (trx) => {
      const { box, reverseId } = await movedFromOffers(trx, true);
      const opener = openerFor([box]);
      const failing = new Proxy(trx, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target) as unknown;
          if (prop === "selectFrom") {
            return (table: string) => {
              if (table === "mailbox_folders") throw new Error("db read failed");
              return (value as (name: string) => unknown).call(target, table);
            };
          }
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      box.fake.calls.length = 0;

      await expect(jobFor(trx, opener, { kind: "all" }, failing).run()).resolves.toBeUndefined();

      expect(await actionState(trx, reverseId)).toMatchObject({ status: "ready", locked_at: null, attempts: 0 });
      expect(opener.calls).toEqual([]);
      expect(box.fake.calls).toEqual([]);
    });
  });

  test("(3) the Undo of a rescue goes back into the junk folder by MOVE, not APPEND", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const box = await addBox(trx);
      box.fake = createFakeMailProvider({ capabilities: { move: true, uidplus: true } });
      const ctx = { orgId: box.orgId };
      await insertSyncFolders(trx, ctx, box.mailboxId, [{ key: "junk", path: JUNK, role: "junk" }], NOW);
      const message = {
        messageId: "<u11-rescue@x.test>",
        from: "sender@x.test",
        to: [box.address],
        subject: "s",
        date: RECEIVED,
      };
      const junkUid = box.fake.deliver(JUNK, message, { internalDate: RECEIVED });
      const uidInInbox = box.fake.userMove(JUNK, junkUid, "INBOX");
      const meta = await box.fake.fetchMetaIn("INBOX", uidInInbox);
      const mail = await insertTriagedWithActions(trx, ctx, box.mailboxId, {
        category: "info",
        createdAt: RECEIVED,
        receivedAt: RECEIVED,
        from: "sender@x.test",
        messageId: "<u11-rescue@x.test>",
        folder: "INBOX",
        sourceFolder: JUNK,
        uid: uidInInbox,
        sourceUid: uidInInbox,
        contentHash: contentHash(meta as NonNullable<typeof meta>),
        movedAt: RECEIVED,
        actions: [{ type: "move", status: "applied", payload: { folder: "inbox" }, appliedAt: RECEIVED }],
      });
      const reverseId = await insertAction(trx, ctx, mail.emailId, {
        type: "move",
        status: "ready",
        payload: { folder: "inbox" },
        reversesActionId: mail.actionIds[0],
        createdAt: new Date(RECEIVED.getTime() + MINUTE_MS),
      });
      box.fake.calls.length = 0;

      await jobFor(trx, openerFor([box]), { kind: "all" }).run();

      expect(box.fake.calls).toContain("moveMessage");
      expect(box.fake.calls).not.toContain("transferByAppend");
      expect(await actionState(trx, reverseId)).toMatchObject({
        status: "applied",
        provider_result: { by_append: false },
      });
      expect((await emailState(trx, mail.emailId)).folder).toBe(JUNK);
    });
  });
});
