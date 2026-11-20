// The push sender (`channels/push-sender.ts`): the outbox rows of the channel `push` go out as Web Push messages to a fake push
// service (a function: no request leaves the process). Every test runs in a transaction that is rolled back, with a fixed clock.
import { randomBytes, randomUUID } from "node:crypto";

import { encodeNoticeView, type NoticeKind, type NoticeView, DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { createPushSender, PUSH_FLAG_WAIT_MS, pushTopicOf } from "../../src/modules/channels";
import { listLiveDeviceIds, upsertPushSubscription } from "../../src/modules/channels/push";
import { insertOutbox } from "../../src/modules/channels/repo";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createSecretBox, type SecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";
import { generateVapidKeyPair } from "../../src/platform/vapid-keys";
import { captureLogs, eventLines, logProblems } from "../log-capture";
import { decryptPushBody, newReceiver } from "../push-decrypt";

import { addMember, createOrgWithMailbox, insertTriaged, isolateChannels, testNoticeView } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

// 11:00 in Warsaw (winter time): outside the default quiet hours 22:00–07:00.
const NOON = new Date("2026-11-20T10:00:00Z");
const box = createSecretBox(randomBytes(32).toString("base64"), 1);
const vapid = { ...generateVapidKeyPair(), subject: "mailto:owner@example.org" };

const CANARY_PATH = "CANARYENDPOINTPATH";
const CANARY_SUBJECT = "CANARYSUBJ";
const CANARY_FROM = "canaryfrom@x.test";
const CANARY_BODY = "CANARYBODY";

interface Answer {
  status: number;
  headers?: Record<string, string>;
}

// The push service of the test. It answers from a list (the last answer repeats; 201 when the list is empty).
function fakePushService(...answers: Answer[]) {
  const calls: { url: string; headers: Record<string, string>; body: Uint8Array }[] = [];
  let script = answers;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = init?.body;
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: raw instanceof Uint8Array ? raw : new Uint8Array(),
    });
    const answer =
      script.length === 0 ? { status: 201 } : (script[Math.min(calls.length - 1, script.length - 1)] as Answer);
    return new Response(null, { status: answer.status, headers: answer.headers ?? {} });
  }) as typeof fetch;
  return {
    fetch: fetchFn,
    calls,
    answer(...next: Answer[]) {
      script = next;
      calls.length = 0;
    },
  };
}

interface World {
  ctx: { orgId: string };
  orgId: string;
  userId: string;
  mailboxId: string;
}

async function world(trx: Trx, flag = true): Promise<World> {
  await isolateChannels(trx);
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  if (flag) await setOrgFeature(trx, ctx, { flag: "web_push", enabled: true, actor: "cli", now: NOON });
  return { ctx, ...created };
}

async function newSession(
  trx: Trx,
  userId: string,
  expiresAt: Date,
  createdAt = new Date(NOON.getTime() - 2 * DAY_MS)
) {
  const { rows } = await sql<{ id: string }>`
    insert into auth_sessions (user_id, token, expires_at, created_at)
    values (${userId}::uuid, ${randomUUID()}, ${expiresAt}, ${createdAt}) returning id`.execute(trx);
  return rows[0]?.id ?? "";
}

let counter = 0;
interface Device {
  id: string;
  sessionId: string;
  receiver: ReturnType<typeof newReceiver>;
  endpoint: string;
}
// A device with real keys (the test decrypts what the sender posts) and a live session.
async function device(
  trx: Trx,
  w: World,
  over: { userId?: string; sessionEnd?: Date; boxOf?: SecretBox } = {}
): Promise<Device> {
  counter += 1;
  const userId = over.userId ?? w.userId;
  const sessionId = await newSession(trx, userId, over.sessionEnd ?? new Date(NOON.getTime() + DAY_MS));
  const receiver = newReceiver();
  const endpoint = `https://fcm.googleapis.com/fcm/send/${CANARY_PATH}-${counter}-${randomUUID()}`;
  const added = await upsertPushSubscription(trx, w.ctx, {
    userId,
    sessionId,
    endpoint,
    p256dh: receiver.sub.p256dh,
    auth: receiver.sub.auth,
    deviceLabel: "Phone",
    box: over.boxOf ?? box,
    now: new Date(NOON.getTime() - DAY_MS),
  });
  return { id: added?.id ?? "", sessionId, receiver, endpoint };
}

