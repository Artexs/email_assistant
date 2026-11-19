import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import {
  MAX_DEVICES_PER_USER,
  PushDeviceElsewhereError,
  upsertPushSubscription,
} from "../../src/modules/channels/push";
import type { DB } from "../../src/platform/db";

import { testDb } from "./helpers";
import { webOrg, type WebOrg } from "./web-helpers";
import { box, newSession } from "./web-push-kit";

// Two subscribes of one user at the same time (a finding of the review of the push migration). Without a lock both pass the first
// `select` before either commits. The test holds the first transaction open after its insert, starts the second, and commits the first.
const db = testDb();
let org: WebOrg;
let sessionId = "";

beforeEach(async () => {
  org = await webOrg(db);
  sessionId = await newSession(db, org.ownerId);
});
afterEach(async () => {
  await org.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;
const endpointOf = () => `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
const subscribe = (trx: Trx, userId: string, endpoint: string, session = sessionId) =>
  upsertPushSubscription(
    trx,
    { orgId: org.orgId },
    {
      userId,
      sessionId: session,
      endpoint,
      p256dh: "p256dh",
      auth: "auth",
      deviceLabel: "Phone",
      box,
      now: new Date(),
    }
  );
const rowsOf = (userId: string) =>
  db
    .selectFrom("push_subscriptions")
    .select(["id", "endpoint_hash"])
    .where("user_id", "=", userId)
    .orderBy("created_at")
    .execute();

// A Postgres session that waits for a lock (the user lock or the unique key).
async function someoneWaits(): Promise<boolean> {
  const { rows } = await sql<{ n: string }>`
    select count(*)::text as n from pg_stat_activity
    where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`.execute(db);
  return Number(rows[0]?.n ?? 0) > 0;
}

// `first` runs in a transaction that stays open; `second` starts after it; the first commits when the second waits or has ended.
async function interleave<A, B>(first: (trx: Trx) => Promise<A>, second: (trx: Trx) => Promise<B>) {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let opened = (): void => undefined;
  const inserted = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const a = db.transaction().execute(async (trx) => {
    const result = await first(trx);
    opened();
    await gate;
    return result;
  });
  await inserted;
  let ended = false;
  const b = db
    .transaction()
    .execute(second)
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    )
    .finally(() => {
      ended = true;
    });
  for (let i = 0; i < 60 && !ended && !(await someoneWaits()); i += 1) await new Promise((r) => setTimeout(r, 50));
  const waited = !ended;
  release();
  return { first: await a, second: await b, waited };
}

describe("two subscribes of one user at once", () => {
  test("the same endpoint twice: one device; the second is a re-bind, not an error about another organization", async () => {
    const endpoint = endpointOf();
    const other = await newSession(db, org.ownerId);
    const run = await interleave(
      (trx) => subscribe(trx, org.ownerId, endpoint),
      (trx) => subscribe(trx, org.ownerId, endpoint, other)
    );
    expect(run.waited).toBe(true);
    expect(run.second.ok).toBe(true);
    const rows = await rowsOf(org.ownerId);
    expect(rows).toHaveLength(1);
    expect(run.first).toEqual({ id: rows[0]?.id ?? "", created: true, sessionChanged: true });
    expect(run.second.ok && run.second.value).toEqual({ id: rows[0]?.id ?? "", created: false, sessionChanged: true });
    // The second session won the row: it re-bound the device.
    const [row] = await db
      .selectFrom("push_subscriptions")
      .select("session_id")
      .where("user_id", "=", org.ownerId)
      .execute();
    expect(row?.session_id).toBe(other);
  });

  test("two new devices at 9: the user ends with 10, not 11; the oldest goes", async () => {
    for (let i = 0; i < MAX_DEVICES_PER_USER - 1; i += 1) {
      await db.transaction().execute((trx) => subscribe(trx, org.ownerId, endpointOf()));
    }
    const before = await rowsOf(org.ownerId);
    expect(before).toHaveLength(MAX_DEVICES_PER_USER - 1);
    const run = await interleave(
      (trx) => subscribe(trx, org.ownerId, endpointOf()),
      (trx) => subscribe(trx, org.ownerId, endpointOf())
    );
    expect(run.waited).toBe(true);
    expect(run.second.ok).toBe(true);
    const after = await rowsOf(org.ownerId);
    expect(after).toHaveLength(MAX_DEVICES_PER_USER);
    // The second subscribe saw 10 devices and removed the oldest one.
    expect(after.map((r) => r.id)).not.toContain(before[0]?.id ?? "");
    expect(after.map((r) => r.id)).toContain(before[1]?.id ?? "");
  });

  test("another user does not wait: the lock is per user", async () => {
    const assistantSession = await newSession(db, org.assistantId);
    const run = await interleave(
      (trx) => subscribe(trx, org.ownerId, endpointOf()),
      (trx) => subscribe(trx, org.assistantId, endpointOf(), assistantSession)
    );
    // The second transaction ended while the first was still open.
    expect(run.waited).toBe(false);
    expect(run.second.ok).toBe(true);
    expect(await rowsOf(org.ownerId)).toHaveLength(1);
    expect(await rowsOf(org.assistantId)).toHaveLength(1);
  });

  test("the same endpoint of the same user in another organization still answers PushDeviceElsewhereError", async () => {
    const endpoint = endpointOf();
    await db.transaction().execute((trx) => subscribe(trx, org.ownerId, endpoint));
    // A second organization of the owner: the first device is invisible there (RLS-style org filter), the unique key still holds it.
    await sql`insert into memberships (org_id, user_id, role) values (${org.otherOrgId}::uuid, ${org.ownerId}::uuid, 'owner')`.execute(
      db
    );
    const result = await db
      .transaction()
      .execute((trx) =>
        upsertPushSubscription(
          trx,
          { orgId: org.otherOrgId },
          {
            userId: org.ownerId,
            sessionId,
            endpoint,
            p256dh: "p",
            auth: "a",
            deviceLabel: "Phone",
            box,
            now: new Date(),
          }
        )
      )
      .catch((error: unknown) => error);
    expect(result).toBeInstanceOf(PushDeviceElsewhereError);
  });
});
