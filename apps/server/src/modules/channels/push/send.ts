import { encryptPushPayload, PushKeyError, PushPayloadTooLarge } from "./encrypt";
import { checkPushEndpoint } from "./endpoint";
import { VapidError, type VapidKeys, vapidHeaders } from "./vapid";

// One POST of one encrypted payload to one push endpoint (RFC 8030), mapped to a `PushResult`.
// Order: the endpoint check, the topic and TTL check and the encryption all run BEFORE any network step. The request goes
// through the injected `fetch`: `redirect: "manual"` (a 3xx is refused, never followed), a 10 s deadline, and the answer body is
// cancelled unread (so the response cap is zero bytes). A result holds a kind and a number only: no endpoint, key, payload or
// error text. The caller logs the kind and the status.

export type PushResult =
  | { kind: "sent" }
  | { kind: "gone" }
  | { kind: "retry"; afterMs: number | null }
  | { kind: "refused"; status: number };

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushOptions {
  /** Seconds the push service keeps the message for an offline device. */
  ttl: number;
  urgency: "high" | "normal";
  /** RFC 8030 `Topic`: at most 32 characters of the URL-safe base64 alphabet. */
  topic: string;
}

export interface SendDeps {
  fetch: typeof fetch;
  now: () => Date;
  keys: VapidKeys;
  timeoutMs?: number;
}

export const PUSH_TIMEOUT_MS = 10_000;
export const MAX_RETRY_AFTER_MS = 900_000;
const TOPIC = /^[A-Za-z0-9_-]{1,32}$/;
const SECONDS = /^\d{1,9}$/;
const REFUSED_BEFORE_SEND: PushResult = { kind: "refused", status: 0 };

function retryAfterMs(header: string | null): number | null {
  if (header === null || !SECONDS.test(header.trim())) return null;
  return Math.min(Number(header.trim()) * 1000, MAX_RETRY_AFTER_MS);
}

function mapStatus(status: number, response: Response): PushResult {
  if (status === 201) return { kind: "sent" };
  if (status === 404 || status === 410) return { kind: "gone" };
  if (status === 429) return { kind: "retry", afterMs: retryAfterMs(response.headers.get("Retry-After")) };
  if (status >= 500 && status <= 599) return { kind: "retry", afterMs: null };
  return { kind: "refused", status };
}

/**
 * Does not throw for a bad endpoint, a bad key, a payload that is too large (a refusal with status 0: no request was made), a
 * network failure or a timeout (`retry`). Any other error is a bug in this code and is thrown on (the sender logs it and tries the row later).
 */
export async function sendWebPush(
  sub: PushTarget,
  payload: Uint8Array,
  opts: PushOptions,
  deps: SendDeps
): Promise<PushResult> {
  if (!checkPushEndpoint(sub.endpoint).ok) return REFUSED_BEFORE_SEND;
  if (!TOPIC.test(opts.topic) || !Number.isInteger(opts.ttl) || opts.ttl < 0) return REFUSED_BEFORE_SEND;

  let body: Uint8Array<ArrayBuffer>;
  let authorization: string;
  try {
    body = Uint8Array.from(encryptPushPayload(sub, payload));
    authorization = vapidHeaders(sub.endpoint, deps.keys, deps.now()).Authorization;
  } catch (error) {
    if (error instanceof PushKeyError || error instanceof PushPayloadTooLarge || error instanceof VapidError) {
      return REFUSED_BEFORE_SEND;
    }
    throw error;
  }

  const timeoutMs = deps.timeoutMs ?? PUSH_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const request = deps.fetch(sub.endpoint, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opts.ttl),
        Urgency: opts.urgency,
        Topic: opts.topic,
      },
      body,
    });
    // A late rejection of a request that lost the race must not become an unhandled rejection.
    request.catch(() => undefined);
    const response = await Promise.race([request, deadline]);
    if (response === "timeout") return { kind: "retry", afterMs: null };
    // The answer text is never read: drop the body.
    void response.body?.cancel().catch(() => undefined);
    return mapStatus(response.status, response);
  } catch {
    return { kind: "retry", afterMs: null };
  } finally {
    clearTimeout(timer);
  }
}
