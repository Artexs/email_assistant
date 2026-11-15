# F117 stage 13 — Graph `sendMail` sender and the fake Graph

Part of [`../plan.md`](../plan.md). `[risky]` (sending to people). Needs stage 10 (the real `oauthTokens` for the end-to-end tests).

## Step 13.1 — `openGraphSender`

**Goal.** Microsoft mailboxes send the MIME of `compose.ts` through Graph `sendMail` (PD-086), as safe to retry as SMTP.

**Files.** `apps/server/src/modules/mail/graph/sender.ts` (new); the composition passes it as `OpenDeps.openGraphSender` with the registry's `graphBaseUrl` bound.

**Interface.** `openGraphSender(opts: { accessToken: string; from: string; freshToken(): Promise<string>; baseUrl: string; fetchFn?: typeof fetch; timeoutMs?: number }): Promise<MailSender>`.

**Rules.**
- `POST <baseUrl>/v1.0/me/sendMail`, `Content-Type: text/plain`, body = base64 of `raw`, `Authorization: Bearer <token>`. Timeout 30 s.
- Before the call: `envelope.from` must equal `opts.from` (case-insensitive); the set of `envelope.to` must equal the set of `To`, `Cc` and `Bcc` addresses of `raw` (parse the headers with `mailparser`). Else `SmtpSendError` stage `envelope`, permanent, no call. Graph takes its recipients from the MIME, so a mismatch would send to someone else.
- `raw` over 3 MB → stage `envelope`, permanent, no call (default limit; spike M10 may change it).
- Answer map (D17); every non-login error is `SmtpSendError(stage, "EGRAPH", httpStatus, permanent, soft)`; a refused login is `MailAuthError` (the only type `send.ts` turns into `auth_error`):
  - 202 → `{ response: "202 Accepted", accepted: envelope.to, rejected: [] }`.
  - `fetch` fails before a response with a connect or DNS error → `connect`, soft.
  - Abort or timeout after the request started → `unknown` (no resend: the server may have it).
  - 401 → call `freshToken()` once and repeat the call once (a 401 means "not accepted"); 401 again → `MailAuthError` reason `oauth_revoked`.
  - 403 with `error.code = "ErrorAccessDenied"` → `MailAuthError` reason `admin_consent_required`; another 403 → `MailAuthError` reason `protocol_disabled`.
  - 400, 404, 413 → `envelope`, permanent.
  - 429, 503 → `connect`, soft.
  - Other 5xx → `unknown`.
- **Sent copy (D22).** Graph saves the copy itself (R3), maybe some seconds after the 202. For `send_via = 'graph'` the Sent step never APPENDs: it locates by action id at 0, 5 and 15 s (injectable sleep); found → `sent_copy = 'found'`; still missing → `sent_copy = 'provider'`, which the send-result notice renders as `found`. Rejected: APPEND on a miss (a late Graph copy makes two). If spike M10 shows a changed Message-ID or `X-EA-Action-Id`, stop and ask.
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
6. 403 `ErrorAccessDenied` → `MailAuthError` `admin_consent_required`; 403 `MailboxNotEnabledForRESTAPI` → `protocol_disabled`.
7. 429 → `connect`, soft; 500 → `unknown`; `hangNext` with `timeoutMs: 200` → `unknown`.
8. Committer, end to end: an approved delegation of a Microsoft mailbox (GreenMail IMAP, fake token server, fake Graph) → one Graph call with the action's Message-ID and `X-EA-Action-Id`; the action is `applied`; the send limits count it (one `send_started_at`).
9. Same with the fake answering 500 → the action is not resent at the next committer tick (stage `unknown` rule).
10. Committer: the fake answers 403 `ErrorAccessDenied` → the mailbox is `auth_error` with `auth_reason = 'admin_consent_required'`; the send waits as `approved` (today's `auth_error` rule).
11. Committer: no Sent copy on GreenMail → no APPEND; `sent_copy = 'provider'` after the three tries; a copy that the test APPENDs before the second try → `found`.
12. Canary: the bearer token and the body are in no log line.

**Check.** The Proof.

**Done when.** The tests pass; the composition wires the Graph sender; the Proof prints `PROOF_OK`.

**Out of scope.** Graph draft creation (E6 fallback), any Graph read call.

## Correction from the stage 04 build (coordinator)

- A refused login is a `MailAuthError` with a `reason`, also for a Graph 401 or 403 (plan decision D15, review B1). Where a test or step above says `login` with a reason (for example line 42: "login, oauth_revoked"), read it as `MailAuthError` with that `reason`. Stage 04 left `reason` on `MailAuthError`; stage 10 sets it.

## Carry-over from the stage 06 review (2026-11-15)

Do not compare Graph scopes by name (`missingResourceScopes(spec, "graph", ...)`) before spike row M2 records the raw `scope` string of a Graph token answer: it may name the scope in a short form (`Mail.Send`). Prove `Mail.Send` by the Graph call itself.
