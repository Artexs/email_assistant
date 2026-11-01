# 0005 — Telegram first, behind a ChatChannel port
- Status: proposed
- Date: 2026-11-01

## Context
The old docs chose WhatsApp. WhatsApp Business needs a Meta business setup and template rules.
The user chose Telegram first and maybe a dedicated mobile app later (product brief Q4).

## Decision
- Define a `ChatChannel` port in the `channels` module: send notice, send digest, ask approval (buttons), receive command / callback.
- First adapter: Telegram Bot API. Chat linking by a one-time deep-link token. Only linked chats are accepted.
- Dev: long polling. Production: webhook with the secret-token header.
- Messages contain short notices and links, not full mail bodies.
- Approvals and commands go through one channel-neutral server API, so a mobile app can use the same API later.

## Consequences
- Fast start, no business verification.
- Telegram bot chats are not end-to-end encrypted: keep sensitive content out of messages.
- WhatsApp or a mobile app is a new adapter, not a redesign.