const urgentView = (emailId: string): NoticeView<"urgent"> => ({
  emailId,
  from: `${CANARY_FROM}`,
  subject: CANARY_SUBJECT,
  ai: { reasonCode: "llm", reason: CANARY_BODY },
  receivedAt: new Date(NOON.getTime() - 20 * MINUTE_MS),
  synthetic: false,
  folderTag: null,
  actions: [],
  delegateNames: {},
  stayFolder: "INBOX",
  now: NOON,
  timeZone: "Europe/Warsaw",
});

// The mail of an urgent row (the table wants an email id for this kind).
const urgentEmail = (trx: Trx, w: World): Promise<string> =>
  insertTriaged(trx, w.ctx, w.mailboxId, { category: "urgent", createdAt: new Date(NOON.getTime() - HOUR_MS) });

interface RowOver {
  kind?: NoticeKind;
  userId?: string;
  createdAt?: Date;
  status?: "pending" | "sending";
  lockedAt?: Date;
  attempts?: number;
  view?: Record<string, unknown>;
  noDevice?: boolean;
}

// One push row of a device. An `urgent` row by default; `auth_error` is a kind of the group `updates`, `approval` of the group `approvals`.
async function pushRow(trx: Trx, w: World, d: Device, over: RowOver = {}): Promise<string> {
  const kind = over.kind ?? "urgent";
  const emailId = kind === "urgent" || kind === "approval" ? await urgentEmail(trx, w) : undefined;
  const view =
    over.view ??
    (kind === "approval"
      ? testNoticeView("approval", { marker: CANARY_SUBJECT, at: NOON })
      : kind === "auth_error"
        ? encodeNoticeView("auth_error", {
            address: CANARY_FROM,
            mailboxId: w.mailboxId,
            since: new Date(NOON.getTime() - HOUR_MS),
            now: NOON,
            timeZone: "Europe/Warsaw",
          })
        : encodeNoticeView("urgent", urgentView(emailId ?? "")));
  const id = await insertOutbox(trx, w.ctx, {
    userId: over.userId ?? w.userId,
    kind,
    dedupKey: `${kind}:${randomUUID()}`,
    ...(kind === "auth_error" ? { mailboxId: w.mailboxId } : {}),
    ...(emailId === undefined ? {} : { emailId, mailboxId: w.mailboxId }),
    view,
    locale: "en",
    channel: "push",
    ...(over.noDevice === true ? {} : { pushSubscriptionId: d.id }),
    createdAt: over.createdAt ?? new Date(NOON.getTime() - 10 * MINUTE_MS),
    nextAttemptAt: new Date(NOON.getTime() - MINUTE_MS),
  });
  if (id === null) throw new Error("no row");
  if (over.status === "sending" || over.attempts !== undefined) {
    await trx
      .updateTable("outbox")
      .set({
        ...(over.status === "sending" ? { status: "sending", locked_at: over.lockedAt ?? NOON } : {}),
        ...(over.attempts === undefined ? {} : { attempts: over.attempts }),
      })
      .where("id", "=", id)
      .execute();
  }
  return id;
}

