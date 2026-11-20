import { MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { draftFollowUp } from "../../src/modules/loops";
import type { DB } from "../../src/platform/db";
import { captureLogs, eventLines } from "../log-capture";

import { openDelegation } from "./delegation-chaser-fixtures";
import { insertTriaged, pauseOtherMailboxes, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  BEFORE_GATE,
  chase,
  DAY_MS,
  delegatedLoop,
  DUE_YESTERDAY,
  dueLoop,
  loopSends,
  markers,
  NOW,
  priorFollowUp,
  setAutoFollowUp,
  setAutoFollowUpRaw,
} from "./loops-chaser-fixtures";
import { actionsOfLoop, auditOf, commandLoop, commandOrg, loopOf } from "./loops-commands-fixtures";
import { siblingMailbox } from "./mail-sent-fixtures";

// The one chaser, the loop part. The delegation cases of the old job are in `delegation-chaser.test.ts` (the
// job `createLoopChaserJob` runs them); the races are in `loops-chaser-race.test.ts`.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const payloadOf = (row: { payload: unknown }): Record<string, unknown> => row.payload as Record<string, unknown>;
const org = async (trx: Transaction<DB>, opts: Parameters<typeof commandOrg>[1] = {}) => {
  await pauseOtherMailboxes(trx);
  return commandOrg(trx, opts);
};
const statusOf = async (trx: Transaction<DB>, id: string) => {
  const row = await loopOf(trx, id);
  return [row.status, row.close_reason];
};

describe("the gates", () => {
  test("T1 07:29 does nothing; 07:31 runs once; a second tick the same day does nothing; force runs again", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const loop = await delegatedLoop(trx, o);
      expect((await chase(trx, o, BEFORE_GATE)).skipped).toBe("gate");
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
      expect(await markers(trx, o.ctx.orgId, "loops.chaser_run")).toHaveLength(0);

      const first = await chase(trx, o, NOW);
      expect(first).toMatchObject({ skipped: null, followUps: 1 });
      expect(await markers(trx, o.ctx.orgId, "loops.chaser_run")).toHaveLength(1);
      expect(await markers(trx, o.ctx.orgId, "delegation.chaser_run")).toHaveLength(1);

      const later = new Date(NOW.getTime() + 14 * MINUTE_MS);
      expect((await chase(trx, o, later)).skipped).toBe("gate");
      expect(await markers(trx, o.ctx.orgId, "loops.chaser_run")).toHaveLength(1);

      const forced = await chase(trx, o, later, { force: true });
      expect(forced.skipped).toBeNull();
      expect(await markers(trx, o.ctx.orgId, "loops.chaser_run")).toHaveLength(2);
      // The loop already has a waiting card: the forced run plans no second one.
      expect(await loopSends(trx, o.ctx.orgId)).toHaveLength(1);
    });
  });

  test("T1b exactly 07:30 acts (the gate is `before 07:30`); the same minute in the next local day acts again", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      await delegatedLoop(trx, o);
      const at0730 = new Date("2026-11-20T06:30:00Z");
      expect((await chase(trx, o, at0730)).skipped).toBeNull();
      expect((await chase(trx, o, new Date(at0730.getTime() + DAY_MS))).skipped).toBeNull();
      expect(await markers(trx, o.ctx.orgId, "loops.chaser_run")).toHaveLength(2);
    });
  });

  test("the day marker is per part: the delegation marker alone does not stop the loop part", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const loop = await delegatedLoop(trx, o);
      await trx
        .insertInto("audit_log")
        .values({
          org_id: o.ctx.orgId,
          actor: "system",
          event: "delegation.chaser_run",
          data: JSON.stringify({ mailbox_id: o.mailboxId }),
          created_at: new Date(NOW.getTime() - MINUTE_MS),
        })
        .execute();
      const result = await chase(trx, o, NOW);
      expect(result.followUps).toBe(1);
      expect(await markers(trx, o.ctx.orgId, "delegation.chaser_run")).toHaveLength(1);
      expect((await actionsOfLoop(trx, loop.id)).length).toBe(2);
    });
  });

  test("a flag that is off: the delegation part runs, the loop part writes nothing and no marker", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { loopsFlag: false });
      const loop = await delegatedLoop(trx, o);
      const stale = await dueLoop(trx, o, { due_at: new Date(NOW.getTime() - 31 * DAY_MS) });
      const result = await chase(trx, o, NOW);
      expect(result).toMatchObject({ skipped: null, followUps: 0, stale: 0 });
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
      expect(await statusOf(trx, stale.id)).toEqual(["open", null]);
      expect(await markers(trx, o.ctx.orgId, "loops.chaser_run")).toHaveLength(0);
      expect(await markers(trx, o.ctx.orgId, "delegation.chaser_run")).toHaveLength(1);
    });
  });

  test("a mailbox that is not in assist: no delegation marker, the loop part still runs and marks the day", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { mode: "shadow" });
      await chase(trx, o, NOW);
      expect(await markers(trx, o.ctx.orgId, "delegation.chaser_run")).toHaveLength(0);
      expect(await markers(trx, o.ctx.orgId, "loops.chaser_run")).toHaveLength(1);
    });
  });

  test("neither part wanted (shadow, flag off): skipped, nothing written", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { mode: "shadow", loopsFlag: false });
      expect((await chase(trx, o, NOW)).skipped).toBe("settings");
      expect(await markers(trx, o.ctx.orgId, "loops.chaser_run")).toHaveLength(0);
    });
  });
});

