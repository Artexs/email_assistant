# E9 · Reach

> Tier: Should. Status: decided, second pass after the E9a spike (only PD-086, PD-087 wait; E9b is ready to plan). Size: about 33 stages, 5.6k lines, two tickets (E9a Mailbox OAuth, E9b Phone channel). Detail: `E09-discovery-notes.md`.

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

## Discovery (2026-11-13)

### Verdict: modify, and split into two tickets

The outcome is right for the thesis: "on any mailbox" needs Microsoft 365 and Gmail, and "trust and privacy" needs a phone channel without mail content. Three changes:
- **One mail core.** Both providers go through the existing IMAP adapter with OAuth tokens (XOAUTH2). The `MailProvider` port is IMAP-shaped (UIDs, flags, APPEND). A Graph or Gmail API read adapter would change sync, locate, actions and the history check, and give no gain without a public webhook endpoint. Only Microsoft send goes through Graph, because security defaults turn off SMTP AUTH. ADR 0031 (proposed).
- **Two tickets in two lanes.** E9a Mailbox OAuth (spike first). E9b Phone channel: installable PWA, Web Push with ids and counts, Telegram detail per user. ADR 0032 (proposed). They do not depend on each other.
- **F040 leaves** for E5: reply detection belongs to the open-loop engine.

### Code cross-check (detail: notes §2)

| Item | Exists today | New |
| --- | --- | --- |
| OAuth IMAP | `imapflow` 1.7.8 takes `auth.accessToken`; `mail/open.ts` is the one seam that opens provider and sender | Secret kind `oauth`, token refresh with a per-mailbox lock |
| Microsoft send | `MailSender` port takes `{ envelope, raw }` | Graph `sendMail` MIME adapter |
| Gmail | App-password preset in `packages/core/src/mail/providers.ts` (never run on a real Gmail mailbox) | OAuth path; one real check of the preset |
| Connect UI | `ConnectDialog.tsx` presets | Sign in with Microsoft / Google, admin-consent page, Reconnect |
| Error state | `auth_error` status and notice | Reason codes, Reconnect keeps history |
| Notices | `outbox` holds rendered Telegram text and buttons | Notice as facts, rendered per channel and detail at send time; push channel |
| PWA | Astro static panel on Tailscale Serve; no manifest or service worker | Manifest, app-shell worker, push subscriptions, device list |
| Web approvals | E4-A builds `/approvals` (web half of F075) | Deep links only |

Correction: the page said "Graph or IMAP XOAUTH2 behind the port" as if both cost the same. Graph read costs about 15 more stages (port change to opaque message keys).

### Research (sources in `notes/2026-11-13-mail-oauth-and-push-facts.md`)

- Exchange Online IMAP has XOAUTH2, UIDPLUS, MOVE, IDLE (Stack Overflow answer; the spike checks again).
- Security defaults are on for tenants created from 2019-10-22. They turn off SMTP AUTH. Microsoft docs say they also turn off IMAP4, but do not say if OAuth IMAP is blocked too (Microsoft Learn, read 2026-11-13). **The spike decides.**
- Graph `sendMail` takes base64 MIME and saves to Sent Items (Microsoft Learn).
- Graph webhooks need a public HTTPS endpoint (Microsoft Learn); the panel is tailnet-only.
- Work tenants ask for admin approval for mail scopes by default; publisher verification does not avoid it (Microsoft 2020 blog; Q&A 2026-01-12; vendor page, marketing).
- Gmail testing mode: consent expires after 7 days, ≤ 100 users; a Workspace admin "trusted app" removes both (Google help, 2026-11-02 note). Personal Gmail IMAP is always on since 2025-01; app passwords need 2SV.
- iOS Web Push only for Home Screen web apps, iOS 16.4+ (OpenPWA, 2026-06).
- `web-push` 4.0.0 (2026-11-06) uses `node:crypto`; an old Bun issue is open; WebCrypto alternatives exist.
- Test tenant: the M365 developer sandbox needs a Visual Studio subscription; Business Basic is $7 per user per month after a 30-day trial (Microsoft, read 2026-11-13).

### Cross-epic notes (edits for the owner; detail in notes §4)

- E5: takes F040 (partly absorbed already: Waiting loops close on any participant). E5's Sent pass works on both providers through IMAP.
- E6: drafts stay IMAP APPEND with thread headers; the spike checks that they show in the thread; Microsoft fallback is Graph create-draft.
- E4: the per-user channel setting (PD-033) gains "push"; approvals need a deep link per item.
- E7: papers name the Telegram detail levels, the push services and the OAuth scopes; `TERMS_VERSION` bump; four flags; one Microsoft test tenant for both spikes.
- E8: never log tokens, `state` or push endpoints; IDLE must log in again after the 1-hour token.
- E10: the security page row for Telegram changes with the detail level.
- `03` §4: the owner rewrites the Telegram clause (decision 8).

