# F117 stage 13 — Graph `sendMail` sender and the fake Graph

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people). Needs stages 05 and 06.

## Step 13.1 — `openGraphSender`

**Goal.** Microsoft mailboxes send the MIME that `compose.ts` builds through Graph `sendMail` (PD-086, ADR 0031 point 2), with the same retry safety as SMTP.

**Files.** `apps/server/src/modules/mail/graph/sender.ts` (new) and tests; the composition root passes it as `OpenDeps.openGraphSender` with the registry's `graphBaseUrl`.

**Interface.** `openGraphSender(opts: { accessToken: string; from: string; freshToken(): Promise<string>; baseUrl: string; fetchFn?: typeof fetch; timeoutMs?: number }): Promise<MailSender>` (the composition binds `baseUrl`; stage 05's `OpenDeps` shape stays).

**Rules.**
- `POST <baseUrl>/v1.0/me/sendMail`, `Content-Type: text/plain`, body = base64 of `raw`, `Authorization: Bearer <token>`. Timeout 30 s.
- Before the call: `envelope.from` must equal `opts.from` (case-insensitive); the set of `envelope.to` must equal the set of `To`, `Cc` and `Bcc` addresses of `raw` (parse the headers with `mailparser`). Else `SmtpSendError` stage `envelope`, permanent, no call. Graph takes its recipients from the MIME, so a mismatch would send to someone else.
- `raw` over 3 MB → stage `envelope`, permanent, no call (default limit; spike M10 may change it).
- Answer map (D17), `SmtpSendError(stage, "EGRAPH", httpStatus, permanent, soft)`:
  - 202 → `{ response: "202 Accepted", accepted: envelope.to, rejected: [] }`.
  - `fetch` fails before a response with a connect or DNS error → `connect`, soft.
  - Abort or timeout after the request started → `unknown` (no resend: the server may have it).
  - 401 → call `freshToken()` once and repeat the call once (a 401 means "not accepted"); 401 again → `login`, reason `oauth_revoked`.
  - 403 with `error.code = "ErrorAccessDenied"` → `login`, reason `admin_consent_required`; another 403 → `login`, reason `protocol_disabled`.
  - 400, 404, 413 → `envelope`, permanent.
  - 429, 503 → `connect`, soft (the committer's retry rules decide).
  - Other 5xx → `unknown`.
- `close()` is a no-op; `send` after `close` rejects.
- The Sent Items copy: Graph saves it. The committer's "locate first, APPEND only if missing" runs unchanged and finds it by Message-ID (spike M10; if M10 shows a changed Message-ID, a refresh changes this stage).
- No header, body, token or recipient in a log line; the Graph error body is read for `error.code` only.

## Step 13.2 — Fake Graph and the contract run

`apps/server/test/fake-graph.ts`: `startFakeGraph(): Promise<{ baseUrl: string; sent: Array<{ authorization: string; raw: Buffer }>; respondNext(status: number, body?: unknown): void; hangNext(): void; stop(): Promise<void> }>` on `127.0.0.1`.

Run `runMailSenderContract("graph", …)` (stage 05) against it: `received` decodes `sent`; `openRefused` makes the fake answer 401 twice.

**Decisions.** D5, D15, D17, D18.

**Test** (integration unless marked):
1. The contract suite passes.
2. A raw message with `Bcc: c@x.test` and envelope `to` of `b@x.test`, `c@x.test` → 202, one call. Envelope `to` `b@x.test` only → `envelope`, no call.
3. `envelope.from` `other@x.test` → `envelope`, no call.
4. 3 MB + 1 byte → `envelope`, no call.
5. 401 then 202 → one `freshToken` call, two calls, success. 401 twice → `login`, `oauth_revoked`.
6. 403 `ErrorAccessDenied` → `admin_consent_required`; 403 `MailboxNotEnabledForRESTAPI` → `protocol_disabled`.
7. 429 → `connect`, soft; 500 → `unknown`; `hangNext` with `timeoutMs: 200` → `unknown`.
8. Committer, end to end: an approved delegation of a Microsoft mailbox (GreenMail IMAP, fake token server, fake Graph) → one Graph call with the action's Message-ID and `X-EA-Action-Id`; the action is `applied`; the send limits count it (one `send_started_at`).
9. Same with the fake answering 500 → the action is not resent at the next committer tick (stage `unknown` rule).
10. Canary: the bearer token and the body are in no log line.

**Check.** The Proof.

**Done when.** The tests pass; the composition wires the Graph sender; the Proof prints `PROOF_OK`.

**Out of scope.** Graph draft creation (E6 fallback), any Graph read call.