describe("the follow-up rules (a) and (b)", () => {
  test("T2 two overdue delegations and one due delegated loop: one set of 2 reminders and one card that joins no set", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const dueAt = new Date("2026-11-19T16:00:00Z");
      await openDelegation(trx, o, { dueAt });
      await openDelegation(trx, o, { dueAt });
      const loop = await delegatedLoop(trx, o);
      const result = await chase(trx, o, NOW);
      expect(result).toMatchObject({ reminders: 2, followUps: 1 });
      const sends = await trx
        .selectFrom("actions")
        .select(["loop_id", "email_id", "payload"])
        .where("org_id", "=", o.ctx.orgId)
        .where("type", "=", "send")
        .where("status", "=", "awaiting_approval")
        .execute();
      const reminders = sends.filter((row) => row.loop_id === null);
      expect(reminders).toHaveLength(2);
      const sets = new Set(reminders.map((row) => payloadOf(row).set_id));
      expect(sets.size).toBe(1);
      expect([...sets][0]).toBeString();
      const card = sends.find((row) => row.loop_id === loop.id);
      expect(card).toBeDefined();
      expect(payloadOf(card ?? { payload: null })).not.toHaveProperty("set_id");
    });
  });

  test("T5 a delegated loop due yesterday in assist: one follow-up, To = the delegate alone, actor system", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const loop = await delegatedLoop(trx, o);
      await chase(trx, o, NOW);
      const rows = await actionsOfLoop(trx, loop.id);
      expect(rows.map((row) => `${row.type}:${row.status}`)).toEqual(["create_draft:ready", "send:awaiting_approval"]);
      expect(rows.map((row) => row.idempotency_key)).toEqual([
        `${loop.id}:create_draft:follow_up:1:1`,
        `${loop.id}:send:follow_up:1:1`,
      ]);
      expect(payloadOf(rows[1] ?? { payload: null })).toMatchObject({
        kind: "follow_up",
        to: [loop.delegateEmail],
        cc: [],
      });
      const planned = await auditOf(trx, o.ctx.orgId, "action.planned");
      expect(planned.map((row) => row.actor)).toEqual(["system", "system"]);
      expect(planned.map((row) => (row.data as Record<string, unknown>).via)).toEqual(["chaser", "chaser"]);
    });
  });

  test("T6 a waiting loop due yesterday: nothing with auto_follow_up off; one follow-up with To and Cc when on", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const loop = await dueLoop(trx, o);
      await chase(trx, o, NOW);
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);

      await setAutoFollowUp(trx, o, true);
      const next = new Date(NOW.getTime() + DAY_MS);
      expect((await chase(trx, o, next)).followUps).toBe(1);
      const send = (await actionsOfLoop(trx, loop.id)).find((row) => row.type === "send");
      expect(payloadOf(send ?? { payload: null })).toMatchObject({
        kind: "follow_up",
        to: ["anna@example.test"],
        cc: ["jan@example.test"],
      });
    });
  });

  test("T3 12 due loops: 10 planned the first day (the oldest due), the other 2 the next day", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const ids: string[] = [];
      for (let i = 0; i < 12; i += 1) {
        const loop = await delegatedLoop(trx, o, { due_at: new Date(DUE_YESTERDAY.getTime() - (12 - i) * MINUTE_MS) });
        ids.push(loop.id);
      }
      expect((await chase(trx, o, NOW)).followUps).toBe(10);
      const planned = new Set((await loopSends(trx, o.ctx.orgId)).map((row) => row.loop_id));
      expect([...planned].sort()).toEqual(ids.slice(0, 10).sort());
      const next = new Date(NOW.getTime() + DAY_MS);
      expect((await chase(trx, o, next)).followUps).toBe(2);
      expect(new Set((await loopSends(trx, o.ctx.orgId)).map((row) => row.loop_id)).size).toBe(12);
    });
  });

  test("T3b delegation reminders come first: 8 reminders and 12 loops give 8 reminders and 2 follow-ups", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      for (let i = 0; i < 8; i += 1) await openDelegation(trx, o, { dueAt: DUE_YESTERDAY });
      for (let i = 0; i < 12; i += 1) await delegatedLoop(trx, o);
      expect(await chase(trx, o, NOW)).toMatchObject({ reminders: 8, followUps: 2 });
    });
  });

  test("T7 shadow: no follow-up planned, no action rows, no would-draft row; the stale close still runs", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { mode: "shadow" });
      const due = await delegatedLoop(trx, o);
      const stale = await dueLoop(trx, o, { due_at: new Date(NOW.getTime() - 30 * DAY_MS) });
      expect(await chase(trx, o, NOW)).toMatchObject({ skipped: null, followUps: 0, stale: 1 });
      expect(await loopSends(trx, o.ctx.orgId)).toEqual([]);
      expect(await actionsOfLoop(trx, due.id)).toEqual([]);
      expect(await auditOf(trx, o.ctx.orgId, "loop.would_draft")).toEqual([]);
      expect(await statusOf(trx, stale.id)).toEqual(["closed", "stale"]);
    });
  });

  test("drafts off: the same as shadow for the follow-ups", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { createDraft: false });
      const loop = await delegatedLoop(trx, o);
      expect((await chase(trx, o, NOW)).followUps).toBe(0);
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
    });
  });

  test("T10 a disabled delegate, or a loop with no counterpart: skipped, no row", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const off = await delegatedLoop(trx, o, { delegateActive: false });
      const none = await delegatedLoop(trx, o, { counterpart: null });
      const ok = await delegatedLoop(trx, o);
      expect((await chase(trx, o, NOW)).followUps).toBe(1);
      expect(await actionsOfLoop(trx, off.id)).toEqual([]);
      expect(await actionsOfLoop(trx, none.id)).toEqual([]);
      expect((await actionsOfLoop(trx, ok.id)).length).toBe(2);
    });
  });

  test("a loop that is not due, a promised loop and a closed loop get nothing", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      await setAutoFollowUp(trx, o, true);
      const future = await dueLoop(trx, o, { due_at: new Date(NOW.getTime() + MINUTE_MS) });
      const promised = await dueLoop(trx, o, { kind: "promised" });
      const closed = await dueLoop(trx, o, { status: "closed", close_reason: "done", closed_at: NOW });
      expect((await chase(trx, o, NOW)).followUps).toBe(0);
      for (const loop of [future, promised, closed]) expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
    });
  });

  test("a thread with a suspicious mail: no follow-up", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const bad = await delegatedLoop(trx, o);
      const good = await delegatedLoop(trx, o);
      await insertTriaged(trx, o.ctx, o.mailboxId, {
        category: "info",
        createdAt: NOW,
        threadKey: bad.threadKey,
        suspiciousReasons: ["lookalike_domain"],
      });
      expect((await chase(trx, o, NOW)).followUps).toBe(1);
      expect(await actionsOfLoop(trx, bad.id)).toEqual([]);
      expect((await actionsOfLoop(trx, good.id)).length).toBe(2);
    });
  });

  const SPACING = [
    ["Tue 07:30 -> Fri 07:31 (3 working days)", "2026-11-17T06:30:00Z", 1],
    ["Tue 07:32 -> Fri 07:31 (one minute short)", "2026-11-17T06:32:00Z", 0],
    ["Wed 07:30 -> Fri 07:31 (2 working days)", "2026-11-18T06:30:00Z", 0],
  ] as const;
  for (const [label, last, expected] of SPACING) {
    test(`the second follow-up needs 3 working days: ${label}`, async () => {
      await withRollback(db, async (trx) => {
        const o = await org(trx);
        const loop = await delegatedLoop(trx, o, { follow_ups_sent: 1, last_follow_up_at: new Date(last) });
        expect((await chase(trx, o, NOW)).followUps).toBe(expected);
        if (expected === 1) {
          const rows = await actionsOfLoop(trx, loop.id);
          expect(payloadOf(rows[0] ?? { payload: null }).n).toBe(2);
        }
      });
    });
  }

  test("a loop with 2 follow-ups sent gets no third, and is not yet stale 13 days after the last", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const loop = await delegatedLoop(trx, o, {
        follow_ups_sent: 2,
        last_follow_up_at: new Date(NOW.getTime() - 5 * DAY_MS),
      });
      expect(await chase(trx, o, NOW)).toMatchObject({ followUps: 0, stale: 0 });
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
      expect(await statusOf(trx, loop.id)).toEqual(["open", null]);
    });
  });

  test("a follow-up card that waits for a tap: no second one", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const loop = await delegatedLoop(trx, o);
      await priorFollowUp(trx, o, loop.id, { status: "awaiting_approval" });
      expect((await chase(trx, o, NOW)).followUps).toBe(0);
      expect(await loopSends(trx, o.ctx.orgId)).toHaveLength(1);
    });
  });

  const OFFERED = [
    ["rejected", undefined],
    ["expired", "timeout"],
    ["failed", "outcome_unknown"],
    ["failed", "smtp_error"],
  ] as const;
  for (const [status, reason] of OFFERED) {
    test(`the job offers a follow-up number once: after a ${status}${reason === undefined ? "" : ` (${reason})`} card it plans none; a tap still can`, async () => {
      await withRollback(db, async (trx) => {
        const o = await org(trx);
        const loop = await delegatedLoop(trx, o);
        await priorFollowUp(trx, o, loop.id, { status, ...(reason === undefined ? {} : { reason }) });
        expect((await chase(trx, o, NOW)).followUps).toBe(0);
        const next = new Date(NOW.getTime() + DAY_MS);
        expect((await chase(trx, o, next)).followUps).toBe(0);
        expect(await loopSends(trx, o.ctx.orgId)).toHaveLength(1);
        const tap = await draftFollowUp({ db: trx, now: () => NOW }, o.ctx, {
          loopId: loop.id,
          userId: o.userId,
          via: "web",
        });
        expect(tap.kind).toBe("planned");
      });
    });
  }

  test("another organization's loops stay untouched", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const other = await commandOrg(trx);
      const mine = await delegatedLoop(trx, o);
      const theirs = await delegatedLoop(trx, other);
      const stale = await dueLoop(trx, other, { due_at: new Date(NOW.getTime() - 40 * DAY_MS) });
      await chase(trx, o, NOW);
      expect((await actionsOfLoop(trx, mine.id)).length).toBe(2);
      expect(await actionsOfLoop(trx, theirs.id)).toEqual([]);
      expect(await statusOf(trx, stale.id)).toEqual(["open", null]);
    });
  });
});

