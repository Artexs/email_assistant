# F118 stage 01 — Push crypto and VAPID `[risky]`

Part of [`../plan.md`](../plan.md). Needs nothing. No migration, no `bun.lock` change.

Carry-over reads: `plan.md` D1, D5, D19, rules; `interfaces.md` § Server; `platform/crypto.ts`, `platform/heartbeat.ts` (`deps.fetch`), `platform/outside-services.ts`.

## Step 1 — Encryption (RFC 8291) and VAPID (RFC 8292)

- **Goal:** a pure module `apps/server/src/modules/channels/push/`: `(subscription, plaintext)` → the `aes128gcm` body and the VAPID headers. Only `node:crypto`.
- **Files:** `push/encrypt.ts`, `push/vapid.ts`, `push/index.ts`, tests next to them.
- **Interfaces:** `encryptPushPayload(sub: { p256dh: string; auth: string }, plain: Uint8Array, deps?: { ephemeral?: KeyPair; salt?: Uint8Array })` → `Uint8Array` (the header block `salt ‖ rs ‖ idlen ‖ keyid` and one record, `rs = 4096`, padding delimiter `0x02`). `vapidHeaders(endpoint: string, keys: VapidKeys, now: Date)` → `{ Authorization: "vapid t=<jwt>, k=<public key b64url>" }`; JWT `aud` = the endpoint origin, `exp` = now + 12 h, `sub` = `VAPID_SUBJECT`. Test-only `deps` fix the ephemeral key and salt.
- **Decisions:** D1. A plaintext over 3,993 bytes is refused (`PushPayloadTooLarge`); D5 keeps it far below. Bad base64url keys throw `PushKeyError` with a fixed message (no key text).
- **Test (unit):**
  1. The example of RFC 8291 (§5, intermediate values in Appendix A): the fixed ephemeral key, salt, `ua_public`, `auth_secret` and the plaintext "When I grow up, I want to be a watermelon" give exactly the RFC's body bytes.
  2. Round trip: a test-side decrypt (`apps/server/test/push-decrypt.ts`, its own ECDH and HKDF code; stage 08 reuses it) opens 10 random payloads of 1 to 256 bytes.
  3. VAPID: the JWT verifies with the public key (ES256, `ieee-p1363`); `aud` = `https://fcm.googleapis.com` for an endpoint `https://fcm.googleapis.com/fcm/send/abc`; `exp` = now + 43,200 s with a fixed clock.
  4. A 3,994-byte plaintext → `PushPayloadTooLarge`.
  5. A `p256dh` of 64 bytes (not 65) → `PushKeyError`, and the message holds no input byte.

## Step 2 — Sender call and endpoint check

- **Goal:** POST one payload to one endpoint; map the answer to `PushResult` (D10).
- **Files:** `push/send.ts`, `push/endpoint.ts`.
- **Interfaces:** `checkPushEndpoint(url)` (D19); `sendWebPush(sub, payload, opts: { ttl: number; urgency: "high" | "normal"; topic: string }, deps: { fetch; now; keys })` → `PushResult`. `redirect: "manual"`; a 3xx is `refused`. A 10 s timeout is `retry`. `sendWebPush` runs `checkPushEndpoint` first and returns `refused` with status 0 and no request when it fails (review N8).
- **Decisions:** D10 map: 201 → `sent`; 404, 410 → `gone`; 429 → `retry` with `Retry-After` seconds (cap 900 s) or null; 5xx, network, timeout → `retry` null; other → `refused` with the status. D19 host list; `https` only; port 443 or none; no user info in the URL. The push services are a sub-processor (review N3), not an `OUTSIDE_CALL_CLASSES` entry. If the outside-services test needs a registry entry for this call and that changes the legal digest, stop and ask; the papers come in stage 13.
- **Test (unit, fake `fetch`):**
  1. 201 → `sent`; the request has headers `TTL`, `Urgency`, `Topic`, `Content-Encoding: aes128gcm`, `Authorization` starting `vapid t=`.
  2. 410 → `gone`; 404 → `gone`.
  3. 429 with `Retry-After: 30` → `retry` 30,000 ms; with `Retry-After: 99999` → 900,000 ms.
  4. 503 → `retry` null; `fetch` throws → `retry` null.
  5. 400 → `refused` 400; 301 → `refused` 301.
  6. `checkPushEndpoint`: `https://fcm.googleapis.com/fcm/send/x` ok; `https://updates.push.services.mozilla.com/wpush/v2/x` ok; `https://web.push.apple.com/x` ok; `http://fcm.googleapis.com/x` bad; `https://evilfcm.googleapis.com.example.org/x` → `push_host_not_allowed`; `https://127.0.0.1/x` → `push_host_not_allowed`; `https://fcm.googleapis.com:8443/x` bad; `https://u:p@fcm.googleapis.com/x` bad.
  7. Mutation guard: a host check by `includes` instead of a suffix after a dot fails test 6.
  8. `sendWebPush` to `https://example.com/x` → `refused` 0 and the fake `fetch` is not called.

## Step 3 — Config and keys CLI

- **Goal:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (base64url, raw P-256), `VAPID_SUBJECT` (`mailto:` or `https:`) in the config schema with an all-or-none rule; `pushConfigOf(config)`; `.env.example` lines with comments; `bun run push:keys` prints a new pair for the owner (the owner runs it, never an agent; the CLI writes nothing).
- **Test (unit):**
  1. Two of the three keys set → `ConfigError` naming the missing key, never a value.
  2. None set → `pushConfigOf` null. All set → keys.
  3. A public key that does not match the private key → `ConfigError` `vapid_key_mismatch`.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** tables, routes, the job (02–08).
