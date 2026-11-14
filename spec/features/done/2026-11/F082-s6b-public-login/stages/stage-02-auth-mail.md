# F082 stage 02 — Auth-mail config, sender, texts, operator event `auth_mail_failed`

Part of [`../plan.md`](../plan.md). Read its L3–L7, B1, B2 and "Rules for every stage" first.

Parallel: lane A, after stage 1. Stage 8 may run at the same time.

Three steps. Nothing calls the sender yet (stages 3–5 wire it). Needs stage 1 (`UserLocale`).

- [ ] **2.1 Config keys**
  - Goal: the server knows whether the auth-mail sender is on, and refuses a half set of keys.
  - Files: change `apps/server/src/platform/config.ts`, `config.test.ts`, `.env.example`.
  - Interfaces:

    ```ts
    // baseSchema (each with the existing emptyAsUndefined preprocess)
    AUTH_SMTP_HOST: optional string, min 1
    AUTH_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465)
    AUTH_SMTP_SECURITY: z.enum(["tls", "starttls"]).default("tls")
    AUTH_SMTP_USER: optional string, min 1
    AUTH_SMTP_PASSWORD: optional string, min 1   // comment: "Secret: never print or log it."
    AUTH_MAIL_FROM: optional string matching addressPattern

    export interface AuthMailSettings { host: string; port: number; security: "tls" | "starttls"; user: string; password: string; from: string }
    // null = the sender is off (none of the four keys set).
    export function authMailSettings(config: Config): AuthMailSettings | null;
    ```

  - Decisions: L3. In `configSchema.superRefine`: let `set` = how many of `AUTH_SMTP_HOST`, `AUTH_SMTP_USER`, `AUTH_SMTP_PASSWORD`, `AUTH_MAIL_FROM` are defined; when `set` is 1, 2 or 3, add one issue per missing key with message `"AUTH_SMTP_HOST, AUTH_SMTP_USER, AUTH_SMTP_PASSWORD and AUTH_MAIL_FROM are set together"`. `.env.example`: a block "Auth mail (S6b). Empty = off: the CLI prints invite and reset links. Server (home VPS): leave all empty." with the six keys empty.
  - Test (`config.test.ts`):
    1. None of the keys → `authMailSettings(config) === null`.
    2. The four keys (`host smtp.x.test`, `user u`, `password p`, `from noreply@x.test`) → settings with `port 465`, `security "tls"`.
    3. `AUTH_SMTP_PORT=587`, `AUTH_SMTP_SECURITY=starttls` → those values.
    4. Only `AUTH_SMTP_HOST` → `ConfigError` whose `keys` hold `AUTH_SMTP_USER`, `AUTH_SMTP_PASSWORD`, `AUTH_MAIL_FROM`.
    5. `AUTH_SMTP_SECURITY=ssl` → `ConfigError` with `AUTH_SMTP_SECURITY`.
    6. `AUTH_MAIL_FROM=not-an-address` (with the other three) → `ConfigError` with `AUTH_MAIL_FROM`.
  - Check: Proof (server form).
  - Done when: the tests pass.
  - Out of scope: the sender (2.2).

