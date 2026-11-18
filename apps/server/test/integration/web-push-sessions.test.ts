import { randomUUID } from "node:crypto";

import { pushStateSchema, pushSubscriptionAnswerSchema } from "@ea/core";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { listDeviceViews, listLiveDeviceIds } from "../../src/modules/channels/push";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { createAuth } from "../../src/platform/auth";
import { auditWebEvent, termsAcceptedHandler } from "../../src/web";

import { testDb } from "./helpers";
import { resetBody } from "./web-helpers";
import { as, fakePush, flagOn, newReceiver, pushApp, put, subscriptionBody } from "./web-push-kit";

// A device is bound to the sign-in session that registered it. Real Better Auth sessions: sign-out, revoke-other-sessions and a
// password reset (`revokeSessionsOnPasswordReset`) must each end the devices of the sessions they delete.
const db = testDb();
const BASE_URL = "http://127.0.0.1:8080";
const PASSWORD = "correct-horse-battery-staple";
const resets: { userId: string; url: string }[] = [];
const handle = createAuth({
  databaseUrl: process.env.DATABASE_URL ?? "",
  baseUrl: BASE_URL,
  secret: "x".repeat(40),
  trustedOrigins: [BASE_URL],
  onEvent: auditWebEvent(db),
  onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
  resetLinkTtlSeconds: 86_400,
  sendResetPassword: async (input) => {
    resets.push(input);
  },
});

const orgIds: string[] = [];
const userIds: string[] = [];
const push = fakePush();
let warnSpy: ReturnType<typeof spyOn>;

beforeAll(() => {
  warnSpy = spyOn(console, "warn").mockImplementation((): void => undefined);
});

afterEach(async () => {
  for (const orgId of orgIds) await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  warnSpy.mockRestore();
  await handle.close();
  await db.destroy();
});

// A member with a password and two real sessions, each with one registered push device.
async function memberWithTwoDevices() {
  const email = `web-push-${randomUUID()}@x.test`;
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Web push",
    timezone: "Europe/Warsaw",
    email,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  await flagOn(db, orgId, userId);
  resets.length = 0;
  await handle.auth.api.requestPasswordReset({ body: { email, redirectTo: `${BASE_URL}/setup` } });
  const token = new URL(resets[0]?.url ?? "").pathname.split("/").pop() ?? "";
  await handle.auth.api.resetPassword({ body: resetBody(PASSWORD, token) });

  const signIn = async (): Promise<{ cookie: string; sessionId: string }> => {
    const res = await handle.auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const session = await handle.auth.api.getSession({ headers: new Headers({ cookie }) });
    return { cookie, sessionId: session?.session.id ?? "" };
  };
  const first = await signIn();
  const second = await signIn();
  expect(first.sessionId).not.toBe("");
  expect(second.sessionId).not.toBe(second.cookie);

  // The panel app takes the session row id as its cookie (the fake `getSession`); the real cookie goes to Better Auth.
  const app = pushApp({ db, sessions: { [first.sessionId]: userId, [second.sessionId]: userId }, push });
  const body = (endpoint: string) => subscriptionBody(newReceiver(), endpoint);
  const endpointOne = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
  const bodyOne = body(endpointOne);
  const register = async (sessionId: string, content: ReturnType<typeof body>): Promise<string> => {
    const res = await app.request("/api/me/push/subscription", put(sessionId, content));
    expect(res.status).toBe(200);
    return pushSubscriptionAnswerSchema.parse(await res.json()).id;
  };
  const deviceOne = await register(first.sessionId, bodyOne);
  const deviceTwo = await register(second.sessionId, body(`https://fcm.googleapis.com/fcm/send/${randomUUID()}`));
  const live = async (): Promise<string[]> =>
    (await listLiveDeviceIds(db, { orgId }, userId, new Date())).map((d) => d.id).sort();
  expect(await live()).toEqual([deviceOne, deviceTwo].sort());
  const sessionOf = async (id: string) =>
    (await db.selectFrom("push_subscriptions").select("session_id").where("id", "=", id).executeTakeFirst())
      ?.session_id;
  return { email, orgId, userId, token, first, second, app, bodyOne, deviceOne, deviceTwo, live, sessionOf, signIn };
}

