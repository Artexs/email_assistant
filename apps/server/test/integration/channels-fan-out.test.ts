// The fan-out of one notice (`queueNotice`) and the push-only recipients (`detectNotices`): who gets a Telegram row, who gets one push
// row per device, and who gets nothing. Every test runs in a transaction that is rolled back.
import { randomBytes, randomUUID } from "node:crypto";
import { format } from "node:util";

import { noticeRenderers, MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { detectNotices, queueMailboxRemovedNotices, queueNotice } from "../../src/modules/channels";
import { planFanOut } from "../../src/modules/channels/notice-fan-out";
import { detectors, mailOnlyDetectors, servesPushOnly } from "../../src/modules/channels/notices";
import { listPushOnlyMembers, pushDedupKey, upsertPushSubscription } from "../../src/modules/channels/push";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { markSynced } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  addMember,
  createOrgWithMailbox,
  insertDraftAndSend,
  insertTriaged,
  isolateChannels,
  linkChat,
  randomChatId,
} from "./fixtures";
import { CURRENT_CONSENT, consentRow, insertFollowUp } from "./follow-up-fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const T = new Date("2026-11-20T10:00:00Z");
const at = (ms: number) => new Date(T.getTime() + ms);
const box = createSecretBox(randomBytes(32).toString("base64"), 1);

let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
let errorLines: string[] = [];
beforeEach(() => {
  errorLines = [];
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(format(...args));
  });
});
afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

interface World {
  ctx: TenantContext;
  orgId: string;
  mailboxId: string;
  owner: string;
}

// One organization with a synced mailbox and one owner. No chat link, no device: each test adds what it needs. `web_push` is on unless
// `flag` is false.
async function world(trx: Transaction<DB>, flag = true): Promise<World> {
  await isolateChannels(trx);
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  await markSynced(trx, ctx, created.mailboxId, at(-5 * MINUTE_MS));
  await trx
    .updateTable("mailboxes")
    .set({ status_changed_at: at(-2 * HOUR_MS) })
    .where("id", "=", created.mailboxId)
    .execute();
  if (flag) await setOrgFeature(trx, ctx, { flag: "web_push", enabled: true, actor: "cli", now: T });
  return { ctx, orgId: created.orgId, mailboxId: created.mailboxId, owner: created.userId };
}

const chat = (trx: Transaction<DB>, w: World, userId: string, linkedAt = at(-2 * HOUR_MS)) =>
  linkChat(trx, w.ctx, userId, randomChatId(), linkedAt);

let counter = 0;
// One device of a user, created at `createdAt`, bound to a session that ends at `sessionEnd`. The session starts at `createdAt` too
// (the fan-out reads the start of the session, so a session made by the real clock would break a fixed test clock).
async function device(
  trx: Transaction<DB>,
  w: World,
  userId: string,
  createdAt: Date,
  sessionEnd = at(DAY_MS)
): Promise<string> {
  counter += 1;
  const { rows } = await sql<{ id: string }>`
    insert into auth_sessions (user_id, token, expires_at, created_at)
    values (${userId}::uuid, ${randomUUID()}, ${sessionEnd}, ${createdAt}) returning id`.execute(trx);
  const sessionId = rows[0]?.id ?? "";
  const added = await upsertPushSubscription(trx, w.ctx, {
    userId,
    sessionId,
    endpoint: `https://fcm.googleapis.com/fcm/send/fan-out-${counter}-${randomUUID()}`,
    p256dh: `p256dh-${counter}`,
    auth: `auth-${counter}`,
    deviceLabel: "Phone",
    box,
    now: createdAt,
  });
  return added?.id ?? "";
}

async function setRoutes(trx: Transaction<DB>, w: World, userId: string, routes: Record<string, string>) {
  await trx
    .updateTable("memberships")
    .set({ notice_routes: JSON.stringify(routes) })
    .where("org_id", "=", w.orgId)
    .where("user_id", "=", userId)
    .execute();
}

async function run(trx: Transaction<DB>): Promise<void> {
  await detectNotices({ db: trx, now: () => T, startedAt: at(-HOUR_MS), testMail: NO_TEST_SENDERS });
}

async function outbox(trx: Transaction<DB>, orgId: string, kind?: string) {
  let query = trx
    .selectFrom("outbox")
    .select(["id", "user_id", "kind", "dedup_key", "channel", "status", "push_subscription_id", "loop_id", "email_id"])
    .where("org_id", "=", orgId)
    .orderBy("dedup_key")
    .orderBy("id");
  if (kind !== undefined) query = query.where("kind", "=", kind);
  return query.execute();
}

