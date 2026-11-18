# F118 plan — Phone channel (PWA, push, Telegram detail)

> **Status 2026-11-18 — planned.** Plan base: db85425a. Interfaces: [interfaces.md](interfaces.md). Questions and owner steps: [questions.md](questions.md).

## Input

Owner (2026-11-13, E9 discovery, "Okay default."): decisions 8, 9, 10 of `docs/product/stage-2/epics/E09-reach.md` § Discovery = PD-092, PD-093, PD-094. ADR 0032 (proposed). Design detail: `E09-discovery-notes.md` §5 "E9b Phone channel". F088 already built ADR 0032 point 5 (notices as facts, send-time render).

- **P1 (PD-092)** Telegram detail `full` or `minimal`; new links `minimal`; `full` needs opt-in with consent text; org owner can lock `minimal`; the pilot keeps `full`.
- **P2 (PD-093)** Installable panel; the service worker caches the app shell only, never `/api`; push holds kind, count, item id; a tap opens the item; iOS documented only.
- **P3 (PD-094)** Routing per user and kind: Telegram, push or both; urgent and approvals default to both once a device subscribes; quiet hours apply; device list in Account; a session that ends removes its subscriptions.
- **P4** Flags `web_push`, `telegram_minimal` (E9 notes §4, PD-045), default off.

Design (each: reason; rejected):

