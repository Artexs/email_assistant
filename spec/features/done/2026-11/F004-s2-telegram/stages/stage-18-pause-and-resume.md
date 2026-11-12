# s2-telegram — Stage 18

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 18 — Commands: `/pause`, `/resume` [risky]

- [x] **18.1 `/pause`, `/resume` (owner only, never over `auth_error`), the command dispatcher**
  - Goal: the owner stops and starts the reading and triage of the organization's mailboxes from Telegram (P6), and the update handlers of stage 14 get their real implementation.
  - Files: change `apps/server/src/modules/channels/commands.ts`, `apps/server/src/modules/channels/index.ts`, `apps/server/src/modules/audit/repo.ts` (two event names), `apps/server/test/integration/channels-commands.test.ts`.
  - Interfaces:
    - `audit/repo.ts`: `auditEvents.mailboxPaused = "mailbox.paused"`, `auditEvents.mailboxResumed = "mailbox.resumed"`.
    - `pauseMailboxes(deps: CommandDeps, link: LinkedChat): Promise<OutMessage>`
    - `resumeMailboxes(deps: CommandDeps, link: LinkedChat): Promise<OutMessage>`
    - `runCommand(deps: CommandDeps, link: LinkedChat, name: CommandName): Promise<OutMessage>` — an exhaustive `switch`: `help` → `helpMessage()`, `status` → `statusMessage`, `digest` → `digestNowMessage`, `pause` → `pauseMailboxes`, `resume` → `resumeMailboxes`.
    - `createUpdateHandlers(deps: CommandDeps): UpdateHandlers` — `command` → `runCommand`; `callback` → `handleCallback({ db: deps.db, now: deps.now }, link, data)` (stage 16).
  - Decisions:
    - `link.role !== "owner"` → `{ text: "Only the owner can pause or resume the mailboxes.", buttons: [] }`, no change.
    - `/pause`: for each mailbox of `listMailboxes(ctx)` with status `active`, one transaction: `changeMailboxStatus(trx, ctx, id, { from: "active", to: "paused", at: now })` (stage 8, conditional) and, when it changed, `recordAudit(trx, ctx, { actor: link.userId, event: auditEvents.mailboxPaused, data: { mailbox_id: id, via: "telegram" }, at: now })`; ``log.info(`mailbox ${id} paused by user ${link.userId}`)``.
    - `/resume`: the same with `from: "paused"`, `to: "active"`, `mailbox.resumed`.
    - `auth_error` is never changed: both updates are conditional, and the sync job's `setMailboxStatus("auth_error")` stays unconditional, so a login error found after a pause wins (P6). `listSyncTargets` reads only `active` mailboxes, so a paused mailbox is neither synced nor triaged (S1a and S1b code, no change).
    - Reply texts (lines joined with `\n`; addresses cut to 60):
      - `/pause`, something changed: `⏸ Paused: <addresses, comma-separated>` / `The system does not read or triage these mailboxes now and sends no urgent notice for them. Digests still come.` / `/resume starts them again.`
      - `/resume`, something changed: `▶️ Resumed: <addresses>` / `The next sync runs within 5 minutes. Mail that came during the pause is read then; mail older than 7 days is not triaged.`
      - Extra lines per other mailbox: `` `❌ ${address} has a login error: run mailbox:password first.` `` (both commands); `` `${address} was paused already.` `` (`/pause`); `` `${address} was active already.` `` (`/resume`).
      - Nothing changed and no extra line (no mailbox) → `No mailbox connected.`
  - Test (`channels-commands.test.ts`, `withRollback`; `T` = `2026-11-06T10:00:00Z`; org A, owner link, one `active` mailbox):
    1. Owner `/pause` → the mailbox is `paused` with `status_changed_at` = `T`; one `mailbox.paused` audit row with `actor` = the owner id and `data.via` = `telegram`; the reply starts with `⏸ Paused:`; `listSyncTargets` no longer lists the mailbox.
    2. `/pause` again → `… was paused already.`; no new audit row.
    3. `/resume` → `active`, `status_changed_at` = the new time, one `mailbox.resumed` row, the reply starts with `▶️ Resumed:`.
    4. An `auth_error` mailbox: `/pause` and `/resume` → it stays `auth_error`, the reply has the login error line, no audit row.
    5. An assistant link → the owner-only text; no change.
    6. `/pause`, then `setMailboxStatus(…, "auth_error", T + 1 min)` (the sync job's path) → `auth_error`; `/resume` → still `auth_error`.
    7. Two mailboxes (one `active`, one `auth_error`) → `/pause` changes only the `active` one.
    8. Org B's mailbox stays `active` when A's owner uses `/pause`.
    9. `runCommand` for each of the five names → the first line of each reply (`Commands:`, `📊 Status`, `📬 Digest now`, `⏸ Paused` / `❌ …`, `▶️ Resumed` / `… was active already.`).
    10. `createUpdateHandlers(deps).callback(link, "fx:<uuid>")` → the cancel result of stage 16.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: a pause of one mailbox only (all mailboxes of the organization; the pilot has one), a pause of the notices alone.
