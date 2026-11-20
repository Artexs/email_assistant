// The readers of the outbox that match a Telegram dedup key also see the push rows of the same event (`<key>:push:<device id>`): the card fail
// of a decided approval, the "request seen" check of the expiry, the `sync_ok` episodes, the cancel with an `except` key, and the resume hook. Every
// test runs in a transaction that is rolled back.
import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { approve, listExpiredApprovals, noDelegationHooks, type ApprovalDeps } from "../../src/modules/actions";
import { listUnseenApprovalSends } from "../../src/modules/actions/repo/approvals";
import { cardEditHooks, insertOutbox } from "../../src/modules/channels";
import { failPendingCardsOfSend, listClosedFollowUpCards } from "../../src/modules/channels/card-edits-repo";
import { pushDedupKey } from "../../src/modules/channels/push";
import {
  cancelPendingApprovalRequestsOfClosedSends,
  cancelPendingOutbox,
  listSentStaleEpisodes,
} from "../../src/modules/channels/repo";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { markSynced } from "../../src/modules/mail/repo";
import { dedupKeyOrPush, type DB } from "../../src/platform/db";

import { insertDraftAndSend } from "./fixtures";
import { insertFollowUp } from "./follow-up-fixtures";
import { testDb, withRollback } from "./helpers";
import { at, chat, device, outbox, run, setStatus, shape, T, waitingSend, world } from "./push-kit";

const db = testDb();
afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const SWITCHES = { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false };

function depsOf(trx: Trx): ApprovalDeps {
  return {
    db: trx,
    hooks: noDelegationHooks,
    approvalHooks: cardEditHooks({ sendScope: { kind: "all" } }),
    uidplus: async () => true,
  };
}

describe("a decided approval ends the push rows of its request (D22, the card fail)", () => {
  test("1. a panel approval: the pending push row is failed / answered_elsewhere, and the Telegram card gets its edit row as before", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      await insertDefaultSettings(trx, w.ctx, w.mailboxId);
      await updateMailboxSettings(trx, w.ctx, w.mailboxId, { mode: "assist", toolSwitches: SWITCHES });
      const send = await waitingSend(trx, w, at(-20 * MINUTE_MS));
      await run(trx);
      const key = `approval:${send.sendId}`;
      expect(shape(await outbox(trx, w.orgId, "approval"))).toEqual(
        [`telegram ${key}`, `push ${pushDedupKey(key, sub.id)}`].sort()
      );
      // The Telegram card went out (a message id); the push row waits (quiet hours).
      const card = (await outbox(trx, w.orgId, "approval")).find((row) => row.channel === "telegram");
      await trx
        .updateTable("outbox")
        .set({ status: "sent", sent_at: T, external_message_id: 501, text: "CARD" })
        .where("id", "=", card?.id ?? "")
        .execute();

      const result = await approve(depsOf(trx), w.ctx, send.sendId, { userId: w.owner, via: "web", now: T });
      expect(result.kind).toBe("approved");

      const approvals = await outbox(trx, w.orgId, "approval");
      const push = approvals.find((row) => row.channel === "push");
      expect(push).toMatchObject({ status: "failed", error_code: "answered_elsewhere" });
      expect(approvals.find((row) => row.channel === "telegram")?.status).toBe("sent");
      const edits = await outbox(trx, w.orgId, "approval_edit");
      expect(edits.map((row) => row.dedup_key)).toEqual([`approval_edit:${card?.id}:approved`]);
    });
  });

  test("1b. a push row in flight (sending) is left; a pending push row of another device and a pending one of another send are decided apart", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      const first = await device(trx, w, w.owner, at(-HOUR_MS));
      const second = await device(trx, w, w.owner, at(-50 * MINUTE_MS));
      await insertDefaultSettings(trx, w.ctx, w.mailboxId);
      await updateMailboxSettings(trx, w.ctx, w.mailboxId, { mode: "assist", toolSwitches: SWITCHES });
      const decided = await waitingSend(trx, w, at(-20 * MINUTE_MS));
      const other = await waitingSend(trx, w, at(-19 * MINUTE_MS));
      await run(trx);
      const rows = await outbox(trx, w.orgId, "approval");
      const idOf = (sendId: string, sub: string) =>
        rows.find((row) => row.dedup_key === pushDedupKey(`approval:${sendId}`, sub))?.id ?? "";
      await setStatus(trx, idOf(decided.sendId, first.id), "sending");
      await approve(depsOf(trx), w.ctx, decided.sendId, { userId: w.owner, via: "web", now: T });
      const after = new Map((await outbox(trx, w.orgId, "approval")).map((row) => [row.id, row]));
      expect(after.get(idOf(decided.sendId, first.id))?.status).toBe("sending");
      expect(after.get(idOf(decided.sendId, second.id))).toMatchObject({
        status: "failed",
        error_code: "answered_elsewhere",
      });
      expect(after.get(idOf(other.sendId, first.id))?.status).toBe("pending");
      expect(after.get(idOf(other.sendId, second.id))?.status).toBe("pending");
    });
  });

  test("1c. a follow-up that ended with its loop: a push row that no sender took is listed and ends answered_elsewhere", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      const follow = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        send: { updated_at: at(-20 * MINUTE_MS) },
      });
      const id = await insertOutbox(trx, w.ctx, {
        userId: w.owner,
        kind: "approval",
        dedupKey: pushDedupKey(`approval:${follow.sendId}`, sub.id),
        loopId: follow.loopId,
        view: { actionId: follow.sendId },
        locale: "en",
        channel: "push",
        pushSubscriptionId: sub.id,
        createdAt: at(-20 * MINUTE_MS),
        nextAttemptAt: at(-20 * MINUTE_MS),
      });
      expect(await listClosedFollowUpCards(trx, w.ctx, { limit: 10 })).toEqual([]);
      await trx
        .updateTable("actions")
        .set({ status: "expired", status_reason: "loop_closed", updated_at: at(-MINUTE_MS) })
        .where("id", "=", follow.sendId)
        .execute();
      expect((await listClosedFollowUpCards(trx, w.ctx, { limit: 10 })).map((row) => row.sendId)).toEqual([
        follow.sendId,
      ]);
      expect(await failPendingCardsOfSend(trx, w.ctx, follow.sendId)).toBe(1);
      const row = (await outbox(trx, w.orgId, "approval")).find((candidate) => candidate.id === id);
      expect(row).toMatchObject({ status: "failed", error_code: "answered_elsewhere" });
    });
  });
});