describe("the closes (c) and (d)", () => {
  const LAST = 14 * DAY_MS;
  test("T8 two follow-ups, the last 14 days ago: stale; 14 days less a millisecond: open", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const on = await delegatedLoop(trx, o, { follow_ups_sent: 2, last_follow_up_at: new Date(NOW.getTime() - LAST) });
      const short = await dueLoop(trx, o, {
        follow_ups_sent: 2,
        last_follow_up_at: new Date(NOW.getTime() - LAST + 1),
      });
      expect(await chase(trx, o, NOW)).toMatchObject({ stale: 1, followUps: 0 });
      expect(await statusOf(trx, on.id)).toEqual(["closed", "stale"]);
      expect(await statusOf(trx, short.id)).toEqual(["open", null]);
    });
  });

  test("T8 no follow-up and due 30 days ago: stale; 30 days less a millisecond: open", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const on = await dueLoop(trx, o, { due_at: new Date(NOW.getTime() - 30 * DAY_MS) });
      const short = await dueLoop(trx, o, { due_at: new Date(NOW.getTime() - 30 * DAY_MS + 1) });
      await chase(trx, o, NOW);
      expect(await statusOf(trx, on.id)).toEqual(["closed", "stale"]);
      expect(await statusOf(trx, short.id)).toEqual(["open", null]);
    });
  });

  test("the stale close takes a loop in every mode and ends its waiting card in the same transaction", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { mode: "shadow" });
      const loop = await delegatedLoop(trx, o, { due_at: new Date(NOW.getTime() - 31 * DAY_MS) });
      const card = await priorFollowUp(trx, o, loop.id, { status: "awaiting_approval" });
      await chase(trx, o, NOW);
      expect(await statusOf(trx, loop.id)).toEqual(["closed", "stale"]);
      const send = (await loopSends(trx, o.ctx.orgId)).find((row) => row.id === card.sendId);
      expect(send).toMatchObject({ status: "expired", status_reason: "loop_closed" });
      const closed = await auditOf(trx, o.ctx.orgId, "loop.closed");
      expect(closed).toHaveLength(1);
      expect(closed[0]?.actor).toBe("system");
      expect(closed[0]?.data).toMatchObject({ reason: "stale" });
    });
  });

  test("a stale loop gets no follow-up, even when it is due and in assist", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const loop = await delegatedLoop(trx, o, { due_at: new Date(NOW.getTime() - 45 * DAY_MS) });
      expect(await chase(trx, o, NOW)).toMatchObject({ stale: 1, followUps: 0 });
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
    });
  });

  test("T9 a promised loop due 2026-11-13 17:00 (Warsaw): expired at 2026-11-20 17:00, open one millisecond before", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const due = new Date("2026-11-13T16:00:00Z");
      const a = await dueLoop(trx, o, { kind: "promised", due_at: due });
      const at = new Date("2026-11-20T16:01:00Z");
      expect(await chase(trx, o, new Date(due.getTime() + 7 * DAY_MS - 1))).toMatchObject({ expired: 0 });
      // Exactly 7 days after the due date counts (a boundary is inclusive, as for the 14 and 30 days of the stale rule).
      const exact = await dueLoop(trx, o, { kind: "promised", due_at: new Date(NOW.getTime() - 7 * DAY_MS) });
      expect(await chase(trx, o, NOW, { force: true })).toMatchObject({ expired: 1 });
      expect(await statusOf(trx, exact.id)).toEqual(["closed", "expired"]);
      expect(await statusOf(trx, a.id)).toEqual(["open", null]);
      expect(await chase(trx, o, at, { force: true })).toMatchObject({ expired: 1 });
      expect(await statusOf(trx, a.id)).toEqual(["closed", "expired"]);
      const row = await loopOf(trx, a.id);
      expect(row.closed_at?.toISOString()).toBe(at.toISOString());
    });
  });

  test("a promised loop expires in shadow mode too and never goes stale; a waiting loop never expires", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx, { mode: "shadow" });
      const promised = await dueLoop(trx, o, { kind: "promised", due_at: new Date(NOW.getTime() - 40 * DAY_MS) });
      const waiting = await dueLoop(trx, o, { due_at: new Date(NOW.getTime() - 8 * DAY_MS) });
      await chase(trx, o, NOW);
      expect(await statusOf(trx, promised.id)).toEqual(["closed", "expired"]);
      expect(await statusOf(trx, waiting.id)).toEqual(["open", null]);
    });
  });

  test("a closed loop is not closed again and keeps its close reason", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const loop = await dueLoop(trx, o, {
        due_at: new Date(NOW.getTime() - 50 * DAY_MS),
        status: "closed",
        close_reason: "done",
        closed_at: new Date(NOW.getTime() - DAY_MS),
      });
      await chase(trx, o, NOW);
      expect(await statusOf(trx, loop.id)).toEqual(["closed", "done"]);
      expect(await auditOf(trx, o.ctx.orgId, "loop.closed")).toEqual([]);
    });
  });
});