- **D1** Own RFC 8291 (`aes128gcm`) and RFC 8292 (VAPID ES256) code on `node:crypto`, proven by the RFC 8291 example vector. Reason: 4 primitives, all checked under Bun 1.4.4; no `bun.lock` change. Rejected: `web-push` 4.0.0 (open Bun AES-GCM issue), `@portable/web-push` (unvetted).
- **D2** The real-phone push is checkpoint A after stage 05, not stage 1: a phone subscription needs our manifest, worker and VAPID key on the tailnet host. Stage 01 retires the Bun risk with the vector and a decrypt round trip. Default, owner to confirm (Q1).
- **D3** `push_subscriptions`: `id`, `org_id`, `user_id` (FK `memberships (org_id, user_id)` ON DELETE CASCADE), `session_id` (FK `auth_sessions` ON DELETE CASCADE), `secret` (ADR 0009 ciphertext of `{endpoint,p256dh,auth}`, AAD `push:<id>`), `key_version`, `endpoint_hash` (sha256 hex; unique per user), `device_label` (≤ 60 chars from the user agent), `created_at`, `last_success_at`, `last_error_code`. At most 10 per user: an 11th removes the oldest. A subscribe with a known endpoint re-binds it to the current session.
- **D4** One outbox row per device: `channel = 'push'`, `push_subscription_id` (FK, ON DELETE CASCADE), dedup `<key>:push:<sub id>`. Reason: a retry never repeats to a device that got it. Rejected: one row per user (a retry re-sends to every device).
- **D5** Payload `{v:1,id,kind,count,itemId,lang}` (≤ 256 bytes), headers `TTL: 86400`, `Urgency: high` for urgent and approvals else `normal`, `Topic` = base64url of the first 24 bytes of sha256(row id). The worker shows the notice with `tag` = row id, so a repeat replaces it.
- **D6** Groups: `urgent` = urgent, not_triaged; `approvals` = approval, approval_set, replies_ready; `updates` = send_result, delegation_answered, send_held, action_failed, auth_error, host_blocked, sync_stale, sync_ok, sent_missing, mailbox_removed. These are `pushKinds`. Every other kind stays Telegram (and mail by PD-033). Default, owner to confirm (Q2).
- **D7** `memberships.notice_routes` jsonb `{urgent?,approvals?,updates?}`, each `telegram|push|both`. Missing value: `both` for urgent and approvals when the user has a live device, else `telegram`. Delivery: the chosen channels that exist (chat link, live device); when none exists, the other one if it exists (Q7).
- **D8** With `web_push` on, a member with a live device and no chat joins `OrgRun.members` and `owners` for push kinds; `since` = their oldest live device `created_at` (urgent look-back as `linkedAt`).
- **D9** Live device = its session exists and `expires_at > now`. The push sender deletes a device whose session expired and fails its rows `no_device`. SSO sessions end after 12 h, so their push stops until the panel is opened again; every panel load re-binds the device (Q3).
- **D10** Push sender outcomes: 201 → `sent`, `last_success_at`; 404, 410 → delete device (rows cascade); 429 → wait `Retry-After` (cap 15 min); 5xx, network → 30 s doubling to 15 min, `too_many_errors` at 5; other 4xx → `failed` / `push_refused`, `last_error_code`. Quiet hours (`createQuietGate`), 24 h expiry, 3 per user per tick, flag off → wait 15 min, org `suspended` → `outdated`. At least once (stale claim after 5 min).
- **D11** `memberships.telegram_detail` `full|minimal`, default `minimal`; the migration sets `full` where a chat link exists (the pilot keeps `full`). Effective detail: flag off → `full`; org locked → `minimal`; else the member's value. The sender reads it at send time for each row without stored text and writes it to `outbox.detail` (ADR 0032 point 5).
- **D12** `minimal` prints no string of the view: only fixed phrases, numbers, the clock and a panel link (`WEB_BASE_URL` + `noticePath`). No address, also not the own mailbox address (Q4). No buttons. The edit line of `approval_edit` is the same in both levels. `/digest` answers the `minimal` digest; `/review` answers "Open the panel" with the link.
- **D13** Link step: `POST /api/channels/telegram/link` takes `detail` (default `minimal`) and stores it on the membership in the link transaction; the consent version is required as today. `PATCH /api/me/telegram-detail` `{detail, consentVersion?}`: `full` needs the current `TELEGRAM_CONSENT_VERSION` and writes `web.telegram_consent`. The CLI link keeps the stored value.
- **D14** `organizations.telegram_minimal_locked` (owner sets it). Locked: `full` is refused `409 telegram_detail_locked`; stored member values stay and come back on unlock (Q5).
- **D15** Manifest `/manifest.webmanifest` (`start_url` `/activity`, `display` standalone, icons 192, 512, maskable) and `/sw.js` (bundled by `Bun.build` in `web:build` from `apps/web/src/sw/`) are public paths. The worker caches `/_astro/*` and `/offline.html` only; navigations go to the network with `/offline.html` as fallback; it never answers `/api`.
- **D16** The panel shell re-sends an existing subscription on each load (`PUT`), so a new session gets the device.
- **D17** `noticePath`: approval, send_result → `/approvals?id=<id>`; approval_set, replies_ready, send_held → `/approvals`; urgent → `/activity?category=urgent`; not_triaged → `/activity`; delegation_answered → `/delegations`; mailbox kinds → `/mailboxes`; every other kind → `/activity`.
- **D18** Logs and errors never hold an endpoint, a key, a payload or a JWT. The log canary gets a planted endpoint and key.
- **D19** A push endpoint must be `https`, port 443, and its host must end with `fcm.googleapis.com`, `push.services.mozilla.com`, `push.apple.com` or `notify.windows.com` (`400 push_host_not_allowed`). No redirects. Rejected: any public host (SSRF surface). Q6.

## Facts checked

- Bun 1.4.4 (`.bun-version` and local): ECDH P-256, `hkdfSync`, AES-128-GCM, ES256 with `ieee-p1363` and JWK export work (probe in this worktree, 2026-11-18).
- Outbox `channel` and `detail` CHECKs, `queueNotice` writes `detail = 'full'`, sender claims by channel: scout 1, read. `auth_sessions.id` uuid, `memberships` PK `(org_id, user_id)`: migrations, read. No manifest, worker or push library: scouts 2, 4. Deep link `/approvals?id=`: `channels/notices/approval.ts`.

## Not verified

