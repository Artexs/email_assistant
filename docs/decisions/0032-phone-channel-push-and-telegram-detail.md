# 0032 — Phone channel: Web Push with ids and counts; Telegram detail per user

- Status: accepted (F118, 2026-11-19; proposed by E9 discovery, 2026-11-13). The code is built and the flags `web_push` and `telegram_minimal` are off by default; the owner turns them on for the pilot organization at checkpoint B.
- Date: 2026-11-13
- Amends: 0005 (Telegram is one of several notice channels), 0016 (the panel becomes an installable PWA)
- Point 5 built by `spec/features/done/2026-11/F088-notices-as-facts/` (the outbox stores the view, the sender renders).

## Context

Today every notice goes to Telegram (`channels/`, table `outbox`). The text of the outbox row is rendered when the row is queued. It holds the sender, the subject, the AI summary and, for approvals, the draft text.
`spec/vision.md` says that Telegram never gets raw mail bodies. `03-product-frame.md` §4 says that Telegram carries ids and counts only. The MVP follows the vision line, not the frame line.
E4 gives the panel an approvals page (E4-A) and a mail channel for digest and report (PD-033).
A user without Telegram has no phone notice. A user who does not want mail content on Telegram servers has no choice.

## Decision

1. The web panel becomes an installable PWA: a manifest and a service worker that caches the app shell only. The service worker never caches `/api` answers. No mail content is stored on the device.
2. Web Push (VAPID, RFC 8291 encrypted payload) carries the notice kind, a count and an item id only. A tap opens the item in the panel. The push services (Google FCM, Apple, Mozilla, Microsoft) see only encrypted ids and counts. The papers list them.
3. Each user chooses per notice kind: Telegram, push or both. The quiet hours (PD-033) apply to every channel. A session that ends (sign-out, lockout, password change) removes the push subscriptions of that session.
4. Telegram detail per user: `full` (the MVP content: sender, subject, summary, draft, Send button) or `minimal` (counts and panel links, no Send button). A new Telegram link defaults to `minimal`. `full` needs an explicit opt-in with the consent text. The organization owner can lock `minimal` for all members. Raw bodies never go to Telegram in either mode.
5. A notice is stored as facts (kind, ids, counts) and rendered for its channel and detail level when it is sent. The send-time renderer reads the user's current choice.

## Built (F118)

Each line says where the point lives now. `docs/capabilities/digest-and-notices.md` (rules 3c to 3f) and `docs/capabilities/web-panel.md` (rules 2 and 14 to 17) hold the rules.

1. **PWA.** Built (stage 04): `/manifest.webmanifest` (`start_url` `/activity`), `/sw.js` (bundled by `web:build`), `/offline.html`, icons. The worker caches `/offline.html` and `/_astro/` only and never handles `/api`. The CSP has `worker-src 'self'`.
2. **Web Push.** Built (stages 01, 03, 08): own RFC 8291 and RFC 8292 code on `node:crypto` (no library), the device API `/api/me/push`, the sender job `channels.push`. The payload is `{ v, id, kind, count, itemId, lang }` and holds no mail text. The papers list the push services: the registry row `web-push` and `TERMS_VERSION` 2026-11-19 (stage 13).
3. **Routes per kind.** Built (stages 06, 07, 12): three groups (`urgent`, `approvals`, `updates`), the value `telegram`, `push` or `both` in `memberships.notice_routes`, the Settings card "Where notices go". Quiet hours apply to every push row. Digests and reports never go to the phone.
4. **Telegram detail.** Built (stages 09 to 12): `memberships.telegram_detail`, `organizations.telegram_minimal_locked`, the routes `PATCH /api/me/telegram-detail` and `PATCH /api/organization/telegram-lock`, the link step and the lock card. A new member is `minimal`; `full` needs the consent version. The text of the consent is unchanged (D13).
5. **Facts.** Built by F088, extended by F118: every kind has a `telegram.minimal` renderer and, for a kind in a group, a push renderer (`noticeFactsOf`). The sender reads the level at send time and stores it in `outbox.detail`.

### Decisions that refine the points

- **D6 (point 3): groups.** `urgent` = urgent, not_triaged; `approvals` = approval, approval_set, replies_ready; `updates` = send_result, delegation_answered, send_held, action_failed, auth_error, host_blocked, sync_stale, sync_ok, sent_missing, mailbox_removed. Every other kind stays on Telegram (and mail, PD-033).
- **D9 (point 3): the end of a session.** A device is live while its session is not ended or expired. A session that ends sets `session_id` to null; the next send, the API or a `404`/`410` from the push service removes the device and its open rows end `no_device`, and a row with a chat link falls back to Telegram (D23). SSO sessions end after 12 hours, so an SSO member gets push again after the next panel load re-binds the device (D16).
- **D19 (point 2): the host list.** An endpoint is accepted only on `https`, port 443, under `fcm.googleapis.com`, `push.services.mozilla.com`, `push.apple.com` or `notify.windows.com`; no redirect is followed. A new browser vendor needs a code change.
- **D13 (point 4): consent.** F118 does not change `tg_consent_text` or `TELEGRAM_CONSENT_VERSION`. The two level texts are the panel texts of the detail choice. A member who linked before keeps the consent.

## Consequences

- `03-product-frame.md` §4 needs one changed line (the owner writes it): "Telegram carries mail content only when the user opts in; never raw bodies. Logs and error reports carry ids and counts."
- `TERMS_VERSION` goes up when E9b lands (papers: Telegram detail levels, push services).
- On the tailnet deployment, the phone needs Tailscale to open the panel. Push arrives without it. A public panel needs an ADR 0017 change (E7 or E10), not this ADR.
- iOS shows push only for a Home Screen web app (iOS 16.4 or later). The owner's test phone is Android, so iOS is documented, not tested.
