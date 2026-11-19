# F118 plan — Phone channel (PWA, push, Telegram detail)

> **Status 2026-11-18 — planned.** Plan base: db85425a. Interfaces: [interfaces.md](interfaces.md). Questions and owner steps: [questions.md](questions.md).

## Input

Owner, 2026-11-13: "Okay default." (E9 decisions 8–10 = PD-092–PD-094; `epics/E09-reach.md`, `E09-discovery-notes.md` §5). ADR 0032 (proposed); F088 built its point 5.

- **P1 (PD-092)** Telegram detail `full` or `minimal`; new links `minimal`; `full` needs opt-in with consent text; org owner can lock `minimal`; the pilot keeps `full`.
- **P2 (PD-093)** Installable panel; the worker caches the app shell only, never `/api`; push holds kind, count, item id; a tap opens the item; iOS documented only.
- **P3 (PD-094)** Routing per user and kind (Telegram, push, both); urgent and approvals default to both once a device exists; quiet hours apply; device list; an ended session removes its devices.
- **P4** Flags `web_push`, `telegram_minimal` (PD-045), default off.

Design (each: reason; rejected):

- **D1** Own RFC 8291 (`aes128gcm`) and RFC 8292 (VAPID ES256) code on `node:crypto`, proven by the RFC 8291 example. Reason: the primitives work under Bun 1.4.4; no `bun.lock` change. Rejected: `web-push` 4.0.0 (open Bun AES-GCM issue), `@portable/web-push` (unvetted).
- **D2** The real-phone push is checkpoint A (after 05): a phone subscribes only on our panel. Q1.
- **D3** `push_subscriptions`: `id`, `org_id`, `user_id` (FK `memberships`, CASCADE), `session_id` (FK `auth_sessions`, SET NULL: null = ended), `secret` (ADR 0009, AAD `push:<id>`), `key_version`, `endpoint_hash` (unique per user), `device_label`, `created_at`, `last_success_at`, `last_error_code`. At most 10 per user. An 11th removes a device that is not live first (no session, or an expired one; oldest first), and the oldest live device last (stage 04).
- **D4** One outbox row per device: `channel = 'push'`, `push_subscription_id` (FK SET NULL, indexed), dedup `<key>:push:<sub id>`. Reason: a retry never repeats to a device that got it; sent rows stay for the metrics. Rejected: one row per user; CASCADE (deletes sent rows, review B1).
- **D5** Payload `{v:1,id,kind,count,itemId,lang}` (≤ 256 bytes); `TTL: 86400`; `Urgency: high` for urgent and approvals; `Topic` from sha256(row id); the service worker uses `tag` = row id.
- **D6** Groups: `urgent` = urgent, not_triaged; `approvals` = approval, approval_set, replies_ready; `updates` = send_result, delegation_answered, send_held, action_failed, auth_error, host_blocked, sync_stale, sync_ok, sent_missing, mailbox_removed. These are `pushKinds`. Other kinds stay Telegram (and mail by PD-033). Q2.
- **D7** `memberships.notice_routes` `{urgent?,approvals?,updates?}` of `telegram|push|both`. Missing: `both` for urgent and approvals when the user has a live device, else `telegram`. Delivery: the chosen channels that exist; when none exists, the other one (Q7).
- **D8** With `web_push` on, a member with a live device and no chat is a recipient of push kinds (`since` = oldest live device), and `detectNotices` visits that org. The M5 SLO stays Telegram-only (Q11).
- **D9** Live device: `session_id` not null and its session not expired. `removeDevice` fails the device's open rows `no_device`, then deletes it; the API, a 410 and the sender (ended or expired session) use it. SSO sessions end after 12 h (Q3).
- **D10** Sender: 201 → `sent`; 404, 410 → `removeDevice`; 429 → `Retry-After` (cap 15 min); 5xx, network → 30 s doubling to 15 min, `too_many_errors` at 5; other → `push_refused`. Quiet hours, 24 h expiry, 3 per user per tick, flag off → wait 15 min. Rows of a suspended org are not claimed. At least once.
- **D11** `memberships.telegram_detail` `full|minimal`, default `minimal`; the migration sets `full` where a chat link exists (pilot). Effective: flag off → `full`; org locked → `minimal`; else the member's value. The sender reads it at send time and writes `outbox.detail` (ADR 0032 point 5).
- **D12** `minimal` prints no string of the view: fixed phrases, numbers, the clock, a panel link. No address (Q4); `/status` names mailboxes "Mailbox 1…". No buttons. `/digest` answers `minimal`; `/review` gives the panel link. Taps on old `full` cards answer as today: their text is already in the chat.
- **D13** The link route takes `detail`; absent keeps the stored level (coordinator decision 87; the column default `minimal` covers a new member). A change to `full` needs the current `TELEGRAM_CONSENT_VERSION` and writes `web.telegram_consent`. The CLI link keeps the stored value. F118 does not change `tg_consent_text` or the consent version.
- **D14** `organizations.telegram_minimal_locked` (owner). Locked: `full` → `409 telegram_detail_locked`; member values stay for the unlock (Q5).
- **D15** `/manifest.webmanifest` (`start_url` `/activity`), `/sw.js` (bundled by `Bun.build` in `web:build`), `/offline.html` are public. The worker caches `/_astro/*` and `/offline.html` only and never answers `/api`. CSP gets `worker-src 'self'`.
- **D16** Each panel load re-sends an existing subscription with `rebindOnly`: it re-binds a device of this user only; a new device needs the click.
- **D17** A tap opens the page of its kind (`noticePath`); urgent opens `/activity?category=urgent` (Q9).
- **D19** Endpoint: `https`, port 443, host under `fcm.googleapis.com`, `push.services.mozilla.com`, `push.apple.com` or `notify.windows.com`; checked at subscribe and at send; no redirects. Rejected: any public host (SSRF). Q6.
- **D20** A push row goes only to devices with `created_at` ≤ the event time (`eventAt`, required for push kinds). Reason: a new device gets no burst of old notices (review B2).
- **D21** The loop-consent gate is a Telegram gate. A push row holds no loop data, so a gated owner gets `loop_consent` on Telegram (`only: "telegram"`) and the real kind by push (`only: "push"`) (review B3).
- **D22** Readers that match a Telegram dedup key also match its push rows: the card fail of an answered approval (`answered_elsewhere`), the F079 "request seen" check, the `sync_ok` episode list (review T1).
- **D23** A push row that ends `no_device` queues the Telegram row of its event when the member has a chat and that row does not exist (review T3).