const shape = (rows: { dedup_key: string; channel: string }[]) =>
  rows.map((row) => `${row.channel} ${row.dedup_key}`).sort();

async function urgentMail(trx: Transaction<DB>, w: World, triagedAt: Date): Promise<string> {
  return insertTriaged(trx, w.ctx, w.mailboxId, { category: "urgent", createdAt: triagedAt });
}

async function waitingSend(trx: Transaction<DB>, w: World, updatedAt: Date) {
  const pair = await insertDraftAndSend(trx, w.ctx, w.mailboxId, {
    createdAt: at(-30 * MINUTE_MS),
    draftProviderResult: { folder: "Drafts", uid: 1 },
    subject: "Quarterly offer",
    from: "boss@example.test",
    bodyText: "Body",
    delegateName: "Anna Nowak",
    task: "Prepare the offer",
  });
  await trx.updateTable("actions").set({ updated_at: updatedAt }).where("id", "=", pair.sendId).execute();
  return pair;
}

async function digestOf(trx: Transaction<DB>, w: World, slot: string): Promise<string> {
  const digest = await trx
    .insertInto("digests")
    .values({ org_id: w.orgId, user_id: w.owner, slot_key: slot, period_start: at(-24 * HOUR_MS), period_end: T })
    .returning("id")
    .executeTakeFirstOrThrow();
  return digest.id;
}

const authErrorView = () => ({
  address: "box@example.test",
  mailboxId: randomUUID(),
  since: at(-HOUR_MS),
  now: T,
  timeZone: "Europe/Warsaw",
});

