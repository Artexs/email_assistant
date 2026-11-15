# F110 stage 23 — One-click unsubscribe POST `[risky]`

Part of [`../plan.md`](../plan.md). Risk: a server request to a URL from untrusted mail (SSRF), an action toward a third party.

## Step 0 — Probe (N3)

- In a temp folder inside the worktree: a Bun script that opens `node:https.request` with a custom `lookup` that returns a fixed address, against a local HTTPS server with a self-signed certificate (`rejectUnauthorized: false` only in the probe). Record in the final message whether Bun calls the `lookup` and connects to that address while TLS still uses the host name for SNI. If it does not, stop and ask: the pinning design changes.

## Step 1 — The guarded client

- **Goal:** one function that can POST only to a public HTTPS host (D17).
- **Files:** new `apps/server/src/platform/public-http.ts`.
- **Interfaces:** `postOneClick(url: URL, deps: { lookup: LookupAll; now; timeoutMs?: number; request? }): Promise<{ kind: "ok" | "refused" | "failed"; code: string }>`.
- **Decisions:**
  - `https:` only; no user info; port 443 only (default 443; any other → `refused` / `port`).
  - Resolve with `dnsLookupAll`; every answer must pass `isLocalAddress` = false (`platform/net-address.ts`); any private answer → `refused` / `private_host`. Connect to the first checked address (pinned through `lookup`), SNI and `Host` = the URL host.
  - Body `List-Unsubscribe=One-Click`, `Content-Type: application/x-www-form-urlencoded`, no cookies, no `Referer`, User-Agent `email-assistant-unsubscribe/1`, 10 s total timeout, response body read at most 4 KiB then dropped.
  - 2xx → `ok` / `http_<status>`; 3xx → `failed` / `redirect` (never followed); 4xx, 5xx → `failed` / `http_<status>`; timeout → `failed` / `timeout`; TLS error → `failed` / `tls`.
  - No URL, query or address in any log line or error text; codes only.
- **Test** (`platform/public-http.test.ts`): cases 4–6 inject a lookup that answers a public address and a `request` that reaches a local test server (the guard itself refuses loopback).
  1. `http://` URL → `refused` / `scheme`.
  2. A lookup answering `10.0.0.5` → `refused` / `private_host`; answering `93.184.216.34` and `127.0.0.1` → `refused`.
  3. Port 8443 → `refused` / `port`.
  4. Server answers 302 → `failed` / `redirect`, and no second request reaches any host.
  5. Server sleeps 11 s → `failed` / `timeout` (fake timers or a short `timeoutMs` in the test).
  6. 200 → `ok`; the server saw the exact body and content type.

## Step 2 — The command

- **Goal:** an owner's tap sends one request, recorded before it leaves (D17, crash rule).
- **Files:** `POST /api/newsletters/:mailboxId/unsubscribe` (owner only, `apiDoc`, body `{ sender }`); show the stage 22 button.
- **Decisions:**
  - Re-read the sender with `listNewsletterSenders`: absent (spam, suspicious, not a newsletter) → 409 `not_allowed`; `method` not `one_click` → 409 `no_one_click`.
  - Insert `unsubscribe_requests` (`requested`) and commit first; unique `(mailbox_id, sender_lower)`: a second tap → 409 `already_requested` with the stored state, no request.
  - Then `postOneClick`; then update `status` (`done`, `failed`, `refused`), `code`, `finished_at`, and an audit row `newsletter.unsubscribe` with the sender domain and the code only.
  - A crash after the POST and before the update leaves `requested`; the view shows "Requested" (no automatic retry: a second POST is the user's choice through "Open unsubscribe page").
- **Test** (`web-newsletters.test.ts`):
  7. Owner tap on a one-click sender (fake client `ok`) → `done`, audit row with the domain, no URL in the audit data.
  8. Second tap → 409, the fake client called once.
  9. A suspicious sender → 409 `not_allowed`, client not called.
  10. Member → 403; flag off → 404.

## Done when

- The guard check of `spec/build.md` TRACK is in the final message.
- Proof (`s23`) prints `PROOF_OK` (add the web part when the stage 22 button changed).

## Out of scope

`mailto:` unsubscribe; retries; following redirects.
