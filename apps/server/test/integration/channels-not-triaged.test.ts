import { format } from "node:util";

import { MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { detectNotices, type NoticeDeps } from "../../src/modules/channels";
import { listNotTriagedEmailIds } from "../../src/modules/channels/repo";
import { insertSenderRule } from "../../src/modules/config";
import { listWaitingFromSenders, listWaitingSenders, NO_TEST_SENDERS } from "../../src/modules/mail";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createLlmPause, type LlmPause } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  addMember,
  createOrgWithMailbox,
  insertTestEmail,
  isolateChannels,
  linkChat,
  randomChatId,
  renderedOf,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// 2027-01-15 10:00 in Europe/Warsaw (UTC+1).
const NOW = new Date("2027-01-15T09:00:00Z");
const SECRET_SUBJECT = "Secret subject 4711";
const CEO = "ceo@corp.test";

let lines: string[] = [];
let spies: ReturnType<typeof spyOn>[] = [];

beforeEach(() => {
  lines = [];
  const capture = (...args: unknown[]) => {
    lines.push(format(...args));
  };
  spies = [
    spyOn(console, "log").mockImplementation(capture),
    spyOn(console, "warn").mockImplementation(capture),
    spyOn(console, "error").mockImplementation(capture),
  ];
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

type Degraded = NonNullable<NoticeDeps["degraded"]>;
const allMail: Degraded["scope"] = { kind: "all" };

// A real pause that tripped once, `agoMs` before `at` (the first trip lasts 5 minutes).
function trippedPause(at: Date, agoMs: number): LlmPause {
  const pause = createLlmPause();
  pause.trip("soft", "http_429", new Date(at.getTime() - agoMs));
  return pause;
}

// A fixed answer, for a tick far from the trip.
const stillPaused = (since: Date): Degraded["pause"] => ({ isPaused: () => true, pausedSince: () => since });

async function tick(
  trx: Transaction<DB>,
  now: Date,
  degraded: Degraded | undefined,
  testMail = NO_TEST_SENDERS
): Promise<void> {
  await detectNotices({
    db: trx,
    now: () => now,
    startedAt: new Date(now.getTime() - DAY_MS),
    testMail,
    ...(degraded === undefined ? {} : { degraded }),
  });
}

async function notTriagedRows(trx: Transaction<DB>, orgId: string) {
  const rows = await trx
    .selectFrom("outbox")
    .select([
      "user_id",
      "kind",
      "dedup_key",
      "text",
      "buttons",
      "view",
      "locale",
      "channel",
      "detail",
      "email_id",
      "mailbox_id",
    ])
    .where("org_id", "=", orgId)
    .where("kind", "=", "not_triaged")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ ...row, ...renderedOf(row) }));
}

interface Org {
  ctx: TenantContext;
  orgId: string;
  ownerId: string;
  assistantId: string;
  mailboxId: string;
}

// An owner and an assistant, both linked; the mailbox is active.
async function org(trx: Transaction<DB>, flag = true): Promise<Org> {
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  const assistantId = await addMember(trx, created.orgId);
  await linkChat(trx, ctx, created.userId, randomChatId(), new Date(NOW.getTime() - 2 * DAY_MS));
  await linkChat(trx, ctx, assistantId, randomChatId(), new Date(NOW.getTime() - 2 * DAY_MS));
  if (flag) await setOrgFeature(trx, ctx, { flag: "degraded_notice", enabled: true, actor: "cli", now: NOW });
  return { ctx, orgId: created.orgId, ownerId: created.userId, assistantId, mailboxId: created.mailboxId };
}

async function vip(trx: Transaction<DB>, o: Org, pattern = CEO, kind: "vip" | "whitelist" = "vip") {
  await insertSenderRule(trx, o.ctx, { mailboxId: null, pattern, kind });
}

async function pending(
  trx: Transaction<DB>,
  o: Org,
  opts: { from?: string; receivedAt?: Date; status?: string; messageId?: string } = {}
): Promise<string> {
  return insertTestEmail(trx, o.ctx, o.mailboxId, {
    from_address: opts.from ?? CEO,
    subject: SECRET_SUBJECT,
    received_at: opts.receivedAt ?? new Date(NOW.getTime() - HOUR_MS),
    status: opts.status ?? "pending",
    ...(opts.messageId === undefined ? {} : { message_id_header: opts.messageId }),
  });
}