describe("queueNotice fans out by the route of the member", () => {
  test("1. chat and one device, flag on, urgent: a Telegram row and a push row of that device", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      const emailId = await urgentMail(trx, w, at(-10 * MINUTE_MS));
      await run(trx);
      const rows = await outbox(trx, w.orgId, "urgent");
      expect(shape(rows)).toEqual([`telegram urgent:${emailId}`, `push urgent:${emailId}:push:${sub}`].sort());
      const push = rows.find((row) => row.channel === "push");
      expect(push?.push_subscription_id).toBe(sub);
      expect(push?.email_id).toBe(emailId);
      expect(rows.find((row) => row.channel === "telegram")?.push_subscription_id).toBeNull();
    });
  });

  test("2. the same with the flag off: one Telegram row and no push row", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, false);
      await chat(trx, w, w.owner);
      await device(trx, w, w.owner, at(-HOUR_MS));
      const emailId = await urgentMail(trx, w, at(-10 * MINUTE_MS));
      await run(trx);
      expect(shape(await outbox(trx, w.orgId, "urgent"))).toEqual([`telegram urgent:${emailId}`]);
    });
  });

  test("3. two devices, approval: one Telegram row and two push rows; a second run adds none", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      const first = await device(trx, w, w.owner, at(-HOUR_MS));
      const second = await device(trx, w, w.owner, at(-50 * MINUTE_MS));
      const send = await waitingSend(trx, w, at(-20 * MINUTE_MS));
      await run(trx);
      const key = `approval:${send.sendId}`;
      const expected = [
        `telegram ${key}`,
        `push ${pushDedupKey(key, first)}`,
        `push ${pushDedupKey(key, second)}`,
      ].sort();
      expect(shape(await outbox(trx, w.orgId, "approval"))).toEqual(expected);
      await run(trx);
      expect(await outbox(trx, w.orgId, "approval")).toHaveLength(3);
    });
  });

  test("4. an updates kind follows the stored route: none stored gives Telegram only, `both` adds push", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      const call = (key: string) =>
        queueNotice(trx, w.ctx, {
          userId: w.owner,
          locale: "en",
          kind: "auth_error",
          view: authErrorView(),
          dedupKey: key,
          mailboxId: w.mailboxId,
          eventAt: at(-10 * MINUTE_MS),
          now: T,
        });
      expect(await call("route:none")).toBeString();
      await setRoutes(trx, w, w.owner, { updates: "both" });
      expect(await call("route:both")).toBeString();
      const rows = await outbox(trx, w.orgId, "auth_error");
      expect(shape(rows)).toEqual(
        ["telegram route:none", "telegram route:both", `push ${pushDedupKey("route:both", sub)}`].sort()
      );
    });
  });

  test("4b. the stored route picks the channel: push only drops Telegram, telegram only drops push", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      const call = (key: string) =>
        queueNotice(trx, w.ctx, {
          userId: w.owner,
          locale: "en",
          kind: "auth_error",
          view: authErrorView(),
          dedupKey: key,
          mailboxId: w.mailboxId,
          eventAt: at(-10 * MINUTE_MS),
          now: T,
        });
      await setRoutes(trx, w, w.owner, { updates: "push" });
      await call("only-push");
      await setRoutes(trx, w, w.owner, { updates: "telegram" });
      await call("only-telegram");
      expect(shape(await outbox(trx, w.orgId, "auth_error"))).toEqual(
        [`push ${pushDedupKey("only-push", sub)}`, "telegram only-telegram"].sort()
      );
    });
  });

  test("4c. a member with neither a chat nor a device keeps the Telegram row of before", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const id = await queueNotice(trx, w.ctx, {
        userId: w.owner,
        locale: "en",
        kind: "auth_error",
        view: authErrorView(),
        dedupKey: "neither",
        mailboxId: w.mailboxId,
        eventAt: at(-10 * MINUTE_MS),
        now: T,
      });
      expect(id).toBeString();
      expect(shape(await outbox(trx, w.orgId))).toEqual(["telegram neither"]);
    });
  });

  test("5. a digest with a device gets no push row", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      await device(trx, w, w.owner, at(-HOUR_MS));
      const id = await queueNotice(trx, w.ctx, {
        userId: w.owner,
        locale: "en",
        kind: "digest",
        view: { text: "x", buttons: [[{ text: "OK", data: "ok" }]] },
        dedupKey: "digest:1",
        digestId: await digestOf(trx, w, "2026-11-20T08:00"),
        now: T,
      });
      expect(id).toBeString();
      expect(shape(await outbox(trx, w.orgId))).toEqual(["telegram digest:1"]);
    });
  });

  test("6. a device whose session expired gets no push row", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      await device(trx, w, w.owner, at(-HOUR_MS), at(-MINUTE_MS));
      const emailId = await urgentMail(trx, w, at(-10 * MINUTE_MS));
      await run(trx);
      expect(shape(await outbox(trx, w.orgId, "urgent"))).toEqual([`telegram urgent:${emailId}`]);
    });
  });

  test("7. a device that is newer than the event gets no push row (no burst of old mail)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      const old = await urgentMail(trx, w, at(-2 * HOUR_MS + 30 * MINUTE_MS)); // 08:30, before the device
      await run(trx);
      const sub = await device(trx, w, w.owner, at(-MINUTE_MS)); // 09:59
      const later = new Date(at(0).getTime() + MINUTE_MS);
      await detectNotices({ db: trx, now: () => later, startedAt: at(-HOUR_MS), testMail: NO_TEST_SENDERS });
      expect(shape(await outbox(trx, w.orgId, "urgent"))).toEqual([`telegram urgent:${old}`]);
      // A mail triaged after the device was added: one push row.
      const fresh = await urgentMail(trx, w, at(-MINUTE_MS + 30_000));
      await detectNotices({ db: trx, now: () => later, startedAt: at(-HOUR_MS), testMail: NO_TEST_SENDERS });
      expect(shape(await outbox(trx, w.orgId, "urgent"))).toEqual(
        [`telegram urgent:${old}`, `telegram urgent:${fresh}`, `push urgent:${fresh}:push:${sub}`].sort()
      );
    });
  });

  test("6b. a member with no chat and only a dead device keeps the Telegram row of before (the route counts live devices only)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await device(trx, w, w.owner, at(-HOUR_MS), at(-MINUTE_MS));
      const plan = await planFanOut(trx, w.ctx, {
        userId: w.owner,
        kind: "urgent",
        eventAt: at(-10 * MINUTE_MS),
        now: T,
      });
      expect(plan).toEqual({ telegram: true, deviceIds: [] });
    });
  });

  test("7b. a device that was bound again to a new session gets no push row for the mail of the time its session was dead", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner, at(-6 * HOUR_MS));
      // The device was made 5 h ago; its session ended 3 h ago; a new session began 1 h ago and the device was bound to it.
      const sub = await device(trx, w, w.owner, at(-5 * HOUR_MS), at(-3 * HOUR_MS));
      const { rows } = await sql<{ id: string }>`
        insert into auth_sessions (user_id, token, expires_at, created_at)
        values (${w.owner}::uuid, ${randomUUID()}, ${at(DAY_MS)}, ${at(-HOUR_MS)}) returning id`.execute(trx);
      await sql`update push_subscriptions set session_id = ${rows[0]?.id ?? ""}::uuid where id = ${sub}::uuid`.execute(
        trx
      );
      const dead = await urgentMail(trx, w, at(-2 * HOUR_MS));
      const fresh = await urgentMail(trx, w, at(-30 * MINUTE_MS));
      await run(trx);
      expect(shape(await outbox(trx, w.orgId, "urgent"))).toEqual(
        [`telegram urgent:${dead}`, `telegram urgent:${fresh}`, `push urgent:${fresh}:push:${sub}`].sort()
      );
    });
  });

  test("8. `eventAt` is required for a push kind: urgent throws, a digest does not", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      const emailId = await urgentMail(trx, w, at(-10 * MINUTE_MS));
      const urgent = queueNotice(trx, w.ctx, {
        userId: w.owner,
        locale: "en",
        kind: "urgent",
        view: {
          emailId,
          from: "sender@example.test",
          subject: "x",
          ai: { reasonCode: "llm", reason: null },
          receivedAt: T,
          synthetic: false,
          folderTag: null,
          actions: [],
          delegateNames: {},
          stayFolder: "INBOX",
          now: T,
          timeZone: "Europe/Warsaw",
        },
        dedupKey: `urgent:${emailId}`,
        emailId,
        now: T,
      });
      await expect(urgent).rejects.toThrow("needs eventAt");
      expect(await outbox(trx, w.orgId)).toHaveLength(0);
      const digest = await queueNotice(trx, w.ctx, {
        userId: w.owner,
        locale: "en",
        kind: "digest",
        view: { text: "x", buttons: [[{ text: "OK", data: "ok" }]] },
        dedupKey: "digest:2",
        digestId: await digestOf(trx, w, "2026-11-20T09:00"),
        now: T,
      });
      expect(digest).toBeString();
    });
  });

  test("8b. a view that has a Telegram text but no push payload writes no row at all (the push check of queueNotice)", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      await device(trx, w, w.owner, at(-HOUR_MS));
      const urgent = noticeRenderers.urgent;
      const original = urgent.push;
      // A push render that fails: the Telegram check passes, so only the push check can stop the write.
      urgent.push = {
        full: () => {
          throw new Error("no push payload");
        },
      };
      try {
        const emailId = await urgentMail(trx, w, at(-10 * MINUTE_MS));
        await expect(
          queueNotice(trx, w.ctx, {
            userId: w.owner,
            locale: "en",
            kind: "urgent",
            view: {
              emailId,
              from: "boss@example.test",
              subject: "Contract",
              ai: { reasonCode: "llm", reason: null },
              receivedAt: at(-20 * MINUTE_MS),
              synthetic: false,
              folderTag: null,
              actions: [],
              delegateNames: {},
              stayFolder: "INBOX",
              now: T,
              timeZone: "Europe/Warsaw",
            },
            dedupKey: `urgent:${emailId}`,
            emailId,
            mailboxId: w.mailboxId,
            eventAt: at(-5 * MINUTE_MS),
            now: T,
          })
        ).rejects.toThrow("urgent");
        expect(await outbox(trx, w.orgId, "urgent")).toEqual([]);
      } finally {
        urgent.push = original;
      }
    });
  });

  test("9. `only` limits the rows: a Telegram answer needs no `eventAt`, push only needs a device", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      await setRoutes(trx, w, w.owner, { updates: "both" });
      const input = (key: string, only: "telegram" | "push") => ({
        userId: w.owner,
        locale: "en" as const,
        kind: "auth_error" as const,
        view: authErrorView(),
        dedupKey: key,
        mailboxId: w.mailboxId,
        only,
        now: T,
      });
      expect(await queueNotice(trx, w.ctx, input("t", "telegram"))).toBeString();
      await expect(queueNotice(trx, w.ctx, input("p0", "push"))).rejects.toThrow("needs eventAt");
      expect(await queueNotice(trx, w.ctx, { ...input("p", "push"), eventAt: at(-MINUTE_MS) })).toBeString();
      expect(shape(await outbox(trx, w.orgId))).toEqual(["telegram t", `push ${pushDedupKey("p", sub)}`].sort());
    });
  });
});

