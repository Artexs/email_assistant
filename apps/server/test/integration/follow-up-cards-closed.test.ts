// The card edit of a closed loop, the 48 hour expiry, a follow-up that no owner can see and the approval set. Every test runs in a transaction that is rolled back.
// The shared world of these tests is in `follow-up-cards-helpers.ts`.
import { format } from "node:util";

import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { createExpiryJob, noDelegationHooks } from "../../src/modules/actions";
import { listClosedFollowUpCards } from "../../src/modules/channels/card-edits-repo";

import { T, at, world, run, outbox, users } from "./follow-up-cards-helpers";
import { consentRow, insertFollowUp, OLD_CONSENT } from "./follow-up-fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
afterAll(async () => {
  await db.destroy();
});

// The notice code logs and warns about rows it skips; these tests read the output.
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
let warnSpy: ReturnType<typeof spyOn>;
let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    warnings.push(format(...args));
  });
  warnSpy = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(format(...args));
  });
});
afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("the card of a follow-up whose loop closed loses its buttons", () => {
  test("a sent card gets one expired edit; a pending card is cancelled; a rerun adds nothing", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      const cards = await outbox(trx, w.orgId, "approval");
      expect(cards).toHaveLength(2);
      // The first card went out; the second is still pending.
      const [sentCard, pendingCard] = cards;
      await trx
        .updateTable("outbox")
        .set({ status: "sent", text: sentCard?.text ?? "", external_message_id: 4242, sent_at: at(MINUTE_MS) })
        .where("id", "=", sentCard?.id ?? "")
        .execute();
      // The loop closes: the committer, the switch-off and the close rules end the send directly.
      await trx
        .updateTable("actions")
        .set({ status: "expired", status_reason: "loop_closed", updated_at: at(5 * MINUTE_MS) })
        .where("id", "=", f.sendId)
        .execute();
      await run(trx);
      const edits = await outbox(trx, w.orgId, "approval_edit");
      expect(edits).toHaveLength(1);
      expect(edits[0]).toMatchObject({ user_id: sentCard?.user_id, loop_id: f.loopId, email_id: null });
      expect(edits[0]?.dedup_key).toBe(`approval_edit:${sentCard?.id}:expired`);
      expect(edits[0]?.text).toContain("⌛ Expired");
      expect(edits[0]?.text?.startsWith("📝 Follow-up")).toBe(true);
      const pending = await trx
        .selectFrom("outbox")
        .select(["status", "error_code"])
        .where("id", "=", pendingCard?.id ?? "")
        .executeTakeFirstOrThrow();
      expect(pending).toEqual({ status: "failed", error_code: "answered_elsewhere" });
      await run(trx);
      expect(await outbox(trx, w.orgId, "approval_edit")).toHaveLength(1);
    });
  });

  test("a tap on one card edits the other owner's card in place, with the loop id and no mail id", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      await trx
        .updateTable("outbox")
        .set((eb) => ({ status: "sent", text: eb.ref("dedup_key"), external_message_id: 77, sent_at: at(MINUTE_MS) }))
        .where("org_id", "=", w.orgId)
        .where("kind", "=", "approval")
        .execute();
      const { approve, noDelegationHooks: none } = await import("../../src/modules/actions");
      const { cardEditHooks } = await import("../../src/modules/channels");
      const deps = {
        db: trx,
        hooks: none,
        approvalHooks: cardEditHooks({ sendScope: { kind: "all" } }),
        uidplus: async () => true,
      };
      expect(
        (await approve(deps, w.ctx, f.sendId, { userId: w.owner, via: "telegram", now: at(2 * MINUTE_MS) })).kind
      ).toBe("approved");
      // The tapped card is edited by the tap answer; the other owner's card gets an `approval_edit` row of the loop.
      const edits = await outbox(trx, w.orgId, "approval_edit");
      expect(edits).toHaveLength(1);
      expect(edits[0]).toMatchObject({ user_id: w.owner2, loop_id: f.loopId, email_id: null });
      expect(edits[0]?.text).toContain("Approved");
    });
  });

  test("a closed loop whose cards were never sent: the pending cards are cancelled, no edit is queued", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      expect(await outbox(trx, w.orgId, "approval")).toHaveLength(2);
      await trx
        .updateTable("actions")
        .set({ status: "expired", status_reason: "loop_closed" })
        .where("id", "=", f.sendId)
        .execute();
      await run(trx);
      const cards = await outbox(trx, w.orgId, "approval");
      expect(cards.every((card) => card.status === "failed")).toBe(true);
      expect(await outbox(trx, w.orgId, "approval_edit")).toEqual([]);
    });
  });

  test("a send that expired for another reason gets no edit from this detector (the hourly job edits no card)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      await trx
        .updateTable("outbox")
        .set((eb) => ({ status: "sent", text: eb.ref("dedup_key"), external_message_id: 1, sent_at: at(MINUTE_MS) }))
        .where("kind", "=", "approval")
        .execute();
      await trx
        .updateTable("actions")
        .set({ status: "expired", status_reason: "timeout" })
        .where("id", "=", f.sendId)
        .execute();
      await run(trx);
      expect(await outbox(trx, w.orgId, "approval_edit")).toEqual([]);
    });
  });
});

