> **Status 2026-11-07 — planned.** Scope approved by the user (2026-11-07). Left: the full plan (stages, step detail), written in a new chat from the handoff `~/.pi/agent/notes/2026-11-07-handoff-fake-telegram-plan.md`.

# Fake Telegram: a local Bot API emulator for agent-run dev tests

Scope: test tooling, not a roadmap slice. Needs: nothing from the user (no account, no phone, no real token).
Why not a real Telegram test account: `notes/2026-11-07-telegram-test-accounts.md` (test DC route blocked, 2026-11-07).

## Goal

A local fake of the Telegram Bot API that our server talks to in dev, plus a driver (CLI + script API) with which an agent plays the user.
The agent can then run full Telegram flows (link, notices, digest, buttons) alone, with GreenMail, and repeat them after each change.

## Scope

1. Server: answers the Bot API methods the bot uses now: `getMe`, `getUpdates` (long polling with offset), `sendMessage`, `editMessageText`, `answerCallbackQuery`, `setMyCommands` (grep `apps/server/src` for others before the plan). Keeps chats and messages in memory.
2. Realistic checks: Telegram limits and errors that our code handles (4096-character text, 64-byte `callback_data`, "message is not modified", 400/401/409/429 shapes as in `notes/2026-11-06-telegram-bot-facts.md`).
3. Driver: send a text or command as a user (`/start <code>`, `/digest`), press an inline button, read a chat (messages, buttons, edits), wait until a bot message matches a pattern. Non-interactive CLI with clear output and exit codes, and a TS API for scripts and tests.
4. App hook: a dev-only `TELEGRAM_API_ROOT` setting, passed to the bot and the `telegram:*` scripts. The code already accepts `apiRoot` (`runtime.ts`, `bot.ts`, `api.ts`, `check.ts`), today only for tests. The config refuses it outside dev (rule to be fixed by the plan).
5. One scripted end-to-end flow: link the chat → urgent notice → digest → button press → result checked in the DB and GreenMail.
6. A short doc so an agent can start and drive it.

## Placement (user decision 2026-11-07)

Separate from the application: its own workspace package (proposal: `tools/fake-telegram/`, add `tools/*` to the root `workspaces`).
The app never imports it, and it never ships in the server image. The only app change is the `TELEGRAM_API_ROOT` setting.

## Out of scope

Webhooks, media, groups, payments, other API methods; real rate limits; how messages look in the real app (the user checks that on the phone sometimes); real Telegram accounts.

## Done when

- To be set by the plan. Minimum: the agent runs the flow in scope item 5 alone and it passes; the same flow runs as an automated test in CI; the server refuses `TELEGRAM_API_ROOT` outside dev.

## Log

- 2026-11-07: test-DC route probed and dropped; fake Telegram scope agreed with the user; placement outside the app decided.