// A send that waits since `notified`, with its push row of the approval request (a push-only owner: no chat link).
async function pushOnlySend(trx: Trx, status: "sent" | "pending", notifiedAt: Date) {
  const w = await world(trx);
  const sub = await device(trx, w, w.owner, at(-100 * HOUR_MS));
  const pair = await insertDraftAndSend(trx, w.ctx, w.mailboxId, {
    createdAt: notifiedAt,
    notifiedAt,
    draftProviderResult: { folder: "Drafts", uid: 1 },
  });
  const id = await insertOutbox(trx, w.ctx, {
    userId: w.owner,
    kind: "approval",
    dedupKey: pushDedupKey(`approval:${pair.sendId}`, sub.id),
    emailId: pair.emailId,
    view: { actionId: pair.sendId },
    locale: "en",
    channel: "push",
    pushSubscriptionId: sub.id,
    createdAt: notifiedAt,
    nextAttemptAt: notifiedAt,
  });
  if (id === null) throw new Error("no row");
  await setStatus(trx, id, status);
  return { w, sendId: pair.sendId, rowId: id };
}

describe("the request seen check of the expiry (F079) counts a sent push row", () => {
  const opts = { now: T, limit: 50, staleBefore: at(-10 * MINUTE_MS) };

  test("2. a push-only owner got the push row (sent): the send ends as timeout (request seen), not not_seen", async () => {
    await withRollback(db, async (trx) => {
      const { w, sendId } = await pushOnlySend(trx, "sent", at(-49 * HOUR_MS));
      const found = await listExpiredApprovals(trx, w.ctx, w.mailboxId, opts);
      expect(found.find((row) => row.id === sendId)?.reason).toBe("timeout");
      expect((await listUnseenApprovalSends(trx, w.ctx, { before: at(-48 * HOUR_MS) })).map((row) => row.id)).toEqual(
        []
      );
    });
  });

  test("3. the push row still pending at expiry: not_seen, and the resume path lists the send", async () => {
    await withRollback(db, async (trx) => {
      const { w, sendId } = await pushOnlySend(trx, "pending", at(-49 * HOUR_MS));
      const found = await listExpiredApprovals(trx, w.ctx, w.mailboxId, opts);
      expect(found.find((row) => row.id === sendId)?.reason).toBe("not_seen");
      expect((await listUnseenApprovalSends(trx, w.ctx, { before: at(-48 * HOUR_MS) })).map((row) => row.id)).toEqual([
        sendId,
      ]);
    });
  });

  test("3b. a push row of another send does not make this send seen", async () => {
    await withRollback(db, async (trx) => {
      const seen = await pushOnlySend(trx, "sent", at(-49 * HOUR_MS));
      const unseen = await insertDraftAndSend(trx, seen.w.ctx, seen.w.mailboxId, {
        createdAt: at(-49 * HOUR_MS),
        notifiedAt: at(-49 * HOUR_MS),
        draftProviderResult: { folder: "Drafts", uid: 1 },
      });
      const found = await listExpiredApprovals(trx, seen.w.ctx, seen.w.mailboxId, opts);
      expect(found.find((row) => row.id === seen.sendId)?.reason).toBe("timeout");
      expect(found.find((row) => row.id === unseen.sendId)?.reason).toBe("not_seen");
    });
  });
});

