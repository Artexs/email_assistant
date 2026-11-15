# F117 stage 19 — Docs: app registration, capability pages, ADR 0031

Part of [`../plan.md`](../plan.md). Needs stages 15 and 18 (all server and web stages landed).

## Step 19.1 — Operator doc and env keys

- `.env.example`: the four `MAIL_OAUTH_*` keys with one comment line each (what, where it comes from, "Secret: never print or log it" for the secrets, both keys or none, needs `WEB_BASE_URL`).
- `deploy/README.md`, new section "Mailbox sign-in apps (Microsoft, Google)":
  - Microsoft Entra: multi-tenant app for work and personal accounts; platform Web; redirect URIs `<WEB_BASE_URL>/api/mailboxes/oauth/microsoft/callback` and `<WEB_BASE_URL>/mailboxes/admin-consent`; delegated `openid`, `email`, `profile`, `offline_access`, Exchange Online `IMAP.AccessAsUser.All`, Graph `Mail.Send`; a client secret and its end date (Entra secrets expire: the `mail_oauth_client_invalid` error line is the sign; renew before the date). Apart from the company sign-in app of ADR 0026 (PD-088).
  - Single-tenant option for a company that hosts its own copy (notes §5).
  - Google Cloud: consent screen External, testing mode, the test-user list (≤ 100; R6), scopes `openid`, `email`, `https://mail.google.com/`; web client; redirect `<WEB_BASE_URL>/api/mailboxes/oauth/google/callback`. Workspace option: an Internal app or the admin "trusted app" setting removes the 7-day limit (PD-087).
  - Flags `mail_oauth_microsoft`, `mail_oauth_google` per organization (operator CLI of the flags capability).
  - The `.ts.net` host is on the Public Suffix List (notes E7 W8): register the full host.

## Step 19.2 — Capability pages and ADR

- `docs/capabilities/sync.md`: connect with OAuth (routes, order, codes D11), secret kind `oauth`, refresh and the lock (D14), reasons and their way out (Reconnect; `mailbox:password` refuses OAuth), Remove per kind, the virtual-folder rule, new audit events `mailbox.reconnected` and the `method` field, new tables and columns, new tests.
- `docs/capabilities/drafts-and-send.md`: the Graph sender (`send_via`), the envelope and size checks, the answer map, Sent Items copy.
- `docs/capabilities/web-panel.md`: the four OAuth routes, the `/mailboxes` banner, the admin-consent page outside the session rule.
- `docs/capabilities/account-data.md`: `mailbox_oauth_states` is not exported; an organization delete revokes no token (Q6).
- `docs/decisions/0031-…md`: status `accepted` with the date; points 2 and 3 as built; a "Spike facts" list that links `spec/features/<lane>/F117-e9a-mailbox-oauth/spike.md`; the process cache of access tokens (Q1) as an amendment of point 1.
- `notes/<date>-mail-oauth-provider-quirks.md`: the provider facts of `spike.md` that a later agent needs (folders, codes, rotation, Sent, Drafts), with row ids. Append to `notes/2026-11-13-mail-oauth-and-push-facts.md` a pointer line.
- Delete `tools/mail-oauth-spike/` (stage 01); `spike.md` and the result files stay in the ticket folder.

**Decisions.** D7, D8, D11, D14, D19, Q1, Q4, Q6.

**Test.** None new.

**Check.** `bun run lint` (Markdown is in its scope if the repo lints it), then the Proof. `test ! -e tools/mail-oauth-spike` must print nothing and exit 0.

**Done when.** The pages say what the code does at `HEAD` (read each rule against the code once); the spike kit is gone; the Proof prints `PROOF_OK`.

**Out of scope.** `docs/product/stage-2/*` and the epic page (the coordinator); the VPS (stage 21).
