import { sendPayloadFor, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { claimActions } from "../../src/modules/actions";
import { heldReason, type HeldReasonDeps } from "../../src/modules/channels";

import {
  NOW,
  CREATED,
  at,
  MARKERS,
  setup,
  followUp,
  committerOf,
  row,
  draftsCount,
  prepare,
} from "./actions-follow-up-helpers";
import { insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The follow-up kind goes through the committer. A follow-up hangs on a loop (`loop_id`), not on a mail.
// Every test runs in a transaction that is rolled back: a committed loop row would break the Down guard of the migration test.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("the recipients come from the loop only, and the scope covers the Cc", () => {
  test("a follow-up to an address that the loop does not hold is never drafted or sent", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { to: [MARKERS.anna], cc: [] });
      // The draft payload names a stranger.
      await trx
        .updateTable("actions")
        .set({
          payload: JSON.stringify({ ...p.draftPayload, to: ["stranger@x.test"] }),
        })
        .where("id", "=", p.draftId)
        .execute();
      const committer = committerOf(trx, s, { now: NOW });
      await committer.run();
      expect(await draftsCount(s)).toBe(0);
      expect((await row(trx, p.draftId)).status).toBe("failed");
      expect((await row(trx, p.draftId)).status_reason).toBe("bad_payload");
      expect(await row(trx, p.sendId)).toMatchObject({ status: "expired", status_reason: "draft_missing" });
      expect(s.sender.sent).toHaveLength(0);
    });
  });

  test("a send that names an address of the loop that its draft does not name ends bad_payload before any SMTP call", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      // The loop holds anna (To) and jan (Cc). The draft names anna only; the send names both.
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ ...p.draftPayload, cc: [] }) })
        .where("id", "=", p.draftId)
        .execute();
      await committerOf(trx, s, { now: NOW }).run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
    });
  });

  test("a mail-kind draft and send on a loop ends bad_payload at the send, with no SMTP call", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      const draft = { kind: "clarification", to: [MARKERS.anna], question: "q", language: "en" };
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify(draft) })
        .where("id", "=", p.draftId)
        .execute();
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "clarification", to: [MARKERS.anna] }) })
        .where("id", "=", p.sendId)
        .execute();
      await committerOf(trx, s, { now: NOW }).run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
    });
  });

  test("a send that waits for its tap is never claimed, even with an approval stamp on the row", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "awaiting_approval" });
      await trx
        .updateTable("actions")
        .set({ approved_at: at(-1), approved_by: s.userId, approved_via: "telegram" })
        .where("id", "=", p.sendId)
        .execute();
      // The claim itself refuses it: the later guard of `markApplying` is not the only one.
      const claimed = await claimActions(trx, s.ctx, s.mailboxId, {
        now: NOW,
        limit: 20,
        staleBefore: new Date(NOW.getTime() - 10 * MINUTE_MS),
        filter: { mailbox: { kind: "all" }, send: { kind: "all" } },
      });
      expect(claimed.map((entry) => entry.id)).toEqual([]);
      await committerOf(trx, s, { now: NOW }).run();
      await committerOf(trx, s, { now: at(5) }).run();
      expect(s.sender.sent).toHaveLength(0);
      expect((await row(trx, p.sendId)).status).toBe("awaiting_approval");
    });
  });

  test("a send of another kind for a follow-up draft ends bad_payload before any SMTP call", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      // The send names the loop, so only its kind is wrong: the follow-up counters would never move.
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "delegation", to: [MARKERS.anna], loop_id: p.loopId }) })
        .where("id", "=", p.sendId)
        .execute();
      await committerOf(trx, s, { now: NOW }).run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
    });
  });

  test("a loop send with a mail-kind payload, and a follow-up on a mail, are bad payloads", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s);
      await trx
        .updateTable("actions")
        .set({
          payload: JSON.stringify({
            kind: "clarification",
            to: [MARKERS.anna],
            question: "q",
            language: "en",
          }),
        })
        .where("id", "=", p.draftId)
        .execute();
      await committerOf(trx, s, { now: NOW }).run();
      expect(await draftsCount(s)).toBe(0);
      expect(await row(trx, p.draftId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
    });
  });

  test("an approved send to an address outside the loop ends bad_payload even when its draft is applied", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      const stranger = { ...p.draftPayload, to: ["stranger@x.test"], cc: [] };
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify(stranger) })
        .where("id", "=", p.draftId)
        .execute();
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify(sendPayloadFor(stranger)) })
        .where("id", "=", p.sendId)
        .execute();
      await committerOf(trx, s, { now: NOW }).run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "failed", status_reason: "bad_payload" });
    });
  });

  test("SEND_SCOPE self: a payload with a Cc that is not a list is never claimed and does not break the claim", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "follow_up", to: [MARKERS.anna], cc: MARKERS.jan, loop_id: p.loopId }) })
        .where("id", "=", p.sendId)
        .execute();
      const claimed = await claimActions(trx, s.ctx, s.mailboxId, {
        now: NOW,
        limit: 20,
        staleBefore: new Date(NOW.getTime() - 10 * MINUTE_MS),
        filter: { mailbox: { kind: "all" }, send: { kind: "self", addresses: [MARKERS.anna, MARKERS.jan] } },
      });
      expect(claimed.map((entry) => entry.id)).toEqual([]);
    });
  });

  test("the held reason of a send names the scope when a Cc is outside the list", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const mail = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        sendStatus: "approved",
        approved: { userId: s.userId, at: at(-1) },
        to: MARKERS.anna,
      });
      await trx
        .updateTable("actions")
        .set({ payload: JSON.stringify({ kind: "delegation", to: [MARKERS.anna], cc: [MARKERS.jan] }) })
        .where("id", "=", mail.sendId)
        .execute();
      const only: HeldReasonDeps = { db: trx, sendScope: { kind: "self", addresses: [MARKERS.anna] } };
      expect(await heldReason(only, s.ctx, mail.sendId)).toBe("scope");
      const both: HeldReasonDeps = { db: trx, sendScope: { kind: "self", addresses: [MARKERS.anna, MARKERS.jan] } };
      expect(await heldReason(both, s.ctx, mail.sendId)).toBeUndefined();
    });
  });

  test("SEND_SCOPE self: a Cc outside the list holds the follow-up; with every address listed it goes out", async () => {
    await withRollback(db, async (trx) => {
      const s = await prepare(trx);
      const p = await followUp(trx, s, { draftStatus: "applied", sendStatus: "approved" });
      await s.fake.appendMessage("Drafts", Buffer.from("x"), ["\\Draft"], CREATED);
      const held = committerOf(trx, s, { now: NOW }, { sendScope: { kind: "self", addresses: [MARKERS.anna] } });
      await held.run();
      expect(s.sender.sent).toHaveLength(0);
      expect(await row(trx, p.sendId)).toMatchObject({ status: "approved", locked_at: null });

      const open = committerOf(
        trx,
        s,
        { now: at(2) },
        { sendScope: { kind: "self", addresses: [MARKERS.anna, MARKERS.jan] } }
      );
      await open.run();
      expect(s.sender.sent).toHaveLength(1);
      expect((await row(trx, p.sendId)).status).toBe("applied");
    });
  });
});