- [ ] **2.2 Sender and texts**
  - Goal: one function sends an invite, a reset or a lockout mail in Polish or English, never rejects, and logs only the user id and a code.
  - Files: add `apps/server/src/platform/auth-mail.ts`, `auth-mail-texts.ts`, `auth-mail.test.ts` (unit), `apps/server/test/integration/auth-mail.test.ts` (GreenMail); change `docs/code-patterns.md` (the `nodemailer` line: "Only `mail/imap/` and `platform/auth-mail.ts` (the auth-mail sender, S6b) import `nodemailer`").
  - Interfaces:

    ```ts
    // platform/auth-mail-texts.ts
    export type AuthMailKind = "invite" | "reset" | "lockout";
    export function authMailText(
      kind: AuthMailKind,
      locale: UserLocale,
      url: string
    ): { subject: string; text: string };

    // platform/auth-mail.ts
    export interface AuthMail {
      kind: AuthMailKind;
      userId: string;
      to: string;
      locale: UserLocale;
      url: string;
    } // lockout: url = `${baseUrl}/forgot`
    export type AuthMailResult = { ok: true } | { ok: false; code: string };
    export interface AuthMailer {
      send(mail: AuthMail): Promise<AuthMailResult>;
    } // never rejects
    export interface AuthMailerDeps {
      createTransport?: (options: SMTPTransportOptions) => {
        sendMail(message: object): Promise<unknown>;
        close(): void;
      }; // default: nodemailer createTransport
      timeoutMs?: number; // default 15_000
    }
    export function authMailTransportOptions(settings: AuthMailSettings, timeoutMs: number): SMTPTransportOptions;
    export function authMailErrorCode(error: unknown): string;
    export function createAuthMailer(settings: AuthMailSettings, deps?: AuthMailerDeps): AuthMailer;
    ```

  - Decisions:
    - `authMailTransportOptions` (L4): `host`, `port`, `auth: { user, pass }`, `connectionTimeout`, `greetingTimeout`, `socketTimeout` = `timeoutMs` (15 000). Host `127.0.0.1`, `localhost` or `::1` → `secure: false, ignoreTLS: true`. Else `security "tls"` → `secure: true`; `"starttls"` → `secure: false, requireTLS: true`. Never set `tls.rejectUnauthorized`.
    - `send`: one transport per mail; `sendMail({ from: { name: "Email Assistant", address: settings.from }, to: mail.to, subject, text })` raced against an outer timer of `timeoutMs + 5_000` ms (20 000; it only catches a hang, so nodemailer's own `ETIMEDOUT` normally wins and the notice key stays stable; timer → code `TIMEOUT`); `close()` in `finally`. Success → `{ ok: true }` and `log.info` `auth mail <kind> sent to user <userId>`. Failure → `{ ok: false, code }` and `log.warn` `auth mail <kind> to user <userId> failed: <code>` (L6). Nothing else of the error goes to the log.
    - `authMailErrorCode` (L6): an object with a string `code` matching `^[A-Z][A-Z_]{1,19}$` → that code; the timeout → `TIMEOUT` (the caller passes it); anything else → `UNKNOWN`.
    - Texts (L5; exact; `{url}` is replaced by the link, nothing else changes):

      | kind / locale | subject                                                 | text                                                                                                                                                                                                                                                                              |
      | ------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
      | invite / en   | `Your Email Assistant account`                          | `Hello,\n\nYou have an account in Email Assistant. Set your password with this link:\n\n{url}\n\nThe link works once and expires in 24 hours. If you did not expect this mail, ignore it.\n\nEmail Assistant\n`                                                                   |
      | invite / pl   | `Twoje konto w Email Assistant`                         | `Dzień dobry,\n\nmasz konto w Email Assistant. Ustaw hasło, korzystając z tego linku:\n\n{url}\n\nLink działa jeden raz i wygasa po 24 godzinach. Jeśli nie spodziewasz się tej wiadomości, zignoruj ją.\n\nEmail Assistant\n`                                                    |
      | reset / en    | `Reset your Email Assistant password`                   | `Hello,\n\nSomeone asked to reset the password of your Email Assistant account. Set a new password with this link:\n\n{url}\n\nThe link works once and expires in 1 hour. If you did not ask for it, ignore this mail. Your password stays the same.\n\nEmail Assistant\n`        |
      | reset / pl    | `Zmiana hasła w Email Assistant`                        | `Dzień dobry,\n\nktoś poprosił o zmianę hasła do Twojego konta w Email Assistant. Ustaw nowe hasło, korzystając z tego linku:\n\n{url}\n\nLink działa jeden raz i wygasa po 1 godzinie. Jeśli to nie Ty, zignoruj tę wiadomość. Twoje hasło się nie zmieni.\n\nEmail Assistant\n` |
      | lockout / en  | `Your Email Assistant account is locked for 15 minutes` | `Hello,\n\nThere were 10 failed sign-ins to your Email Assistant account in 15 minutes. We locked the sign-in for 15 minutes.\n\nIf this was not you, set a new password: {url}\n\nEmail Assistant\n`                                                                             |
      | lockout / pl  | `Konto w Email Assistant zablokowane na 15 minut`       | `Dzień dobry,\n\nw ciągu 15 minut było 10 nieudanych prób logowania do Twojego konta w Email Assistant. Zablokowaliśmy logowanie na 15 minut.\n\nJeśli to nie Ty, ustaw nowe hasło: {url}\n\nEmail Assistant\n`                                                                   |

  - Test:
    1. unit: `authMailTransportOptions` for host `127.0.0.1` → `secure false`, `ignoreTLS true`; `smtp.x.test` + `tls` → `secure true`; + `starttls` → `secure false`, `requireTLS true`; no result has a `tls` key; the three timeouts equal the argument.
    2. unit: `authMailErrorCode({ code: "EAUTH" }) === "EAUTH"`; `({ code: "weird code" })` → `UNKNOWN`; `new Error("x")` → `UNKNOWN`.
    3. unit: for each of the 6 kind/locale pairs, `text` holds `https://x.test/link` exactly once, no `{url}` is left, `subject` is the table value.
    4. unit: a fake `createTransport` whose `sendMail` never settles, `timeoutMs: 50` (outer timer 5 050 ms) → `{ ok: false, code: "TIMEOUT" }` within 6 s, and `close` was called.
    5. unit: a fake whose `sendMail` rejects with `{ code: "EAUTH", message: "secret https://x.test/link" }` → `{ ok: false, code: "EAUTH" }`; the captured log has one `warn` line with the user id and `EAUTH`, and no line holds `x.test`.
    6. integration (GreenMail): settings `{ host: TEST_IMAP_HOST ?? "127.0.0.1", port: Number(TEST_SMTP_PORT ?? "3025"), security: "tls", user: "auth", password: "greenmail-test", from: "noreply@x.test" }`, an invite to `auth-mail-<uuid>@x.test` → `{ ok: true }`; open that address's INBOX on IMAP (`TEST_IMAP_PORT`, default 3143) as `smtp-send.test.ts` does → one message with subject `Twoje konto w Email Assistant` (locale `pl`).
    7. integration: port 1 (nothing listens) → `{ ok: false }` with a code matching `^[A-Z][A-Z_]{1,19}$`.
  - Check: Proof (server form).
  - Done when: the tests pass.
  - Out of scope: who calls the sender (stages 3–5); HTML mail.

- [ ] **2.3 Operator event `auth_mail_failed`**
  - Goal: a failed auth mail reaches the operator once per user, code and day (D31).
  - Files: change `apps/server/src/modules/channels/operator.ts`; add cases to `apps/server/test/integration/channels-operator.test.ts`.
  - Interfaces:

    ```ts
    export type OperatorNoticeKind = "trial_ending" | "llm_cap" | "auth_error_24h" | "auth_mail_failed";
    // in OperatorNotices: called by the web wiring (stage 3) and the lockout (stage 5). Never throws, never blocks.
    authMailFailed(ctx: TenantContext, userId: string, kind: "invite" | "reset" | "lockout", code: string, now: Date): void;
    ```

  - Decisions: L7. Same shape as `capReached`: build key and text, `void start(ctx, "auth_mail_failed", key, text)` inside `try`; `catch` logs `operator notice auth_mail_failed: <describeError>`. Key `auth_mail_failed:${userId}:${code}:${now.toISOString().slice(0, 10)}`. Text `Auth mail ${kind} to user ${userId} of org ${ctx.orgId} failed (${code}).` A failed send is not retried by the hourly run (only `llm_cap` is): the next failed mail of the same day is deduplicated by the key only after a successful send.
  - Test:
    1. With a fake `send`: `authMailFailed(ctx, u1, "reset", "EAUTH", 2026-11-20T10:00Z)` twice, `await notices.idle()` → `send` called once with `Auth mail reset to user <u1> of org <org> failed (EAUTH).`; one `operator.notice` audit row with `data.key = auth_mail_failed:<u1>:EAUTH:2026-11-20`.
    2. Same user, code `ETIMEDOUT`, same day → a second send.
    3. Same user and code, `2026-11-21T00:30Z` → a third send.
    4. `send: null` → one `warn` line `operator notice auth_mail_failed: …` and the audit row.
    5. A `send` that throws → `authMailFailed` returns normally; no audit row.
  - Check: Proof (server form, `/tmp/f082-s02`).
  - Done when: the tests pass and the Proof printed `PROOF_OK`.
  - Out of scope: the wiring into the reset request (stage 3).