- Better Auth deletes the `auth_sessions` row on sign-out and on revoke: stage 03 test 5.
- Chrome on Android installs the PWA and FCM accepts our VAPID JWT: checkpoint A.

## Done when

1. The RFC 8291 vector passes (stage 01).
2. Payload keys are exactly D5 for every push kind (stage 07).
3. Canary test: `minimal` text of every kind holds no planted string and no button (stage 08).
4. Sign-out removes the session's devices; an expired session gets no push (stages 03, 07).
5. A push-only member gets urgent and approval rows; a Telegram-only member gets no push row (stage 06).
6. Checkpoint A and B pass on the owner's phone.
7. ADR 0032 accepted, capability pages and papers updated (stage 12).

## Rules for every stage

- Read `docs/code-patterns.md` (§ Notices are facts, § Add a user command, § Texts carry a locale), this file, `interfaces.md` and your stage.
- No endpoint, key, JWT, payload, mail text or address in a log, error, audit row or test name.
- Texts en and pl in the same stage. A new `/api` route has `apiDoc`. A new table goes into the privacy export map.
- Format only the stage's files. A gap or a deviation is a question in the final message, not a choice.

## Proof

```
mkdir -p /tmp/f118-sNN && bun run lint > /tmp/f118-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f118-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f118-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f118-sNN/int.log 2>&1 && echo PROOF_OK
```

Stages 04 and 05 add the e2e step (their files).

## Checkpoints, owner steps

- **A** after 05: owner steps O1–O3 (`questions.md`); a test push reaches the phone. Stage 06 waits for it.
- **C1** after 09: review of stages 06–09 (not a stop).
- **B** after 12: owner steps O4–O5; pilot switch-on.
- Owner step after 02 and after 09: `bun run db:migrate` on the shared dev DB.

## Review

`claude-opus-5-5` before the land: 01, 02, 03, 06, 07, 08, 09, 10 (security, migration, sending to people, privacy, Polish text); 04, 05, 11 (Polish text). Stage 12: `claude-sonnet-5-5`.

## Stages

- 01 [Push crypto and VAPID](stages/stage-01-push-crypto.md) `[risky]`
- 02 [Migration A: devices and routes](stages/stage-02-migration-push.md) `[risky]`; migration
- 03 [Device API](stages/stage-03-device-api.md) `[risky]`; needs 01, 02
- 04 [PWA shell](stages/stage-04-pwa-shell.md); needs 03
- 05 [Account device card](stages/stage-05-device-card.md); needs 04; checkpoint A
- 06 [Routing and recipients](stages/stage-06-routing.md) `[risky]`; needs A
- 07 [Push render and sender](stages/stage-07-push-sender.md) `[risky]`; needs 06
- 08 [Minimal Telegram render](stages/stage-08-minimal-render.md) `[risky]`; needs 07
- 09 [Migration B: detail at send time](stages/stage-09-detail-migration.md) `[risky]`; migration; needs 08; C1
- 10 [Detail and lock API](stages/stage-10-detail-api.md) `[risky]`; needs 09
- 11 [Settings cards](stages/stage-11-settings-cards.md); needs 10
- 12 [Papers, docs, ADR](stages/stage-12-docs.md); needs 11; checkpoint B

## How to run (coordinator)

Move the ticket to `active/` and commit. One stage at a time; land each (`limen land --keep-open`) before the next spawn; drop the job DB after the land.

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F118" \
  'Implement F118 stage NN. Read spec/features/active/F118-e9b-phone-channel-pwa-push-telegram-detail/ticket.md, plan.md, interfaces.md and stages/stage-NN-<slug>.md; build every step. Final proof: the Proof of plan.md with sNN. In the final message, list as proven only what a saved log shows.'
```

## Planning progress

Scouts: 4 (`scouts.md`). Words: see § Log. Stages 01–12 [written].

## Cold review

Model: `claude-opus-5-5` (risky stages, migrations, push to people, privacy). Result: `plan-review-1.md`.

## Log

- 2026-11-18 planned at db85425a.
