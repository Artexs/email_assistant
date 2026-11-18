import { randomUUID } from "node:crypto";

import {
  deviceOf,
  HOUR_MS,
  pushSubscriptionBodySchema,
  type PushState,
  type PushSubscriptionAnswer,
  type PushTestAnswer,
} from "@ea/core";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import type { SecretBox } from "../../../platform/crypto";
import type { Db } from "../../../platform/db";
import { parseBody, type ApiEnv, ValidationError } from "../../../platform/http";
import { createLog } from "../../../platform/log";
import { auditEvents, countActorEventsSince, recordAudit } from "../../audit";
import { getUserAuthProfile, isFeatureOn } from "../../tenancy";

import { pushDocs } from "./api-docs";
import { encryptPushPayload, PushKeyError } from "./encrypt";
import { canonicalEndpoint, checkPushEndpoint } from "./endpoint";
import {
  listDeviceViews,
  loadDeviceSecret,
  lockPushUser,
  markPushError,
  markPushSuccess,
  PushDeviceElsewhereError,
  removeDevice,
  upsertPushSubscription,
} from "./repo";
import { sendWebPush, type PushTarget } from "./send";
import type { VapidKeys } from "./vapid";

// The push device routes of the own user. The endpoint and the keys come from the browser: they are checked, stored encrypted
// (repo) and never read back, logged or put in an answer, an audit row or an error. Nothing here calls a push service except the
// test route, through the injected `fetch`.

const log = createLog("channels");

/** The test notice: at most this many a user in the last hour. */
export const PUSH_TEST_LIMIT = 5;
const TEST_TTL_SECONDS = 60;

export interface PushRouteDeps {
  db: Db;
  now(): Date;
  box: SecretBox;
  /** null: no VAPID keys on this server. */
  keys: VapidKeys | null;
  /** The only way out to a push service. A test passes a fake that answers on the loopback. */
  fetch: typeof fetch;
}

const BROWSER_WORDS = {
  edge: "Edge",
  opera: "Opera",
  firefox: "Firefox",
  chrome: "Chrome",
  safari: "Safari",
  unknown: "Browser",
} as const;
const OS_WORDS = {
  android: "Android",
  ios: "iOS",
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  unknown: null,
} as const;

// The browser and the system as two words ("Chrome on Android"), never the User-Agent text.
export function deviceLabelOf(userAgent: string | undefined): string {
  const { browser, os } = deviceOf(userAgent ?? null);
  const system = OS_WORDS[os];
  return system === null ? BROWSER_WORDS[browser] : `${BROWSER_WORDS[browser]} on ${system}`;
}

const idSchema = z.uuid();