describe("the cards that a closed loop still lists (the limit must not clog)", () => {
  test("a sent card whose text was removed or that has no message id is not listed; a normal sent card and a pending card are", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const mk = async (minutesAgo: number) => {
        const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
        await trx
          .updateTable("actions")
          .set({ status: "expired", status_reason: "loop_closed", updated_at: at(-minutesAgo * MINUTE_MS) })
          .where("id", "=", f.sendId)
          .execute();
        return f;
      };
      const card = async (sendId: string, loopId: string, patch: Record<string, unknown>) =>
        trx
          .insertInto("outbox")
          .values({
            org_id: w.orgId,
            user_id: w.owner,
            kind: "approval",
            dedup_key: `approval:${sendId}`,
            loop_id: loopId,
            text: "CARD",
            status: "sent",
            external_message_id: 5,
            sent_at: at(0),
            next_attempt_at: at(0),
            created_at: at(0),
            ...patch,
          })
          .execute();
      // The useless ones are the oldest: with a limit of one they would hide the good card if they were listed.
      const removed = await mk(50);
      await card(removed.sendId, removed.loopId, { text: "[removed]" });
      const noId = await mk(30);
      await card(noId.sendId, noId.loopId, { external_message_id: null });
      const good = await mk(20);
      await card(good.sendId, good.loopId, {});
      const pending = await mk(10);
      await card(pending.sendId, pending.loopId, {
        status: "pending",
        text: null,
        external_message_id: null,
        sent_at: null,
      });
      expect((await listClosedFollowUpCards(trx, w.ctx, { limit: 10 })).map((row) => row.sendId)).toEqual([
        good.sendId,
        pending.sendId,
      ]);
      expect((await listClosedFollowUpCards(trx, w.ctx, { limit: 1 })).map((row) => row.sendId)).toEqual([good.sendId]);
    });
  });
});

