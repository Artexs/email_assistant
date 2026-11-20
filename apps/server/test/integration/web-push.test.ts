import { randomUUID } from "node:crypto";

import {
  pushPayloadSchema,
  pushStateSchema,
  pushSubscriptionAnswerSchema,
  pushTestAnswerSchema,
  MINUTE_MS,
} from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { endpointHash, PUSH_TEST_LIMIT } from "../../src/modules/channels/push";
import { insertMembership } from "../../src/modules/tenancy/repo";
import { captureLogs, logProblems } from "../log-capture";

import { testDb } from "./helpers";
import { webOrg, type WebOrg } from "./web-helpers";
import {
  as,
  CANARY_ENDPOINT,
  box,
  CHROME_ANDROID,
  configNoPush,
  decryptPushBody,
  fakePush,
  flagOn,
  newReceiver,
  newSession,
  pushApp,
  put,
  subscriptionBody,
  vapid,
} from "./web-push-kit";

// The push device API (`/api/me/push`): flag, validation of an untrusted body, own-user filters, the session binding, the test notice.
const db = testDb();
let org: WebOrg;
let owner = "";
let owner2 = "";
let assistant = "";
const push = fakePush();
const clock = { now: new Date() };

const app = () =>
  pushApp({ db, sessions: { [owner]: org.ownerId, [owner2]: org.ownerId, [assistant]: org.assistantId }, push, clock });

beforeEach(async () => {
  org = await webOrg(db);
  owner = await newSession(db, org.ownerId);
  owner2 = await newSession(db, org.ownerId);
  assistant = await newSession(db, org.assistantId);
  await flagOn(db, org.orgId, org.ownerId);
  push.calls.length = 0;
  push.answer(201);
  clock.now = new Date();
});

afterEach(async () => {
  await org.cleanup();
});

afterAll(async () => {
  await db.destroy();
});

const devicesOf = (userId: string) =>
  db.selectFrom("push_subscriptions").selectAll().where("user_id", "=", userId).execute();
const auditOf = (event: string) =>
  db
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", org.orgId)
    .where("event", "=", event)
    .orderBy("id")
    .execute();

async function register(cookie: string, receiver = newReceiver(), endpoint = `${CANARY_ENDPOINT}-${randomUUID()}`) {
  const res = await app().request("/api/me/push/subscription", put(cookie, subscriptionBody(receiver, endpoint)));
  expect(res.status).toBe(200);
  return { receiver, endpoint, id: pushSubscriptionAnswerSchema.parse(await res.json()).id };
}

describe("the flag web_push", () => {
  test("1. off: every route answers 404 not_found, for the owner and the assistant; a real device stays", async () => {
    const mine = await register(owner);
    await db.deleteFrom("org_features").where("org_id", "=", org.orgId).execute();
    const calls: [string, string][] = [
      ["GET", "/api/me/push"],
      ["PUT", "/api/me/push/subscription"],
      ["DELETE", `/api/me/push/devices/${randomUUID()}`],
      ["POST", "/api/me/push/test"],
    ];
    for (const who of [owner, assistant]) {
      for (const [method, path] of calls) {
        const init =
          method === "PUT"
            ? put(who, subscriptionBody(newReceiver()))
            : as(who, { method, body: method === "POST" ? {} : undefined });
        const res = await app().request(path, init);
        expect({
          method,
          path: path.slice(0, 18),
          status: res.status,
          body: await res.json().catch(() => null),
        }).toEqual({
          method,
          path: path.slice(0, 18),
          status: 404,
          body: { error: "not_found" },
        });
      }
    }
    // The id of a real device of the caller: with the flag off the DELETE is a 404 too, and the device stays.
    const real = await app().request(`/api/me/push/devices/${mine.id}`, as(owner, { method: "DELETE" }));
    expect({ status: real.status, body: await real.json() }).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await devicesOf(org.ownerId)).toHaveLength(1);
    expect(push.calls).toHaveLength(0);
  });

  test("without a session every route answers 401", async () => {
    const res = await app().request("/api/me/push", as("nobody"));
    expect(res.status).toBe(401);
  });

  test("a write without a trusted Origin answers 403 bad_origin and stores nothing", async () => {
    const init = put(owner, subscriptionBody(newReceiver()));
    const headers = { ...(init.headers as Record<string, string>), origin: "https://evil.example" };
    const res = await app().request("/api/me/push/subscription", { ...init, headers });
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 403, body: { error: "bad_origin" } });
    expect(await devicesOf(org.ownerId)).toHaveLength(0);
  });
});