export function pushRoutes(deps: PushRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // The flag comes first: with it off every route is a 404, for every role.
  const flagFirst: MiddlewareHandler<ApiEnv> = async (c, next) => {
    if (!(await isFeatureOn(deps.db, c.get("ctx"), "web_push"))) return c.json({ error: "not_found" }, 404);
    await next();
  };

  app.get("/me/push", flagFirst, pushDocs.getPush, async (c) => {
    const ctx = c.get("ctx");
    const { userId, sessionId } = c.get("session");
    const views = await listDeviceViews(deps.db, ctx, userId, deps.now());
    const state: PushState = {
      vapidPublicKey: deps.keys?.publicKey ?? null,
      devices: views.map((view) => ({
        id: view.id,
        label: view.deviceLabel,
        createdAt: view.createdAt.toISOString(),
        lastSuccessAt: view.lastSuccessAt?.toISOString() ?? null,
        thisSession: view.sessionId === sessionId,
      })),
    };
    c.header("Cache-Control", "no-store");
    return c.json(state);
  });

  app.put("/me/push/subscription", flagFirst, pushDocs.putPushSubscription, async (c) => {
    if (deps.keys === null) return c.json({ error: "push_off" }, 409);
    const ctx = c.get("ctx");
    const { userId, sessionId } = c.get("session");
    const body = await parseBody(c, pushSubscriptionBodySchema);

    const endpoint = checkPushEndpoint(body.endpoint);
    if (!endpoint.ok) {
      if (endpoint.code === "push_host_not_allowed") return c.json({ error: "push_host_not_allowed" }, 400);
      throw new ValidationError([{ path: "endpoint", code: endpoint.code, message: "not a valid push endpoint" }]);
    }
    // The keys must work: one trial encryption proves the length and the P-256 point before anything is stored.
    try {
      encryptPushPayload(body.keys, Buffer.from("k"));
    } catch (error) {
      if (error instanceof PushKeyError) {
        throw new ValidationError([{ path: `keys.${error.field}`, code: "bad_key", message: "not a valid push key" }]);
      }
      throw error;
    }

    const now = deps.now();
    try {
      const result = await deps.db.transaction().execute(async (trx) => {
        const device = await upsertPushSubscription(trx, ctx, {
          userId,
          sessionId,
          endpoint: canonicalEndpoint(body.endpoint),
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          deviceLabel: deviceLabelOf(c.req.header("user-agent")),
          box: deps.box,
          now,
          ...(body.rebindOnly === true ? { rebindOnly: true } : {}),
        });
        if (device === null) return null;
        await recordAudit(trx, ctx, {
          event: auditEvents.pushSubscribed,
          actor: userId,
          data: { push_subscription_id: device.id, created: device.created, via: "web" },
          at: now,
        });
        return device;
      });
      if (result === null) return c.json({ error: "no_device" }, 404);
      log.info("push_subscribed", { user_id: userId, push_subscription_id: result.id });
      const answer: PushSubscriptionAnswer = { id: result.id };
      return c.json(answer);
    } catch (error) {
      if (error instanceof PushDeviceElsewhereError) return c.json({ error: "push_device_elsewhere" }, 409);
      throw error;
    }
  });

  app.delete("/me/push/devices/:id", flagFirst, pushDocs.deletePushDevice, async (c) => {
    const parsed = idSchema.safeParse(c.req.param("id"));
    if (!parsed.success) return c.json({ error: "not_found" }, 404);
    // The database matches a uuid in any case; the audit row and the log hold the one lower case form.
    const deviceId = parsed.data.toLowerCase();
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    const removed = await deps.db.transaction().execute(async (trx) => {
      const done = await removeDevice(trx, ctx, deviceId, { userId });
      if (done) {
        await recordAudit(trx, ctx, {
          event: auditEvents.pushRemoved,
          actor: userId,
          data: { push_subscription_id: deviceId, via: "web" },
          at: deps.now(),
        });
      }
      return done;
    });
    if (!removed) return c.json({ error: "not_found" }, 404);
    log.info("push_removed", { user_id: userId, push_subscription_id: deviceId });
    return c.body(null, 204);
  });

  app.post("/me/push/test", flagFirst, pushDocs.postPushTest, async (c) => {
    const keys = deps.keys;
    if (keys === null) return c.json({ error: "push_off" }, 409);
    const ctx = c.get("ctx");
    const { userId, sessionId } = c.get("session");
    const now = deps.now();

    // The limit check, its audit row and the secrets of the devices of this session share one transaction under the user lock:
    // two taps at once cannot both pass the count. The send itself runs outside any transaction.
    const prepared = await deps.db.transaction().execute(async (trx) => {
      await lockPushUser(trx, userId);
      const since = new Date(now.getTime() - HOUR_MS);
      if ((await countActorEventsSince(trx, ctx, auditEvents.pushTestSent, userId, since)) >= PUSH_TEST_LIMIT) {
        return "limit" as const;
      }
      const targets: { id: string; target: PushTarget }[] = [];
      for (const view of await listDeviceViews(trx, ctx, userId, now)) {
        if (view.sessionId !== sessionId) continue;
        const secret = await loadDeviceSecret(trx, ctx, view.id, deps.box);
        if (secret !== null) targets.push({ id: view.id, target: secret.target });
      }
      await recordAudit(trx, ctx, {
        event: auditEvents.pushTestSent,
        actor: userId,
        data: { devices: targets.length },
        at: now,
      });
      return targets;
    });
    if (prepared === "limit") return c.json({ error: "push_test_limit" }, 429);

    const lang = (await getUserAuthProfile(deps.db, userId))?.locale ?? "pl";
    let sent = 0;
    for (const { id, target } of prepared) {
      // The push payload shape: v, id, kind, count, itemId, lang (`pushPayloadSchema` of the service worker parses this literal; a test pins it).
      const payload = { v: 1, id: randomUUID(), kind: "test", count: 1, itemId: null, lang };
      const result = await sendWebPush(
        target,
        Buffer.from(JSON.stringify(payload), "utf8"),
        { ttl: TEST_TTL_SECONDS, urgency: "high", topic: "test" },
        { fetch: deps.fetch, now: deps.now, keys }
      );
      switch (result.kind) {
        case "sent":
          sent += 1;
          await markPushSuccess(deps.db, ctx, id, deps.now());
          break;
        case "gone":
          await deps.db.transaction().execute((trx) => removeDevice(trx, ctx, id, { userId }));
          break;
        case "retry":
          await markPushError(deps.db, ctx, id, "push_retry");
          break;
        case "refused":
          await markPushError(deps.db, ctx, id, "push_refused");
          break;
      }
      log.info("push_test_tried", { user_id: userId, push_subscription_id: id });
    }
    const answer: PushTestAnswer = { sent };
    return c.json(answer);
  });

  return app;
}