describe("the job and its logs", () => {
  test("loops_chaser_done: one line for the cards, one for stale and one for expired; counts and ids only", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      await delegatedLoop(trx, o);
      await dueLoop(trx, o, { due_at: new Date(NOW.getTime() - 31 * DAY_MS) });
      await dueLoop(trx, o, { kind: "promised", due_at: new Date(NOW.getTime() - 8 * DAY_MS) });
      const logs = captureLogs({ level: "info" });
      try {
        await chase(trx, o, NOW);
      } finally {
        logs.stop();
      }
      const lines = eventLines(logs.lines, "loops_chaser_done");
      expect(lines.map((line) => [line.count, line.kind ?? null])).toEqual([
        [1, null],
        [1, "stale"],
        [1, "expired"],
      ]);
      for (const line of lines) expect(line.mailbox_id).toBe(o.mailboxId);
    });
  });
});

describe("a loop that the planner refuses", () => {
  test("a loop with no safe recipient plans nothing and does not stop the delegation reminders", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      await openDelegation(trx, o, { dueAt: DUE_YESTERDAY });
      // The draft schema refuses the address (a zero-width character): no safe recipient, nothing planned, nothing thrown.
      await delegatedLoop(trx, o, {
        counterpart: "ana\u200b@x.test",
        to_addresses: ["ana\u200b@x.test"],
      });
      const result = await chase(trx, o, NOW);
      expect(result).toMatchObject({ reminders: 1, followUps: 0 });
    });
  });
});

