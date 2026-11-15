# F117 stage 04 — Auth material: IMAP and SMTP with XOAUTH2

Part of [`../plan.md`](../plan.md). `[risky]` (auth). Needs stage 03.

## Step 04.1 — `AuthMaterial` in the adapter options

**Goal.** The IMAP and SMTP adapters log in with a password or an OAuth access token (D4; architecture review §3.7). No behaviour change for password mailboxes.

**Interfaces** (in `apps/server/src/modules/mail/port.ts`, exported through the module index):

```ts
export type AuthMaterial = { kind: "password"; password: string } | { kind: "oauth"; accessToken: string };
export type AuthErrorReason = "oauth_expired" | "oauth_revoked" | "admin_consent_required" | "protocol_disabled";
```

- `ImapConnectOptions` and `SmtpConnectOptions`: `auth: AuthMaterial` replaces `password`. Fix every caller (connect, password change, check and probe tools, `open.ts`, tests, fakes). The CLIs that take a password build `{ kind: "password", … }`.
- IMAP: `oauth` → imapflow `auth: { user, accessToken }`.
- SMTP: `oauth` → `SMTPConnection.login({ user, oauth2 })` with a nodemailer `XOAuth2` object built from `{ user, accessToken }` and no refresh data (Facts checked). `SmtpConnectionLike.login` widens to accept that shape. `verifySmtpLogin` takes the same options.
- `MailAuthError` gets `readonly reason?: AuthErrorReason` (D15). Nothing sets it in this stage. A refused login stays `MailAuthError` on every path (today's SMTP rule: EAUTH → `MailAuthError`); `SmtpSendError` gets no reason.
- State in a comment at the top of `port.ts` that `MailProvider` has IMAP semantics (UIDs, flags, APPEND) by design; another backend gets an adapter that maps ids, or a port v2 with its own ADR (§3.7).

**Decisions.** D4, D15, D18.

**Edge cases.**
- An empty `accessToken` or `password` → `HardError` before any connection.
- The error text of a refused XOAUTH2 login never holds the token: imapflow and nodemailer may put the command in the error; the mapped error message is our own text, and the original stays only as `cause`. Check that no log path prints `cause` in full.

**Test.**
1. Unit: `imapFlowOptions` with `{ kind: "oauth", accessToken: "tok-1" }` gives `auth: { user: "a@x.test", accessToken: "tok-1" }` and no `pass`.
2. Unit, scripted SMTP server (the pattern of `smtp-starttls.test.ts`): the client sends `AUTH XOAUTH2 <b64>` and the decoded value is `user=a@x.test\x01auth=Bearer tok-1\x01\x01`.
3. Integration, GreenMail: an IMAP login and an SMTP `verifySmtpLogin` with `{ kind: "oauth", accessToken: "any-token" }` pass (auth off accepts any token; write this in the test name).
4. Unit, scripted SMTP server answers `535 5.7.3 Authentication unsuccessful` to XOAUTH2 → `MailAuthError` (as for a password today); `String(error)`, `error.message` and the captured log lines hold no `tok-1`.
5. Unit, scripted IMAP refusal (or the imapflow error shape) → `MailAuthError`; its message and the log hold no `tok-1`.
6. The existing password tests pass unchanged.

**Check.** The tests above, then the Proof.

**Done when.** Every caller uses `auth`; the tests pass; the Proof prints `PROOF_OK`.

**Out of scope.** Where the token comes from (stage 10), the sender choice (stage 05).