describe("PUT /api/me/push/subscription and GET /api/me/push", () => {
  test("2. a valid FCM endpoint is listed with thisSession; the label has two words; the audit row holds no endpoint", async () => {
    const receiver = newReceiver();
    // The browser sends unpadded base64url: 87 characters for the key, 22 for the auth secret.
    expect(receiver.sub.p256dh).toHaveLength(87);
    expect(receiver.sub.auth).toHaveLength(22);
    const res = await app().request("/api/me/push/subscription", put(owner, subscriptionBody(receiver)));
    expect(res.status).toBe(200);
    const { id } = pushSubscriptionAnswerSchema.parse(await res.json());

    const list = await app().request("/api/me/push", as(owner));
    const text = await list.text();
    const state = pushStateSchema.parse(JSON.parse(text));
    expect(state.vapidPublicKey).toBe(vapid.publicKey);
    expect(state.devices).toHaveLength(1);
    expect(state.devices[0]).toMatchObject({ id, label: "Chrome on Android", thisSession: true, lastSuccessAt: null });
    expect(text).not.toContain("CANARYPUSH");
    expect(text).not.toContain(receiver.sub.p256dh);

    // Another session of the same user sees the device, but it is not bound to that session.
    const other = pushStateSchema.parse(await (await app().request("/api/me/push", as(owner2))).json());
    expect(other.devices.map((d) => [d.id, d.thisSession])).toEqual([[id, false]]);
    // Another member sees no device of the owner.
    const mine = pushStateSchema.parse(await (await app().request("/api/me/push", as(assistant))).json());
    expect(mine.devices).toEqual([]);

    const rows = await auditOf("push.subscribed");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(org.ownerId);
    expect(rows[0]?.data).toEqual({ push_subscription_id: id, created: true, via: "web" });
    expect(JSON.stringify(rows)).not.toContain("CANARYPUSH");
    const [row] = await devicesOf(org.ownerId);
    expect(row?.session_id).toBe(owner);
    expect(row?.device_label).toBe("Chrome on Android");
    expect(push.calls).toHaveLength(0);
  });

  test("the label never holds the User-Agent text; an unknown agent gets the word Browser", async () => {
    const res = await app().request(
      "/api/me/push/subscription",
      put(owner, subscriptionBody(newReceiver()), `curl/8 ${"x".repeat(500)}`)
    );
    expect(res.status).toBe(200);
    expect((await devicesOf(org.ownerId))[0]?.device_label).toBe("Browser");
  });

  test("3. a host outside the push services answers 400 push_host_not_allowed and stores nothing", async () => {
    for (const endpoint of [
      "https://example.com/x",
      "https://fcm.googleapis.com.evil.example/fcm/send/CANARYPUSH",
      "https://evil.example/fcm.googleapis.com",
      "https://127.0.0.1/CANARYPUSH",
    ]) {
      const res = await app().request(
        "/api/me/push/subscription",
        put(owner, subscriptionBody(newReceiver(), endpoint))
      );
      const text = await res.text();
      expect({ endpoint: endpoint.slice(8, 20), status: res.status, body: text }).toEqual({
        endpoint: endpoint.slice(8, 20),
        status: 400,
        body: JSON.stringify({ error: "push_host_not_allowed" }),
      });
    }
    expect(await devicesOf(org.ownerId)).toHaveLength(0);
    expect(await auditOf("push.subscribed")).toHaveLength(0);
  });

  test("a scheme other than https, a port, user info and a bad URL answer 400 validation without the endpoint", async () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/CANARYPUSH",
      "https://fcm.googleapis.com:8443/fcm/send/CANARYPUSH",
      "https://user:CANARYPUSH@fcm.googleapis.com/x",
      "CANARYPUSH not a url",
    ]) {
      const res = await app().request(
        "/api/me/push/subscription",
        put(owner, subscriptionBody(newReceiver(), endpoint))
      );
      const text = await res.text();
      expect({ status: res.status, error: (JSON.parse(text) as { error: string }).error }).toEqual({
        status: 400,
        error: "validation",
      });
      expect(text).not.toContain("CANARYPUSH");
    }
    expect(await devicesOf(org.ownerId)).toHaveLength(0);
  });

  test("4. padded base64url keys, short keys and a point that is not on the curve answer 400 validation; no answer echoes a key", async () => {
    const receiver = newReceiver();
    const badPoint = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
    const cases: Record<string, { p256dh: string; auth: string }> = {
      // `decodeBase64Url` refuses padding; the API neither adds nor strips it.
      "padded p256dh": { p256dh: `${receiver.sub.p256dh}=`, auth: receiver.sub.auth },
      "padded auth": { p256dh: receiver.sub.p256dh, auth: `${receiver.sub.auth}==` },
      "short p256dh": { p256dh: receiver.sub.p256dh.slice(0, 40), auth: receiver.sub.auth },
      "short auth": { p256dh: receiver.sub.p256dh, auth: receiver.sub.auth.slice(0, 10) },
      "point off the curve": { p256dh: badPoint, auth: receiver.sub.auth },
      "standard base64 alphabet": {
        p256dh: receiver.sub.p256dh.replace(/-/g, "+").replace(/_/g, "/") + "+",
        auth: receiver.sub.auth,
      },
    };
    for (const [name, keys] of Object.entries(cases)) {
      const res = await app().request("/api/me/push/subscription", put(owner, { endpoint: CANARY_ENDPOINT, keys }));
      const text = await res.text();
      expect({ name, status: res.status, error: (JSON.parse(text) as { error: string }).error }).toEqual({
        name,
        status: 400,
        error: "validation",
      });
      for (const secret of [keys.p256dh, keys.auth, "CANARYPUSH"]) expect(text).not.toContain(secret);
    }
    expect(await devicesOf(org.ownerId)).toHaveLength(0);
    // The same keys without padding pass.
    await register(owner, receiver);
  });

  test("4b. a body past its caps, with a wrong type or with another key answers 400 or 413; no answer echoes the endpoint", async () => {
    const receiver = newReceiver();
    const long = (n: number) => `${CANARY_ENDPOINT}/${"a".repeat(n)}`;
    const bodies: [string, unknown, number][] = [
      ["endpoint 1025", { endpoint: long(1025 - CANARY_ENDPOINT.length - 1), keys: receiver.sub }, 400],
      ["p256dh 101", { endpoint: CANARY_ENDPOINT, keys: { p256dh: "a".repeat(101), auth: receiver.sub.auth } }, 400],
      ["auth 51", { endpoint: CANARY_ENDPOINT, keys: { p256dh: receiver.sub.p256dh, auth: "a".repeat(51) } }, 400],
      ["endpoint is a number", { endpoint: 5, keys: receiver.sub }, 400],
      ["endpoint is empty", { endpoint: "", keys: receiver.sub }, 400],
      ["keys missing", { endpoint: CANARY_ENDPOINT }, 400],
      ["extra field", { endpoint: CANARY_ENDPOINT, keys: receiver.sub, userId: org.otherOwnerId }, 400],
      ["extra key field", { endpoint: CANARY_ENDPOINT, keys: { ...receiver.sub, extra: 1 } }, 400],
      ["rebindOnly is a string", { endpoint: CANARY_ENDPOINT, keys: receiver.sub, rebindOnly: "yes" }, 400],
      ["body above 64 KB", { endpoint: CANARY_ENDPOINT, keys: receiver.sub, pad: "a".repeat(70_000) }, 413],
    ];
    for (const [name, body, status] of bodies) {
      const res = await app().request("/api/me/push/subscription", put(owner, body));
      const text = await res.text();
      expect({ name, status: res.status }).toEqual({ name, status });
      expect(text).not.toContain("CANARYPUSH");
      expect(text).not.toContain(receiver.sub.p256dh);
      // The size caps and the strict objects answer from the schema, not from a later check.
      const code = (JSON.parse(text) as { details?: { code: string }[] }).details?.[0]?.code;
      const expected = { "endpoint 1025": "too_big", "p256dh 101": "too_big", "auth 51": "too_big" }[name];
      if (expected !== undefined) expect({ name, code }).toEqual({ name, code: expected });
      if (name.startsWith("extra")) expect({ name, code }).toEqual({ name, code: "unrecognized_keys" });
    }
    const notJson = await app().request("/api/me/push/subscription", {
      ...put(owner, {}),
      body: `{"endpoint":"${CANARY_ENDPOINT}`,
    });
    expect(notJson.status).toBe(400);
    expect(await notJson.text()).not.toContain("CANARYPUSH");
    expect(await devicesOf(org.ownerId)).toHaveLength(0);
  });

  test("5. no VAPID keys on the server: PUT and POST test answer 409 push_off, GET gives a null key; nothing is stored", async () => {
    const off = pushApp({ db, sessions: { [owner]: org.ownerId }, config: configNoPush, push, clock });
    const res = await off.request("/api/me/push/subscription", put(owner, subscriptionBody(newReceiver())));
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 409, body: { error: "push_off" } });
    const test = await off.request("/api/me/push/test", as(owner, { method: "POST", body: {} }));
    expect({ status: test.status, body: await test.json() }).toEqual({ status: 409, body: { error: "push_off" } });
    const state = pushStateSchema.parse(await (await off.request("/api/me/push", as(owner))).json());
    expect(state).toEqual({ vapidPublicKey: null, devices: [] });
    expect(await devicesOf(org.ownerId)).toHaveLength(0);
  });

  test("the same endpoint from a second session re-binds the one device (created false)", async () => {
    const { receiver, endpoint, id } = await register(owner);
    const res = await app().request("/api/me/push/subscription", put(owner2, subscriptionBody(receiver, endpoint)));
    expect(pushSubscriptionAnswerSchema.parse(await res.json()).id).toBe(id);
    const rows = await devicesOf(org.ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.session_id).toBe(owner2);
    expect((await auditOf("push.subscribed")).map((r) => (r.data as { created: boolean }).created)).toEqual([
      true,
      false,
    ]);
  });

  test("one browser is one device: a leading space, an upper case host and :443 store the canonical endpoint once", async () => {
    const receiver = newReceiver();
    const canonical = `${CANARY_ENDPOINT}-canon`;
    const first = await register(owner, receiver, canonical);
    const variants = [
      ` ${canonical}`,
      `${canonical} `,
      canonical.replace("fcm.googleapis.com", "FCM.Googleapis.COM"),
      canonical.replace("fcm.googleapis.com", "fcm.googleapis.com:443"),
    ];
    for (const endpoint of variants) {
      const res = await app().request("/api/me/push/subscription", put(owner2, subscriptionBody(receiver, endpoint)));
      expect(res.status).toBe(200);
      expect(pushSubscriptionAnswerSchema.parse(await res.json()).id).toBe(first.id);
    }
    const rows = await devicesOf(org.ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.endpoint_hash).toBe(endpointHash(canonical));
    // The stored endpoint is the canonical one (the sender reads it back from the secret).
    expect(
      JSON.parse(
        box.decrypt({ ciphertext: rows[0]?.secret ?? "", keyVersion: rows[0]?.key_version ?? 1 }, `push:${first.id}`)
      )
    ).toMatchObject({ endpoint: canonical });
    expect((await auditOf("push.subscribed")).map((r) => (r.data as { created: boolean }).created)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  test("GET /api/me/push answers Cache-Control: no-store (the device list is per user and per session)", async () => {
    const res = await app().request("/api/me/push", as(owner));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("8. rebindOnly: no device of this user answers 404 no_device and stores nothing; a device of another member stays as it is", async () => {
    const { receiver, endpoint, id } = await register(owner);
    // The assistant signs in on the browser that holds the owner's subscription.
    const res = await app().request(
      "/api/me/push/subscription",
      put(assistant, { ...subscriptionBody(receiver, endpoint), rebindOnly: true })
    );
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 404, body: { error: "no_device" } });
    expect(await devicesOf(org.assistantId)).toHaveLength(0);
    const [row] = await devicesOf(org.ownerId);
    expect({ id: row?.id, session: row?.session_id }).toEqual({ id, session: owner });

    // A new endpoint with rebindOnly stores nothing either.
    const fresh = await app().request(
      "/api/me/push/subscription",
      put(owner, { ...subscriptionBody(newReceiver()), rebindOnly: true })
    );
    expect(fresh.status).toBe(404);
    expect(await devicesOf(org.ownerId)).toHaveLength(1);

    // The owner's own device re-binds to the new session.
    const rebind = await app().request(
      "/api/me/push/subscription",
      put(owner2, { ...subscriptionBody(receiver, endpoint), rebindOnly: true })
    );
    expect(pushSubscriptionAnswerSchema.parse(await rebind.json()).id).toBe(id);
    expect((await devicesOf(org.ownerId))[0]?.session_id).toBe(owner2);
  });

  test("8b. a panel load of a session that already holds the device writes no audit row; a re-bind to a new session and a click do", async () => {
    const { receiver, endpoint, id } = await register(owner);
    const audited = async () => (await auditOf("push.subscribed")).map((r) => (r.data as { created: boolean }).created);
    expect(await audited()).toEqual([true]);
    const load = (cookie: string) =>
      app().request(
        "/api/me/push/subscription",
        put(cookie, { ...subscriptionBody(receiver, endpoint), rebindOnly: true })
      );

    // The same session loads the panel three times: the device stays, the answer is the same, no audit row.
    for (let i = 0; i < 3; i += 1) {
      const res = await load(owner);
      expect(pushSubscriptionAnswerSchema.parse(await res.json()).id).toBe(id);
    }
    expect(await audited()).toEqual([true]);

    // A new session re-binds the device: one audit row. Its next loads write none.
    expect((await load(owner2)).status).toBe(200);
    expect(await audited()).toEqual([true, false]);
    expect((await load(owner2)).status).toBe(200);
    expect((await load(owner2)).status).toBe(200);
    expect(await audited()).toEqual([true, false]);
    expect((await devicesOf(org.ownerId))[0]?.session_id).toBe(owner2);

    // The click (no `rebindOnly`) is a user action: audited each time, also from the session that holds the device.
    const click = await app().request("/api/me/push/subscription", put(owner2, subscriptionBody(receiver, endpoint)));
    expect(click.status).toBe(200);
    expect(await audited()).toEqual([true, false, false]);
  });

  test("an endpoint that the user registered in another organization answers 409 push_device_elsewhere", async () => {
    // The assistant is a member of the first organization and, later, of the second. The tenant is the first.
    const endpoint = `${CANARY_ENDPOINT}-elsewhere`;
    const receiver = newReceiver();
    await insertMembership(db, { orgId: org.otherOrgId }, { userId: org.assistantId, role: "assistant" });
    await sql`
      insert into push_subscriptions (id, org_id, user_id, session_id, secret, key_version, endpoint_hash, device_label)
      values (${randomUUID()}::uuid, ${org.otherOrgId}::uuid, ${org.assistantId}::uuid, ${assistant}::uuid, '\\x00'::bytea, 1,
        encode(sha256(${endpoint}::bytea), 'hex'), 'Phone')`.execute(db);
    const res = await app().request("/api/me/push/subscription", put(assistant, subscriptionBody(receiver, endpoint)));
    const text = await res.text();
    expect({ status: res.status, body: text }).toEqual({
      status: 409,
      body: JSON.stringify({ error: "push_device_elsewhere" }),
    });
    expect(await devicesOf(org.assistantId)).toHaveLength(1);
  });

  test("a PUT stores the endpoint and the keys only inside the encrypted secret", async () => {
    const receiver = newReceiver();
    await register(owner, receiver);
    const [row] = await devicesOf(org.ownerId);
    const plain = Buffer.from(row?.secret ?? []).toString("latin1");
    expect(plain).not.toContain("CANARYPUSH");
    expect(plain).not.toContain(receiver.sub.p256dh);
    expect(JSON.stringify({ ...row, secret: undefined })).not.toContain("CANARYPUSH");
  });
});

describe("DELETE /api/me/push/devices/:id", () => {
  test("4. another member of the same organization and another organization get 404; the device stays; the owner removes it", async () => {
    const { id } = await register(owner);
    const mine = await app().request(`/api/me/push/devices/${id}`, as(assistant, { method: "DELETE" }));
    expect({ status: mine.status, body: await mine.json() }).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await devicesOf(org.ownerId)).toHaveLength(1);
    expect(await auditOf("push.removed")).toHaveLength(0);

    // The owner of the other organization.
    const otherSession = await newSession(db, org.otherOwnerId);
    await flagOn(db, org.otherOrgId, org.otherOwnerId);
    const otherApp = pushApp({ db, sessions: { [otherSession]: org.otherOwnerId }, push, clock });
    const foreign = await otherApp.request(`/api/me/push/devices/${id}`, as(otherSession, { method: "DELETE" }));
    expect(foreign.status).toBe(404);
    expect(await devicesOf(org.ownerId)).toHaveLength(1);

    const bad = await app().request("/api/me/push/devices/not-a-uuid", as(owner, { method: "DELETE" }));
    expect(bad.status).toBe(404);

    const own = await app().request(`/api/me/push/devices/${id}`, as(owner2, { method: "DELETE" }));
    expect(own.status).toBe(204);
    expect(await devicesOf(org.ownerId)).toHaveLength(0);
    const rows = await auditOf("push.removed");
    expect(rows.map((r) => r.data)).toEqual([{ push_subscription_id: id, via: "web" }]);
    expect(rows[0]?.actor).toBe(org.ownerId);

    const again = await app().request(`/api/me/push/devices/${id}`, as(owner, { method: "DELETE" }));
    expect(again.status).toBe(404);
  });

  test("an upper case uuid in the path removes the device; the audit row and the log hold the lower case id", async () => {
    const { id } = await register(owner);
    expect(id).toBe(id.toLowerCase());
    const logs = captureLogs();
    try {
      const res = await app().request(`/api/me/push/devices/${id.toUpperCase()}`, as(owner, { method: "DELETE" }));
      expect(res.status).toBe(204);
    } finally {
      logs.stop();
    }
    expect(await devicesOf(org.ownerId)).toHaveLength(0);
    expect((await auditOf("push.removed")).map((r) => r.data)).toEqual([{ push_subscription_id: id, via: "web" }]);
    const removedLine = logs.lines.find((line) => line.includes("push_removed")) ?? "";
    expect(removedLine).toContain(id);
    expect(removedLine).not.toContain(id.toUpperCase());
  });
});

