import { randomBytes, randomUUID } from "node:crypto";

import { DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  endpointHash,
  listDeviceViews,
  listLiveDeviceIds,
  loadDeviceSecret,
  markPushError,
  markPushSuccess,
  MAX_DEVICES_PER_USER,
  PushDeviceElsewhereError,
  pushDedupKey,
  removeDevice,
  upsertPushSubscription,
} from "../../src/modules/channels/push";
import { insertMembership } from "../../src/modules/tenancy/repo";
import { CryptoKeyVersionError, createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";
import { captureLogs, eventLines, logProblems } from "../log-capture";

import { addMember, createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The repository of the push devices (`channels/push/repo.ts`). The connection is the `app` role with no
// tenant scope, so every query must filter by the `org_id` of its `TenantContext` itself.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const box = createSecretBox(randomBytes(32).toString("base64"), 1);
const NOW = new Date("2026-11-20T10:00:00Z");
const CANARY_ENDPOINT = "CANARYENDPOINT";

interface Org {
  orgId: string;
  userId: string;
  mailboxId: string;
}

let counter = 0;
// A made-up push endpoint on an allowed host. `tag` makes the endpoint known to the test.
const endpointOf = (tag: string) => `https://fcm.googleapis.com/fcm/send/${CANARY_ENDPOINT}-${tag}-${randomUUID()}`;

async function session(trx: Trx, userId: string, expiresAt: Date): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into auth_sessions (user_id, token, expires_at)
    values (${userId}::uuid, ${randomUUID()}, ${expiresAt}) returning id`.execute(trx);
  return rows[0]?.id ?? "";
}

async function subscribe(
  trx: Trx,
  o: { orgId: string },
  userId: string,
  sessionId: string,
  over: Partial<{ endpoint: string; now: Date; rebindOnly: boolean; deviceLabel: string }> = {}
) {
  counter += 1;
  return upsertPushSubscription(
    trx,
    { orgId: o.orgId },
    {
      userId,
      sessionId,
      endpoint: over.endpoint ?? endpointOf(`d${counter}`),
      p256dh: `p256dh-${counter}`,
      auth: `auth-${counter}`,
      deviceLabel: over.deviceLabel ?? "Phone",
      box,
      now: over.now ?? NOW,
      ...(over.rebindOnly === undefined ? {} : { rebindOnly: over.rebindOnly }),
    }
  );
}

async function pushRow(
  trx: Trx,
  o: Org,
  deviceId: string | null,
  status: "pending" | "sending" | "sent" | "failed" = "pending"
): Promise<string> {
  const row = await trx
    .insertInto("outbox")
    .values({
      org_id: o.orgId,
      user_id: o.userId,
      kind: "sync_ok",
      dedup_key: randomUUID(),
      mailbox_id: o.mailboxId,
      channel: "push",
      push_subscription_id: deviceId,
      status,
      sent_at: status === "sent" ? NOW : null,
      locked_at: status === "sending" ? NOW : null,
      error_code: status === "failed" ? "push_refused" : null,
      next_attempt_at: NOW,
      created_at: NOW,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function stateOf(trx: Trx, id: string) {
  return trx
    .selectFrom("outbox")
    .select(["status", "error_code", "push_subscription_id"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

const deviceCount = async (trx: Trx, orgId: string): Promise<number> =>
  (await trx.selectFrom("push_subscriptions").select("id").where("org_id", "=", orgId).execute()).length;

describe("upsertPushSubscription", () => {
  test("1: the same endpoint twice with two sessions gives one row bound to the second session; the first call creates", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const first = await session(trx, o.userId, new Date(NOW.getTime() + HOUR_MS));
      const second = await session(trx, o.userId, new Date(NOW.getTime() + 2 * HOUR_MS));
      const endpoint = endpointOf("same");
      const one = await subscribe(trx, o, o.userId, first, { endpoint, deviceLabel: "Old label" });
      const two = await subscribe(trx, o, o.userId, second, { endpoint, deviceLabel: "New label" });
      expect(one).toEqual({ id: expect.any(String), created: true, sessionChanged: true });
      expect(two).toEqual({ id: one?.id ?? "", created: false, sessionChanged: true });
      const rows = await trx.selectFrom("push_subscriptions").selectAll().where("org_id", "=", o.orgId).execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        session_id: second,
        device_label: "New label",
        endpoint_hash: endpointHash(endpoint),
      });
    });
  });

  test("2: rebindOnly with an unknown endpoint stores nothing; with another user's endpoint it changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const memberId = await addMember(trx, o.orgId);
      const ownerSession = await session(trx, o.userId, new Date(NOW.getTime() + HOUR_MS));
      const memberSession = await session(trx, memberId, new Date(NOW.getTime() + HOUR_MS));
      const endpoint = endpointOf("owner");
      const made = await subscribe(trx, o, o.userId, ownerSession, { endpoint });
      expect(await subscribe(trx, o, o.userId, ownerSession, { rebindOnly: true })).toBeNull();
      expect(await deviceCount(trx, o.orgId)).toBe(1);
      // User B sends A's endpoint with `rebindOnly`: no device of B matches, so nothing is stored and A's row stays.
      expect(await subscribe(trx, o, memberId, memberSession, { endpoint, rebindOnly: true })).toBeNull();
      const row = await trx
        .selectFrom("push_subscriptions")
        .select(["id", "user_id", "session_id"])
        .where("org_id", "=", o.orgId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ id: made?.id ?? "", user_id: o.userId, session_id: ownerSession });
      // With `rebindOnly` and the user's own endpoint the device is re-bound to the new session.
      const newer = await session(trx, o.userId, new Date(NOW.getTime() + 3 * HOUR_MS));
      expect(await subscribe(trx, o, o.userId, newer, { endpoint, rebindOnly: true })).toEqual({
        id: made?.id ?? "",
        created: false,
        sessionChanged: true,
      });
      // The same session again (a second page load): the device stays bound, and the result says that no binding changed.
      expect(await subscribe(trx, o, o.userId, newer, { endpoint, rebindOnly: true })).toEqual({
        id: made?.id ?? "",
        created: false,
        sessionChanged: false,
      });
    });
  });

  test("3: the 11th endpoint of a user removes the oldest device and fails its open rows as no_device", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const s = await session(trx, o.userId, new Date(NOW.getTime() + DAY_MS));
      const ids: string[] = [];
      for (let n = 0; n < MAX_DEVICES_PER_USER; n += 1) {
        const made = await subscribe(trx, o, o.userId, s, { now: new Date(NOW.getTime() + n * 1000) });
        ids.push(made?.id ?? "");
      }
      expect(await deviceCount(trx, o.orgId)).toBe(10);
      const oldest = ids[0] ?? "";
      const pending = await pushRow(trx, o, oldest);
      const sent = await pushRow(trx, o, oldest, "sent");
      const newest = await subscribe(trx, o, o.userId, s, { now: new Date(NOW.getTime() + MINUTE_MS) });
      expect(newest?.created).toBe(true);
      const left = await trx
        .selectFrom("push_subscriptions")
        .select("id")
        .where("org_id", "=", o.orgId)
        .orderBy("created_at")
        .execute();
      expect(left.map((row) => row.id)).toEqual([...ids.slice(1), newest?.id ?? ""]);
      expect(await stateOf(trx, pending)).toEqual({
        status: "failed",
        error_code: "no_device",
        push_subscription_id: null,
      });
      expect(await stateOf(trx, sent)).toEqual({ status: "sent", error_code: null, push_subscription_id: null });
    });
  });

  test("3b: a full list drops a device without a live session first (null session, then an expired one), a live one last", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const live = await session(trx, o.userId, new Date(NOW.getTime() + DAY_MS));
      const expired = await session(trx, o.userId, new Date(NOW.getTime() - HOUR_MS));
      const ids: string[] = [];
      for (let n = 0; n < MAX_DEVICES_PER_USER; n += 1) {
        const made = await subscribe(trx, o, o.userId, live, { now: new Date(NOW.getTime() + n * 1000) });
        ids.push(made?.id ?? "");
      }
      // Device 0 is the oldest and live. Device 5 has an expired session, device 3 has none (its session ended).
      await trx
        .updateTable("push_subscriptions")
        .set({ session_id: expired })
        .where("id", "=", ids[5] ?? "")
        .execute();
      await trx
        .updateTable("push_subscriptions")
        .set({ session_id: null })
        .where("id", "=", ids[3] ?? "")
        .execute();
      const idsOf = async () =>
        (
          await trx
            .selectFrom("push_subscriptions")
            .select("id")
            .where("org_id", "=", o.orgId)
            .orderBy("created_at")
            .execute()
        ).map((row) => row.id);

      const a = await subscribe(trx, o, o.userId, live, { now: new Date(NOW.getTime() + MINUTE_MS) });
      expect(await idsOf()).toEqual([...ids.filter((id) => id !== ids[3]), a?.id ?? ""]);
      const b = await subscribe(trx, o, o.userId, live, { now: new Date(NOW.getTime() + 61_000) });
      expect(await idsOf()).toEqual([...ids.filter((id) => id !== ids[3] && id !== ids[5]), a?.id ?? "", b?.id ?? ""]);
      // No dead device is left: the next one removes the oldest live device.
      const c = await subscribe(trx, o, o.userId, live, { now: new Date(NOW.getTime() + 62_000) });
      expect(await idsOf()).toEqual([
        ...ids.filter((id) => id !== ids[3] && id !== ids[5] && id !== ids[0]),
        a?.id ?? "",
        b?.id ?? "",
        c?.id ?? "",
      ]);
    });
  });

  test("4: the cap counts one user: another user's devices and another organization's devices stay", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const memberId = await addMember(trx, a.orgId);
      const b = await createOrgWithMailbox(trx);
      const s = await session(trx, a.userId, new Date(NOW.getTime() + HOUR_MS));
      const memberSession = await session(trx, memberId, new Date(NOW.getTime() + HOUR_MS));
      const bSession = await session(trx, b.userId, new Date(NOW.getTime() + HOUR_MS));
      for (let n = 0; n < MAX_DEVICES_PER_USER; n += 1) await subscribe(trx, a, a.userId, s);
      await subscribe(trx, a, memberId, memberSession);
      await subscribe(trx, b, b.userId, bSession);
      await subscribe(trx, a, a.userId, s);
      const own = await trx.selectFrom("push_subscriptions").select("id").where("user_id", "=", a.userId).execute();
      expect(own).toHaveLength(10);
      expect(await deviceCount(trx, a.orgId)).toBe(11);
      expect(await deviceCount(trx, b.orgId)).toBe(1);
    });
  });

  test("5: the browser of a user in two organizations: the second organization cannot take the endpoint (one row per user and endpoint)", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await insertMembership(trx, { orgId: b.orgId }, { userId: a.userId, role: "assistant" });
      const s = await session(trx, a.userId, new Date(NOW.getTime() + HOUR_MS));
      const endpoint = endpointOf("two-orgs");
      await subscribe(trx, a, a.userId, s, { endpoint });
      await sql`savepoint f118_elsewhere`.execute(trx);
      await expect(subscribe(trx, b, a.userId, s, { endpoint })).rejects.toBeInstanceOf(PushDeviceElsewhereError);
      await sql`rollback to savepoint f118_elsewhere`.execute(trx);
      expect(await deviceCount(trx, b.orgId)).toBe(0);
    });
  });

  test("6: the stored secret holds none of the endpoint or the keys in clear; the device label is the only plain text", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const s = await session(trx, o.userId, new Date(NOW.getTime() + HOUR_MS));
      const made = await subscribe(trx, o, o.userId, s, { endpoint: endpointOf("canary") });
      const row = await trx
        .selectFrom("push_subscriptions")
        .selectAll()
        .where("id", "=", made?.id ?? "")
        .executeTakeFirstOrThrow();
      const stored = JSON.stringify(row);
      expect(stored).not.toContain(CANARY_ENDPOINT);
      expect(stored).not.toContain("fcm.googleapis.com");
      expect(stored).not.toMatch(/p256dh-|auth-/);
      expect(row.secret).not.toContain("{");
      expect(row.key_version).toBe(1);
      expect(row.endpoint_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});

describe("listLiveDeviceIds and listDeviceViews", () => {
  test("7a: boundAt is the later of the device start and the session start", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const early = new Date(NOW.getTime() - 5 * HOUR_MS);
      const late = new Date(NOW.getTime() - HOUR_MS);
      const mk = async (sessionStart: Date, deviceStart: Date) => {
        const sessionId = await session(trx, o.userId, new Date(NOW.getTime() + HOUR_MS));
        await sql`update auth_sessions set created_at = ${sessionStart} where id = ${sessionId}::uuid`.execute(trx);
        return (await subscribe(trx, o, o.userId, sessionId, { now: deviceStart }))?.id ?? "";
      };
      const rebound = await mk(late, early); // the session is newer: the device was bound again
      const fresh = await mk(early, late); // the device is newer
      const live = await listLiveDeviceIds(trx, { orgId: o.orgId }, o.userId, NOW);
      const times = (id: string) => {
        const row = live.find((candidate) => candidate.id === id);
        return [row?.createdAt.getTime(), row?.boundAt.getTime()];
      };
      expect(times(rebound)).toEqual([early.getTime(), late.getTime()]);
      expect(times(fresh)).toEqual([late.getTime(), late.getTime()]);
    });
  });

  test("7: a device is live only with an unexpired session of its own user; the list holds no secret", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const memberId = await addMember(trx, o.orgId);
      const live = await subscribe(trx, o, o.userId, await session(trx, o.userId, new Date(NOW.getTime() + HOUR_MS)), {
        now: new Date(NOW.getTime() - 3000),
      });
      const expired = await subscribe(trx, o, o.userId, await session(trx, o.userId, new Date(NOW.getTime() - 1)), {
        now: new Date(NOW.getTime() - 2000),
      });
      const edge = await subscribe(trx, o, o.userId, await session(trx, o.userId, NOW), {
        now: new Date(NOW.getTime() - 1000),
      });
      const ended = await subscribe(trx, o, o.userId, await session(trx, o.userId, new Date(NOW.getTime() + HOUR_MS)));
      await sql`update push_subscriptions set session_id = null where id = ${ended?.id ?? ""}::uuid`.execute(trx);
      // A session of another user (only a bug could write this) does not make the device live.
      const foreign = await subscribe(
        trx,
        o,
        o.userId,
        await session(trx, memberId, new Date(NOW.getTime() + HOUR_MS))
      );
      // A device of another user stays out of this user's list.
      const theirs = await subscribe(trx, o, memberId, await session(trx, memberId, new Date(NOW.getTime() + HOUR_MS)));
      const ids = await listLiveDeviceIds(trx, { orgId: o.orgId }, o.userId, NOW);
      expect(ids.map((row) => row.id)).toEqual([live?.id ?? ""]);
      expect(ids[0]?.createdAt).toEqual(new Date(NOW.getTime() - 3000));
      expect(Object.keys(ids[0] ?? {}).sort()).toEqual(["boundAt", "createdAt", "id"]);
      expect([expired, edge, ended, foreign, theirs].map((made) => made?.created)).toEqual([
        true,
        true,
        true,
        true,
        true,
      ]);

      const views = await listDeviceViews(trx, { orgId: o.orgId }, o.userId, NOW);
      expect(views.map((view) => view.id)).toEqual([live?.id ?? ""]);
      expect(Object.keys(views[0] ?? {}).sort()).toEqual([
        "createdAt",
        "deviceLabel",
        "id",
        "lastErrorCode",
        "lastSuccessAt",
        "sessionId",
      ]);
      expect(JSON.stringify(views)).not.toContain(CANARY_ENDPOINT);
    });
  });
});

describe("removeDevice", () => {
  test("8: pending and sending rows end failed / no_device; sent and failed rows stay; the device column clears", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const s = await session(trx, o.userId, new Date(NOW.getTime() + HOUR_MS));
      const made = await subscribe(trx, o, o.userId, s);
      const id = made?.id ?? "";
      const other = await subscribe(trx, o, o.userId, s);
      const pending = await pushRow(trx, o, id);
      const sending = await pushRow(trx, o, id, "sending");
      const sent = await pushRow(trx, o, id, "sent");
      const failed = await pushRow(trx, o, id, "failed");
      const otherDevice = await pushRow(trx, o, other?.id ?? "");
      expect(await removeDevice(trx, { orgId: o.orgId }, id)).toBe(true);
      expect(await stateOf(trx, pending)).toEqual({
        status: "failed",
        error_code: "no_device",
        push_subscription_id: null,
      });
      expect(await stateOf(trx, sending)).toEqual({
        status: "failed",
        error_code: "no_device",
        push_subscription_id: null,
      });
      expect(await stateOf(trx, sent)).toEqual({ status: "sent", error_code: null, push_subscription_id: null });
      expect(await stateOf(trx, failed)).toEqual({
        status: "failed",
        error_code: "push_refused",
        push_subscription_id: null,
      });
      expect(await stateOf(trx, otherDevice)).toEqual({
        status: "pending",
        error_code: null,
        push_subscription_id: other?.id ?? "",
      });
      expect(await removeDevice(trx, { orgId: o.orgId }, id)).toBe(false);
      // The failed row has no lock left: the sender cannot finish it any more.
      const locked = await trx
        .selectFrom("outbox")
        .select("locked_at")
        .where("id", "=", sending)
        .executeTakeFirstOrThrow();
      expect(locked.locked_at).toBeNull();
    });
  });

  test("9: with a userId only a device of that user goes", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const memberId = await addMember(trx, o.orgId);
      const s = await session(trx, o.userId, new Date(NOW.getTime() + HOUR_MS));
      const made = await subscribe(trx, o, o.userId, s);
      const pending = await pushRow(trx, o, made?.id ?? "");
      expect(await removeDevice(trx, { orgId: o.orgId }, made?.id ?? "", { userId: memberId })).toBe(false);
      expect(await stateOf(trx, pending)).toMatchObject({ status: "pending" });
      expect(await removeDevice(trx, { orgId: o.orgId }, made?.id ?? "", { userId: o.userId })).toBe(true);
    });
  });
});

describe("the organization filter", () => {
  test("10: the context of organization B cannot list, read, remove, re-bind or mark a device of organization A", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const s = await session(trx, a.userId, new Date(NOW.getTime() + HOUR_MS));
      const endpoint = endpointOf("of-a");
      const made = await subscribe(trx, a, a.userId, s, { endpoint });
      const id = made?.id ?? "";
      const pending = await pushRow(trx, a, id);
      const ctxB = { orgId: b.orgId };
      expect(await listLiveDeviceIds(trx, ctxB, a.userId, NOW)).toEqual([]);
      expect(await listDeviceViews(trx, ctxB, a.userId, NOW)).toEqual([]);
      expect(await loadDeviceSecret(trx, ctxB, id, box)).toBeNull();
      expect(await removeDevice(trx, ctxB, id)).toBe(false);
      await markPushSuccess(trx, ctxB, id, NOW);
      await markPushError(trx, ctxB, id, "push_refused");
      // B re-binds with the user id and the endpoint of A: no device of B matches (and no row is made with `rebindOnly`).
      expect(await subscribe(trx, ctxB, a.userId, s, { endpoint, rebindOnly: true })).toBeNull();
      const row = await trx
        .selectFrom("push_subscriptions")
        .select(["org_id", "last_success_at", "last_error_code", "session_id"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ org_id: a.orgId, last_success_at: null, last_error_code: null, session_id: s });
      expect(await stateOf(trx, pending)).toMatchObject({ status: "pending", push_subscription_id: id });
      expect(await loadDeviceSecret(trx, { orgId: a.orgId }, id, box)).not.toBeNull();
    });
  });
});

describe("loadDeviceSecret", () => {
  test("11: it returns the endpoint and the keys that were stored, and the user and the session of the device", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const s = await session(trx, o.userId, new Date(NOW.getTime() + HOUR_MS));
      const endpoint = endpointOf("round");
      const made = await subscribe(trx, o, o.userId, s, { endpoint });
      const loaded = await loadDeviceSecret(trx, { orgId: o.orgId }, made?.id ?? "", box);
      expect(loaded).toEqual({
        userId: o.userId,
        sessionId: s,
        target: { endpoint, p256dh: `p256dh-${counter}`, auth: `auth-${counter}` },
      });
      expect(await loadDeviceSecret(trx, { orgId: o.orgId }, randomUUID(), box)).toBeNull();
    });
  });

  test("12b: a secret of another key version throws and removes nothing: the device and its open rows stay", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const s = await session(trx, o.userId, new Date(NOW.getTime() + HOUR_MS));
      const device = await subscribe(trx, o, o.userId, s);
      const row = await pushRow(trx, o, device?.id ?? "");
      const next = createSecretBox(randomBytes(32).toString("base64"), 2);
      await expect(loadDeviceSecret(trx, { orgId: o.orgId }, device?.id ?? "", next)).rejects.toThrow(
        CryptoKeyVersionError
      );
      expect(await deviceCount(trx, o.orgId)).toBe(1);
      expect(await stateOf(trx, row)).toEqual({
        status: "pending",
        error_code: null,
        push_subscription_id: device?.id ?? "",
      });
    });
  });

  test("12: a secret that does not open removes the device, fails its open rows, and logs the device id only", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const s = await session(trx, o.userId, new Date(NOW.getTime() + HOUR_MS));
      const bad = await subscribe(trx, o, o.userId, s);
      const wrongKey = await subscribe(trx, o, o.userId, s);
      const swapped = await subscribe(trx, o, o.userId, s);
      const garbled = await subscribe(trx, o, o.userId, s);
      const good = await subscribe(trx, o, o.userId, s);
      // A garbage secret, a secret of another key, and a secret that was made for another device (the AAD names the id).
      await sql`update push_subscriptions set secret = ${"not-a-secret"} where id = ${bad?.id ?? ""}::uuid`.execute(
        trx
      );
      const other = createSecretBox(randomBytes(32).toString("base64"), 1);
      const foreign = other.encrypt(
        JSON.stringify({ endpoint: endpointOf("x"), p256dh: "p", auth: "a" }),
        `push:${wrongKey?.id ?? ""}`
      );
      await sql`update push_subscriptions set secret = ${foreign.ciphertext} where id = ${wrongKey?.id ?? ""}::uuid`.execute(
        trx
      );
      const mine = await trx
        .selectFrom("push_subscriptions")
        .select("secret")
        .where("id", "=", good?.id ?? "")
        .executeTakeFirstOrThrow();
      await sql`update push_subscriptions set secret = ${mine.secret} where id = ${swapped?.id ?? ""}::uuid`.execute(
        trx
      );
      // A secret that opens but holds text that is no JSON: the parser error must not reach the log with that text.
      const garbledSecret = box.encrypt(`${CANARY_ENDPOINT} is not json`, `push:${garbled?.id ?? ""}`);
      await sql`update push_subscriptions set secret = ${garbledSecret.ciphertext} where id = ${garbled?.id ?? ""}::uuid`.execute(
        trx
      );
      const pendings = await Promise.all(
        [bad, wrongKey, swapped, garbled].map((made) => pushRow(trx, o, made?.id ?? ""))
      );

      const logs = captureLogs();
      try {
        for (const made of [bad, wrongKey, swapped, garbled])
          expect(await loadDeviceSecret(trx, { orgId: o.orgId }, made?.id ?? "", box)).toBeNull();
        const events = eventLines(logs.lines, "push_secret_unreadable");
        expect(events.map((line) => line.push_subscription_id).sort()).toEqual(
          [bad?.id, wrongKey?.id, swapped?.id, garbled?.id].sort()
        );
        expect(logProblems(logs.lines, [CANARY_ENDPOINT, "not-a-secret", "p256dh-", "fcm.googleapis.com"])).toEqual([]);
      } finally {
        logs.stop();
      }
      for (const id of pendings)
        expect(await stateOf(trx, id)).toMatchObject({ status: "failed", error_code: "no_device" });
      const left = await trx.selectFrom("push_subscriptions").select("id").where("org_id", "=", o.orgId).execute();
      expect(left.map((row) => row.id)).toEqual([good?.id ?? ""]);
    });
  });
});

describe("markPushSuccess, markPushError and pushDedupKey", () => {
  test("13: success sets the time and clears the error; an error sets a short code; a bad code is refused by the table", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const s = await session(trx, o.userId, new Date(NOW.getTime() + HOUR_MS));
      const made = await subscribe(trx, o, o.userId, s);
      const id = made?.id ?? "";
      const read = () =>
        trx
          .selectFrom("push_subscriptions")
          .select(["last_success_at", "last_error_code"])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();
      await markPushError(trx, { orgId: o.orgId }, id, "too_many_errors");
      expect(await read()).toEqual({ last_success_at: null, last_error_code: "too_many_errors" });
      await markPushSuccess(trx, { orgId: o.orgId }, id, NOW);
      expect(await read()).toEqual({ last_success_at: NOW, last_error_code: null });
      await sql`savepoint f118_code`.execute(trx);
      await expect(markPushError(trx, { orgId: o.orgId }, id, "https://x.test")).rejects.toMatchObject({
        code: "23514",
      });
      await sql`rollback to savepoint f118_code`.execute(trx);
    });
  });

  test("14: the dedup key of a push row is the Telegram key, the word push and the device id", () => {
    expect(pushDedupKey("urgent:abc", "d1")).toBe("urgent:abc:push:d1");
  });
});
