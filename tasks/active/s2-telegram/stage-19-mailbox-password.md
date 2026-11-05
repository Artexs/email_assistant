# s2-telegram — Stage 19

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 19 — `mailbox:password`: leave `auth_error` [risky]

- [ ] **19.1 `updateMailboxPassword` and `bun run mailbox:password`**
  - Goal: after an `auth_error` notice the user can store a new password; the system tests the login first, stores the password only encrypted, and sets `auth_error → active` (D7). Today `mailbox:connect` refuses an existing address, so there is no other way back.
  - Files: change `apps/server/src/modules/mail/connect.ts`, `mail/repo.ts`, `mail/index.ts`, `apps/server/src/modules/audit/repo.ts` (one event name); create `apps/server/src/scripts/mailbox-password.ts`, `apps/server/test/integration/mail-password.test.ts`; change root `package.json` (`"mailbox:password": "bun apps/server/src/scripts/mailbox-password.ts"`); change `deploy/README.md` (a short section "Login error (`auth_error`)").
  - Interfaces:
    - `mail/repo.ts`: `updateCredentials(db, ctx, mailboxId: string, row: { encryptedSecret: string; secretKind: "password" | "app_password"; keyVersion: number }): Promise<boolean>`.
    - `mail/connect.ts`: `updateMailboxPassword(deps: ConnectDeps, ctx: TenantContext, input: { mailboxId: string; password: string; secretKind?: "password" | "app_password"; now: Date }): Promise<{ status: "active" | "paused" | "auth_error"; reactivated: boolean }>`.
    - `audit/repo.ts`: `auditEvents.mailboxPasswordChanged = "mailbox.password_changed"`.
    - CLI: `read -rsp 'New password: ' P && printf '%s' "$P" | bun run mailbox:password --org-id <uuid> --mailbox-id <uuid> [--secret-kind password|app_password]; unset P` (on the VPS: `… | $C run --rm -T server bun run mailbox:password …`).
  - Decisions:
    - `updateMailboxPassword`:
      1. `getMailbox(ctx, mailboxId)` → none → `HardError("mailbox not found")`.
      2. Login test with the new password, before any DB write: `deps.openProvider({ host: imap_host, port: imap_port, user: address, password })`, then `close()` in `finally`; then `deps.verifySmtp({ host: smtp_host, port: smtp_port, user: address, password })`. A `MailAuthError` (IMAP or SMTP) or any other error goes up unchanged; nothing is stored.
      3. ``secret = deps.secrets.encrypt(password, `mailbox:${mailboxId}`)`` (the same AAD as `connectMailbox`).
      4. One transaction: `lockMailbox(trx, ctx, mailboxId)` (row lock against a sync job that sets `auth_error` at the same time); `updateCredentials` (false → `HardError("credentials row missing")`); keep the old `secret_kind` when `secretKind` is not given; when the locked status is `auth_error` → `setMailboxStatus(trx, ctx, mailboxId, "active", now)` and `reactivated = true`; `recordAudit(trx, ctx, { actor: "system", event: auditEvents.mailboxPasswordChanged, data: { mailbox_id: mailboxId, reactivated }, at: now })`.
      5. Return the final status and `reactivated`. A `paused` mailbox stays `paused` (the owner resumes it with `/resume`).
    - New module edge `mail → audit` (the status change and its audit row in one transaction, code patterns). `audit` imports nothing, so there is no cycle. Stage 22 adds the edge to `docs/modules.md` §2.
    - The script follows `mailbox-connect.ts`: the password only from a stdin pipe (a TTY stdin → usage and exit 1, so the password is never typed on a visible terminal line or put in an argument); `parseArgs` with Zod uuid checks; `assertAppRole`. Output with `log`: `` `password updated for mailbox ${mailboxId}; status ${status}` ``, plus `the next sync runs within 5 minutes` when `reactivated`, or `the mailbox stays paused: use /resume in Telegram` when `paused`. `MailAuthError` → ``log.error(`${error.message}: the password was not saved`)`` (its message is a fixed text: "IMAP login failed" or "SMTP login failed"); `HardError` → `log.error(error.message)`; else ``log.error(`failed: ${describeError(error)}`)``. Exit 1 on any error. Never print or log the password or `error.cause`.
    - `deploy/README.md`, new section: what an `auth_error` notice means; check the password in the webmail (for Interia: the "mail program" switch, notes `2026-11-03-interia-imap-capabilities.md`); then run the CLI line above; the next sync comes within 5 minutes.
  - Test (`mail-password.test.ts`, `withRollback`; fake providers and a fake `verifySmtp` as in `mail-connect.test.ts`; a `createSecretBox` with a random key; the mailbox from `connectMailbox` with the old password `old-pass`):
    1. Status `auth_error`, new password `new-pass` → the result is `{ status: "active", reactivated: true }`; decrypting the stored secret gives `new-pass`; `status_changed_at` = `now`; one `mailbox.password_changed` audit row with `reactivated` true.
    2. The fake IMAP login throws `MailAuthError` → the call rejects with it; the stored secret still decrypts to `old-pass`; the status stays `auth_error`; no audit row.
    3. IMAP works and the fake SMTP throws `MailAuthError("SMTP login failed")` → the same as 2.
    4. A `paused` mailbox → `{ status: "paused", reactivated: false }`; the secret is new.
    5. An `active` mailbox → `{ status: "active", reactivated: false }`; `status_changed_at` does not change.
    6. Another org's context → `HardError("mailbox not found")`; nothing changes.
    7. `secretKind` not given → `secret_kind` stays as it was; `app_password` given → stored.
    8. The script with a TTY-less stdin and no arguments → exit 1 with the usage (spawn as `mail-connect.test.ts` does for its script).
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`; `bunx prettier --check deploy/README.md`. Manual on the dev DB with GreenMail (it accepts any password): set the dev mailbox to `auth_error` with SQL, run the CLI with any password → `status active`, `reactivated`.
  - Done when: the tests pass and the manual run gives `status active`.
  - Out of scope: a Telegram way to enter a password (never: a password in a bot chat is not safe), a change of the address or the hosts.
