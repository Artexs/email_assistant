import { randomBytes, randomUUID } from "node:crypto";

import { DAY_MS } from "@ea/core";
import { sql } from "kysely";

import { upsertOrgFeature } from "../../src/modules/tenancy";
import { loadConfig } from "../../src/platform/config";
import { createSecretBox } from "../../src/platform/crypto";
import type { Db } from "../../src/platform/db";
import { generateVapidKeyPair } from "../../src/platform/vapid-keys";
import { apiRouters } from "../../src/web";
import { decryptPushBody, newReceiver } from "../push-decrypt";

import { as, noBackupCodes, noPrivacy, TEST_ORIGIN, webTestApp } from "./web-helpers";

// Shared by the push device API tests (`web-push*.test.ts`): a config with VAPID keys, a fake push service that is a function (no
// network, no socket), real `auth_sessions` rows, and a planted endpoint and key.

export const CANARY_ENDPOINT = "https://fcm.googleapis.com/fcm/send/CANARYPUSH";
export const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

export const vapid = generateVapidKeyPair();
const secretKey = randomBytes(32).toString("base64");
export const box = createSecretBox(secretKey, 1);

const baseEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  CREDENTIALS_KEY: secretKey,
  WEB_BASE_URL: TEST_ORIGIN,
  WEB_AUTH_SECRET: "x".repeat(32),
};
export const configWithPush = loadConfig({
  ...baseEnv,
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:owner@example.org",
});
export const configNoPush = loadConfig(baseEnv);

/** A new live session row of a user (the device binds to its id). */
export async function newSession(db: Db, userId: string, expiresAt = new Date(Date.now() + DAY_MS)): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    insert into auth_sessions (user_id, token, expires_at)
    values (${userId}::uuid, ${randomUUID()}, ${expiresAt}) returning id`.execute(db);
  return rows[0]?.id ?? "";
}

export async function flagOn(db: Db, orgId: string, setBy: string): Promise<void> {
  await upsertOrgFeature(db, { orgId }, { flag: "web_push", enabled: true, setBy, setAt: new Date() });
}

export interface FakePush {
  fetch: typeof fetch;
  /** Every request that the code made, in order. */
  calls: { url: string; headers: Record<string, string>; body: Uint8Array }[];
  /** The status of the next answers; the last one repeats. */
  answer(...statuses: number[]): void;
}

// The push service of the tests. It is a function, so no request leaves the process.
export function fakePush(): FakePush {
  const calls: FakePush["calls"] = [];
  let statuses = [201];
  let index = 0;
  const fake = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = init?.body;
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: raw instanceof Uint8Array ? raw : new Uint8Array(),
    });
    const status = statuses[Math.min(index, statuses.length - 1)] ?? 201;
    index += 1;
    return new Response(null, { status });
  }) as typeof fetch;
  return {
    fetch: fake,
    calls,
    answer(...next) {
      statuses = next;
      index = 0;
    },
  };
}

/** The real routers of `web.ts` (the wiring is under test), with the fake push service and a clock the test moves. */
export function pushApp(opts: {
  db: Db;
  sessions: Record<string, string>;
  config?: typeof configWithPush;
  push: FakePush;
  clock?: { now: Date };
}) {
  const clock = opts.clock ?? { now: new Date() };
  return webTestApp({
    db: opts.db,
    sessions: opts.sessions,
    routers: apiRouters(
      opts.config ?? configWithPush,
      opts.db,
      {
        secrets: box,
        actionsScope: { kind: "off" },
        sendScope: { kind: "off" },
        botUsername: null,
        pushFetch: opts.push.fetch,
      },
      () => new Date(clock.now),
      async () => [],
      noBackupCodes,
      noPrivacy
    ),
  });
}

export const subscriptionBody = (receiver: ReturnType<typeof newReceiver>, endpoint = CANARY_ENDPOINT) => ({
  endpoint,
  keys: receiver.sub,
});

export function put(cookie: string, body: unknown, userAgent = CHROME_ANDROID): RequestInit {
  const init = as(cookie, { method: "PUT", body });
  return { ...init, headers: { ...(init.headers as Record<string, string>), "user-agent": userAgent } };
}

export { as, decryptPushBody, newReceiver };