### Decisions (owner: "Okay default.", 2026-11-13; rows PD-085–PD-095)

1. Modify and split: E9a Mailbox OAuth and E9b Phone channel, two `plan-task` runs, parallel lanes. F040 moves to E5. [yes]
2. Microsoft 365: IMAP with OAuth for read, move, drafts and APPEND through the existing adapter; send through Graph `sendMail` with the MIME we already build. No Graph read adapter, no webhooks. If the spike shows OAuth IMAP blocked in a default tenant, the fallback (Graph read adapter, +15 stages) comes back to the owner. [yes; second pass after the E9a spike]
3. Gmail: IMAP and SMTP with OAuth through the existing adapters, testing mode, one-tap Reconnect for the 7-day expiry. The app-password preset stays as the durable path for personal Gmail. Workspace: doc for "Internal" or "trusted app". No Gmail API adapter. [yes; second pass after the E9a spike]
4. One OAuth app per provider per deployment (env keys), apart from the E7 sign-in apps; redirect on the `ts.net` host. Microsoft multi-tenant with an admin-consent page that the user can forward. [yes]
5. Tokens: refresh token encrypted, access token in memory only, per-mailbox refresh lock; `auth_error` with a reason code and Reconnect that keeps the history; the address comes from the provider, never typed; remove revokes where possible. [yes]
6. Test accounts: the owner buys one Microsoft 365 Business Basic seat (30-day trial, then about $7 per month), shared with the E7 identity spike; Gmail tests use the owner's personal Gmail; no Workspace purchase. [yes]
7. Exit rewrite: GreenMail cannot be Microsoft or Gmail. A provider smoke appends 20 bank cases into each real test mailbox, runs assist, sends only to the owner; CI uses a fake token server and a fake Graph. [yes]
8. Telegram content: per-user `full` (today) or `minimal` (counts and links, no Send button). New links default to `minimal`; `full` needs an opt-in with the consent text; the org owner can lock `minimal`; the pilot keeps `full`; never raw bodies. `03` §4 then reads: "Telegram carries mail content only when the user opts in; never raw bodies." [yes]
9. PWA: installable panel; the service worker caches the app shell only, never `/api` data; push carries kind, count and item id; a tap opens the item. iOS documented, not tested (the owner's phone is Android). [yes]
10. Notice routing per user and kind: Telegram, push or both; urgent and approvals default to both once a device subscribes; quiet hours apply; a device list in Account; sign-out removes that session's push subscriptions. [yes]
11. Order: E9b starts after E4-A (approvals page) and E4-B (channel setting); E9a needs only E7 send limits and flags, and its spike can run first. Neither needs identity tier 1 (PD-050). [yes]
12. Commit the changed files by explicit path. [yes]

### Size

About 33 stages, 5.6k lines (page said 40 / 6k): E9a ≈ 19 / 3k, E9b ≈ 14 / 2.6k. Less: no Graph read adapter, no Gmail API adapter, F040 leaves. More: admin consent, reason codes, outbox as facts, device list. Graph read fallback: + ≈ 15 stages, 3k lines.

### Risks (detail and mitigations: notes §8)

| Risk | Mitigation |
| --- | --- |
| Default Microsoft tenant blocks OAuth IMAP | Spike first; sized fallback goes to the owner at the second pass |
| Admin consent needed in work tenants | Forwardable admin-consent page; single-tenant doc for self-hosting |
| Exchange APPEND gives a non-editable or out-of-thread draft | Spike checks; Graph create-draft fallback for Microsoft only |
| Gmail weekly re-consent | One-tap Reconnect; app password for personal Gmail |
| Rotated refresh token lost in a race | Per-mailbox lock, save in the same transaction |
| Token or push endpoint in logs | E8 allow-list and canary test |
| Push library fails under Bun | E9b stage 1 sends a real push to the phone |
| `minimal` default makes Telegram less useful | One-tap opt-in to `full` |
| Phone off the tailnet cannot open the panel | Push still arrives; public panel is an ADR 0017 change (E7/E10) |

### Planned tickets

- F048 (mail OAuth adapters): replaced by E9a. Its "Google verification and CASA" line is dropped (PD-005).
- F075 (content-minimal Telegram): web half already in E4-A; the Telegram half is absorbed by E9b.
- F040 (delegate reply from another address): leaves E9 for E5.
- F055 (live updates): not needed by E9; stays planned.
