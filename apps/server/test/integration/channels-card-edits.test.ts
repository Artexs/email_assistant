import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { queueCardEdits } from "../../src/modules/channels";
import type { DB } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// One `approval_edit` row per sent card of a send.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const at = new Date("2026-11-20T13:05:00Z");

interface World {
  trx: Transaction<DB>;
  orgId: string;
  ctx: { orgId: string };
  u1: string;
  u2: string;
  emailId: string;
  sendId: string;
}

async function world(trx: Transaction<DB>): Promise<World> {
  const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
  const ctx = { orgId };
  const u2 = await addMember(trx, orgId, "owner");
  const { emailId, sendId } = await insertDraftAndSend(trx, ctx, mailboxId, {});
  return { trx, orgId, ctx, u1: userId, u2, emailId, sendId };
}

async function insertCard(
  w: World,
  userId: string,
  extra: {
    kind?: "approval" | "approval_set";
    dedupKey?: string;
    status?: "sent" | "pending" | "sending";
    text?: string | null;
    messageId?: number | null;
    orgId?: string;
    emailId?: string;
  } = {}
): Promise<string> {
  const status = extra.status ?? "sent";
  const row = await w.trx
    .insertInto("outbox")
    .values({
      org_id: extra.orgId ?? w.orgId,
      user_id: userId,
      kind: extra.kind ?? "approval",
      dedup_key: extra.dedupKey ?? `approval:${w.sendId}`,
      email_id: extra.emailId ?? w.emailId,
      text: extra.text === undefined ? `📤 Send? ${userId}` : extra.text,
      status,
      next_attempt_at: at,
      created_at: at,
      sent_at: status === "sent" ? at : null,
      locked_at: status === "sending" ? at : null,
      external_message_id: extra.messageId === undefined ? 1000 : extra.messageId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function edits(w: World) {
  const rows = await w.trx
    .selectFrom("outbox")
    .select(["user_id", "edit_of_outbox_id", "email_id", "dedup_key", "status", "view", "locale"])
    .where("org_id", "=", w.orgId)
    .where("kind", "=", "approval_edit")
    .orderBy("dedup_key")
    .execute();
  return rows;
}

describe("queueCardEdits", () => {
  test("T6: one row per sent card; the tapped user's card is skipped", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const c1 = await insertCard(w, w.u1);
      const c2 = await insertCard(w, w.u2);
      const result = await queueCardEdits(trx, w.ctx, { sendId: w.sendId, outcome: "approved", at });
      expect(result).toEqual({ queued: 2, cancelled: 0 });
      const rows = await edits(w);
      expect(rows.map((row) => row.edit_of_outbox_id).sort()).toEqual([c1, c2].sort());
      const first = rows.find((row) => row.edit_of_outbox_id === c1);
      expect(first?.user_id).toBe(w.u1);
      expect(first?.email_id).toBe(w.emailId);
      expect(first?.status).toBe("pending");
      expect(first?.locale).toBe("en");
      expect(first?.dedup_key).toBe(`approval_edit:${c1}:approved`);
      expect(first?.view).toEqual({
        original: `📤 Send? ${w.u1}`,
        outcome: "approved",
        at: at.toISOString(),
        timeZone: "Europe/Warsaw",
      });
    });
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await insertCard(w, w.u1);
      const c2 = await insertCard(w, w.u2);
      const result = await queueCardEdits(trx, w.ctx, {
        sendId: w.sendId,
        outcome: "approved",
        exceptUserId: w.u1,
        at,
      });
      expect(result.queued).toBe(1);
      expect((await edits(w)).map((row) => [row.user_id, row.edit_of_outbox_id])).toEqual([[w.u2, c2]]);
    });
  });

  test("T7: a pending card fails as answered_elsewhere and gets no edit", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const c1 = await insertCard(w, w.u1);
      const c2 = await insertCard(w, w.u2, { status: "pending", text: null, messageId: null });
      const result = await queueCardEdits(trx, w.ctx, { sendId: w.sendId, outcome: "rejected", at });
      expect(result).toEqual({ queued: 1, cancelled: 1 });
      expect((await edits(w)).map((row) => row.edit_of_outbox_id)).toEqual([c1]);
      const card = await trx
        .selectFrom("outbox")
        .select(["status", "error_code"])
        .where("id", "=", c2)
        .executeTakeFirstOrThrow();
      expect(card).toEqual({ status: "failed", error_code: "answered_elsewhere" });
    });
  });

  test("TG1: the acting user's own pending card also fails as answered_elsewhere", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const c1 = await insertCard(w, w.u1, { status: "pending", text: null, messageId: null });
      const c2 = await insertCard(w, w.u2);
      const result = await queueCardEdits(trx, w.ctx, {
        sendId: w.sendId,
        outcome: "approved",
        exceptUserId: w.u1,
        at,
      });
      expect(result).toEqual({ queued: 1, cancelled: 1 });
      expect((await edits(w)).map((row) => row.edit_of_outbox_id)).toEqual([c2]);
      const card = await trx
        .selectFrom("outbox")
        .select(["status", "error_code"])
        .where("id", "=", c1)
        .executeTakeFirstOrThrow();
      expect(card).toEqual({ status: "failed", error_code: "answered_elsewhere" });
    });
  });

  test("a card in flight, a set card, a card without text or message id and a foreign send get no edit", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const u3 = await addMember(trx, w.orgId, "owner");
      const u4 = await addMember(trx, w.orgId, "owner");
      const sending = await insertCard(w, w.u1, { status: "sending" });
      await insertCard(w, w.u2, { kind: "approval_set", dedupKey: `approval_set:${randomUUID()}` });
      await insertCard(w, u3, { text: null });
      await insertCard(w, u4, { messageId: null });
      const result = await queueCardEdits(trx, w.ctx, { sendId: w.sendId, outcome: "expired", at });
      expect(result).toEqual({ queued: 0, cancelled: 0 });
      expect(await edits(w)).toEqual([]);
      const card = await trx.selectFrom("outbox").select("status").where("id", "=", sending).executeTakeFirstOrThrow();
      expect(card.status).toBe("sending");
      const other = await queueCardEdits(trx, w.ctx, { sendId: randomUUID(), outcome: "expired", at });
      expect(other).toEqual({ queued: 0, cancelled: 0 });
    });
  });

  test("T8: another outcome is another row; the same outcome twice adds none", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await insertCard(w, w.u1);
      await insertCard(w, w.u2);
      const held = { sendId: w.sendId, outcome: "approved_held", heldBy: "scope", at } as const;
      expect((await queueCardEdits(trx, w.ctx, held)).queued).toBe(2);
      expect((await queueCardEdits(trx, w.ctx, { sendId: w.sendId, outcome: "rejected", at })).queued).toBe(2);
      expect((await queueCardEdits(trx, w.ctx, held)).queued).toBe(0);
      expect((await queueCardEdits(trx, w.ctx, { sendId: w.sendId, outcome: "rejected", at })).queued).toBe(0);
      const rows = await edits(w);
      expect(rows).toHaveLength(4);
      // The held view keeps Reject for every owner: it names the send.
      const heldRow = rows.find((row) => (row.view as { outcome: string }).outcome === "approved_held");
      expect(heldRow?.view).toMatchObject({ heldBy: "scope", actionId: w.sendId });
    });
  });

  test("approved_held without heldBy throws, so the decision transaction rolls back", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await insertCard(w, w.u1);
      // TG2: the compiler refuses the call (typecheck fails when the directive is not needed); the runtime check stays.
      // @ts-expect-error approved_held needs heldBy
      const call = queueCardEdits(trx, w.ctx, { sendId: w.sendId, outcome: "approved_held", at });
      await expect(call).rejects.toThrow("bad notice view for approval_edit");
    });
  });

  test("T9: a card of another organization is never read", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const other = await createOrgWithMailbox(trx);
      const otherEmail = (await insertDraftAndSend(trx, { orgId: other.orgId }, other.mailboxId, {})).emailId;
      await insertCard(w, w.u1);
      // The card of O2 has the dedup key of the send of O1, and is pending: neither an edit nor a cancel may reach it.
      const foreignSent = await insertCard(w, other.userId, { orgId: other.orgId, emailId: otherEmail });
      const otherMember = await addMember(trx, other.orgId, "owner");
      const foreignPending = await insertCard(w, otherMember, {
        orgId: other.orgId,
        emailId: otherEmail,
        status: "pending",
        text: null,
        messageId: null,
      });
      const result = await queueCardEdits(trx, w.ctx, { sendId: w.sendId, outcome: "approved", at });
      expect(result.queued).toBe(1);
      expect((await edits(w)).map((row) => row.user_id)).toEqual([w.u1]);
      const foreign = await trx
        .selectFrom("outbox")
        .select(["kind", "status"])
        .where("org_id", "=", other.orgId)
        .execute();
      expect(foreign.map((row) => `${row.kind}:${row.status}`).sort()).toEqual(["approval:pending", "approval:sent"]);
      expect([foreignSent, foreignPending]).toHaveLength(2);
    });
  });
});
