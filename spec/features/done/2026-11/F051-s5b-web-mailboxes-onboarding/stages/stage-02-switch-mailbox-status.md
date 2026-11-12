# s5b-web-mailboxes-onboarding — Stage 2

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", S1–S12, "Facts checked", B1–B17, "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first.

## Stage 2 — `switchMailboxStatus` and the Telegram `/pause` `/resume` refactor (B4, D10 (c))

- [x] **2.1 `mail/status.ts` and the caller in `channels/commands.ts`**
  - Goal: one function changes a mailbox between `active` and `paused` with its audit row; the web (stage 7) and Telegram call it; every Telegram text and audit row stays as today.
  - Files: create `apps/server/src/modules/mail/status.ts`, `apps/server/test/integration/mail-status.test.ts`; change `apps/server/src/modules/mail/repo.ts` (`getMailboxSummary`), `apps/server/src/modules/mail/index.ts` (exports), `apps/server/src/modules/channels/commands.ts` (`switchMailboxes`).
  - Interfaces:

    ```ts
    // mail/repo.ts — the columns and the status parse of listMailboxes, for one id
    export async function getMailboxSummary(
      db: DbOrTrx,
      ctx: TenantContext,
      mailboxId: string
    ): Promise<MailboxSummary | undefined>;
    // mail/status.ts
    export type SwitchResult =
      | { kind: "changed"; mailbox: MailboxSummary }
      | { kind: "already"; mailbox: MailboxSummary }
      | { kind: "auth_error" }
      | { kind: "not_found" };
    export async function switchMailboxStatus(
      db: Db | Transaction<DB>,
      ctx: TenantContext,
      mailboxId: string,
      input: { to: "paused" | "active"; actor: string; via: "web" | "telegram"; now: Date }
    ): Promise<SwitchResult>;
    ```

  - Decisions:
    - One transaction (or the caller's, when `db.isTransaction`, the pattern of `commands.ts`): `changeMailboxStatus(trx, ctx, id, { from: <the other status>, to, at: now })`; `true` → `recordAudit(trx, ctx, { actor, event: to === "paused" ? auditEvents.mailboxPaused : auditEvents.mailboxResumed, data: { mailbox_id: id, via }, at: now })`, then `getMailboxSummary` → `changed`; `false` → `getMailboxSummary`: none → `not_found`, `auth_error` → `auth_error`, else `already` (the status equals `to`).
    - After the commit (only on `changed`): `log.info(`mailbox ${id} ${to === "paused" ? "paused" : "resumed"} by user ${actor}`)` with `createLog("mail")`; `commands.ts` no longer logs it (the text stays; only the module prefix changes from `channels` to `mail`; grep `test/` for `paused by user` first: no test reads it today).
    - `switchMailboxes` keeps the owner check, the loop over `listMailboxes`, the `auth_error` line before the call (no call for such a mailbox: the text stays `❌ <address> has a login error: run mailbox:password first.`), and builds its texts from the result: `changed` → the changed list, `already` → `<address> <already text>`, `auth_error` (it turned `auth_error` between the list and the call) → the `❌` line, `not_found` (removed between the list and the call) → no line. The `StatusSwitch` type keeps `verb` and `already` but loses `event` (the event comes from `to`).
    - `via` is `"telegram"` from `commands.ts`; the web passes `"web"` (stage 7).
  - Test:
    1. `mail-status.test.ts` (`withRollback`, `createOrgWithMailbox`): pause an `active` mailbox → `changed`, `mailbox.status` `paused`, `status_changed_at` = `now`, one audit row `mailbox.paused` with `actor` = the given id and `data` `{ mailbox_id, via: "web" }`.
    2. Pause it again → `already`, no second audit row, `status_changed_at` unchanged.
    3. Resume → `changed`, one `mailbox.resumed` row; resume again → `already`.
    4. An `auth_error` mailbox: pause and resume → `auth_error`; status and `status_changed_at` unchanged; no audit row.
    5. A mailbox of another organization (`ctx` of org A, id of org B) → `not_found`, org B's row unchanged; a random UUID → `not_found`.
    6. The existing `channels-commands.test.ts` block "pauseMailboxes and resumeMailboxes" (texts, audit `{ mailbox_id, via: "telegram" }`, actor, sync targets, the assistant case) passes unchanged.
  - Check: the database guard (segment file, user step 0), then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; `grep -rn "changeMailboxStatus" apps/server/src/modules/channels/` finds nothing (only `mail/status.ts` and `mail/remove.ts` later call it).
  - Out of scope: the web route (stage 7).
