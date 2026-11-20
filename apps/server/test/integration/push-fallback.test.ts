// The Telegram fallback of a push row that ends `no_device`: the event goes to the member's chat when the member has one, no Telegram row of the
// event exists, and the row holds no loop (the loop-consent gate stays closed). Every test runs in a transaction that is rolled back; the push
// service is a function (no request leaves the process).
import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { createPushSender } from "../../src/modules/channels";
import { removeDevice } from "../../src/modules/channels/push";
import type { DB } from "../../src/platform/db";
import { generateVapidKeyPair } from "../../src/platform/vapid-keys";

import { insertTriaged } from "./fixtures";
import { CURRENT_CONSENT, consentRow, insertFollowUp } from "./follow-up-fixtures";
import { testDb, withRollback } from "./helpers";
import { at, chat, device, outbox, pushBox, run, setRoutes, shape, world, type World } from "./push-kit";

const db = testDb();
afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const vapid = { ...generateVapidKeyPair(), subject: "mailto:owner@example.org" };
// 23:00 in Warsaw (winter time): inside the quiet hours 22:00-07:00. The next 07:00 is 06:00Z.
const NIGHT = new Date("2026-11-20T22:00:00Z");
const MORNING = new Date("2026-11-21T06:00:00Z");
const SESSION_END = new Date("2026-11-21T02:00:00Z"); // 03:00 in Warsaw

function sender(trx: Trx, now: Date, answer = 201) {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL): Promise<Response> => {
    calls.push(String(input));
    return new Response(null, { status: answer });
  }) as typeof fetch;
  return {
    calls,
    run: () => createPushSender({ db: trx, box: pushBox, keys: vapid, fetch: fetchFn, now: () => now }).run(),
  };
}

const urgentRows = (trx: Trx, w: World) => outbox(trx, w.orgId, "urgent");

// A member with a chat, the route `urgent: push` and one device whose session ends at 03:00. An urgent mail was triaged at 22:00Z; the detector
// wrote the push row; the sender held it for the quiet hours.
async function heldUrgent(trx: Trx, opts: { chat?: boolean; routes?: Record<string, string> } = {}) {
  const w = await world(trx);
  if (opts.chat !== false) await chat(trx, w, w.owner, at(-30 * HOUR_MS));
  await setRoutes(trx, w, w.owner, opts.routes ?? { urgent: "push" });
  const sub = await device(trx, w, w.owner, at(-5 * HOUR_MS), SESSION_END);
  const emailId = await insertTriaged(trx, w.ctx, w.mailboxId, {
    category: "urgent",
    createdAt: new Date(NIGHT.getTime() - 5 * MINUTE_MS),
  });
  await run(trx, NIGHT);
  const held = sender(trx, new Date(NIGHT.getTime() + MINUTE_MS));
  await held.run();
  expect(held.calls).toHaveLength(0);
  return { w, sub, emailId };
}