// The gaps that the reviewer proved with mutations.
describe("review gaps", () => {
  test("TG1 two mailboxes in one org: the run of mailbox A touches no loop of mailbox B", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const sibling = await siblingMailbox(trx, o);
      const other = { ...o, mailboxId: sibling.mailboxId };
      const due = await commandLoop(trx, other, { due_at: DUE_YESTERDAY, kind: "promised" });
      const stale = await commandLoop(trx, other, { due_at: new Date(NOW.getTime() - 40 * DAY_MS) });
      const expired = await commandLoop(trx, other, { kind: "promised", due_at: new Date(NOW.getTime() - 8 * DAY_MS) });
      await setAutoFollowUp(trx, o, true);
      const waitingB = await commandLoop(trx, other, { due_at: DUE_YESTERDAY });
      const mine = await delegatedLoop(trx, o);
      expect(await chase(trx, o, NOW)).toMatchObject({ followUps: 1, stale: 0, expired: 0 });
      expect((await actionsOfLoop(trx, mine.id)).length).toBe(2);
      for (const loop of [due, stale, expired, waitingB]) {
        expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
        expect((await loopOf(trx, loop.id)).status).toBe("open");
      }
    });
  });

  test("TG2 exactly one follow-up sent 20 days ago and due 20 days ago: not stale; follow-up number 2 is planned", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const at = new Date(NOW.getTime() - 20 * DAY_MS);
      const loop = await delegatedLoop(trx, o, { follow_ups_sent: 1, last_follow_up_at: at, due_at: at });
      expect(await chase(trx, o, NOW)).toMatchObject({ stale: 0, followUps: 1 });
      expect(await statusOf(trx, loop.id)).toEqual(["open", null]);
      const draft = (await actionsOfLoop(trx, loop.id)).find((row) => row.type === "create_draft");
      expect(payloadOf(draft ?? { payload: null }).n).toBe(2);
    });
  });

  test("TG4 only a JSON true counts for auto_follow_up", async () => {
    const BAD: unknown[] = ["true", 1, "yes", { on: true }, [true], "on", 0, null];
    for (const value of BAD) {
      await withRollback(db, async (trx) => {
        const o = await org(trx);
        await setAutoFollowUpRaw(trx, o, value);
        const loop = await dueLoop(trx, o);
        expect((await chase(trx, o, NOW)).followUps, JSON.stringify(value)).toBe(0);
        expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
      });
    }
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      await setAutoFollowUpRaw(trx, o, true);
      await dueLoop(trx, o);
      expect((await chase(trx, o, NOW)).followUps).toBe(1);
    });
  });

  test("TG6 a loop due exactly now is a follow-up candidate (the due boundary is inclusive)", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const loop = await delegatedLoop(trx, o, { due_at: NOW });
      const later = await delegatedLoop(trx, o, { due_at: new Date(NOW.getTime() + 1) });
      expect((await chase(trx, o, NOW)).followUps).toBe(1);
      expect((await actionsOfLoop(trx, loop.id)).length).toBe(2);
      expect(await actionsOfLoop(trx, later.id)).toEqual([]);
    });
  });

  test("TG6 a suspended organization: the run writes nothing and no marker", async () => {
    await withRollback(db, async (trx) => {
      const o = await org(trx);
      const loop = await delegatedLoop(trx, o);
      await suspendOrg(trx, o.ctx.orgId);
      expect((await chase(trx, o, NOW)).skipped).toBe("suspended");
      expect(await actionsOfLoop(trx, loop.id)).toEqual([]);
      expect(await markers(trx, o.ctx.orgId, "loops.chaser_run")).toEqual([]);
      expect(await markers(trx, o.ctx.orgId, "delegation.chaser_run")).toEqual([]);
    });
  });
});