describe("push-only recipients", () => {
  test("1. an organization with one owner, a device and no chat: an urgent mail gives one push row and no Telegram row", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      const emailId = await urgentMail(trx, w, at(-10 * MINUTE_MS));
      await run(trx);
      expect(shape(await outbox(trx, w.orgId))).toEqual([`push urgent:${emailId}:push:${sub}`]);
    });
  });

  test("2. an urgent mail triaged before the device was added gives no row", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await device(trx, w, w.owner, at(-HOUR_MS));
      await urgentMail(trx, w, at(-2 * HOUR_MS));
      await run(trx);
      expect(await outbox(trx, w.orgId)).toHaveLength(0);
    });
  });

  test("3. a waiting approval gives one push row; the approval is marked notified in the same run", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      const send = await waitingSend(trx, w, at(-20 * MINUTE_MS));
      await run(trx);
      expect(shape(await outbox(trx, w.orgId, "approval"))).toEqual([
        `push ${pushDedupKey(`approval:${send.sendId}`, sub)}`,
      ]);
      const state = await trx
        .selectFrom("actions")
        .select("notified_at")
        .where("id", "=", send.sendId)
        .executeTakeFirstOrThrow();
      expect(state.notified_at).toEqual(T);
    });
  });

  test("4. the flag off: no row, and the approval stays unmarked", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, false);
      await device(trx, w, w.owner, at(-HOUR_MS));
      await urgentMail(trx, w, at(-10 * MINUTE_MS));
      const send = await waitingSend(trx, w, at(-20 * MINUTE_MS));
      await run(trx);
      expect(await outbox(trx, w.orgId)).toHaveLength(0);
      const state = await trx
        .selectFrom("actions")
        .select("notified_at")
        .where("id", "=", send.sendId)
        .executeTakeFirstOrThrow();
      expect(state.notified_at).toBeNull();
    });
  });

  test("5. a Telegram-only member of the same organization gets Telegram rows only, and a push-only member gets push rows only", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const telegramOnly = await addMember(trx, w.orgId, "owner");
      await chat(trx, w, telegramOnly);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      const emailId = await urgentMail(trx, w, at(-10 * MINUTE_MS));
      await run(trx);
      const rows = await outbox(trx, w.orgId, "urgent");
      expect(rows.filter((row) => row.user_id === telegramOnly).map((row) => row.channel)).toEqual(["telegram"]);
      expect(rows.filter((row) => row.user_id === w.owner).map((row) => row.channel)).toEqual(["push"]);
      expect(rows.find((row) => row.user_id === w.owner)?.dedup_key).toBe(`urgent:${emailId}:push:${sub}`);
    });
  });

  test("5b. a push-only member takes part only in the detectors of push kinds", () => {
    const names = (list: readonly { name: string }[]) => list.map((detector) => detector.name).sort();
    expect(names(detectors.filter((detector) => !servesPushOnly(detector)))).toEqual(
      ["follow-up-closed", "reply_results", "weekly_report"].sort()
    );
    expect(names(mailOnlyDetectors)).toEqual(["weekly_report"]);
  });

  test("6. a push-only owner with no consent row and a follow-up approval gets a push row of kind approval, and the approval is marked", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      const follow = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        send: { updated_at: at(-20 * MINUTE_MS) },
      });
      await run(trx);
      const rows = await outbox(trx, w.orgId);
      expect(shape(rows)).toEqual([`push approval:${follow.sendId}:push:${sub}`]);
      expect(rows[0]?.kind).toBe("approval");
      expect(rows[0]?.loop_id).toBe(follow.loopId);
      const state = await trx
        .selectFrom("actions")
        .select("notified_at")
        .where("id", "=", follow.sendId)
        .executeTakeFirstOrThrow();
      expect(state.notified_at).toEqual(T);
    });
  });

  test("7. an owner with a chat, no covering consent and one device, a follow-up approval: a Telegram loop_consent line and an approval push row", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      const follow = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        send: { updated_at: at(-20 * MINUTE_MS) },
      });
      await run(trx);
      const rows = await outbox(trx, w.orgId);
      expect(shape(rows)).toEqual(
        [`telegram loop_consent:approval:2026-11-20`, `push approval:${follow.sendId}:push:${sub}`].sort()
      );
      expect(rows.find((row) => row.channel === "telegram")?.kind).toBe("loop_consent");
      expect(rows.find((row) => row.channel === "push")?.kind).toBe("approval");
    });
  });

  test("7b. a covered owner with a chat and a device gets the follow-up approval on both channels", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      await consentRow(trx, w.orgId, w.owner, CURRENT_CONSENT, at(-HOUR_MS));
      const follow = await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, {
        send: { updated_at: at(-20 * MINUTE_MS) },
      });
      await run(trx);
      expect(shape(await outbox(trx, w.orgId))).toEqual(
        [`telegram approval:${follow.sendId}`, `push approval:${follow.sendId}:push:${sub}`].sort()
      );
    });
  });

  test("7c. the result of a follow-up reaches a push-only owner by push and a withheld owner with a chat by line and push", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const pushOnly = w.owner;
      const withChat = await addMember(trx, w.orgId, "owner");
      await chat(trx, w, withChat);
      const subA = await device(trx, w, pushOnly, at(-HOUR_MS));
      const subB = await device(trx, w, withChat, at(-HOUR_MS));
      // The default route of an updates kind is Telegram: this owner picked both.
      await setRoutes(trx, w, withChat, { updates: "both" });
      const follow = await insertFollowUp(trx, w.ctx, w.mailboxId, pushOnly, {
        sendStatus: "applied",
        send: {
          updated_at: at(-20 * MINUTE_MS),
          applied_at: at(-20 * MINUTE_MS),
          provider_result: '{"sent_copy":"appended"}',
        },
      });
      await run(trx);
      const key = `send_result:${follow.sendId}`;
      expect(shape(await outbox(trx, w.orgId))).toEqual(
        [
          `push ${pushDedupKey(key, subA)}`,
          `push ${pushDedupKey(key, subB)}`,
          "telegram loop_consent:result:2026-11-20",
        ].sort()
      );
      const state = await trx
        .selectFrom("actions")
        .select("result_notified_at")
        .where("id", "=", follow.sendId)
        .executeTakeFirstOrThrow();
      expect(state.result_notified_at).toEqual(T);
    });
  });

  test("8. a withheld owner with a chat and no device gets only the loop_consent line, as before", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await chat(trx, w, w.owner);
      await insertFollowUp(trx, w.ctx, w.mailboxId, w.owner, { send: { updated_at: at(-20 * MINUTE_MS) } });
      await run(trx);
      expect((await outbox(trx, w.orgId)).map((row) => `${row.channel} ${row.kind}`)).toEqual([
        "telegram loop_consent",
      ]);
    });
  });

  test("9. a removed mailbox reaches a push-only owner by push", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const sub = await device(trx, w, w.owner, at(-HOUR_MS));
      const mailboxId = randomUUID();
      expect(await queueMailboxRemovedNotices(trx, w.ctx, { mailboxId, now: T })).toBe(1);
      expect(shape(await outbox(trx, w.orgId))).toEqual([`push ${pushDedupKey(`mailbox_removed:${mailboxId}`, sub)}`]);
    });
  });

  test("10. a suspended organization is not visited", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await device(trx, w, w.owner, at(-HOUR_MS));
      await urgentMail(trx, w, at(-10 * MINUTE_MS));
      await trx.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", w.orgId).execute();
      await run(trx);
      expect(await outbox(trx, w.orgId)).toHaveLength(0);
    });
  });

  test("11. the list of push-only members: no member with a chat, none with an expired session; `since` is the oldest live device", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const withChat = await addMember(trx, w.orgId, "owner");
      await chat(trx, w, withChat);
      await device(trx, w, withChat, at(-HOUR_MS));
      const expired = await addMember(trx, w.orgId, "owner");
      await device(trx, w, expired, at(-HOUR_MS), at(-MINUTE_MS));
      await device(trx, w, w.owner, at(-30 * MINUTE_MS));
      await device(trx, w, w.owner, at(-3 * HOUR_MS));
      const found = (await listPushOnlyMembers(trx, { now: T, orgId: w.orgId })).map((member) => ({
        userId: member.userId,
        since: member.since,
        role: member.role,
      }));
      expect(found).toEqual([{ userId: w.owner, since: at(-3 * HOUR_MS), role: "owner" }]);
    });
  });

  test("no push row logs a failure", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      await device(trx, w, w.owner, at(-HOUR_MS));
      await urgentMail(trx, w, at(-10 * MINUTE_MS));
      await run(trx);
      expect(errorLines).toEqual([]);
    });
  });
});