describe("not_triaged detector (F109 stage 15)", () => {
  test("(1) a pending VIP mail: one row per member; the text has the address and no subject", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await vip(trx, o);
      const emailId = await pending(trx, o);
      await tick(trx, NOW, { pause: trippedPause(NOW, 3 * MINUTE_MS), scope: allMail });
      const rows = await notTriagedRows(trx, o.orgId);
      expect(rows.map((row) => row.user_id).sort()).toEqual([o.ownerId, o.assistantId].sort());
      for (const row of rows) {
        expect(row.dedup_key).toBe(`not_triaged:${emailId}`);
        expect(row.email_id).toBe(emailId);
        expect(row.mailbox_id).toBe(o.mailboxId);
        expect(row.view).toEqual({ emailId, mailboxId: o.mailboxId, sender: CEO });
        expect(row.text).toBe(
          `📭 Mail from ${CEO} is not triaged yet: the AI service is paused. It is triaged when the service is back.`
        );
        expect(row.text).not.toContain(SECRET_SUBJECT);
        expect(row.buttons).toEqual([]);
      }
      // The log holds a count and no mail data.
      expect(lines.some((line) => line.includes("not_triaged_run") && line.includes("count"))).toBe(true);
      for (const line of lines) {
        expect(line).not.toContain(CEO);
        expect(line).not.toContain(SECRET_SUBJECT);
      }
    });
  });

  test("(2) a second tick adds no row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await vip(trx, o);
      await pending(trx, o);
      const degraded = { pause: trippedPause(NOW, 3 * MINUTE_MS), scope: allMail };
      await tick(trx, NOW, degraded);
      await tick(trx, new Date(NOW.getTime() + 15_000), degraded);
      expect(await notTriagedRows(trx, o.orgId)).toHaveLength(2);
    });
  });

  test("(3) a pending mail from an unknown sender or a blocklisted sender gets no row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await vip(trx, o);
      await pending(trx, o, { from: "stranger@elsewhere.test" });
      await insertSenderRule(trx, o.ctx, { mailboxId: null, pattern: "spam.test", kind: "blocklist" });
      await pending(trx, o, { from: "x@spam.test" });
      await tick(trx, NOW, { pause: trippedPause(NOW, 3 * MINUTE_MS), scope: allMail });
      expect(await notTriagedRows(trx, o.orgId)).toHaveLength(0);
    });
  });

  test("TG1: a VIP sender with one pending and one triaged mail: only the pending mail gets a notice", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await vip(trx, o);
      const waiting = await pending(trx, o);
      await pending(trx, o, { status: "triaged" });
      await tick(trx, NOW, { pause: trippedPause(NOW, 3 * MINUTE_MS), scope: allMail });
      const rows = await notTriagedRows(trx, o.orgId);
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.email_id))).toEqual(new Set([waiting]));
    });
  });

  test("TG2: a sender on a whitelist and a blocklist rule gets a notice (the whitelist wins)", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await vip(trx, o, CEO, "whitelist");
      await insertSenderRule(trx, o.ctx, { mailboxId: null, pattern: "corp.test", kind: "blocklist" });
      await pending(trx, o);
      await tick(trx, NOW, { pause: trippedPause(NOW, 3 * MINUTE_MS), scope: allMail });
      expect(await notTriagedRows(trx, o.orgId)).toHaveLength(2);
    });
  });

  test("(4) no pause: no row; two trips (5 then 10 min) 14 min ago: still paused, since = the first trip", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await vip(trx, o);
      await pending(trx, o);
      await tick(trx, NOW, { pause: createLlmPause(), scope: allMail });
      expect(await notTriagedRows(trx, o.orgId)).toHaveLength(0);

      const pause = createLlmPause();
      pause.trip("soft", "http_429", new Date(NOW.getTime() - 14 * MINUTE_MS));
      // The first pause ended 9 min ago; the second trip came when it ended and lasts 10 min.
      pause.trip("soft", "http_429", new Date(NOW.getTime() - 9 * MINUTE_MS));
      expect(pause.isPaused(NOW)).toBe(true);
      expect(pause.pausedSince()).toEqual(new Date(NOW.getTime() - 14 * MINUTE_MS));
      await tick(trx, NOW, { pause, scope: allMail });
      expect(await notTriagedRows(trx, o.orgId)).toHaveLength(2);
    });
  });

  test("(4b) a pause that ended (no reset yet) gives no row; no degraded deps gives no row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await vip(trx, o);
      await pending(trx, o);
      await tick(trx, NOW, { pause: trippedPause(NOW, 20 * MINUTE_MS), scope: allMail });
      await tick(trx, NOW, undefined);
      expect(await notTriagedRows(trx, o.orgId)).toHaveLength(0);
    });
  });

  test("(5) flag off: no row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx, false);
      await vip(trx, o);
      await pending(trx, o);
      await tick(trx, NOW, { pause: trippedPause(NOW, 3 * MINUTE_MS), scope: allMail });
      expect(await notTriagedRows(trx, o.orgId)).toHaveLength(0);
    });
  });

  test("(6) 23:00 local: no row; 07:00 next day with the pause still active: the row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await vip(trx, o);
      await pending(trx, o, { receivedAt: new Date("2027-01-15T08:00:00Z") });
      const since = new Date("2027-01-15T21:57:00Z");
      await tick(trx, new Date("2027-01-15T22:00:00Z"), { pause: stillPaused(since), scope: allMail });
      expect(await notTriagedRows(trx, o.orgId)).toHaveLength(0);
      await tick(trx, new Date("2027-01-16T06:00:00Z"), { pause: stillPaused(since), scope: allMail });
      expect(await notTriagedRows(trx, o.orgId)).toHaveLength(2);
    });
  });

  test("(7) seven pending whitelisted mails in one mailbox: 5 mails, 5 rows per member, the oldest first", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await vip(trx, o, "corp.test", "whitelist");
      const ids: string[] = [];
      for (let index = 0; index < 7; index += 1) {
        ids.push(
          await pending(trx, o, {
            from: `p${index}@corp.test`,
            receivedAt: new Date(NOW.getTime() - (10 - index) * MINUTE_MS),
          })
        );
      }
      const degraded = { pause: trippedPause(NOW, 3 * MINUTE_MS), scope: allMail };
      await tick(trx, NOW, degraded);
      await tick(trx, new Date(NOW.getTime() + 15_000), degraded);
      const rows = await notTriagedRows(trx, o.orgId);
      expect(rows).toHaveLength(10);
      for (const userId of [o.ownerId, o.assistantId]) {
        expect(
          rows
            .filter((row) => row.user_id === userId)
            .map((row) => row.email_id)
            .sort()
        ).toEqual(ids.slice(0, 5).sort());
      }
    });
  });

  test("(7b) the cap counts since the start of the pause: rows of an earlier run do not count", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await vip(trx, o, "corp.test", "whitelist");
      const earlier: string[] = [];
      for (let index = 0; index < 5; index += 1) earlier.push(await pending(trx, o, { from: `x${index}@corp.test` }));
      await tick(trx, NOW, { pause: trippedPause(NOW, 3 * MINUTE_MS), scope: allMail });
      expect(await notTriagedRows(trx, o.orgId)).toHaveLength(10);
      // The earlier run is over: its mails are triaged and its rows are 3 h old.
      await trx.updateTable("emails").set({ status: "triaged" }).where("org_id", "=", o.orgId).execute();
      await trx
        .updateTable("outbox")
        .set({ created_at: new Date(NOW.getTime() - 3 * HOUR_MS) })
        .where("org_id", "=", o.orgId)
        .execute();

      const later: string[] = [];
      for (let index = 0; index < 5; index += 1) later.push(await pending(trx, o, { from: `y${index}@corp.test` }));
      await tick(trx, NOW, { pause: trippedPause(NOW, MINUTE_MS), scope: allMail });
      const rows = await notTriagedRows(trx, o.orgId);
      const owner = rows.filter((row) => row.user_id === o.ownerId).map((row) => row.email_id);
      expect(owner.sort()).toEqual([...earlier, ...later].sort());
    });
  });

  test("(8) the pause is global: org A and org B both get rows, each only for its own members", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      await vip(trx, a);
      await vip(trx, b);
      const mailA = await pending(trx, a);
      const mailB = await pending(trx, b);
      await tick(trx, NOW, { pause: trippedPause(NOW, 3 * MINUTE_MS), scope: allMail });
      const rowsA = await notTriagedRows(trx, a.orgId);
      const rowsB = await notTriagedRows(trx, b.orgId);
      expect(rowsA.map((row) => [row.user_id, row.email_id]).sort()).toEqual(
        [
          [a.ownerId, mailA],
          [a.assistantId, mailA],
        ].sort()
      );
      expect(rowsB.map((row) => [row.user_id, row.email_id]).sort()).toEqual(
        [
          [b.ownerId, mailB],
          [b.assistantId, mailB],
        ].sort()
      );
    });
  });

  test("(8b) the rules of org A do not match mail of org B; a flag of org A does not turn B on", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx, false);
      await vip(trx, a);
      await pending(trx, b);
      await pending(trx, a);
      await tick(trx, NOW, { pause: trippedPause(NOW, 3 * MINUTE_MS), scope: allMail });
      expect(await notTriagedRows(trx, b.orgId)).toHaveLength(0);
      expect(await notTriagedRows(trx, a.orgId)).toHaveLength(2);
    });
  });

  test("scope synthetic: only test mail gets a row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await vip(trx, o);
      await pending(trx, o);
      const synthetic = await pending(trx, o, { messageId: "<seed-1@ea-seed.test>" });
      const syntheticScope: Degraded["scope"] = { kind: "synthetic", testMail: NO_TEST_SENDERS };
      await tick(trx, NOW, { pause: trippedPause(NOW, 3 * MINUTE_MS), scope: syntheticScope });
      const rows = await notTriagedRows(trx, o.orgId);
      expect(new Set(rows.map((row) => row.email_id))).toEqual(new Set([synthetic]));
    });
  });

  test("a triaged mail, an old mail and a mail of a paused mailbox get no row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await vip(trx, o);
      await pending(trx, o, { status: "triaged" });
      await pending(trx, o, { receivedAt: new Date(NOW.getTime() - 25 * HOUR_MS) });
      await tick(trx, NOW, { pause: trippedPause(NOW, 3 * MINUTE_MS), scope: allMail });
      expect(await notTriagedRows(trx, o.orgId)).toHaveLength(0);
      await pending(trx, o);
      await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", o.mailboxId).execute();
      await tick(trx, NOW, { pause: trippedPause(NOW, 3 * MINUTE_MS), scope: allMail });
      expect(await notTriagedRows(trx, o.orgId)).toHaveLength(0);
    });
  });
});