describe("T7 the 48 hour expiry of a follow-up", () => {
  test("a follow-up not tapped for 48 h expires and the loop stays open; a fresh one stays", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const old = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        notifiedAt: new Date(T.getTime() - 49 * HOUR_MS),
      });
      const fresh = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        notifiedAt: new Date(T.getTime() - 47 * HOUR_MS),
      });
      // The card of the old one went out: the request counts as seen, so the reason is `timeout`.
      await trx
        .insertInto("outbox")
        .values({
          org_id: w.orgId,
          user_id: w.owner,
          kind: "approval",
          dedup_key: `approval:${old.sendId}`,
          loop_id: old.loopId,
          view: JSON.stringify({}),
          text: "CARD",
          status: "sent",
          next_attempt_at: T,
          created_at: T,
          sent_at: T,
          external_message_id: 5,
        })
        .execute();
      await createExpiryJob({ db: trx, now: () => T, hooks: noDelegationHooks, uidplus: async () => true }).run();
      const state = async (id: string) =>
        trx.selectFrom("actions").select(["status", "status_reason"]).where("id", "=", id).executeTakeFirstOrThrow();
      expect(await state(old.sendId)).toEqual({ status: "expired", status_reason: "timeout" });
      expect(await state(fresh.sendId)).toEqual({ status: "awaiting_approval", status_reason: null });
      const loops = await trx.selectFrom("open_loops").select(["id", "status"]).where("org_id", "=", w.orgId).execute();
      expect(loops.every((loop) => loop.status === "open")).toBe(true);
      const audit = await trx
        .selectFrom("audit_log")
        .select(["reason_code", "data"])
        .where("action_id", "=", old.sendId)
        .execute();
      expect(audit).toEqual([
        { reason_code: "timeout", data: { action_type: "send", reason: "timeout", loop_id: old.loopId } },
      ]);
      // The result notice of the expired follow-up: one row per covered owner.
      await run(trx);
      const results = await outbox(trx, w.orgId, "send_result");
      expect(users(results)).toEqual([w.owner, w.owner2].sort());
      expect(results[0]?.text).toBe("⌛ Follow-up not sent: the approval expired (48 h).");
    });
  });
});

describe("a follow-up that no owner could see (every owner uncovered)", () => {
  test("the hourly job ends it after 48 h with the reason the code gives; the loop stays open", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      for (const user of [w.owner, w.owner2]) await consentRow(trx, w.orgId, user, OLD_CONSENT, at(-10 * MINUTE_MS));
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      await run(trx);
      expect(await outbox(trx, w.orgId, "approval")).toEqual([]);
      const later = at(49 * HOUR_MS);
      await createExpiryJob({ db: trx, now: () => later, hooks: noDelegationHooks, uidplus: async () => true }).run();
      const row = await trx
        .selectFrom("actions")
        .select(["status", "status_reason"])
        .where("id", "=", f.sendId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ status: "expired", status_reason: "not_seen" });
      const loop = await trx
        .selectFrom("open_loops")
        .select("status")
        .where("id", "=", f.loopId)
        .executeTakeFirstOrThrow();
      expect(loop.status).toBe("open");
    });
  });
});

describe("a follow-up is never in an approval set", () => {
  test("a forged set_id in the payload gives one card, no set row, and the set tap approves nothing", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const setId = "11111111-1111-4111-8111-111111111111";
      const f = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {});
      // The stored payload carries a set id (a bug or a forged write): the readers must not trust it.
      await trx
        .updateTable("actions")
        .set((eb) => ({
          payload: eb.fn("jsonb_set", [eb.ref("payload"), eb.val("{set_id}"), eb.val(JSON.stringify(setId))]),
        }))
        .where("id", "=", f.sendId)
        .execute();
      await run(trx);
      expect(await outbox(trx, w.orgId, "approval_set")).toEqual([]);
      // It is one single card per covered owner, whatever the stored payload says about a set.
      expect(users(await outbox(trx, w.orgId, "approval"))).toEqual([w.owner, w.owner2].sort());
      const { approveSet, rejectSet } = await import("../../src/modules/actions");
      const deps = {
        db: trx,
        hooks: noDelegationHooks,
        approvalHooks: { onDecided: async () => undefined },
        uidplus: async () => true,
      };
      const result = await approveSet(deps, w.ctx, setId, { userId: w.owner, via: "telegram", now: T });
      expect(result).toEqual({ approved: 0, skipped: 0, approvedIds: [] });
      expect(await rejectSet(deps, w.ctx, setId, { userId: w.owner, via: "telegram", now: T })).toEqual({
        rejected: 0,
        skipped: 0,
      });
      const row = await trx.selectFrom("actions").select("status").where("id", "=", f.sendId).executeTakeFirstOrThrow();
      expect(row.status).toBe("awaiting_approval");
      // The tap on its own card still decides it (the card edit and the audit name the loop).
      const { approve } = await import("../../src/modules/actions");
      expect((await approve(deps, w.ctx, f.sendId, { userId: w.owner, via: "telegram", now: T })).kind).toBe(
        "approved"
      );
    });
  });
});
