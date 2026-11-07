import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { handleCallback, type CallbackDeps } from "../../src/modules/channels";
import type { LinkedChat } from "../../src/modules/channels";
import { UNDO_TEXTS } from "../../src/modules/channels/callbacks";
import { listLabeledResults } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertAction, insertTriaged, insertTriagedWithActions } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const T = new Date("2026-11-06T10:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOT_FOUND = "This mail is not in your account.";

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
  const address = `box-${randomUUID()}@x.test`;
  const a = await createOrgWithMailbox(trx, { address });
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
  const deps: CallbackDeps = { db: trx, now: () => T, actionsScope: { kind: "all", mailboxAddress: address } };
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

  describe("undo", () => {
    const applied = (type: "move" | "mark_read", payload?: Record<string, string>) => ({
      type,
      status: "applied",
      payload,
      appliedAt: new Date(T.getTime() - HOUR),
    });

    async function reverseRows(trx: Transaction<DB>, orgId: string) {
      return trx
        .selectFrom("actions")
        .select(["type", "email_id"])
        .where("org_id", "=", orgId)
        .where("reverses_action_id", "is not", null)
        .execute();
    }

    async function undoMail(trx: Transaction<DB>, s: Awaited<ReturnType<typeof setup>>, category: "info" | "unsure") {
      return insertTriagedWithActions(trx, s.ctxA, s.a.mailboxId, {
        category,
        createdAt: T,
        actions: [applied("move", { folder: category === "info" ? "ai_info" : "ai_manual" }), applied("mark_read")],
      });
    }

    test("(1)(2) a tap starts the Undo and writes one feedback row; the second tap says already", async () => {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        const mail = await undoMail(trx, s, "info");

        const first = await handleCallback(s.deps, s.link, `fu:${mail.emailId}`);
        expect(first).toEqual({ answer: UNDO_TEXTS.started });
        expect(await reverseRows(trx, s.a.orgId)).toHaveLength(2);
        expect(await feedbackRows(trx, mail.emailId)).toMatchObject([
          { verdict: "wrong", true_category: null, source: "undo", user_id: s.a.userId },
        ]);

        const second = await handleCallback(s.deps, s.link, `fu:${mail.emailId}`);
        expect(second.answer).toBe(UNDO_TEXTS.already);
        expect(await reverseRows(trx, s.a.orgId)).toHaveLength(2);
        expect(await feedbackRows(trx, mail.emailId)).toHaveLength(1);
      });
    });

    test("(3) an unsure mail starts the Undo and writes no feedback row", async () => {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        const mail = await undoMail(trx, s, "unsure");

        const result = await handleCallback(s.deps, s.link, `fu:${mail.emailId}`);

        expect(result.answer).toBe(UNDO_TEXTS.started);
        expect(await reverseRows(trx, s.a.orgId)).toHaveLength(2);
        expect(await feedbackRows(trx, mail.emailId)).toEqual([]);
      });
    });

    test("(4) a mail with logged rows only: nothing to undo", async () => {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        await insertAction(trx, s.ctxA, s.info, { type: "move", status: "logged" });

        const result = await handleCallback(s.deps, s.link, `fu:${s.info}`);

        expect(result.answer).toBe(UNDO_TEXTS.nothing);
        expect(await reverseRows(trx, s.a.orgId)).toEqual([]);
        expect(await feedbackRows(trx, s.info)).toEqual([]);
      });
    });

    test("(5) applied 8 days ago: too old", async () => {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        await insertAction(trx, s.ctxA, s.info, {
          type: "mark_read",
          status: "applied",
          appliedAt: new Date(T.getTime() - 8 * DAY),
        });

        const result = await handleCallback(s.deps, s.link, `fu:${s.info}`);

        expect(result.answer).toBe(UNDO_TEXTS.too_old);
        expect(await reverseRows(trx, s.a.orgId)).toEqual([]);
        expect(await feedbackRows(trx, s.info)).toEqual([]);
      });
    });

    test("(5b) scope off: held, no reverse row, no feedback row", async () => {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        const mail = await undoMail(trx, s, "info");

        const result = await handleCallback({ ...s.deps, actionsScope: { kind: "off" } }, s.link, `fu:${mail.emailId}`);

        expect(result.answer).toBe(UNDO_TEXTS.held);
        expect(await reverseRows(trx, s.a.orgId)).toEqual([]);
        expect(await feedbackRows(trx, mail.emailId)).toEqual([]);
      });
    });

    test("(5c) a ✏️ label with a true category stays the latest feedback row", async () => {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        const mail = await undoMail(trx, s, "info");
        await handleCallback(s.deps, s.link, `fc:s:${mail.emailId}`);
        await ageFeedback(trx);

        const result = await handleCallback(s.deps, s.link, `fu:${mail.emailId}`);

        expect(result.answer).toBe(UNDO_TEXTS.started);
        expect(await reverseRows(trx, s.a.orgId)).toHaveLength(2);
        expect(await feedbackRows(trx, mail.emailId)).toMatchObject([{ verdict: "wrong", true_category: "spam" }]);
      });
    });

    test("(6) another organization's mail and an unknown id: not found, no rows", async () => {
      await withRollback(db, async (trx) => {
        const s = await setup(trx);
        await insertAction(
          trx,
          {
            orgId: (await trx.selectFrom("emails").select("org_id").where("id", "=", s.other).executeTakeFirstOrThrow())
              .org_id,
          },
          s.other,
          {
            type: "mark_read",
            status: "applied",
            appliedAt: new Date(T.getTime() - HOUR),
          }
        );

        for (const id of [s.other, randomUUID()]) {
          expect((await handleCallback(s.deps, s.link, `fu:${id}`)).answer).toBe(NOT_FOUND);
        }
        expect(await feedbackRows(trx, s.other)).toEqual([]);
        const otherOrgId = (
          await trx.selectFrom("emails").select("org_id").where("id", "=", s.other).executeTakeFirstOrThrow()
        ).org_id;
        expect(await reverseRows(trx, s.a.orgId)).toEqual([]);
        expect(await reverseRows(trx, otherOrgId)).toEqual([]);
      });
    });
  });
});