describe("the sync_ok episodes see push rows", () => {
  test("4. a push-only owner gets a sync_stale push; the sync is fresh again: one sync_ok push row; a second run adds none", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const sub = await device(trx, w, w.owner, at(-5 * HOUR_MS));
      await markSynced(trx, w.ctx, w.mailboxId, at(-2 * HOUR_MS));
      await run(trx);
      const stale = (await outbox(trx, w.orgId, "sync_stale")).filter((row) => row.channel === "push");
      expect(stale).toHaveLength(1);
      expect(stale[0]?.push_subscription_id).toBe(sub.id);
      await setStatus(trx, stale[0]?.id ?? "", "sent");
      expect(await listSentStaleEpisodes(trx, w.ctx, w.mailboxId)).toEqual([
        { userId: w.owner, episode: stale[0]?.dedup_key.split(":")[2] ?? "" },
      ]);

      await markSynced(trx, w.ctx, w.mailboxId, at(-MINUTE_MS));
      await run(trx);
      const ok = await outbox(trx, w.orgId, "sync_ok");
      expect(shape(ok)).toEqual([`push sync_ok:${w.mailboxId}:${stale[0]?.dedup_key.split(":")[2]}:push:${sub.id}`]);
      // The episode is closed: the list is empty, and a second run adds no row.
      expect(await listSentStaleEpisodes(trx, w.ctx, w.mailboxId)).toEqual([]);
      await run(trx);
      expect(await outbox(trx, w.orgId, "sync_ok")).toHaveLength(1);
    });
  });

  test("4b. two devices: the episode is listed once for the member, and one sync_ok push row of any device closes it", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const first = await device(trx, w, w.owner, at(-5 * HOUR_MS));
      const second = await device(trx, w, w.owner, at(-4 * HOUR_MS));
      await markSynced(trx, w.ctx, w.mailboxId, at(-2 * HOUR_MS));
      await run(trx);
      const stale = (await outbox(trx, w.orgId, "sync_stale")).filter((row) => row.channel === "push");
      expect(stale.map((row) => row.push_subscription_id).sort()).toEqual([first.id, second.id].sort());
      for (const row of stale) await setStatus(trx, row.id, "sent");
      expect(await listSentStaleEpisodes(trx, w.ctx, w.mailboxId)).toHaveLength(1);
      const episode = stale[0]?.dedup_key.split(":")[2] ?? "";
      await insertOutbox(trx, w.ctx, {
        userId: w.owner,
        kind: "sync_ok",
        dedupKey: pushDedupKey(`sync_ok:${w.mailboxId}:${episode}`, second.id),
        mailboxId: w.mailboxId,
        view: {},
        locale: "en",
        channel: "push",
        pushSubscriptionId: second.id,
        createdAt: at(-MINUTE_MS),
        nextAttemptAt: at(-MINUTE_MS),
      });
      expect(await listSentStaleEpisodes(trx, w.ctx, w.mailboxId)).toEqual([]);
    });
  });
});

