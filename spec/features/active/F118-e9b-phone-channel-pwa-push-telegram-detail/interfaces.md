# F118 interfaces

Part of [plan.md](plan.md). These names are the contract between the stages and for later tickets. A stage that must change one asks first. Signatures are the shape; the worker picks the exact TypeScript form at `HEAD`.

## Core (`packages/core`)

- `noticeChannels` gains `"push"` and `NoticeRenderer` an optional `push` key (stage 07, the first writer of push rows); stage 08 fills the push renderers. `noticeDetails` gains `"minimal"` (stage 09).
- `pushKinds`: the kinds with a push renderer (D6). `noticeGroups`: `{ urgent, approvals, updates }` → kinds (D6). `noticeGroupOf(kind): NoticeGroup | null`. All three in stage 04.
- `noticeFactsOf(kind, view): { count: number; itemId: string | null }` (stage 08 for push kinds, stage 09 for every kind). One source for the push payload and the `minimal` text.
- `noticePath(kind, itemId): string` (stage 04): the panel path of a tap (D17). Pure; the service worker bundles it.
- `PushPayload = { v: 1; id: string; kind: NoticeKind | "test"; count: number; itemId: string | null; lang: "pl" | "en" }` and `pushPayloadSchema` (strict) (stage 04).
- `renderNotice(kind, view, { channel: "push", detail: "full", locale })` → `{ ok: true, text: <JSON of PushPayload without id>, buttons: [] }` for a push kind, `{ ok: false }` for any other kind (stage 08). The sender adds `id`.
- `renderNotice(kind, view, { channel: "telegram", detail: "minimal", locale, webBaseUrl? })` for every kind (stage 09). The `NoticeRenderer` type makes `telegram.minimal` required.
- `effectiveDetail({ flagOn, locked, memberDetail }): "full" | "minimal"` (stage 10).
- `effectiveRoute({ stored, hasChat, hasDevice, group }): { telegram: boolean; push: boolean }` (stage 06, D7).
- `pushTexts(lang)`: the push notification title and body per kind and count (stage 04; en and pl).
- Flags in `featureFlags`: `web_push` (stage 03), `telegram_minimal` (stage 10). Epic E9, remove-by `2027-06-01`, default off.

## Server (`apps/server`)

- `channels/push/` module (stage 01): `encryptPushPayload(sub, plain, deps?)` (RFC 8291 `aes128gcm`), `vapidHeaders(endpoint, keys, now)` (RFC 8292, ES256, `exp` ≤ 12 h), `sendWebPush(sub, payload, opts, deps: { fetch, now })` → `PushResult = { kind: "sent" } | { kind: "gone" } | { kind: "retry"; afterMs: number | null } | { kind: "refused"; status: number }`, `checkPushEndpoint(url): ok | "push_host_not_allowed" | "bad_endpoint"` (D19).
- Config (stage 01): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (all three or none; `pushConfigOf(config)` → keys or null). CLI `bun run push:keys` prints a new key pair for the owner.
- Table `push_subscriptions` (stage 02, D3). Repo: `upsertPushSubscription` (with `rebindOnly`), `listLiveDeviceIds(trx, ctx, userId, now)` → `{ id, createdAt }[]` (no secret, no box), `loadDeviceSecret(trx, ctx, id, box)`, `listDeviceViews`, `removeDevice(trx, ctx, id)` (fails the device's open rows `no_device`, then deletes it), `markPushSuccess`, `markPushError`.
- `outbox.push_subscription_id` (stage 02, D4); dedup key of a push row: `<key>:push:<subscription id>` (`pushDedupKey`).
- `memberships.notice_routes jsonb` (stage 02, D7); `memberships.telegram_detail`, `organizations.telegram_minimal_locked` (stage 10, D11, D14).
- Routes (stage 03): `GET /api/me/push`, `PUT /api/me/push/subscription`, `DELETE /api/me/push/devices/:id`, `POST /api/me/push/test`. Stage 06: `PATCH /api/me/notify` gains `routes`. Stage 11: `PATCH /api/me/telegram-detail`, `PATCH /api/organization/telegram-lock`, `POST /api/channels/telegram/link` gains `detail`.
- `NoticeRecipient = { userId, role, locale, since: Date, hasChat: boolean }` (stage 07): `OrgRun.members` and `owners` become recipients.
- `queueNotice` (stage 07): new inputs `eventAt?: Date` (required for a push kind, D20) and `only?: "telegram" | "push"` (D21). Without an explicit `channel`, it writes one Telegram row and one push row per live device with `createdAt ≤ eventAt`, by `effectiveRoute`. It returns the Telegram row id when it wrote one, else the first push row id, else null.
- Job `channels.push` (`createPushSender`, every 15 s, stage 08): registered when `pushConfigOf` is not null, with or without the Telegram bot.
- Audit events: `push.subscribed`, `push.removed` (stage 03), `member.telegram_detail_changed`, `org.telegram_lock_changed` (stage 11). Data: ids and the new value only.
- Outbox fail codes added: `no_device` (stage 02, `removeDevice`), `push_refused` (stage 08).
- Log fields added: `push_subscription_id` (uuid), `http_status` (number) if missing. Never an endpoint, a key or a payload.
