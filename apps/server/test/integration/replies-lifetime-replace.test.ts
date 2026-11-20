import { randomUUID } from "node:crypto";

import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { closeSend, noDelegationHooks, replaceApproval, type CloseSendDeps } from "../../src/modules/actions";
import { cardEditHooks } from "../../src/modules/channels";

import { testDb, withRollback } from "./helpers";
import { insertLoopActionPair, insertLoopRow, insertSentRow } from "./loops-fixtures";
import { NOW, ago, SWITCHES, TO, world, reply, approvalDeps, row, auditRows } from "./replies-lifetime-helpers";

// `replaceApproval` and `closeSend` on a reply send. Every test runs in a transaction that is rolled back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const closeDeps = (): CloseSendDeps => ({
  hooks: noDelegationHooks,
  approvalHooks: cardEditHooks({ sendScope: { kind: "all" } }),
  uidplus: async () => true,
});

describe("step 3: replaceApproval and closeSend", () => {
  test("3a: replaceApproval with a new cc makes version 2 with the cc; the old send is superseded", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, { draftStatus: "applied" });

      const result = await replaceApproval(trx, w.ctx, {
        sendId: p.sendId,
        userId: w.userId,
        via: "web",
        now: NOW,
        deps: approvalDeps(trx),
        payload: { cc: ["c@z.test"] },
      });

      if (result.kind !== "edited") throw new Error(`replace gave ${result.kind}`);
      expect(result.version).toBe(2);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "expired", status_reason: "superseded" });
      expect((await row(trx, p.draftId)).status).not.toBe("ready");
      const draft = await row(trx, result.draftId);
      expect(draft).toMatchObject({ status: "ready", supersedes_action_id: p.draftId });
      expect(draft.payload).toMatchObject({ kind: "reply", version: 2, cc: ["c@z.test"], to: [TO] });
      const send = await row(trx, result.sendId);
      expect(send).toMatchObject({ status: "awaiting_approval", supersedes_action_id: p.sendId });
      expect(send.payload).toMatchObject({ kind: "reply", to: [TO], cc: ["c@z.test"] });
      expect(await auditRows(trx, result.sendId, "action.edited")).toHaveLength(1);
    });
  });

  test("3b: replaceApproval refuses an invalid recipient set: nothing is written", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, { draftStatus: "applied" });

      await expect(
        replaceApproval(trx, w.ctx, {
          sendId: p.sendId,
          userId: w.userId,
          via: "web",
          now: NOW,
          deps: approvalDeps(trx),
          payload: { cc: Array.from({ length: 11 }, (_, i) => `c${i}@z.test`) },
        })
      ).rejects.toThrow("replaced draft payload is invalid");
    });
  });

  test("3c: replaceApproval with the reply switch off answers drafts_off; a closed send names its state", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, { draftStatus: "applied" });
      const input = {
        sendId: p.sendId,
        userId: w.userId,
        via: "web" as const,
        now: NOW,
        deps: approvalDeps(trx),
        payload: { cc: ["c@z.test"] },
      };
      await trx
        .updateTable("mailbox_settings")
        .set({ tool_switches: JSON.stringify({ ...SWITCHES, reply_drafts: false }) })
        .where("mailbox_id", "=", w.mailboxId)
        .execute();
      expect(await replaceApproval(trx, w.ctx, input)).toEqual({ kind: "drafts_off" });
      await trx
        .updateTable("mailbox_settings")
        .set({ tool_switches: JSON.stringify({ ...SWITCHES, reply_drafts: true }) })
        .where("mailbox_id", "=", w.mailboxId)
        .execute();
      await trx.updateTable("actions").set({ status: "rejected" }).where("id", "=", p.sendId).execute();
      expect(await replaceApproval(trx, w.ctx, input)).toEqual({ kind: "closed", state: "rejected" });
    });
  });

  test("3d: closeSend on an applying send answers busy, whatever claimed says", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, {
        sendStatus: "applying",
        approved: { userId: w.userId, at: ago(MINUTE_MS) },
      });
      for (const claimed of [false, true]) {
        const result = await closeSend(trx, w.ctx, {
          sendId: p.sendId,
          reason: "answered",
          notify: false,
          claimed,
          now: NOW,
          deps: closeDeps(),
        });
        expect(result).toEqual({ kind: "busy" });
      }
      expect((await row(trx, p.sendId)).status).toBe("applying");
    });
  });

  test("3e: closeSend on a locked approved row: busy when not claimed, closed when claimed; a stale lock closes", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const locked = await reply(trx, w, HOUR_MS, {
        sendStatus: "approved",
        approved: { userId: w.userId, at: ago(5 * MINUTE_MS) },
        lockedAt: ago(MINUTE_MS),
      });
      const stale = await reply(trx, w, HOUR_MS, {
        sendStatus: "approved",
        approved: { userId: w.userId, at: ago(30 * MINUTE_MS) },
        lockedAt: ago(20 * MINUTE_MS),
        to: "ewa@x.test",
        from: "ewa@x.test",
      });
      const close = (sendId: string, claimed: boolean) =>
        closeSend(trx, w.ctx, { sendId, reason: "draft_changed", notify: false, claimed, now: NOW, deps: closeDeps() });

      expect(await close(locked.sendId, false)).toEqual({ kind: "busy" });
      expect((await row(trx, locked.sendId)).status).toBe("approved");
      expect(await close(locked.sendId, true)).toEqual({ kind: "closed", sendId: locked.sendId });
      expect(await row(trx, locked.sendId)).toMatchObject({
        status: "expired",
        status_reason: "draft_changed",
        locked_at: null,
      });
      expect(await close(stale.sendId, false)).toEqual({ kind: "closed", sendId: stale.sendId });
    });
  });

  test("3f: closeSend of a sent-and-closed row answers not_open with its state and writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, { sendStatus: "rejected" });

      const result = await closeSend(trx, w.ctx, {
        sendId: p.sendId,
        reason: "answered",
        notify: false,
        claimed: false,
        now: NOW,
        deps: closeDeps(),
      });

      expect(result).toEqual({ kind: "not_open", state: "rejected" });
      expect(await auditRows(trx, p.sendId, "action.expired")).toHaveLength(0);
    });
  });

  test("3g: closeSend answered, notify false: expired / answered, draft closed, a card edit per sent card, one audit row, notice mark set", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, { draftStatus: "applied" });
      const cards = [501, 502];
      const owner2 = await trx
        .insertInto("users")
        .values({ email: `o2-${randomUUID()}@x.test`, display_name: "Two", locale: "en" })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx.insertInto("memberships").values({ org_id: w.ctx.orgId, user_id: owner2.id, role: "owner" }).execute();
      const users = [w.userId, owner2.id];
      for (const [index, messageId] of cards.entries()) {
        await trx
          .insertInto("outbox")
          .values({
            org_id: w.ctx.orgId,
            user_id: users[index] as string,
            kind: "approval",
            dedup_key: `approval:${p.sendId}`,
            email_id: p.emailId,
            text: `CARD-${messageId}`,
            buttons: JSON.stringify([]),
            status: "sent",
            next_attempt_at: ago(HOUR_MS),
            created_at: ago(HOUR_MS),
            sent_at: ago(HOUR_MS),
            external_message_id: messageId,
          })
          .execute();
      }

      const result = await closeSend(trx, w.ctx, {
        sendId: p.sendId,
        reason: "answered",
        notify: false,
        claimed: false,
        now: NOW,
        deps: closeDeps(),
      });

      expect(result).toEqual({ kind: "closed", sendId: p.sendId });
      expect(await row(trx, p.sendId)).toMatchObject({
        status: "expired",
        status_reason: "answered",
        result_notified_at: NOW,
      });
      // The draft is `applied` with UIDPLUS: a reverse row removes the copy.
      const reverse = await trx.selectFrom("actions").selectAll().where("reverses_action_id", "=", p.draftId).execute();
      expect(reverse).toHaveLength(1);
      const edits = await trx
        .selectFrom("outbox")
        .select(["user_id", "dedup_key"])
        .where("org_id", "=", w.ctx.orgId)
        .where("kind", "=", "approval_edit")
        .execute();
      expect(edits).toHaveLength(2);
      expect(edits.every((edit) => edit.dedup_key.endsWith(":expired"))).toBe(true);
      const audit = await auditRows(trx, p.sendId, "action.expired");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ reason_code: "answered" });
    });
  });

  test("3h: closeSend with notify true leaves the notice mark null", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const p = await reply(trx, w, HOUR_MS, { draftStatus: "ready" });

      await closeSend(trx, w.ctx, {
        sendId: p.sendId,
        reason: "newer_mail",
        notify: true,
        claimed: false,
        now: NOW,
        deps: closeDeps(),
      });

      expect(await row(trx, p.sendId)).toMatchObject({
        status: "expired",
        status_reason: "newer_mail",
        result_notified_at: null,
      });
      expect((await row(trx, p.draftId)).status).toBe("expired");
    });
  });

  test("3i: closeSend draft_changed on an open follow_up send: expired, its draft closed, the loop row unchanged", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const sent = await insertSentRow(trx, w.ctx, w.mailboxId, { toAddresses: [TO] });
      const loopId = await insertLoopRow(trx, w.ctx, w.mailboxId, { sent_email_id: sent, to_addresses: [TO] });
      const before = await trx.selectFrom("open_loops").selectAll().where("id", "=", loopId).executeTakeFirstOrThrow();
      const pair = await insertLoopActionPair(trx, w.ctx, loopId, {
        draftStatus: "ready",
        sendStatus: "awaiting_approval",
        createdAt: ago(HOUR_MS),
      });

      const result = await closeSend(trx, w.ctx, {
        sendId: pair.sendId,
        reason: "draft_changed",
        notify: false,
        claimed: false,
        now: NOW,
        deps: closeDeps(),
      });

      expect(result).toEqual({ kind: "closed", sendId: pair.sendId });
      expect(await row(trx, pair.sendId)).toMatchObject({ status: "expired", status_reason: "draft_changed" });
      expect((await row(trx, pair.draftId)).status).toBe("expired");
      const after = await trx.selectFrom("open_loops").selectAll().where("id", "=", loopId).executeTakeFirstOrThrow();
      expect(after).toEqual(before);
    });
  });

  test("3j: a send of an unknown id answers not_found", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      expect(
        await closeSend(trx, w.ctx, {
          sendId: randomUUID(),
          reason: "answered",
          notify: false,
          claimed: false,
          now: NOW,
          deps: closeDeps(),
        })
      ).toEqual({ kind: "not_found" });
    });
  });
});