describe("a push row that ends no_device falls back to Telegram", () => {
  test("1. route push, a device held by quiet hours, the session ends at 03:00: at 07:00 the push row is no_device and one Telegram urgent row exists", async () => {
    await withRollback(db, async (trx) => {
      const { w, sub, emailId } = await heldUrgent(trx);
      expect(shape(await urgentRows(trx, w))).toEqual([`push urgent:${emailId}:push:${sub.id}`]);
      const morning = sender(trx, MORNING);
      await morning.run();
      expect(morning.calls).toHaveLength(0);
      const rows = await urgentRows(trx, w);
      expect(shape(rows)).toEqual([`telegram urgent:${emailId}`, `push urgent:${emailId}:push:${sub.id}`].sort());
      expect(rows.find((row) => row.channel === "push")).toMatchObject({ status: "failed", error_code: "no_device" });
      const telegram = rows.find((row) => row.channel === "telegram");
      expect(telegram).toMatchObject({
        status: "pending",
        kind: "urgent",
        email_id: emailId,
        push_subscription_id: null,
      });
      // The row keeps the time of the event, so the 24 hours of the notice run from the event, and it is due at once.
      expect(telegram?.created_at.getTime()).toBe(rows.find((row) => row.channel === "push")?.created_at.getTime());
      expect(telegram?.next_attempt_at.getTime()).toBeLessThanOrEqual(MORNING.getTime());
    });
  });

  test("2. a Telegram row of the event exists already (route both): no second Telegram row", async () => {
    await withRollback(db, async (trx) => {
      const { w, sub, emailId } = await heldUrgent(trx, { routes: { urgent: "both" } });
      expect(shape(await urgentRows(trx, w))).toEqual(
        [`telegram urgent:${emailId}`, `push urgent:${emailId}:push:${sub.id}`].sort()
      );
      await sender(trx, MORNING).run();
      const rows = await urgentRows(trx, w);
      expect(rows.filter((row) => row.channel === "telegram")).toHaveLength(1);
      expect(rows.find((row) => row.channel === "push")).toMatchObject({ status: "failed", error_code: "no_device" });
    });
  });

  test("3. a push-only member (no chat): no fallback row, the push row stays failed / no_device", async () => {
    await withRollback(db, async (trx) => {
      const { w, sub, emailId } = await heldUrgent(trx, { chat: false, routes: {} });
      await sender(trx, MORNING).run();
      const rows = await urgentRows(trx, w);
      expect(shape(rows)).toEqual([`push urgent:${emailId}:push:${sub.id}`]);
      expect(rows[0]).toMatchObject({ status: "failed", error_code: "no_device" });
    });
  });

  test("4. a 400 answer (push_refused): no fallback row", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner, at(-30 * HOUR_MS));
      await setRoutes(trx, w, w.owner, { urgent: "push" });
      const sub = await device(trx, w, w.owner, at(-5 * HOUR_MS));
      const emailId = await insertTriaged(trx, w.ctx, w.mailboxId, {
        category: "urgent",
        createdAt: at(-10 * MINUTE_MS),
      });
      await run(trx);
      const refused = sender(trx, at(MINUTE_MS), 400);
      await refused.run();
      expect(refused.calls).toHaveLength(1);
      const rows = await urgentRows(trx, w);
      expect(shape(rows)).toEqual([`push urgent:${emailId}:push:${sub.id}`]);
      expect(rows[0]).toMatchObject({ status: "failed", error_code: "push_refused" });
    });
  });

  test("5. a withheld owner with a chat and a device (no loop consent): the follow-up approval is a push row with a loop; when the device ends no Telegram approval row appears", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS), at(30 * MINUTE_MS));
      const follow = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        send: { updated_at: at(-20 * MINUTE_MS) },
      });
      await run(trx);
      const before = await outbox(trx, w.orgId);
      expect(shape(before)).toEqual(
        [`telegram loop_consent:approval:2026-11-20`, `push approval:${follow.sendId}:push:${sub.id}`].sort()
      );
      expect(before.find((row) => row.channel === "push")?.loop_id).toBe(follow.loopId);
      // The device ends (its session is over); the sender finds it not live.
      const later = sender(trx, at(HOUR_MS));
      await later.run();
      expect(later.calls).toHaveLength(0);
      const rows = await outbox(trx, w.orgId);
      expect(rows.find((row) => row.channel === "push")).toMatchObject({ status: "failed", error_code: "no_device" });
      expect(rows.filter((row) => row.channel === "telegram").map((row) => row.kind)).toEqual(["loop_consent"]);
      expect(await outbox(trx, w.orgId, "approval")).toHaveLength(1);
    });
  });

  test("5b. a covered owner (loop consent given): the follow-up approval of a push row that ends no_device does not fall back either, because the Telegram card exists", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS), at(30 * MINUTE_MS));
      await consentRow(trx, w.orgId, w.owner, CURRENT_CONSENT, at(-HOUR_MS));
      const follow = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        send: { updated_at: at(-20 * MINUTE_MS) },
      });
      await run(trx);
      await sender(trx, at(HOUR_MS)).run();
      const rows = await outbox(trx, w.orgId, "approval");
      expect(shape(rows)).toEqual(
        [`telegram approval:${follow.sendId}`, `push approval:${follow.sendId}:push:${sub.id}`].sort()
      );
      expect(rows.find((row) => row.channel === "push")?.error_code).toBe("no_device");
    });
  });

  test("6. a 410 from the push service ends every open row of the device, and each falls back once", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner, at(-30 * HOUR_MS));
      await setRoutes(trx, w, w.owner, { urgent: "push" });
      await device(trx, w, w.owner, at(-5 * HOUR_MS));
      const first = await insertTriaged(trx, w.ctx, w.mailboxId, {
        category: "urgent",
        createdAt: at(-20 * MINUTE_MS),
      });
      const second = await insertTriaged(trx, w.ctx, w.mailboxId, {
        category: "urgent",
        createdAt: at(-10 * MINUTE_MS),
      });
      await run(trx);
      const gone = sender(trx, at(MINUTE_MS), 410);
      await gone.run();
      expect(gone.calls).toHaveLength(1);
      const rows = await urgentRows(trx, w);
      const telegram = rows
        .filter((row) => row.channel === "telegram")
        .map((row) => row.dedup_key)
        .sort();
      expect(telegram).toEqual([`urgent:${first}`, `urgent:${second}`].sort());
      expect(rows.filter((row) => row.channel === "push").map((row) => row.error_code)).toEqual([
        "no_device",
        "no_device",
      ]);
    });
  });

  test("7. the member removes the device (removeDevice): the open push row falls back, and a second call adds nothing", async () => {
    await withRollback(db, async (trx) => {
      const { w, sub, emailId } = await heldUrgent(trx);
      expect(await removeDevice(trx, w.ctx, sub.id)).toBe(true);
      expect(shape(await urgentRows(trx, w))).toEqual(
        [`telegram urgent:${emailId}`, `push urgent:${emailId}:push:${sub.id}`].sort()
      );
      expect(await removeDevice(trx, w.ctx, sub.id)).toBe(false);
      expect(await urgentRows(trx, w)).toHaveLength(2);
    });
  });

  test("8. a push row that was sent stays as it is when its device goes", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner, at(-30 * HOUR_MS));
      await setRoutes(trx, w, w.owner, { urgent: "push" });
      const sub = await device(trx, w, w.owner, at(-5 * HOUR_MS));
      await insertTriaged(trx, w.ctx, w.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE_MS) });
      await run(trx);
      await sender(trx, at(MINUTE_MS)).run();
      await sql`update push_subscriptions set session_id = null where id = ${sub.id}::uuid`.execute(trx);
      await sender(trx, at(2 * MINUTE_MS)).run();
      const rows = await urgentRows(trx, w);
      expect(rows.map((row) => `${row.channel} ${row.status}`)).toEqual(["push sent"]);
    });
  });

  test("9. a push row whose device row was deleted by a plain delete (no device id left) ends no_device and falls back", async () => {
    await withRollback(db, async (trx) => {
      const { w, sub, emailId } = await heldUrgent(trx);
      await sql`delete from push_subscriptions where id = ${sub.id}::uuid`.execute(trx);
      await sender(trx, MORNING).run();
      const rows = await urgentRows(trx, w);
      expect(shape(rows.filter((row) => row.channel === "telegram"))).toEqual([`telegram urgent:${emailId}`]);
      expect(rows.find((row) => row.channel === "push")).toMatchObject({ status: "failed", error_code: "no_device" });
    });
  });
});