describe("POST /api/me/push/test", () => {
  test("6. 201 answers sent 1 with a decryptable test payload; 410 answers sent 0 and removes the device; 5xx keeps it with an error code", async () => {
    const { receiver, endpoint, id } = await register(owner);
    // A device of another session of the same user is not tried.
    await register(owner2);

    push.answer(201);
    const ok = await app().request("/api/me/push/test", as(owner, { method: "POST", body: {} }));
    expect(pushTestAnswerSchema.parse(await ok.json())).toEqual({ sent: 1 });
    expect(push.calls).toHaveLength(1);
    expect(push.calls[0]?.url).toBe(endpoint);
    const payload = JSON.parse(
      decryptPushBody(push.calls[0]?.body ?? new Uint8Array(), receiver).toString("utf8")
    ) as Record<string, unknown>;
    expect(payload).toEqual({
      v: 1,
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      kind: "test",
      count: 1,
      itemId: null,
      lang: "pl",
    });
    // The service worker parses the same bytes with this schema: the test payload must pass it.
    expect(pushPayloadSchema.safeParse(payload).success).toBe(true);
    expect((await devicesOf(org.ownerId)).find((d) => d.id === id)?.last_success_at).not.toBeNull();

    push.answer(500);
    const retry = await app().request("/api/me/push/test", as(owner, { method: "POST", body: {} }));
    expect(await retry.json()).toEqual({ sent: 0 });
    expect((await devicesOf(org.ownerId)).find((d) => d.id === id)?.last_error_code).toBe("push_retry");

    push.answer(410);
    const gone = await app().request("/api/me/push/test", as(owner, { method: "POST", body: {} }));
    expect(await gone.json()).toEqual({ sent: 0 });
    const left = await devicesOf(org.ownerId);
    expect(left.map((d) => d.id)).not.toContain(id);
    expect(left).toHaveLength(1);
  });

  test("a device sealed under another key version answers 500 internal, stays, and is not tried (a configuration fault, not a dead device)", async () => {
    const { id } = await register(owner);
    // The server key is now another version than the one that sealed the stored secret.
    await db.updateTable("push_subscriptions").set({ key_version: 2 }).where("id", "=", id).execute();
    const logs = captureLogs();
    try {
      const res = await app().request("/api/me/push/test", as(owner, { method: "POST", body: {} }));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal" });
    } finally {
      logs.stop();
    }
    expect(push.calls).toHaveLength(0);
    expect((await devicesOf(org.ownerId)).map((d) => d.id)).toContain(id);
    // The failed call rolled back with its transaction: it wrote no audit row and used no part of the hourly limit.
    expect(await auditOf("push.test_sent")).toHaveLength(0);
  });

  test("the payload language is the locale of the user", async () => {
    const { receiver } = await register(owner);
    await db.updateTable("users").set({ locale: "en" }).where("id", "=", org.ownerId).execute();
    await app().request("/api/me/push/test", as(owner, { method: "POST", body: {} }));
    const payload = JSON.parse(decryptPushBody(push.calls[0]?.body ?? new Uint8Array(), receiver).toString("utf8")) as {
      lang: string;
    };
    expect(payload.lang).toBe("en");
  });

  test("6b. the 6th call in an hour answers 429 push_test_limit and sends nothing; the limit is per user and ends after the hour", async () => {
    await register(owner);
    await register(assistant);
    for (let i = 0; i < PUSH_TEST_LIMIT; i += 1) {
      const res = await app().request("/api/me/push/test", as(owner, { method: "POST", body: {} }));
      expect(res.status).toBe(200);
    }
    expect(push.calls).toHaveLength(PUSH_TEST_LIMIT);
    const sixth = await app().request("/api/me/push/test", as(owner, { method: "POST", body: {} }));
    expect({ status: sixth.status, body: await sixth.json() }).toEqual({
      status: 429,
      body: { error: "push_test_limit" },
    });
    expect(push.calls).toHaveLength(PUSH_TEST_LIMIT);

    const other = await app().request("/api/me/push/test", as(assistant, { method: "POST", body: {} }));
    expect(other.status).toBe(200);

    clock.now = new Date(clock.now.getTime() + 61 * MINUTE_MS);
    const later = await app().request("/api/me/push/test", as(owner, { method: "POST", body: {} }));
    expect(later.status).toBe(200);
    expect(await auditOf("push.test_sent")).toHaveLength(PUSH_TEST_LIMIT + 2);
  });

  test("6c. twelve calls at once: exactly 5 pass and 7 answer 429 (the count and its audit row sit under the user lock)", async () => {
    await register(owner);
    const answers = await Promise.all(
      Array.from({ length: 12 }, () => app().request("/api/me/push/test", as(owner, { method: "POST", body: {} })))
    );
    expect(answers.map((res) => res.status).sort()).toEqual([
      ...Array(PUSH_TEST_LIMIT).fill(200),
      ...Array(12 - PUSH_TEST_LIMIT).fill(429),
    ]);
    expect(await auditOf("push.test_sent")).toHaveLength(PUSH_TEST_LIMIT);
    expect(push.calls).toHaveLength(PUSH_TEST_LIMIT);
  });

  test("a call with no device on the session counts and answers sent 0", async () => {
    await register(owner);
    const res = await app().request("/api/me/push/test", as(owner2, { method: "POST", body: {} }));
    expect(await res.json()).toEqual({ sent: 0 });
    expect(push.calls).toHaveLength(0);
  });
});

