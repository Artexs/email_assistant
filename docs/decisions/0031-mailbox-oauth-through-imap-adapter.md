# 0031 — Mailbox OAuth through the existing IMAP adapter; Microsoft 365 sends through Graph

- Status: proposed (E9 discovery, 2026-11-13). Second pass after the mailbox OAuth spike (first stage of ticket E9a). The E9a ticket sets "accepted" or changes point 2 or 3.
- Date: 2026-11-13
- Amends: 0010 (adds a second secret kind and a second sender), 0009 (a refresh token is a stored secret)

## Context

E9 connects Microsoft 365 and Gmail mailboxes with OAuth (PD-005: Microsoft first, Gmail in "testing" mode).
The `MailProvider` port (`apps/server/src/modules/mail/port.ts`) is IMAP-shaped: UID cursors, flags, `UID MOVE`, `APPEND` with APPENDUID.
Sync, locate, actions, drafts, the report mail (ADR 0022) and the header capture (E3a) all use it.
`MailSender` is a separate port: it takes the envelope and the raw RFC 5322 message.
`openMailboxProvider` (`mail/open.ts`) is the one place that reads the secret and opens both.

Facts (sources in `notes/2026-11-13-mail-oauth-and-push-facts.md`):
- Exchange Online IMAP supports `AUTH=XOAUTH2`, `UIDPLUS`, `MOVE`, `IDLE`. Gmail IMAP supports XOAUTH2 and the same extensions.
- `imapflow` 1.7.8 (in the repo) takes `auth.accessToken`. nodemailer supports OAuth2 for SMTP.
- Exchange Online: "If security defaults is enabled in your organization, SMTP AUTH is already disabled." Security defaults are on for new tenants since 2019-10-22. The same docs say that security defaults also turn off POP3 and IMAP4; it is not clear whether this also applies to OAuth IMAP. The spike checks this.
- Microsoft Graph `sendMail` takes a base64 MIME message and saves a copy in Sent Items.
- Graph change notifications need a public HTTPS endpoint. The panel is tailnet-only (ADR 0017).
- Gmail API and IMAP need the same restricted scope class. A Gmail API adapter gives no verification or CASA benefit.

## Decision

1. OAuth is a new secret kind, not a new protocol. `mailbox_credentials.secret_kind` gets `oauth`. The encrypted secret holds the provider, the refresh token, the tenant (Microsoft) and the granted scopes. The access token lives only in memory, for one job.
2. Microsoft 365: read, move, flags, drafts and APPEND go through the existing IMAP adapter with XOAUTH2. Send goes through a new `MailSender` adapter that calls Graph `sendMail` with the MIME that `compose.ts` already builds. No Graph read adapter, no webhooks.
3. Gmail: IMAP and SMTP with XOAUTH2 through the existing adapters, scope `https://mail.google.com/`. No Gmail API adapter. The app-password preset stays.
4. One OAuth client per provider per deployment (env keys), apart from the sign-in apps of ADR 0026. The redirect URI is on `WEB_BASE_URL` (the `ts.net` host is on the Public Suffix List). Authorization code flow with PKCE and a stored, single-use `state`.
5. The mailbox address comes from the provider's identity answer, never from a typed field.
6. Token errors set the mailbox to `auth_error` with a reason code (`oauth_expired`, `oauth_revoked`, `admin_consent_required`, `protocol_disabled`). Reconnect keeps the mailbox id and its history. Remove revokes the token at the provider where an API exists and deletes it here.
7. A token refresh that rotates the refresh token saves the new one in the same transaction, under a per-mailbox lock.

Fallback if the spike shows that OAuth IMAP is blocked in a default Microsoft 365 tenant: a Graph read adapter, and a port change from UIDs to opaque message keys. This is a separate decision and costs about 15 more stages.

## Consequences

- Header capture, the history check, report mail into INBOX and the contract suite work for both providers with no new read code.
- Microsoft and Google are the customer's own mail hosts (the customer chooses them). They are not new sub-processors. The papers name the OAuth scopes.
- Gmail in testing mode: consent expires after 7 days. The user taps Reconnect once a week, or uses an app password. A Workspace admin can mark the app as trusted, which removes the 7-day limit for that organization.
- Microsoft work tenants often need admin consent for mail scopes. The connect page shows an admin-consent link that the user can forward.
- Latency stays at the poll interval (E3a: 2 min). IDLE (E8, Should) works on both hosts with XOAUTH2. A one-hour token means that an IDLE session must log in again.
