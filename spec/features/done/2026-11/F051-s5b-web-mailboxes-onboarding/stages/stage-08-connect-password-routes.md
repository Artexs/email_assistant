# s5b-web-mailboxes-onboarding — Stage 8

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", S1–S12, "Facts checked", B1–B17, "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first.

## Stage 8 — Connect and password routes, the host rule, the error map [risky]

One step. The request body holds a mailbox password: it may reach only `connectMailbox` / `updateMailboxPassword`.

- [x] **8.1 `mail/host-check.ts`, `mail/connect-request.ts`, `POST /mailboxes`, `POST /mailboxes/:id/password`, `mailErrorBody` (B5, B6, B11, B12, D14)**
  - Goal: the owner connects a mailbox by preset or by host fields and changes a password over HTTP; every failure has the D14 status and code, within about 50 s.
  - Files: create `apps/server/src/modules/mail/host-check.ts`, `host-check.test.ts`, `apps/server/src/modules/mail/connect-request.ts`, `apps/server/src/modules/mail/routes.test.ts` (unit: `mailErrorBody`); change `mail/routes.ts`, `mail/port.ts` (`HostNotAllowedError`), `mail/index.ts`, `apps/server/test/integration/web-mailboxes.test.ts` (connect and password cases), `spec/features/planned/F056-web-public-hardening/plan.md` (one line: the DNS-level host check, B12).
  - Interfaces:

    ```ts
    // mail/port.ts
    export class HostNotAllowedError extends HardError {} // message "host not allowed", name "HostNotAllowedError"
    // mail/host-check.ts
    export function isLocalMailHost(host: string): boolean;
    // mail/connect-request.ts
    export async function connectMailboxRequest(
      deps: ConnectDeps & { allowLocalHosts: boolean },
      ctx: TenantContext,
      input: { body: ConnectMailboxBody; actor: string }
    ): Promise<{ mailboxId: string; info: MailServerInfo }>;
    // mail/routes.ts
    export function mailErrorBody(error: unknown): { status: 400 | 404 | 409 | 422 | 502; error: ApiErrorCode } | null;
    ```

  - Decisions:
    - `isLocalMailHost`: lower-case and trim; `localhost` or a name ending in `.localhost` → true; strip `[` `]`; strip a leading `::ffff:` when the rest is an IPv4; when `net.isIP(x) === 0`: a host made only of digits and dots (`127.1`, `0`, `2130706433`) or with a label that starts with `0x` (`0x7f.1`) → true (a resolver maps these spellings to addresses; cold review finding 7), any other name → false; else a `BlockList` with `addSubnet` for `127.0.0.0/8`, `0.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (`ipv4`) and `::/128`, `::1/128`, `::/96` (IPv4-compatible), `::ffff:0:0/96` (IPv4-mapped in any spelling, also `::ffff:7f00:1`), `fc00::/7`, `fe80::/10` (`ipv6`) → `check(x, family)`.
    - `connectMailboxRequest`: `servers = serversFor(body)` (B1); when `!deps.allowLocalHosts` and `isLocalMailHost(servers.imapHost) || isLocalMailHost(servers.smtpHost)` → throw `HostNotAllowedError` (before any network call); then `connectMailbox(deps, ctx, { address, password, secretKind, ...servers }, { actor, via: "web" })`. The preset never hits the rule (public hosts).
    - `mailErrorBody` (the B11 order; `instanceof` checks top-down): `HostNotAllowedError` → 400 `host_not_allowed`; `MailboxNotFoundError` → 404 `not_found`; `MailboxExistsError` → 409 `mailbox_exists`; `MailAuthError` → 422 `mail_login_failed`; `SoftError` or any other `HardError` → 502 `mail_unreachable`; else `null` (the route rethrows → 500 by `onError`).
    - `POST /mailboxes` (owner): `body = await parseBody(c, connectMailboxBodySchema)`; `try { connectMailboxRequest(…) } catch (e) { const mapped = mailErrorBody(e); if (!mapped) throw e; if (mapped.status >= 422) log.info(`web: mailbox connect failed: ${describeError(e)}`); return c.json({ error: mapped.error }, mapped.status) }`; success → 201 `{ id: mailboxId, address: body.address, status: "active", capabilities: { move, uidplus, idle } }` from `info.capabilities` (the `connectResultSchema` shape). Never `message` in the body (a library message may name the host).
    - `POST /mailboxes/:id/password` (owner): the `:id` rule of stage 7; `body = await parseBody(c, mailboxPasswordBodySchema)`; `updateMailboxPassword(deps.connect, ctx, { mailboxId: id, password, secretKind, now, actor: userId })`; the same catch with `password check failed` in the log line; success → 200 `getMailboxView(…)`. No host rule here (the hosts are stored).
    - The schema rule of B2 keeps the body stricter than `connectInputSchema`, so the service's own parse never throws a `ZodError` (that would be a 500).
    - No log line, error body or audit row holds the password, the address or a host.
  - Test:
    1. `host-check.test.ts`: true for `localhost`, `LOCALHOST`, `mail.localhost`, `127.0.0.1`, `127.8.9.1`, `0.0.0.0`, `10.1.2.3`, `172.16.0.1`, `172.31.255.255`, `192.168.1.10`, `169.254.1.1`, `::1`, `[::1]`, `fd00::1`, `fe80::1`, `::ffff:127.0.0.1`, `::ffff:192.168.0.1`, `::ffff:7f00:1`, `::`, `127.1`, `0`, `2130706433`, `0x7f.1`, `0x7f000001`; false for `poczta.interia.pl`, `imap.gmail.com`, `8.8.8.8`, `172.32.0.1`, `2001:db8::1`, `localhost.example.com`.
    2. `routes.test.ts`: `mailErrorBody` maps each error class of the decision (also `new MailAuthError("x")` before the generic `HardError` branch, and `new HostNotAllowedError()` → 400); `new Error("x")` and a `ZodError` → `null`.
    3. `web-mailboxes.test.ts` (the stage 7 file; fake openers in `connect`: `openProvider` returns `createFakeMailProvider()` and records its options; `verifySmtp` records its options; `secrets` from `createSecretBox`; `allowLocalHosts` per test): matrix for both routes: 401; assistant → 403; password route with another organization's id → 404; a bad body → 400 `validation` whose JSON text does not contain the sent password (`"s3cret pass"`).
    4. Preset connect `{ address: "anna@gmail.com", password: "s3cret pass", secretKind: "app_password", preset: "gmail" }` → 201; `connectResultSchema` parses; the fake IMAP options have `host: "imap.gmail.com"`, `port: 993`, `connectionTimeoutMs: 20000`; SMTP `smtp.gmail.com`, 465, `timeoutMs: 20000`; `GET` lists it; one `mailbox.connected` row with `actor` = the owner and `via: "web"`.
    5. "Other" `{ imapHost: "127.0.0.1", imapPort: 3143, smtpHost: "127.0.0.1", smtpPort: 3025, … }` with `allowLocalHosts: false` → 400 `host_not_allowed` and the fake opener was not called; with `true` → 201.
    6. `openProvider` throws `new MailAuthError("IMAP login failed")` → 422 `mail_login_failed`, no mailbox row; throws `new SoftError("IMAP connect: connection error ETIMEDOUT")` → 502 `mail_unreachable`; `verifySmtp` throws `new HardError("SMTP verify failed (CERT_HAS_EXPIRED)")` → 502; the bodies are exactly `{ error: <code> }`.
    7. Duplicate in another case → 409 `mailbox_exists`, the opener not called.
    8. Password: an `auth_error` mailbox → 200 view with `status: "active"`; the `mailbox.password_changed` row has `actor` = the owner and `reactivated: true`; `MailAuthError` → 422 and the stored secret unchanged.
    9. Log (a captured log, the pattern of `web-auth-logs.test.ts`): run tests 4, 6 and 8 again; no captured line contains the password, the address or a host name.
  - Check: the database guard, then `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the tests pass; the route file holds no SQL; `connect-request.ts` makes no network call before the host rule.
  - Out of scope: the form (stage 12).
