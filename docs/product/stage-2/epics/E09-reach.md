# E9 · Reach

> Tier: Should. Status: needs a spike per provider. Size: about 40 stages, 6k lines (like S5).

## Outcome

An executive on Microsoft 365 or Gmail connects with OAuth; the phone becomes a control channel without Telegram content; a user without Telegram gets push notices from an installable web app.

## Users

Executive on Microsoft 365 (first, PD-005), on Gmail (testing mode), and users who do not want mail content in Telegram.

## In scope

- Microsoft 365 adapter: OAuth, Microsoft Graph or IMAP/SMTP XOAUTH2 behind the `MailProvider` port (ADR 0010); refresh tokens stored encrypted; admin consent note for multi-tenant apps.
- Gmail adapter: OAuth in "testing" mode (up to 100 test users, no CASA); Gmail API or IMAP XOAUTH2.
- Mailbox access (OAuth) kept apart from sign-in (OIDC, E7): separate storage, revocation and error states (`02` §10.1).
- PWA: installable web panel, Web Push with ids and counts only; the app fetches content over the authenticated API.
- Content-minimal Telegram (F075): counts and links only; the digest, urgent details and approvals in the panel or PWA.
- Delegate reply from another address (F040) if the simulator shows it matters.

## Out of scope

Google verification and CASA (no public Gmail app). Slack and Teams channels (Stage 3). Native app (E12).

## Dependencies

E7 tier 1 (identity and hardened login), E4 (approvals pages, API commands). Blocks E12.

## Open product questions

1. Graph API vs IMAP XOAUTH2 for Microsoft 365: Graph gives webhooks and categories; IMAP keeps one code path. Spike decides.
2. Keep Telegram with content as a user choice, or content-minimal for everyone.

## Risks

- Provider differences (labels vs folders, Gmail threads) stress the `MailProvider` port; the simulator needs provider-shaped cases.
- Token refresh failures become a new `auth_error` kind; the flow must match the IMAP one.

## Exit

- A test Microsoft 365 mailbox and a test Gmail mailbox run the full pipeline on the simulator; a disconnect and reconnect works.
- The PWA installs on the owner's phone and shows a push for an urgent mail; Telegram in content-minimal mode shows only counts.
