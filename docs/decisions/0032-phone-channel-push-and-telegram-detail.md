# 0032 — Phone channel: Web Push with ids and counts; Telegram detail per user

- Status: proposed (E9 discovery, 2026-11-13). The E9b ticket sets "accepted".
- Date: 2026-11-13
- Amends: 0005 (Telegram is one of several notice channels), 0016 (the panel becomes an installable PWA)

## Context

Today every notice goes to Telegram (`channels/`, table `outbox`). The text of the outbox row is rendered when the row is queued. It holds the sender, the subject, the AI summary and, for approvals, the draft text.
`spec/vision.md` says that Telegram never gets raw mail bodies. `03-product-frame.md` §4 says that Telegram carries ids and counts only. The MVP follows the vision line, not the frame line.
E4 gives the panel an approvals page (E4-A) and a mail channel for digest and report (PD-033).
A user without Telegram has no phone notice. A user who does not want mail content on Telegram servers has no choice.

## Decision

1. The web panel becomes an installable PWA: a manifest and a service worker that caches the app shell only. The service worker never caches `/api` answers. No mail content is stored on the device.
2. Web Push (VAPID, RFC 8291 encrypted payload) carries the notice kind, a count and an item id only. A tap opens the item in the panel. The push services (Google FCM, Apple, Mozilla) see only encrypted ids and counts. The papers list them.
3. Each user chooses per notice kind: Telegram, push or both. The quiet hours (PD-033) apply to every channel. A session that ends (sign-out, lockout, password change) removes the push subscriptions of that session.
4. Telegram detail per user: `full` (the MVP content: sender, subject, summary, draft, Send button) or `minimal` (counts and panel links, no Send button). A new Telegram link defaults to `minimal`. `full` needs an explicit opt-in with the consent text. The organization owner can lock `minimal` for all members. Raw bodies never go to Telegram in either mode.
5. A notice is stored as facts (kind, ids, counts) and rendered for its channel and detail level when it is sent. The send-time renderer reads the user's current choice.

## Consequences

- `03-product-frame.md` §4 needs one changed line (the owner writes it): "Telegram carries mail content only when the user opts in; never raw bodies. Logs and error reports carry ids and counts."
- `TERMS_VERSION` goes up when E9b lands (papers: Telegram detail levels, push services).
- On the tailnet deployment, the phone needs Tailscale to open the panel. Push arrives without it. A public panel needs an ADR 0017 change (E7 or E10), not this ADR.
- iOS shows push only for a Home Screen web app (iOS 16.4 or later). The owner's test phone is Android, so iOS is documented, not tested.