describe("not_triaged readers: a second organization is never read", () => {
  test("listWaitingSenders, listWaitingFromSenders and listNotTriagedEmailIds read with the org of the context", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      await vip(trx, a);
      const mailA = await pending(trx, a);
      const query = { receivedSince: new Date(NOW.getTime() - DAY_MS), syntheticOnly: false } as const;
      expect(await listWaitingSenders(trx, a.ctx, a.mailboxId, query)).toEqual([CEO]);
      // The mailbox of A under the context of B: nothing.
      expect(await listWaitingSenders(trx, b.ctx, a.mailboxId, query)).toEqual([]);
      expect(await listWaitingFromSenders(trx, a.ctx, a.mailboxId, [CEO], query)).toHaveLength(1);
      expect(await listWaitingFromSenders(trx, b.ctx, a.mailboxId, [CEO], query)).toEqual([]);

      await tick(trx, NOW, { pause: trippedPause(NOW, 3 * MINUTE_MS), scope: allMail });
      const since = new Date(NOW.getTime() - HOUR_MS);
      expect(await listNotTriagedEmailIds(trx, a.ctx, a.mailboxId, since)).toEqual(new Set([mailA]));
      expect(await listNotTriagedEmailIds(trx, b.ctx, a.mailboxId, since)).toEqual(new Set());
    });
  });
});
