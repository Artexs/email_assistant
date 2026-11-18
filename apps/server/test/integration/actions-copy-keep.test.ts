import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { editApproval, noApprovalHooks, reject, type ApprovalDeps } from "../../src/modules/actions";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { delegationHooks } from "../../src/modules/delegation";
import type { DB } from "../../src/platform/db";
import { captureLogs, type CapturedLogs } from "../log-capture";

import {
  actionRow,
  copyOf,
  draftCopies,
  editCopy,
  flagOn,
  NOW,
  reverseOf,
  runSend,
  seedPair,
  type CopyBox,
} from "./copy-hash-fixtures";
import { testDb, withRollback } from "./helpers";

// F115 stage 08, step 3: a reverse row (reject, expiry, a new version, a send) deletes only the copy that the system made.
const db = testDb();
const boxes: CopyBox[] = [];
let logs: CapturedLogs | null = null;

afterEach(async () => {
  logs?.stop();
  logs = null;
  for (const box of boxes) await box.close();
  boxes.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

const approvals = (trx: Transaction<DB>): ApprovalDeps => ({
  db: trx,
  hooks: delegationHooks({ db: trx }),
  approvalHooks: noApprovalHooks,
  uidplus: async () => true,
});

const rejectIt = (trx: Transaction<DB>, box: CopyBox, sendId: string) =>
  reject(approvals(trx), box.ctx, sendId, { userId: box.userId, via: "web", now: NOW });

describe("removeDraft keeps a changed copy", () => {
  test("1. reject an untouched draft (UIDPLUS): the copy is deleted, the reverse row has no kept mark", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "delegation", flag: false });
      expect(await draftCopies(box)).toHaveLength(1);

      expect(await rejectIt(trx, box, p.sendId)).toEqual({ kind: "rejected" });
      await box.committer.run();

      expect(await draftCopies(box)).toHaveLength(0);
      const reverse = await reverseOf(trx, p.draftId);
      expect(reverse?.status).toBe("applied");
      expect(reverse?.provider_result).toEqual({ found: true, uid: expect.any(Number) });
      expect((await actionRow(trx, p.draftId)).status).toBe("undone");
    });
  });

  for (const flag of [false, true]) {
    test(`2. reject after the user edited the copy (flag draft_copy_check ${flag ? "on" : "off"}): the copy stays, the reverse row is applied with kept changed`, async () => {
      await withRollback(db, async (trx) => {
        logs = captureLogs();
        const { box, p } = await seedPair(trx, boxes, { kind: "delegation", flag });
        await editCopy(box, p.draftId, { text: (text) => `${text}\n\nMy own line` });
        const before = await copyOf(box, p.draftId);

        await rejectIt(trx, box, p.sendId);
        await box.committer.run();

        expect(await draftCopies(box)).toHaveLength(1);
        expect((await copyOf(box, p.draftId))?.uid).toBe(before?.uid);
        expect(await reverseOf(trx, p.draftId)).toMatchObject({
          status: "applied",
          provider_result: { found: true, uid: before?.uid, kept: "changed" },
        });
        expect((await actionRow(trx, p.draftId)).status).toBe("undone");
        const kept = logs.lines
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .filter((line) => line.event === "draft_copy_kept");
        expect(kept).toEqual([expect.objectContaining({ action_id: p.draftId, reason: "changed" })]);
      });
    });
  }

  test("3. an F102 edit of a changed copy: the old copy stays, the new version is APPENDed next to it", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "clarification", flag: false });
      // The F102 edit needs the mode `assist` and the switch `create_draft`.
      await insertDefaultSettings(trx, box.ctx, box.mailboxId);
      await updateMailboxSettings(trx, box.ctx, box.mailboxId, {
        mode: "assist",
        toolSwitches: { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false },
      });
      await editCopy(box, p.draftId, { text: (text) => `${text}\n\nMy own line` });
      const old = await copyOf(box, p.draftId);

      const edited = await editApproval(approvals(trx), box.ctx, p.sendId, {
        userId: box.userId,
        via: "web",
        now: NOW,
        subject: "New version",
        body: "A new body from the panel",
      });
      if (edited.kind !== "edited") throw new Error(`the edit gave ${edited.kind}`);
      await box.committer.run();

      const copies = await draftCopies(box);
      expect(copies).toHaveLength(2);
      const newDraftId = (await actionRow(trx, edited.sendId)).depends_on_action_id;
      if (newDraftId === null) throw new Error("the new send has no draft");
      expect(copies.map((copy) => copy.actionId).sort()).toEqual([p.draftId, newDraftId].sort());
      expect((await copyOf(box, p.draftId))?.uid).toBe(old?.uid);
      expect((await reverseOf(trx, p.draftId))?.provider_result).toMatchObject({ kept: "changed" });
      expect((await actionRow(trx, newDraftId)).provider_result).toMatchObject({
        copy_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    });
  });

  for (const kind of ["delegation", "reply"] as const) {
    test(`4. no baseline: the copy of a ${kind} is ${kind === "reply" ? "kept (kept no_baseline)" : "deleted as before"}`, async () => {
      await withRollback(db, async (trx) => {
        const { box, p } = await seedPair(trx, boxes, { kind, flag: false });
        const row = await actionRow(trx, p.draftId);
        const rest = Object.fromEntries(
          Object.entries(row.provider_result as Record<string, unknown>).filter(([key]) => key !== "copy_hash")
        );
        await trx
          .updateTable("actions")
          .set({ provider_result: JSON.stringify(rest) })
          .where("id", "=", p.draftId)
          .execute();

        await rejectIt(trx, box, p.sendId);
        await box.committer.run();

        const reverse = await reverseOf(trx, p.draftId);
        expect(reverse?.status).toBe("applied");
        if (kind === "reply") {
          expect(await draftCopies(box)).toHaveLength(1);
          expect(reverse?.provider_result).toMatchObject({ kept: "no_baseline" });
        } else {
          expect(await draftCopies(box)).toHaveLength(0);
          expect(reverse?.provider_result).not.toHaveProperty("kept");
        }
      });
    });
  }

  test("5. a delegation with an edited copy and the flag off is sent as approved; the changed copy then stays", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "delegation", flag: false });
      await editCopy(box, p.draftId, { text: (text) => `${text}\n\nMy own line` });

      expect((await runSend(trx, box, p.sendId)).status).toBe("applied");
      await box.committer.run();

      expect(box.sender.sent).toHaveLength(1);
      expect(await draftCopies(box)).toHaveLength(1);
      expect((await reverseOf(trx, p.draftId))?.provider_result).toMatchObject({ kept: "changed" });
    });
  });

  test("6. a send of an untouched draft removes the copy as before (the Sent copy is the proof)", async () => {
    await withRollback(db, async (trx) => {
      const { box, p } = await seedPair(trx, boxes, { kind: "reply", flag: false });
      await flagOn(trx, box, "draft_copy_check");

      expect((await runSend(trx, box, p.sendId)).status).toBe("applied");
      await box.committer.run();

      const drafts = await draftCopies(box);
      expect(drafts).toHaveLength(0);
      expect((await reverseOf(trx, p.draftId))?.provider_result).toEqual({ found: true, uid: expect.any(Number) });
    });
  });
});