function authPost(path: string, cookie: string): Promise<Response> {
  return handle.auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers: { origin: BASE_URL, "content-type": "application/json", cookie },
      body: "{}",
    })
  );
}

describe("push devices and the end of a session", () => {
  test("5a. sign-out ends the device of that session only: session_id null, not live, not in the list", async () => {
    const m = await memberWithTwoDevices();
    expect((await authPost("/sign-out", m.first.cookie)).status).toBe(200);
    expect(await m.sessionOf(m.deviceOne)).toBeNull();
    expect(await m.sessionOf(m.deviceTwo)).toBe(m.second.sessionId);
    expect(await m.live()).toEqual([m.deviceTwo]);
    expect((await listDeviceViews(db, { orgId: m.orgId }, m.userId, new Date())).map((d) => d.id)).toEqual([
      m.deviceTwo,
    ]);
    // The row stays (the device can be re-bound by the next panel load with rebindOnly).
    expect(
      await db.selectFrom("push_subscriptions").select("id").where("id", "=", m.deviceOne).executeTakeFirst()
    ).toBeDefined();
  });

  test("5b. revoke-other-sessions ends the devices of the other sessions and keeps the caller's", async () => {
    const m = await memberWithTwoDevices();
    expect((await authPost("/revoke-other-sessions", m.first.cookie)).status).toBe(200);
    expect(await m.sessionOf(m.deviceTwo)).toBeNull();
    expect(await m.sessionOf(m.deviceOne)).toBe(m.first.sessionId);
    expect(await m.live()).toEqual([m.deviceOne]);
  });

  test("5c. revoke-sessions ends every device of the user", async () => {
    const m = await memberWithTwoDevices();
    expect((await authPost("/revoke-sessions", m.first.cookie)).status).toBe(200);
    expect(await m.live()).toEqual([]);
    expect(await m.sessionOf(m.deviceOne)).toBeNull();
    expect(await m.sessionOf(m.deviceTwo)).toBeNull();
  });

  test("5d. a password reset (revokeSessionsOnPasswordReset) ends the devices of every session", async () => {
    const m = await memberWithTwoDevices();
    resets.length = 0;
    await handle.auth.api.requestPasswordReset({ body: { email: m.email, redirectTo: `${BASE_URL}/setup` } });
    const token = new URL(resets[0]?.url ?? "").pathname.split("/").pop() ?? "";
    await handle.auth.api.resetPassword({ body: resetBody(`new-${PASSWORD}`, token) });
    expect(await m.live()).toEqual([]);
    expect(await m.sessionOf(m.deviceOne)).toBeNull();
    expect(await m.sessionOf(m.deviceTwo)).toBeNull();
    // The panel lists no device and the test notice reaches none.
    const state = pushStateSchema.parse(await (await m.app.request("/api/me/push", as(m.first.sessionId))).json());
    expect(state.devices).toEqual([]);
  });

  test("after a sign-out the next panel load re-binds the device to the new session (rebindOnly)", async () => {
    const m = await memberWithTwoDevices();
    expect((await authPost("/sign-out", m.first.cookie)).status).toBe(200);
    expect(await m.live()).toEqual([m.deviceTwo]);
    const third = await m.signIn();
    const app = pushApp({ db, sessions: { [third.sessionId]: m.userId }, push });
    const res = await app.request(
      "/api/me/push/subscription",
      put(third.sessionId, { ...m.bodyOne, rebindOnly: true })
    );
    expect(pushSubscriptionAnswerSchema.parse(await res.json()).id).toBe(m.deviceOne);
    expect(await m.sessionOf(m.deviceOne)).toBe(third.sessionId);
    expect(await m.live()).toEqual([m.deviceOne, m.deviceTwo].sort());
  });
});
