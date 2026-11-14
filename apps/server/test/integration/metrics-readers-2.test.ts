import { weekRange, type WeekQuery } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { listHiddenMoveRows, listMistakeRows, listRejectRows } from "../../src/modules/actions";
import { listLlmCallRows } from "../../src/modules/audit";
import { listDelegationDueRows } from "../../src/modules/delegation";

import { testDb, withRollback } from "./helpers";
import { WEEK, seedWeek } from "./metrics-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const range = weekRange(WEEK, "Europe/Warsaw");
const query = (overrides: Partial<WeekQuery> = {}): WeekQuery => ({
  range,
  mailboxId: null,
  testMail: { senders: [] },
  ...overrides,
});

describe("metric row readers: actions, delegation, audit", () => {
  test("the seeded mailbox has its settings row in assist mode", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const row = await trx
        .selectFrom("mailbox_settings")
        .select("mode")
        .where("org_id", "=", orgA.ctx.orgId)
        .where("mailbox_id", "=", orgA.mailboxId)
        .executeTakeFirstOrThrow();
      expect(row.mode).toBe("assist");
    });
  });

  test("listHiddenMoveRows: the original moves of the week with the latest vip flag and truth", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const rows = await listHiddenMoveRows(trx, orgA.ctx, query());
      expect(rows.map((row) => row.emailId).sort()).toEqual([orgA.ids.e1, orgA.ids.e4, orgA.ids.e5].map(String).sort());
      const byName = (name: string) => rows.find((row) => row.emailId === orgA.ids[name]);
      expect(byName("e1")).toMatchObject({
        folder: "ai_info",
        truth: "urgent",
        vip: false,
        mailboxId: orgA.mailboxId,
      });
      expect(byName("e4")).toMatchObject({ folder: "ai_notifications", truth: null, vip: false });
      expect(byName("e5")).toMatchObject({ folder: "ai_spam", vip: true, mailboxId: orgA.mailboxId });
      expect(byName("e1")?.fromAddress).toMatch(/^sender-.+@x\.test$/);
    });
  });

  test("listHiddenMoveRows: a move back to inbox and a reverse move are not rows", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const original = await trx
        .selectFrom("actions")
        .select(["id", "email_id"])
        .where("org_id", "=", orgA.ctx.orgId)
        .where("email_id", "=", orgA.ids.e4 as string)
        .where("type", "=", "move")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("actions")
        .values({
          org_id: orgA.ctx.orgId,
          email_id: original.email_id,
          type: "move",
          status: "applied",
          payload: JSON.stringify({ folder: "inbox" }),
          idempotency_key: "test:reverse-e4",
          reverses_action_id: original.id,
          applied_at: new Date("2026-11-18T11:30:00Z"),
        })
        .execute();
      await trx
        .insertInto("actions")
        .values({
          org_id: orgA.ctx.orgId,
          email_id: orgA.ids.e2 as string,
          type: "move",
          status: "applied",
          payload: JSON.stringify({ folder: "inbox" }),
          idempotency_key: "test:inbox-e2",
          applied_at: new Date("2026-11-17T10:30:00Z"),
        })
        .execute();
      await trx
        .insertInto("actions")
        .values({
          org_id: orgA.ctx.orgId,
          email_id: orgA.ids.e3 as string,
          type: "move",
          status: "applied",
          payload: JSON.stringify({ folder: "not_a_folder" }),
          idempotency_key: "test:unknown-e3",
          applied_at: new Date("2026-11-18T10:30:00Z"),
        })
        .execute();
      const rows = await listHiddenMoveRows(trx, orgA.ctx, query());
      expect(rows).toHaveLength(3);
    });
  });

  test("listRejectRows: rejected sends of the week with their reason", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const rows = await listRejectRows(trx, orgA.ctx, query());
      expect(rows).toEqual([
        { actionId: orgA.ids.s1 as string, rejectedAt: new Date("2026-11-18T13:00:00Z"), reason: "wrong_person" },
        { actionId: orgA.ids.s2 as string, rejectedAt: new Date("2026-11-19T13:00:00Z"), reason: null },
      ]);
    });
  });

  test("listMistakeRows: the mistake tap with the send time", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      expect(await listMistakeRows(trx, orgA.ctx, query())).toEqual([
        { actionId: orgA.ids.s3 as string, sentAt: new Date("2026-11-20T09:10:00Z") },
      ]);
    });
  });

  test("listDelegationDueRows: due in the week; the done, overdue and answered times", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const rows = await listDelegationDueRows(trx, orgA.ctx, query());
      expect(rows.map((row) => row.id).sort()).toEqual([orgA.ids.d2, orgA.ids.d3].map(String).sort());
      const byId = (id: string | undefined) => rows.find((row) => row.id === id);
      expect(byId(orgA.ids.d2)).toMatchObject({
        answeredAt: new Date("2026-11-18T15:00:00Z"),
        doneAt: null,
        overdueAt: null,
        cancelled: false,
      });
      expect(byId(orgA.ids.d3)).toMatchObject({
        answeredAt: null,
        overdueAt: new Date("2026-11-20T06:30:00Z"),
        cancelled: false,
      });
    });
  });

  test("listLlmCallRows: every call of the week, with model, tokens and time", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const rows = await listLlmCallRows(trx, orgA.ctx, { range, mailboxId: null });
      expect(rows).toHaveLength(10);
      expect(rows[0]).toEqual({
        mailboxId: orgA.mailboxId,
        model: "gpt-6-luna",
        tokensIn: 1036,
        tokensOut: 80,
        at: new Date("2026-11-17T10:00:00Z"),
      });
    });
  });

  test("tenants: organization B sees its own rows only; a foreign mailbox gives none", async () => {
    await withRollback(db, async (trx) => {
      const { orgA, orgB } = await seedWeek(trx);
      const hidden = await listHiddenMoveRows(trx, orgB.ctx, query());
      expect(hidden).toHaveLength(1);
      expect(hidden[0]?.mailboxId).toBe(orgB.mailboxId);
      expect(await listLlmCallRows(trx, orgB.ctx, { range, mailboxId: null })).toHaveLength(1);
      expect(await listRejectRows(trx, orgB.ctx, query())).toEqual([]);
      expect(await listMistakeRows(trx, orgB.ctx, query())).toEqual([]);
      expect(await listDelegationDueRows(trx, orgB.ctx, query())).toEqual([]);

      const foreign = query({ mailboxId: orgA.mailboxId });
      expect(await listHiddenMoveRows(trx, orgB.ctx, foreign)).toEqual([]);
      expect(await listRejectRows(trx, orgB.ctx, foreign)).toEqual([]);
      expect(await listMistakeRows(trx, orgB.ctx, foreign)).toEqual([]);
      expect(await listDelegationDueRows(trx, orgB.ctx, foreign)).toEqual([]);
      expect(await listLlmCallRows(trx, orgB.ctx, { range, mailboxId: orgA.mailboxId })).toEqual([]);
    });
  });

  test("mailboxId of the only mailbox gives the same rows as null", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const all = query();
      const one = query({ mailboxId: orgA.mailboxId });
      expect(await listHiddenMoveRows(trx, orgA.ctx, one)).toEqual(await listHiddenMoveRows(trx, orgA.ctx, all));
      expect(await listRejectRows(trx, orgA.ctx, one)).toEqual(await listRejectRows(trx, orgA.ctx, all));
      expect(await listMistakeRows(trx, orgA.ctx, one)).toEqual(await listMistakeRows(trx, orgA.ctx, all));
      expect(await listDelegationDueRows(trx, orgA.ctx, one)).toEqual(await listDelegationDueRows(trx, orgA.ctx, all));
      expect(await listLlmCallRows(trx, orgA.ctx, { range, mailboxId: orgA.mailboxId })).toEqual(
        await listLlmCallRows(trx, orgA.ctx, { range, mailboxId: null })
      );
    });
  });

  test("a test sender is left out of the hidden-move, reject and mistake readers", async () => {
    await withRollback(db, async (trx) => {
      const { orgA } = await seedWeek(trx);
      const addressOf = async (name: string) =>
        (
          await trx
            .selectFrom("emails")
            .select("from_address")
            .where("id", "=", orgA.ids[name] as string)
            .executeTakeFirstOrThrow()
        ).from_address as string;
      const rule = (names: string[]) => Promise.all(names.map(addressOf));
      const hidden = await listHiddenMoveRows(
        trx,
        orgA.ctx,
        query({ testMail: { senders: (await rule(["e1"])).map((a) => a.toLowerCase()) } })
      );
      expect(hidden.map((row) => row.emailId)).not.toContain(orgA.ids.e1);
      expect(hidden).toHaveLength(2);
      const rejects = await listRejectRows(
        trx,
        orgA.ctx,
        query({ testMail: { senders: (await rule(["e3"])).map((a) => a.toLowerCase()) } })
      );
      expect(rejects.map((row) => row.actionId)).toEqual([orgA.ids.s2 as string]);
      const mistakes = await listMistakeRows(
        trx,
        orgA.ctx,
        query({ testMail: { senders: (await rule(["e7"])).map((a) => a.toLowerCase()) } })
      );
      expect(mistakes).toEqual([]);
    });
  });
});