## Facts checked

- Bun 1.4.4: ECDH P-256, `hkdfSync`, AES-128-GCM, ES256 (`ieee-p1363`) work (local probe, 2026-11-18).
- At db85425a: outbox CHECKs and send-time render (scout 1); `memberships` PK `(org_id, user_id)`; no manifest, worker or push library (scouts 2, 4); `/approvals?id=` links; urgent look-back 24 h by `linkedAt`; the approval consent split (review).

## Not verified

- Better Auth deletes the session row on sign-out and revoke: stage 03 test 5.
- Android install and FCM accepting our JWT: checkpoint A.

## Done when

1. The RFC 8291 example passes (01).
2. A sent payload decrypts to exactly the D5 keys (08).
3. `minimal` of every kind holds no planted string and no button (09).
4. Sign-out ends the session's devices; an ended session gets no push (03, 08).
5. A push-only member gets urgent and approval pushes; a Telegram-only member gets no push row (07).
6. Checkpoints A and B pass.
7. ADR 0032 accepted; docs and papers updated (13).

## Rules for every stage

- Read `docs/code-patterns.md` (§ Notices are facts, § Add a user command, § Texts carry a locale), `interfaces.md` and your stage.
- No endpoint, key, JWT, payload, mail text or address in a log, error, audit row or test name (D18).
- Texts en and pl in the same stage. A new `/api` route has `apiDoc`. A new table goes into the privacy export map.
- Format only the stage's files. A gap or deviation is a question, not a choice.

## Proof

```
mkdir -p /tmp/f118-sNN && bun run lint > /tmp/f118-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f118-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f118-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f118-sNN/int.log 2>&1 && echo PROOF_OK
```

Stages 04 and 05 add the e2e step (their files).

## Checkpoints, owner steps

- **A** after 05: owner steps O1–O3 (`questions.md`); a test push reaches the phone. Gate for 06.
- **C1** after 10: review of stages 06–10 (not a stop).
- **B** after 13: owner steps O4–O5; pilot switch-on.
- After 02 and 10: `bun run db:migrate` on the shared dev DB.

## Review

`claude-opus-5-5` before the land: every stage except 06 (`claude-sonnet-5-5`): risk areas or new Polish text.

## Stages

- 01 [Push crypto and VAPID](stages/stage-01-push-crypto.md) `[risky]`
- 02 [Migration A: devices and routes](stages/stage-02-migration-push.md) `[risky]`; migration; needs 01
- 03 [Device API](stages/stage-03-device-api.md) `[risky]`; needs 02
- 04 [PWA shell](stages/stage-04-pwa-shell.md); needs 03
- 05 [Account device card](stages/stage-05-device-card.md); needs 04; checkpoint A
- 06 [Route rule and setting](stages/stage-06-routing.md); needs A
- 07 [Fan-out and push-only recipients](stages/stage-07-fan-out.md) `[risky]`; needs 06
- 08 [Push render and sender](stages/stage-08-push-sender.md) `[risky]`; needs 07
- 08b [Push rows in the outbox readers](stages/stage-08b-push-readers.md) `[risky]`; needs 08
- 09 [Minimal Telegram render](stages/stage-09-minimal-render.md) `[risky]`; needs 08b
- 10 [Migration B: detail at send time](stages/stage-10-detail-migration.md) `[risky]`; migration; needs 09; C1
- 11 [Detail and lock API](stages/stage-11-detail-api.md) `[risky]`; needs 10
- 12 [Settings cards](stages/stage-12-settings-cards.md); needs 11
- 13 [Papers, docs, ADR](stages/stage-13-docs.md); needs 12; checkpoint B

## How to run (coordinator)

One stage at a time; land each (`--keep-open`) before the next spawn; drop the job DB after.

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F118" \
  'Implement F118 stage NN. Read spec/features/active/F118-e9b-phone-channel-pwa-push-telegram-detail/ticket.md, plan.md, interfaces.md and stages/stage-NN-<slug>.md; build every step. Final proof: the Proof of plan.md with sNN. In the final message, list as proven only what a saved log shows.'
```

## Planning progress

Scouts: 4. Stages 01–13, 08b [written]. `wc -w`: plan 1,496; stages 357–700.

## Cold review

`claude-opus-5-5` (risky stages, migrations, privacy). 5 blocking, 4 test gaps, 12 notes: all fixed (`plan-review-1-fixes.md`).
