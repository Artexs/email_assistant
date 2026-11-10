# s5b-web-mailboxes-onboarding — Stage 3

Part of [`../s5b-web-mailboxes-onboarding.md`](../s5b-web-mailboxes-onboarding.md). Read that file's "Done when", "Owns", S1–S12, "Facts checked", B1–B17, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 3 — Login timeouts and the deadline, `MailboxExistsError`, `MailboxNotFoundError`, `mailbox.connected`, actors [risky]

One step. The CLI keeps its behaviour: every new option is optional, and the CLI passes none.

- [x] **3.1 Mail services for the web (B5, B6)**
  - Goal: a web connect or password check ends within about 50 s with a typed error; a duplicate address is refused before any login; the audit log names who connected a mailbox and who changed its password.
  - Files: change `apps/server/src/modules/mail/imap/client.ts` (`imapFlowOptions`), `client.test.ts`, `mail/imap/smtp.ts` (`SmtpConnectOptions`, `smtpTransportOptions`), `smtp.test.ts`, `mail/port.ts` (two errors), `mail/repo.ts` (`findMailboxIdByAddress`), `mail/connect.ts`, `mail/index.ts` (exports), `modules/audit/repo.ts` (`mailboxConnected: "mailbox.connected"`), `scripts/mailbox-connect.ts`, `test/integration/mail-connect.test.ts`, `test/integration/mail-password.test.ts`.
  - Interfaces:

    ```ts
    // imap/client.ts: when opts.connectionTimeoutMs is set, imapFlowOptions also sets
    //   greetingTimeout: opts.connectionTimeoutMs, socketTimeout: opts.connectionTimeoutMs
    // imap/smtp.ts
    export interface SmtpConnectOptions {
      host: string;
      port: number;
      user: string;
      password: string;
      secure?: boolean;
      timeoutMs?: number;
    }
    // smtpTransportOptions: with timeoutMs → connectionTimeout, greetingTimeout, socketTimeout = timeoutMs
    // port.ts
    export class MailboxNotFoundError extends HardError {} // message "mailbox not found", name "MailboxNotFoundError"
    export class MailboxExistsError extends HardError {} // message "mailbox with this address already exists", name "MailboxExistsError"
    // repo.ts
    export async function findMailboxIdByAddress(
      db: DbOrTrx,
      ctx: TenantContext,
      address: string
    ): Promise<string | undefined>; // lower(address) = lower($1)
    // connect.ts
    export interface ConnectDeps {
      db: Db | Transaction<DB>;
      secrets: SecretBox;
      openProvider(opts: ImapConnectOptions): Promise<MailProvider>;
      verifySmtp(opts: SmtpConnectOptions): Promise<void>;
      timeouts?: { socketMs: number; deadlineMs: number }; // web: { socketMs: 20_000, deadlineMs: 25_000 }
    }
    export interface ConnectMeta {
      actor: string;
      via: "web" | "cli";
    }
    export async function connectMailbox(
      deps: ConnectDeps,
      ctx: TenantContext,
      input: ConnectInput,
      meta?: ConnectMeta
    ): Promise<{ mailboxId: string; info: MailServerInfo }>;
    export async function updateMailboxPassword(
      deps: ConnectDeps,
      ctx: TenantContext,
      input: {
        mailboxId: string;
        password: string;
        secretKind?: "password" | "app_password";
        now: Date;
        actor?: string;
      }
    ): Promise<{ status: MailboxStatus; reactivated: boolean }>;
    ```

  - Decisions:
    - `withDeadline<T>(promise: Promise<T>, ms: number | undefined): Promise<T>` is a local helper in `connect.ts`: `undefined` → the promise itself; else `Promise.race` with a timer that rejects `new SoftError("mail check timed out")`; the timer is cleared in `finally`. A late success of the raced promise is dropped; `readServerInfo` still closes its provider in its own `finally`.
    - `connectMailbox` order: `connectInputSchema.parse`; `findMailboxIdByAddress` → found → `throw new MailboxExistsError()` (no login: the user learns it at once, and a duplicate never opens a connection); IMAP `readServerInfo` inside `withDeadline` with `connectionTimeoutMs: timeouts?.socketMs`; SMTP `verifySmtp` inside `withDeadline` with `timeoutMs: timeouts?.socketMs`; encrypt; the transaction (today's inserts) plus `recordAudit(trx, ctx, { actor: meta.actor, event: auditEvents.mailboxConnected, data: { mailbox_id, via: meta.via } })` (default meta `{ actor: "system", via: "cli" }`). A thrown error with `code === "23505"` and `constraint === "mailboxes_org_address_key"` from the transaction becomes `MailboxExistsError` (with `cause`); any other error passes unchanged.
    - `updateMailboxPassword`: both `HardError("mailbox not found")` throws become `MailboxNotFoundError` (same message: the CLI and `mail-password.test.ts:164` keep working); the IMAP open and the SMTP verify use `withDeadline` and the socket timeout like connect (the provider is opened and closed inside the raced function); the audit row's `actor` is `input.actor ?? "system"`.
    - The audit `data` holds ids and codes only (`mailbox_id`, `via`, `reactivated`), never the address (modules §3.6).
    - `scripts/mailbox-connect.ts`: `isUniqueViolation` goes; the catch checks `error instanceof MailboxExistsError` and logs the same line `mailbox with this address already exists`.
    - `client.ts` `toMailError` and `smtp.ts` `toSmtpError` stay: the timeout codes are already soft (fact 2).
  - Test:
    1. `client.test.ts`: `imapFlowOptions({ …, connectionTimeoutMs: 20_000 })` has `connectionTimeout`, `greetingTimeout`, `socketTimeout` = 20000; without the option, `greetingTimeout` and `socketTimeout` are absent (`undefined`).
    2. `smtp.test.ts`: `smtpTransportOptions({ …, timeoutMs: 20_000 })` has the three keys = 20000; without, none of them.
    3. `mail-connect.test.ts` (`withRollback` where it says nothing else): a mailbox `A@X.test` exists; connecting `a@x.test` → `MailboxExistsError`, and the fake `openProvider` was never called (a counter in the deps).
    4. The same address in another organization connects.
    5. Race (committed, own organization, cleanup in `finally` with `deleteFrom("organizations")`, because a failed statement aborts a test transaction): the deps' `openProvider` inserts a mailbox with the same address through `insertMailbox` on the plain `db` before it returns the fake; `connectMailbox` with `deps.db = db` → `MailboxExistsError` whose `cause.code` is `23505`; the organization holds exactly one mailbox with that address.
    6. A connect writes one `mailbox.connected` row: default `actor "system"`, `data { mailbox_id, via: "cli" }`; with `meta { actor: <user id>, via: "web" }` those values; `data` has no `address` key.
    7. Timeouts reach the openers: with `timeouts { socketMs: 20_000, deadlineMs: 25_000 }` the fake `openProvider` receives `connectionTimeoutMs: 20000` and the fake `verifySmtp` receives `timeoutMs: 20000`; without `timeouts` both are `undefined`.
    8. Deadline: `openProvider` returns a promise that never settles, `timeouts { socketMs: 20_000, deadlineMs: 50 }` → `SoftError` with the message `mail check timed out` within 1 s; no mailbox row for the address. The same with a never-settling `verifySmtp`.
    9. `mail-password.test.ts`: an unknown id → `MailboxNotFoundError` (and still `instanceof HardError`, message `mailbox not found`); `actor: <user id>` → the `mailbox.password_changed` row has that actor; the deadline case of test 8 for the password path leaves the stored secret unchanged.
    10. A new CLI test in `mail-connect.test.ts` (the `connectScript` + `Bun.spawn` pattern of that file; no GreenMail is needed, because the duplicate check comes before any login): an organization with a mailbox `dup@x.test`; `printf 'x' | bun run mailbox:connect --org-id <id> --address DUP@x.test` exits 1 and its output holds `mailbox with this address already exists` (no CLI duplicate test exists today: cold review finding 18).
    11. Tenant filter of `findMailboxIdByAddress`: org A's address searched with org B's `ctx` → `undefined` (code patterns: every new repository function gets a filter test; finding 11).
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; `grep -n "23505" apps/server/src/scripts/mailbox-connect.ts` finds nothing; `grep -rn "password" apps/server/src/modules/mail/connect.ts` shows no log call.
  - Out of scope: the host rule and the presets (stage 8), the routes (stages 7–8).
