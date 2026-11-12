# s2-telegram — Stage 24

Part of [`../plan.md`](../plan.md). Read that file's "Input" (D3) and "Rules for every step" first.

## Stage 24 — A linked chat that sends its used link again (D3 change, user yes 2026-11-07)

Why: in the stage 23 pilot run the user opened the used link again in the already linked chat and got "This link was used already. Ask for a new link." That text is wrong for a chat that works. The main session and the checkpoint 3 reviewer proposed the change; the user said yes on 2026-11-07.

- [x] **24.1 Reply "linked already" to a linked chat that sends a used token**
  - Goal: a chat that is linked (any link row for this chat id) and sends `/start <token>` with a token whose row is `used` gets `ALREADY_LINKED_TEXT`. Nothing else changes.
  - Files:
    - `apps/server/src/modules/channels/texts.ts`: add `export const ALREADY_LINKED_TEXT = \`✅ This chat is linked already.\n${helpText()}\`;`next to`LINKED_TEXT`.
    - `apps/server/src/modules/channels/telegram/bot.ts`: in the `bot.command("start", …)` handler, branch `result.kind === "used"`: if `await findChatLink(db, chatId)` returns a link, reply `ALREADY_LINKED_TEXT`; else reply `LINK_USED_TEXT` as now. Keep the log line `a used link token was tried` for both cases (no chat id, no token in the log).
    - `apps/server/test/integration/telegram-router.test.ts`: new tests (below).
    - `spec/features/done/2026-11/F004-s2-telegram/plan.md`: D3 text (main session does it, not the implementer).
  - Interfaces: `ALREADY_LINKED_TEXT: string` (new export of `channels/texts.ts`).
  - Decisions:
    - `expired` keeps `LINK_EXPIRED_TEXT` also for a linked chat (an expired token was never used; the user may want a new link for another reason).
    - An unlinked chat with a used token keeps `LINK_USED_TEXT` (D3 exception unchanged). An unknown token: unchanged (help for a linked chat, no reply for an unlinked chat).
    - The check uses the chat's own link only (`findChatLink(db, chatId)`); it does not compare the token's user with the link's user. Why: the chat is linked, so "ask for a new link" is never the right advice.
  - Test (in `telegram-router.test.ts`, `withRollback`, fixed `T`):
    1. Linked + used: create a token, `/start <token>` from chat A (links it), clear `calls`, send `/start <token>` again from chat A → one `sendMessage` with text `ALREADY_LINKED_TEXT`; `linkCount(trx, A)` stays 1.
    2. The existing test "a used token from another chat gets LINK_USED_TEXT and no link" stays and passes unchanged (unlinked + used).
    3. Linked + expired: a linked chat (`linkedMember`) sends `/start <expired token>` → `LINK_EXPIRED_TEXT`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`; `bun run test:int` (dev DB on 5433 must be up: `bun run dev:up`). Format only the changed files: `bunx prettier --write <changed files>`. **Never run `bun run format`** (whole repo; other agents have untracked files in this checkout).
  - Done when: the tests pass and the reply texts match the decisions.
  - Out of scope: the picker "Already saved" text (`spec/features/planned/F030-telegram-picker-already-saved/plan.md`); any other `/start` change.

- [x] **24.2 Deploy to the VPS (main session)**
  - Steps (as in `deploy/README.md` "Update"; `ssh home_vm`, `cd ~/email_assistant`, `C="docker compose -f deploy/compose.yaml --env-file .env"`): `git rev-parse --short HEAD` → `<OLD>`; `git pull`; `$C up -d --wait db`; `$C run --build --rm server bun run db:migrate`; `$C up -d --build --wait`; `$C logs --since 5m server` has `listening on port 8080` and `telegram: polling as @Email_assistant_vps_bot`, no `409`.
  - Rollback: `git checkout <OLD> && $C up -d --build --wait`.
  - Done when: the server is healthy with the new commit and polls as the pilot bot.