describe("logs", () => {
  test("7. no log line of a run holds the planted endpoint or key", async () => {
    const receiver = newReceiver();
    const logs = captureLogs();
    try {
      const { id } = await register(owner, receiver, CANARY_ENDPOINT);
      await app().request("/api/me/push", as(owner));
      await app().request(
        "/api/me/push/subscription",
        put(owner, subscriptionBody(receiver, "https://example.com/CANARYPUSH"))
      );
      await app().request(
        "/api/me/push/subscription",
        put(owner, { endpoint: CANARY_ENDPOINT, keys: { ...receiver.sub, auth: `${receiver.sub.auth}=` } })
      );
      push.answer(201, 500, 410);
      for (let i = 0; i < 3; i += 1) await app().request("/api/me/push/test", as(owner, { method: "POST", body: {} }));
      await app().request(`/api/me/push/devices/${id}`, as(owner, { method: "DELETE" }));
      expect(push.calls.length).toBeGreaterThan(0);
      expect(logs.lines.length).toBeGreaterThan(0);
      expect(logProblems(logs.lines, [CANARY_ENDPOINT, "CANARYPUSH", receiver.sub.p256dh, receiver.sub.auth])).toEqual(
        []
      );
    } finally {
      logs.stop();
    }
  });
});

void CHROME_ANDROID;