async function stateOf(trx: Trx, id: string) {
  return trx
    .selectFrom("outbox")
    .select(["status", "error_code", "attempts", "next_attempt_at", "locked_at", "text", "buttons", "sent_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

const deviceCount = async (trx: Trx, id: string): Promise<number> =>
  (await trx.selectFrom("push_subscriptions").select("id").where("id", "=", id).execute()).length;

function sender(
  trx: Trx,
  push: ReturnType<typeof fakePushService>,
  clock: { now: Date },
  over: { box?: SecretBox } = {}
) {
  return createPushSender({
    db: trx,
    box: over.box ?? box,
    keys: vapid,
    fetch: push.fetch,
    now: () => new Date(clock.now),
  });
}

describe("the push sender", () => {
  test("1. a pending urgent row of a live device: one POST, the row is sent, the body holds exactly v, id, kind, count, itemId and lang", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      await trx
        .updateTable("push_subscriptions")
        .set({ last_error_code: "push_retry" })
        .where("id", "=", d.id)
        .execute();
      const rowId = await pushRow(trx, w, d);
      const push = fakePushService();
      await sender(trx, push, { now: NOON }).run();
      expect(push.calls).toHaveLength(1);
      const call = push.calls[0];
      expect(call?.url).toBe(d.endpoint);
      expect(call?.headers).toMatchObject({
        // The row is 10 minutes old: the message lives what is left of its 24 hours.
        ttl: "85800",
        urgency: "high",
        topic: pushTopicOf(rowId),
        "content-encoding": "aes128gcm",
      });
      expect(call?.headers.authorization?.startsWith("vapid t=")).toBe(true);
      const body = JSON.parse(decryptPushBody(call?.body ?? new Uint8Array(), d.receiver).toString("utf8")) as Record<
        string,
        unknown
      >;
      expect(Object.keys(body).sort()).toEqual(["count", "id", "itemId", "kind", "lang", "v"]);
      expect(body).toEqual({ v: 1, id: rowId, kind: "urgent", count: 1, itemId: null, lang: "en" });
      const state = await stateOf(trx, rowId);
      expect(state).toMatchObject({ status: "sent", error_code: null, buttons: [] });
      expect(JSON.parse(state.text ?? "{}")).toEqual(body);
      expect(state.sent_at?.getTime()).toBe(NOON.getTime());
      const device_ = await trx
        .selectFrom("push_subscriptions")
        .select(["last_success_at", "last_error_code"])
        .where("id", "=", d.id)
        .executeTakeFirstOrThrow();
      expect(device_.last_success_at?.getTime()).toBe(NOON.getTime());
      expect(device_.last_error_code).toBeNull();
      // The planted strings of the view are in no byte of the body.
      expect(JSON.stringify(body)).not.toContain("CANARY");
    });
  });

  test("1b. a kind of the group updates goes with the urgency normal", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      await pushRow(trx, w, d, { kind: "auth_error" });
      const push = fakePushService();
      await sender(trx, push, { now: NOON }).run();
      expect(push.calls).toHaveLength(1);
      expect(push.calls[0]?.headers.urgency).toBe("normal");
    });
  });

  test("1c. an approval row goes with the urgency high and a body that holds the action id", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      const id = await pushRow(trx, w, d, { kind: "approval" });
      const push = fakePushService();
      await sender(trx, push, { now: NOON }).run();
      expect(push.calls).toHaveLength(1);
      expect(push.calls[0]?.headers.urgency).toBe("high");
      const body = JSON.parse(
        decryptPushBody(push.calls[0]?.body ?? new Uint8Array(), d.receiver).toString("utf8")
      ) as Record<string, unknown>;
      expect(body).toMatchObject({ kind: "approval", id });
      expect((await stateOf(trx, id)).status).toBe("sent");
    });
  });

  test("2. a 410 deletes the device, ends the row and the other open row of the device as no_device, and leaves the Telegram row alone", async () => {
    const logs = captureLogs();
    try {
      await withRollback(db, async (trx) => {
        const w = await world(trx);
        const d = await device(trx, w);
        const first = await pushRow(trx, w, d);
        const second = await pushRow(trx, w, d, { createdAt: new Date(NOON.getTime() - 5 * MINUTE_MS) });
        const telegramMail = await urgentEmail(trx, w);
        const telegram = await insertOutbox(trx, w.ctx, {
          userId: w.userId,
          kind: "urgent",
          dedupKey: `urgent:${randomUUID()}`,
          emailId: telegramMail,
          mailboxId: w.mailboxId,
          view: encodeNoticeView("urgent", urgentView(telegramMail)),
          locale: "en",
          createdAt: NOON,
          nextAttemptAt: NOON,
        });
        const push = fakePushService({ status: 410 });
        await sender(trx, push, { now: NOON }).run();
        expect(push.calls).toHaveLength(1);
        expect(await deviceCount(trx, d.id)).toBe(0);
        expect(await stateOf(trx, first)).toMatchObject({ status: "failed", error_code: "no_device", locked_at: null });
        expect(await stateOf(trx, second)).toMatchObject({
          status: "failed",
          error_code: "no_device",
          locked_at: null,
        });
        expect(await stateOf(trx, telegram ?? "")).toMatchObject({ status: "pending", error_code: null });
        // The end `no_device` is not a failure in the operator counts, so this line is the trace of a systematic sender bug.
        const gone = eventLines(logs.lines, "push_device_gone");
        expect(gone).toHaveLength(1);
        expect(gone[0]).toMatchObject({ push_subscription_id: d.id, kind: "urgent", code: "endpoint_gone" });
      });
    } finally {
      logs.stop();
    }
  });

  test("2b. a 404 is a gone device too", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      const id = await pushRow(trx, w, d);
      await sender(trx, fakePushService({ status: 404 }), { now: NOON }).run();
      expect(await deviceCount(trx, d.id)).toBe(0);
      expect(await stateOf(trx, id)).toMatchObject({ status: "failed", error_code: "no_device" });
    });
  });

  test("3. a 503 backs off 30, 60 and 120 s (an attempt each); the fifth failure ends as too_many_errors", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      const id = await pushRow(trx, w, d);
      const push = fakePushService({ status: 503 });
      const clock = { now: NOON };
      const run = sender(trx, push, clock);
      const waits: number[] = [];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await run.run();
        const state = await stateOf(trx, id);
        expect(state).toMatchObject({ status: "pending", attempts: attempt });
        waits.push((state.next_attempt_at?.getTime() ?? 0) - clock.now.getTime());
        clock.now = state.next_attempt_at ?? clock.now;
      }
      expect(waits).toEqual([30_000, MINUTE_MS, 120_000]);
      await run.run(); // the fourth failure: 240 s
      const fourth = await stateOf(trx, id);
      expect(fourth).toMatchObject({ status: "pending", attempts: 4 });
      clock.now = fourth.next_attempt_at ?? clock.now;
      await run.run(); // the fifth failure
      expect(await stateOf(trx, id)).toMatchObject({ status: "failed", error_code: "too_many_errors" });
      expect(push.calls).toHaveLength(5);
      // The device stays: a 5xx is the service, not the device.
      expect(await deviceCount(trx, d.id)).toBe(1);
    });
  });

  test("4. a 429 with Retry-After 30 waits 30 s", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      const id = await pushRow(trx, w, d);
      await sender(trx, fakePushService({ status: 429, headers: { "Retry-After": "30" } }), { now: NOON }).run();
      const state = await stateOf(trx, id);
      expect(state).toMatchObject({ status: "pending", attempts: 1 });
      expect(state.next_attempt_at?.getTime()).toBe(NOON.getTime() + 30_000);
    });
  });

  test("4b. Retry-After wins over the backoff: 120 s on the first failure, where the backoff would be 30 s", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      const id = await pushRow(trx, w, d);
      await sender(trx, fakePushService({ status: 429, headers: { "Retry-After": "120" } }), { now: NOON }).run();
      const state = await stateOf(trx, id);
      expect(state).toMatchObject({ status: "pending", attempts: 1 });
      expect(state.next_attempt_at?.getTime()).toBe(NOON.getTime() + 120_000);
    });
  });

  test("4c. five 429 answers count five attempts and end the row as too_many_errors", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      const id = await pushRow(trx, w, d);
      const clock = { now: NOON };
      const run = sender(trx, fakePushService({ status: 429, headers: { "Retry-After": "30" } }), clock);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await run.run();
        const state = await stateOf(trx, id);
        expect(state).toMatchObject({ status: "pending", attempts: attempt });
        clock.now = state.next_attempt_at ?? clock.now;
      }
      await run.run();
      expect(await stateOf(trx, id)).toMatchObject({ status: "failed", error_code: "too_many_errors" });
    });
  });

  test("5. at 23:00 in the organization zone the row is held to 07:00 and nothing is posted", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      const night = new Date("2026-11-20T22:00:00Z"); // 23:00 in Warsaw
      const id = await pushRow(trx, w, d, { createdAt: new Date(night.getTime() - 10 * MINUTE_MS) });
      const push = fakePushService();
      await sender(trx, push, { now: night }).run();
      expect(push.calls).toHaveLength(0);
      const state = await stateOf(trx, id);
      expect(state).toMatchObject({ status: "pending", attempts: 0 });
      expect(state.next_attempt_at?.toISOString()).toBe("2026-11-21T06:00:00.000Z"); // 07:00 in Warsaw
    });
  });

  test("6. a session that expired, and a session that sign-out deleted: no POST, the device goes, the row ends no_device", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const expired = await device(trx, w, { sessionEnd: new Date(NOON.getTime() - MINUTE_MS) });
      const signedOut = await device(trx, w);
      await sql`delete from auth_sessions where id = ${signedOut.sessionId}::uuid`.execute(trx);
      const a = await pushRow(trx, w, expired);
      const b = await pushRow(trx, w, signedOut);
      const push = fakePushService();
      await sender(trx, push, { now: NOON }).run();
      expect(push.calls).toHaveLength(0);
      expect(await stateOf(trx, a)).toMatchObject({ status: "failed", error_code: "no_device" });
      expect(await stateOf(trx, b)).toMatchObject({ status: "failed", error_code: "no_device" });
      expect(await deviceCount(trx, expired.id)).toBe(0);
      expect(await deviceCount(trx, signedOut.id)).toBe(0);
    });
  });

  test("7. a row older than 24 h ends as expired and posts nothing", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      const id = await pushRow(trx, w, d, { createdAt: new Date(NOON.getTime() - 25 * HOUR_MS) });
      const push = fakePushService();
      await sender(trx, push, { now: NOON }).run();
      expect(push.calls).toHaveLength(0);
      expect(await stateOf(trx, id)).toMatchObject({ status: "failed", error_code: "expired" });
      expect(await deviceCount(trx, d.id)).toBe(1);
    });
  });

  test("8. with the flag off nothing is posted and the row waits 15 minutes with no attempt", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, false);
      const d = await device(trx, w);
      const id = await pushRow(trx, w, d);
      const push = fakePushService();
      await sender(trx, push, { now: NOON }).run();
      expect(push.calls).toHaveLength(0);
      const state = await stateOf(trx, id);
      expect(state).toMatchObject({ status: "pending", attempts: 0 });
      expect(state.next_attempt_at?.getTime()).toBe(NOON.getTime() + PUSH_FLAG_WAIT_MS);
    });
  });

  test("9. four rows of one user: three POSTs in this run, the fourth in the next", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      const ids: string[] = [];
      for (let n = 0; n < 4; n += 1) {
        ids.push(await pushRow(trx, w, d, { createdAt: new Date(NOON.getTime() - (10 - n) * MINUTE_MS) }));
      }
      const push = fakePushService();
      const clock = { now: NOON };
      const run = sender(trx, push, clock);
      await run.run();
      expect(push.calls).toHaveLength(3);
      const states = await Promise.all(ids.map((id) => stateOf(trx, id)));
      expect(states.map((state) => state.status)).toEqual(["sent", "sent", "sent", "pending"]);
      await run.run();
      expect(push.calls).toHaveLength(4);
      expect((await stateOf(trx, ids[3] ?? "")).status).toBe("sent");
    });
  });

  test("10. a row that a dead run left sending 6 minutes ago is sent again once, with a warning", async () => {
    const logs = captureLogs();
    try {
      await withRollback(db, async (trx) => {
        const w = await world(trx);
        const d = await device(trx, w);
        const id = await pushRow(trx, w, d, { status: "sending", lockedAt: new Date(NOON.getTime() - 6 * MINUTE_MS) });
        const push = fakePushService();
        const run = sender(trx, push, { now: NOON });
        await run.run();
        await run.run();
        expect(push.calls).toHaveLength(1);
        expect(await stateOf(trx, id)).toMatchObject({ status: "sent", attempts: 1 });
        expect(eventLines(logs.lines, "outbox_push_resent_after_stale")).toHaveLength(1);
      });
    } finally {
      logs.stop();
    }
  });

  test("10b. a stale row that already had four attempts ends as too_many_errors and posts nothing", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      const id = await pushRow(trx, w, d, {
        status: "sending",
        lockedAt: new Date(NOON.getTime() - 6 * MINUTE_MS),
        attempts: 4,
      });
      const push = fakePushService();
      await sender(trx, push, { now: NOON }).run();
      expect(push.calls).toHaveLength(0);
      expect(await stateOf(trx, id)).toMatchObject({ status: "failed", error_code: "too_many_errors" });
    });
  });

  test("11. a 400 ends the row as push_refused, keeps the device and stores the status as its last error", async () => {
    const logs = captureLogs();
    try {
      await withRollback(db, async (trx) => {
        const w = await world(trx);
        const d = await device(trx, w);
        const id = await pushRow(trx, w, d);
        const push = fakePushService({ status: 400 });
        await sender(trx, push, { now: NOON }).run();
        expect(await stateOf(trx, id)).toMatchObject({ status: "failed", error_code: "push_refused" });
        const left = await trx
          .selectFrom("push_subscriptions")
          .select("last_error_code")
          .where("id", "=", d.id)
          .executeTakeFirstOrThrow();
        expect(left.last_error_code).toBe("http_400");
        const failed = eventLines(logs.lines, "push_failed");
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({ push_subscription_id: d.id, kind: "urgent", http_status: 400 });
      });
    } finally {
      logs.stop();
    }
  });

  test("12. a row with no device (the device row was deleted) ends as no_device", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      const id = await pushRow(trx, w, d);
      // A plain delete (not `removeDevice`): the key of the row clears.
      await sql`delete from push_subscriptions where id = ${d.id}::uuid`.execute(trx);
      const push = fakePushService();
      await sender(trx, push, { now: NOON }).run();
      expect(push.calls).toHaveLength(0);
      expect(await stateOf(trx, id)).toMatchObject({ status: "failed", error_code: "no_device" });
    });
  });

  test("13. a view that does not render ends as bad_view and posts nothing", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      const id = await pushRow(trx, w, d, { view: { emailId: "x" } });
      const push = fakePushService();
      await sender(trx, push, { now: NOON }).run();
      expect(push.calls).toHaveLength(0);
      expect(await stateOf(trx, id)).toMatchObject({ status: "failed", error_code: "bad_view" });
    });
  });

  test("14. a device that was sealed under another key version stays, and the row and the run wait 10 minutes with an error line", async () => {
    const logs = captureLogs();
    try {
      await withRollback(db, async (trx) => {
        const w = await world(trx);
        const d = await device(trx, w);
        const id = await pushRow(trx, w, d);
        const other = await pushRow(trx, w, d, { createdAt: new Date(NOON.getTime() - 5 * MINUTE_MS) });
        const push = fakePushService();
        // The server key is now version 2: the stored secret (version 1) cannot be opened.
        await sender(trx, push, { now: NOON }, { box: createSecretBox(randomBytes(32).toString("base64"), 2) }).run();
        expect(push.calls).toHaveLength(0);
        expect(await deviceCount(trx, d.id)).toBe(1);
        for (const row of [id, other]) {
          const state = await stateOf(trx, row);
          expect(state).toMatchObject({ status: "pending", attempts: 0 });
          expect(state.next_attempt_at?.getTime()).toBe(NOON.getTime() + 10 * MINUTE_MS);
        }
        expect(eventLines(logs.lines, "push_key_version_mismatch")).toHaveLength(1);
      });
    } finally {
      logs.stop();
    }
  });

  test("15. the rows of a suspended organization are not claimed", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      const id = await pushRow(trx, w, d);
      await trx.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", w.orgId).execute();
      const push = fakePushService();
      await sender(trx, push, { now: NOON }).run();
      expect(push.calls).toHaveLength(0);
      expect(await stateOf(trx, id)).toMatchObject({ status: "pending", attempts: 0 });
    });
  });

  test("16. the user limit is per user: a second user of the organization still gets a push when the first is at the limit", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const memberId = await addMember(trx, w.orgId);
      const d1 = await device(trx, w);
      const d2 = await device(trx, w, { userId: memberId });
      for (let n = 0; n < 4; n += 1)
        await pushRow(trx, w, d1, { createdAt: new Date(NOON.getTime() - (20 - n) * MINUTE_MS) });
      const second = await pushRow(trx, w, d2, { userId: memberId });
      const push = fakePushService();
      await sender(trx, push, { now: NOON }).run();
      expect(push.calls).toHaveLength(4);
      expect((await stateOf(trx, second)).status).toBe("sent");
      expect(await listLiveDeviceIds(trx, w.ctx, memberId, NOON)).toHaveLength(1);
    });
  });

  test("17. log canary: the planted endpoint, keys and view strings are in no log line of a run with every answer", async () => {
    const logs = captureLogs();
    const planted: string[] = [CANARY_PATH, CANARY_SUBJECT, CANARY_FROM, CANARY_BODY, vapid.privateKey];
    try {
      await withRollback(db, async (trx) => {
        const w = await world(trx);
        const devices = [await device(trx, w), await device(trx, w), await device(trx, w), await device(trx, w)];
        for (const [index, d] of devices.entries()) {
          planted.push(d.receiver.sub.p256dh, d.receiver.sub.auth);
          await pushRow(trx, w, d, { createdAt: new Date(NOON.getTime() - (10 - index) * MINUTE_MS) });
        }
        // Run 1: sent, gone, retry (the limit of three leaves the fourth row); run 2: refused.
        await sender(trx, fakePushService({ status: 201 }, { status: 410 }, { status: 503 }), { now: NOON }).run();
        await sender(trx, fakePushService({ status: 400 }), { now: NOON }).run();
      });
      expect(logs.lines.length).toBeGreaterThan(0);
      expect(logProblems(logs.lines, planted)).toEqual([]);
      const events = new Set(logs.lines.map((line) => (JSON.parse(line) as { event: string }).event));
      expect(events.has("push_sent")).toBe(true);
      expect(events.has("push_device_gone")).toBe(true);
      expect(events.has("push_failed")).toBe(true);
    } finally {
      logs.stop();
    }
  });

  test("18. the TTL is what is left of the 24 hours of the row: a row 23 h 50 min old goes with 600 s, a fresh row with 86400 s", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const d = await device(trx, w);
      await pushRow(trx, w, d, { createdAt: new Date(NOON.getTime() - 23 * HOUR_MS - 50 * MINUTE_MS) });
      await pushRow(trx, w, d, { createdAt: NOON });
      const push = fakePushService();
      await sender(trx, push, { now: NOON }).run();
      expect(push.calls.map((call) => call.headers.ttl).sort()).toEqual(["600", "86400"]);
    });
  });

  test("19. a row that was posted and then hit a database error stays sending; the stale reclaim after 5 minutes sends it again", async () => {
    const logs = captureLogs();
    try {
      await withRollback(db, async (trx) => {
        const w = await world(trx);
        const d = await device(trx, w);
        const id = await pushRow(trx, w, d);
        const push = fakePushService();
        // After the POST the database "goes away": a transaction that starts now fails. Before the POST it works as usual.
        let posted = false;
        const postingFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          posted = true;
          return push.fetch(input, init);
        }) as typeof fetch;
        const flaky = new Proxy(trx, {
          get(target, prop) {
            if (prop === "isTransaction") return false;
            if (prop === "transaction") {
              return () => ({
                execute: <T>(action: (inner: Trx) => Promise<T>): Promise<T> =>
                  posted ? Promise.reject(new Error("database went away")) : action(target),
              });
            }
            const value = Reflect.get(target, prop, target) as unknown;
            return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
          },
        });
        const clock = { now: NOON };
        await createPushSender({
          db: flaky,
          box,
          keys: vapid,
          fetch: postingFetch,
          now: () => new Date(clock.now),
        }).run();
        expect(push.calls).toHaveLength(1);
        const stuck = await stateOf(trx, id);
        expect(stuck).toMatchObject({ status: "sending", attempts: 0 });
        expect(stuck.locked_at?.getTime()).toBe(NOON.getTime());
        expect(eventLines(logs.lines, "outbox_failed")).toHaveLength(1);

        // 4 minutes later the lock is young: nobody claims the row.
        clock.now = new Date(NOON.getTime() + 4 * MINUTE_MS);
        await sender(trx, push, clock).run();
        expect(push.calls).toHaveLength(1);
        expect((await stateOf(trx, id)).status).toBe("sending");

        // 6 minutes later the reclaim sends it again, with an attempt counted.
        clock.now = new Date(NOON.getTime() + 6 * MINUTE_MS);
        await sender(trx, push, clock).run();
        expect(push.calls).toHaveLength(2);
        expect(await stateOf(trx, id)).toMatchObject({ status: "sent", attempts: 1 });
      });
    } finally {
      logs.stop();
    }
  });

  test("20. a second run of the same sender inside the 10-minute key-version pause claims nothing, not even a new row; after the pause it tries again", async () => {
    const logs = captureLogs();
    try {
      await withRollback(db, async (trx) => {
        const w = await world(trx);
        const d = await device(trx, w);
        await pushRow(trx, w, d);
        const push = fakePushService();
        const clock = { now: NOON };
        const wrongKey = createSecretBox(randomBytes(32).toString("base64"), 2);
        const run = sender(trx, push, clock, { box: wrongKey });
        await run.run();
        expect(eventLines(logs.lines, "push_key_version_mismatch")).toHaveLength(1);

        // A new row, due now: inside the pause the sender must not even claim it.
        const fresh = await pushRow(trx, w, d, { createdAt: new Date(NOON.getTime() - 2 * MINUTE_MS) });
        clock.now = new Date(NOON.getTime() + 5 * MINUTE_MS);
        await run.run();
        const waiting = await stateOf(trx, fresh);
        expect(waiting).toMatchObject({ status: "pending", attempts: 0 });
        expect(waiting.next_attempt_at?.getTime()).toBe(NOON.getTime() - MINUTE_MS);
        expect(eventLines(logs.lines, "push_key_version_mismatch")).toHaveLength(1);
        expect(push.calls).toHaveLength(0);

        // The pause is over: the sender claims again (and meets the same fault once more).
        clock.now = new Date(NOON.getTime() + 11 * MINUTE_MS);
        await run.run();
        expect(eventLines(logs.lines, "push_key_version_mismatch")).toHaveLength(2);
      });
    } finally {
      logs.stop();
    }
  });
});
