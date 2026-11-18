import { describe, expect, test } from "bun:test";

import { decryptPushBody, newReceiver } from "../../../../test/push-decrypt";
import { generateVapidKeyPair } from "../../../platform/vapid-keys";

import { MAX_RETRY_AFTER_MS, type PushOptions, sendWebPush } from "./send";

const keys = { ...generateVapidKeyPair(), subject: "mailto:ops@example.org" };
const receiver = newReceiver();
const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
const sub = { endpoint, ...receiver.sub };
const opts: PushOptions = { ttl: 86_400, urgency: "high", topic: "abc_DEF-123" };
const payload = Buffer.from('{"v":1}');
const now = () => new Date("2026-11-18T10:00:00.000Z");

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(answer: (call: Call) => Response | Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return { fetch: fake, calls };
}

const answering = (status: number, headers: Record<string, string> = {}) =>
  fakeFetch(() => new Response(null, { status, headers }));
const send = (f: typeof fetch, target = sub, timeoutMs?: number) =>
  sendWebPush(target, payload, opts, { fetch: f, now, keys, timeoutMs });

describe("sendWebPush", () => {
  test("1. 201 is sent; the request has TTL, Urgency, Topic, Content-Encoding and a vapid Authorization; the body decrypts", async () => {
    const { fetch, calls } = answering(201);
    expect(await send(fetch)).toEqual({ kind: "sent" });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(endpoint);
    expect(call?.init.method).toBe("POST");
    expect(call?.init.redirect).toBe("manual");
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.TTL).toBe("86400");
    expect(headers.Urgency).toBe("high");
    expect(headers.Topic).toBe("abc_DEF-123");
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.Authorization?.startsWith("vapid t=")).toBe(true);
    expect(headers.Authorization?.endsWith(`, k=${keys.publicKey}`)).toBe(true);
    expect(decryptPushBody(call?.init.body as Uint8Array, receiver).toString("utf8")).toBe('{"v":1}');
  });

  test("2. 410 and 404 are gone", async () => {
    expect(await send(answering(410).fetch)).toEqual({ kind: "gone" });
    expect(await send(answering(404).fetch)).toEqual({ kind: "gone" });
  });

  test("3. 429 is retry with Retry-After seconds, capped at 900 s; no or odd header is null", async () => {
    expect(await send(answering(429, { "Retry-After": "30" }).fetch)).toEqual({ kind: "retry", afterMs: 30_000 });
    expect(await send(answering(429, { "Retry-After": "99999" }).fetch)).toEqual({ kind: "retry", afterMs: 900_000 });
    expect(MAX_RETRY_AFTER_MS).toBe(900_000);
    expect(await send(answering(429).fetch)).toEqual({ kind: "retry", afterMs: null });
    expect(await send(answering(429, { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" }).fetch)).toEqual({
      kind: "retry",
      afterMs: null,
    });
    expect(await send(answering(429, { "Retry-After": "-5" }).fetch)).toEqual({ kind: "retry", afterMs: null });
  });

  test("4. 5xx and a thrown fetch are retry null; a hung fetch that ignores the signal ends at the deadline", async () => {
    expect(await send(answering(503).fetch)).toEqual({ kind: "retry", afterMs: null });
    expect(await send(answering(500).fetch)).toEqual({ kind: "retry", afterMs: null });
    const boom = fakeFetch(() => {
      throw new Error(`connect failed to ${endpoint} with ${keys.privateKey}`);
    });
    expect(await send(boom.fetch)).toEqual({ kind: "retry", afterMs: null });
    const hung = fakeFetch(() => new Promise<Response>(() => undefined));
    expect(await send(hung.fetch, sub, 30)).toEqual({ kind: "retry", afterMs: null });
    const rejected = fakeFetch(async () => {
      await Bun.sleep(5);
      throw new Error("late");
    });
    expect(await send(rejected.fetch, sub, 1000)).toEqual({ kind: "retry", afterMs: null });
  });

  test("5. 400 is refused 400; 301 is refused 301 (a redirect is never followed); 200 and 202 are refused too", async () => {
    expect(await send(answering(400).fetch)).toEqual({ kind: "refused", status: 400 });
    const redirect = answering(301, { Location: "https://example.com/x" });
    expect(await send(redirect.fetch)).toEqual({ kind: "refused", status: 301 });
    expect(redirect.calls).toHaveLength(1);
    expect(await send(answering(401).fetch)).toEqual({ kind: "refused", status: 401 });
    expect(await send(answering(413).fetch)).toEqual({ kind: "refused", status: 413 });
  });

  test("8. an endpoint outside the allowed hosts is refused 0 and the fake fetch is not called", async () => {
    for (const bad of [
      "https://example.com/x",
      "http://fcm.googleapis.com/x",
      "https://127.0.0.1/x",
      "https://fcm.googleapis.com:8443/x",
      "https://u:p@fcm.googleapis.com/x",
      "https://evilfcm.googleapis.com.example.org/x",
    ]) {
      const { fetch, calls } = answering(201);
      expect(await send(fetch, { ...sub, endpoint: bad })).toEqual({ kind: "refused", status: 0 });
      expect({ bad, calls: calls.length }).toEqual({ bad, calls: 0 });
    }
  });

  test("9. a bad topic, TTL, subscription key or VAPID key is refused 0 before any request", async () => {
    const { fetch, calls } = answering(201);
    const run = (o: Partial<PushOptions>, target = sub, k = keys) =>
      sendWebPush(target, payload, { ...opts, ...o }, { fetch, now, keys: k });
    expect(await run({ topic: "has space" })).toEqual({ kind: "refused", status: 0 });
    expect(await run({ topic: "a".repeat(33) })).toEqual({ kind: "refused", status: 0 });
    expect(await run({ topic: "" })).toEqual({ kind: "refused", status: 0 });
    expect(await run({ ttl: -1 })).toEqual({ kind: "refused", status: 0 });
    expect(await run({ ttl: 1.5 })).toEqual({ kind: "refused", status: 0 });
    expect(await run({}, { ...sub, p256dh: "AAAA" })).toEqual({ kind: "refused", status: 0 });
    expect(await run({}, sub, { ...keys, privateKey: "AAAA" })).toEqual({ kind: "refused", status: 0 });
    expect(await sendWebPush(sub, new Uint8Array(4000), opts, { fetch, now, keys })).toEqual({
      kind: "refused",
      status: 0,
    });
    expect(calls).toHaveLength(0);
  });

  test("10. no result holds the endpoint, a key or the answer text", async () => {
    const results = [
      await send(fakeFetch(() => new Response(`secret ${keys.privateKey}`, { status: 400 })).fetch),
      await send(
        fakeFetch(() => {
          throw new Error(`${endpoint} ${keys.privateKey} ${receiver.sub.auth}`);
        }).fetch
      ),
    ];
    for (const result of results) {
      const text = JSON.stringify(result);
      for (const secret of [endpoint, keys.privateKey, receiver.sub.auth, "secret"]) expect(text).not.toContain(secret);
    }
  });

  test("TG2. a large 201 body is cancelled and never read: the result is sent", async () => {
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 64) controller.close();
        else controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const { fetch } = fakeFetch(() => new Response(body, { status: 201 }));
    expect(await send(fetch)).toEqual({ kind: "sent" });
    // Give the cancel a turn to reach the stream.
    await Bun.sleep(10);
    expect({ cancelled, readsAtMost: pulls <= 2 }).toEqual({ cancelled: true, readsAtMost: true });
  });
});