describe("the other readers of a fixed key", () => {
  test("5. a key that holds _ or % does not match another key (the push match is no LIKE)", async () => {
    await withRollback(db, async (trx) => {
      const match = async (key: string, keys: string[]) => {
        const list = sql.join(keys.map((k) => sql`(${k})`));
        const { rows } = await sql<{ k: string }>`
          select k from (values ${list}) as t(k) where ${dedupKeyOrPush(sql.raw<string>("k"), key)} order by k`.execute(
          trx
        );
        return rows.map((row) => row.k);
      };
      expect(await match("a_b", ["axb:push:1", "a_b", "a_b:push:1", "a_b:pushx", "a_bc:push:1", "axb"])).toEqual([
        "a_b",
        "a_b:push:1",
      ]);
      expect(await match("a%b", ["aXXb:push:1", "a%b", "a%b:push:2"])).toEqual(["a%b", "a%b:push:2"]);
    });
  });

  test("5b. the card fail of a send id with _ ends the push rows of that id only", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      const emailId = (await waitingSend(trx, w, at(-20 * MINUTE_MS))).emailId;
      const make = (key: string) =>
        insertOutbox(trx, w.ctx, {
          userId: w.owner,
          kind: "approval",
          dedupKey: key,
          emailId,
          view: {},
          locale: "en",
          channel: "push",
          pushSubscriptionId: sub.id,
          createdAt: at(-MINUTE_MS),
          nextAttemptAt: at(-MINUTE_MS),
        });
      const mine = await make("approval:a_b:push:1");
      const other = await make("approval:axb:push:1");
      expect(await failPendingCardsOfSend(trx, w.ctx, "a_b")).toBe(1);
      const rows = new Map((await outbox(trx, w.orgId, "approval")).map((row) => [row.id, row.status]));
      expect(rows.get(mine ?? "")).toBe("failed");
      expect(rows.get(other ?? "")).toBe("pending");
    });
  });

  test("6. a newer notice replaces the pending ones: the rows of its own key (Telegram and push) stay, the older episode goes", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      const make = (key: string, channel: "telegram" | "push") =>
        insertOutbox(trx, w.ctx, {
          userId: w.owner,
          kind: "sync_stale",
          dedupKey: channel === "push" ? pushDedupKey(key, sub.id) : key,
          mailboxId: w.mailboxId,
          view: {},
          locale: "en",
          channel,
          ...(channel === "push" ? { pushSubscriptionId: sub.id } : {}),
          createdAt: at(-MINUTE_MS),
          nextAttemptAt: at(-MINUTE_MS),
        });
      const newTelegram = await make(`sync_stale:${w.mailboxId}:2`, "telegram");
      const newPush = await make(`sync_stale:${w.mailboxId}:2`, "push");
      const oldTelegram = await make(`sync_stale:${w.mailboxId}:1`, "telegram");
      const oldPush = await make(`sync_stale:${w.mailboxId}:1`, "push");
      const cancelled = await cancelPendingOutbox(trx, w.ctx, {
        kind: "sync_stale",
        mailboxId: w.mailboxId,
        exceptDedupKey: `sync_stale:${w.mailboxId}:2`,
      });
      expect(cancelled).toBe(2);
      const status = new Map((await outbox(trx, w.orgId, "sync_stale")).map((row) => [row.id, row.status]));
      expect([newTelegram, newPush].map((id) => status.get(id ?? ""))).toEqual(["pending", "pending"]);
      expect([oldTelegram, oldPush].map((id) => status.get(id ?? ""))).toEqual(["failed", "failed"]);
    });
  });

  test("7. the resume hook ends the request rows of closed sends, push rows included, and keeps those of a send that still waits", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      const waiting = await waitingSend(trx, w, at(-20 * MINUTE_MS));
      const closed = await waitingSend(trx, w, at(-19 * MINUTE_MS));
      await trx.updateTable("actions").set({ status: "rejected" }).where("id", "=", closed.sendId).execute();
      const make = (sendId: string, emailId: string) =>
        insertOutbox(trx, w.ctx, {
          userId: w.owner,
          kind: "approval",
          dedupKey: pushDedupKey(`approval:${sendId}`, sub.id),
          emailId,
          view: {},
          locale: "en",
          channel: "push",
          pushSubscriptionId: sub.id,
          createdAt: at(-MINUTE_MS),
          nextAttemptAt: at(-MINUTE_MS),
        });
      const keep = await make(waiting.sendId, waiting.emailId);
      const end = await make(closed.sendId, closed.emailId);
      const changed = await cancelPendingApprovalRequestsOfClosedSends(trx, w.ctx, {
        staleBefore: at(-10 * MINUTE_MS),
      });
      expect(changed).toBe(1);
      const rows = new Map((await outbox(trx, w.orgId, "approval")).map((row) => [row.id, row]));
      expect(rows.get(keep ?? "")?.status).toBe("pending");
      expect(rows.get(end ?? "")).toMatchObject({ status: "failed", error_code: "outdated" });
    });
  });
});
