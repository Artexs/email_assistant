import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { handleCallback, type CallbackDeps } from "../../src/modules/channels";
import type { LinkedChat } from "../../src/modules/channels";
import { listLabeledResults } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTriaged } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const T = new Date("2026-11-06T10:00:00Z");

async function feedbackRows(trx: Transaction<DB>, emailId: string) {
  return trx.selectFrom("triage_feedback").selectAll().where("email_id", "=", emailId).execute();
}

// Rows of one transaction share `now()`: move the rows written so far into the past, so the next row is the newest.
async function ageFeedback(trx: Transaction<DB>): Promise<void> {
  await trx
    .updateTable("triage_feedback")
    .set({ created_at: sql`created_at - interval '1 minute'` })
    .execute();
}

async function setup(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  const ctxA = { orgId: a.orgId };
  const info = await insertTriaged(trx, ctxA, a.mailboxId, {
    category: "info",
    createdAt: T,
    subject: "MARKER-SUBJECT",
  });
  const unsure = await insertTriaged(trx, ctxA, a.mailboxId, { category: "unsure", createdAt: T });
  const other = await insertTriaged(trx, { orgId: b.orgId }, b.mailboxId, { category: "info", createdAt: T });
  const link: LinkedChat = { orgId: a.orgId, userId: a.userId, role: "owner", chatId: 1, linkedAt: T };
  const deps: CallbackDeps = { db: trx, now: () => T };
  return { a, ctxA, info, unsure, other, link, deps };
}

describe("handleCallback", () => {
  test("a right tap writes one row; the same tap again writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { a, info, link, deps } = await setup(trx);

      const first = await handleCallback(deps, link, `fr:i:${info}`);
      expect(first.answer).toBe("✅ Saved: Info is right.");
      expect(await feedbackRows(trx, info)).toMatchObject([
        { verdict: "right", true_category: "info", source: "telegram", user_id: a.userId },
      ]);

      const second = await handleCallback(deps, link, `fr:i:${info}`);
      expect(second.answer).toBe("Already saved.");
      expect(await feedbackRows(trx, info)).toHaveLength(1);
    });
  });

  test("the edit button sends the picker", async () => {
    await withRollback(db, async (trx) => {
      const { info, link, deps } = await setup(trx);

      const result = await handleCallback(deps, link, `fe:${info}`);

      expect(result.answer).toBe("");
      expect(result.edit).toBeUndefined();
      const picker = result.send;
      expect(picker?.text).toContain("MARKER-SUBJECT");
      expect(picker?.text).toContain("AI said: ℹ️ Info");
      expect(picker?.buttons).toHaveLength(3);
      const data = picker?.buttons.flat().map((button) => button.data);
      expect(data).toEqual([
        `fc:u:${info}`,
        `fc:r:${info}`,
        `fc:i:${info}`,
        `fc:n:${info}`,
        `fc:s:${info}`,
        `fx:${info}`,
      ]);
      expect(picker?.buttons.flat()).toHaveLength(6);
      for (const item of data ?? []) {
        expect(Buffer.byteLength(item)).toBeLessThanOrEqual(64);
      }
    });
  });

  test("a pick writes a row; the same pick is skipped; a changed answer wins", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctxA, info, link, deps } = await setup(trx);

      const spam = await handleCallback(deps, link, `fc:s:${info}`);
      expect(spam).toEqual({
        answer: "Saved.",
        edit: { text: "✏️ Saved: Spam (AI said Info).", buttons: [] },
      });
      expect(await feedbackRows(trx, info)).toMatchObject([{ verdict: "wrong", true_category: "spam" }]);

      const again = await handleCallback(deps, link, `fc:s:${info}`);
      expect(again.answer).toBe("Already saved.");
      expect(await feedbackRows(trx, info)).toHaveLength(1);

      await ageFeedback(trx);
      const right = await handleCallback(deps, link, `fc:i:${info}`);
      expect(right.answer).toBe("Saved.");
      expect(await feedbackRows(trx, info)).toHaveLength(2);

      const labeled = await listLabeledResults(trx, ctxA, a.mailboxId, { mail: "real" });
      expect(labeled.filter((row) => row.email_id === info)).toMatchObject([
        { verdict: "right", true_category: "info" },
      ]);
    });
  });

  test("a pick on an unsure mail writes wrong with the picked category", async () => {
    await withRollback(db, async (trx) => {
      const { unsure, link, deps } = await setup(trx);

      await handleCallback(deps, link, `fc:n:${unsure}`);

      expect(await feedbackRows(trx, unsure)).toMatchObject([{ verdict: "wrong", true_category: "notification" }]);
    });
  });

  test("another organization's mail and an unknown id give the same answer and no row", async () => {
    await withRollback(db, async (trx) => {
      const { a, other, link, deps } = await setup(trx);

      for (const id of [other, randomUUID()]) {
        for (const data of [`fr:i:${id}`, `fe:${id}`, `fc:s:${id}`]) {
          expect((await handleCallback(deps, link, data)).answer).toBe("This mail is not in your account.");
        }
      }
      expect(await feedbackRows(trx, other)).toEqual([]);
      const rows = await trx.selectFrom("triage_feedback").select("id").where("org_id", "=", a.orgId).execute();
      expect(rows).toEqual([]);
    });
  });

  test("junk data is not valid", async () => {
    await withRollback(db, async (trx) => {
      const { link, deps } = await setup(trx);

      expect(await handleCallback(deps, link, "junk")).toEqual({ answer: "This button is not valid any more." });
    });
  });

  test("cancel edits the picker and needs no database", async () => {
    await withRollback(db, async (trx) => {
      const { info, link, deps } = await setup(trx);

      const result = await handleCallback(deps, link, `fx:${info}`);

      expect(result).toEqual({ answer: "", edit: { text: "✏️ Cancelled.", buttons: [] } });
      expect(await feedbackRows(trx, info)).toEqual([]);
    });
  });
});
