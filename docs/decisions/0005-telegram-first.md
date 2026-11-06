# 0005 — Telegram first, behind a ChatChannel port
- Status: accepted (user, 2026-11-02)
- Date: 2026-11-01

## Context
The old docs chose WhatsApp. WhatsApp Business needs a Meta business setup and template rules.
The user chose Telegram first and maybe a dedicated mobile app later (product brief Q4).

## Decision
- Define a `ChatChannel` port in the `channels` module: send notice, send digest, ask approval (buttons), receive command / callback.
- First adapter: Telegram Bot API. Chat linking by a one-time deep-link token. Only linked chats are accepted.
- Long polling on the dev machine and on the home VPS (no inbound port needed). A webhook with the secret-token header only when the server has a public HTTPS address.
- Two bots: a dev bot and a pilot bot. Telegram allows only one update consumer per bot token at a time.
- Link tokens: one-time, bound to one user, valid for 15 minutes.
- Notices and digests go out in every mailbox mode (they do not change the mailbox).
- Messages contain short notices, no full mail bodies. Digest lines contain the sender, the subject and the AI summary: the user accepts this content on Telegram servers.
- Approvals and commands go through one channel-neutral server API, so a mobile app can use the same API later.

## Consequences
- Fast start, no business verification.
- Telegram bot chats are not end-to-end encrypted: keep sensitive content out of messages.
- WhatsApp or a mobile app is a new adapter, not a redesign.
- Implementation (S2): long polling with grammY, an outbox table for scheduled messages (digests and notices), private chats only, plain-text messages.
