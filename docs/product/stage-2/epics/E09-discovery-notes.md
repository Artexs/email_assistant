# E9 Reach: discovery notes (2026-11-13)

Detail for the "Discovery" section of `E09-reach.md`. The next agent has no chat history: this file holds what was read, what was found and why each default is what it is.

## 1. Read

- `03-product-frame.md`, `E09-reach.md`, `05-execution-plan.md`, `decisions.md` (PD-001–PD-069), `04-review-result.md` §3, §5, §8, §9.
- Other epic pages and their discovery notes: E02, E03, E04, E07 (W8, W9: `ts.net` is on the Public Suffix List), E08, E12.
- Code: `apps/server/src/modules/mail/{port,open}.ts`, `mail/imap/{client,smtp}.ts`, `packages/core/src/mail/providers.ts`, `modules/channels/{port,notices,texts}.ts`, migrations `20261103100001_mail.sql` and `20261106000001_telegram.sql`, `apps/web/src/components/mailboxes/ConnectDialog.tsx`, ADR 0004, 0009, 0010, 0016, 0017.
- Tickets: F048, F075, F040, F055 (`spec/features/planned/`).
- Notes: `2026-11-02-external-facts-gmail-gemini-telegram.md`, `2026-11-11-web-mailboxes-facts.md`, `2026-11-12-web-panel-deploy.md`, `2026-11-13-identity-and-send-limit-facts.md`. New: `notes/2026-11-13-mail-oauth-and-push-facts.md` (all web facts with sources).

## 2. Code cross-check

| Item | Exists today | Partly | New |
| --- | --- | --- | --- |
| Mail port | `mail/port.ts`: IMAP-shaped (`uid`, flags, `UID MOVE`, `APPEND` with APPENDUID, `transferByAppend`); `MailSender` is separate and takes `{ envelope, raw }` | — | A Graph `MailSender` adapter (Microsoft send) |
| Secret handling | `mail/open.ts` `openMailboxProvider` decrypts the password and opens provider and sender; `mailbox_credentials.secret_kind` ∈ `password`, `app_password` (ADR 0009) | — | Secret kind `oauth`; token refresh in `openMailboxProvider`; per-mailbox refresh lock |
| IMAP with a token | `imapflow` 1.7.8 supports `auth.accessToken` (`imap-flow.js:1957`); `imap/client.ts:87` passes `{ user, pass }` only | Library ready | Pass `accessToken` |
| SMTP with a token | `imap/smtp.ts` has its own login hook (`login(auth: { user; pass })`, line 219) | — | XOAUTH2 login for Gmail SMTP |
| Gmail | Preset `gmail` (app password, `imap.gmail.com`, `smtp.gmail.com:465`) in `packages/core/src/mail/providers.ts`; help text in `apps/web/src/i18n/en.ts:118` | Never run on a real Gmail mailbox (no note) | OAuth path; one real check of the app-password path |
| Microsoft 365 | No preset; `outlook.office365.com` absent | — | OAuth only (Basic is gone for IMAP) |
| Connect UI | `ConnectDialog.tsx` presets: interia, gmail, onet, wp, o2, icloud, other | — | "Sign in with Microsoft" and "Sign in with Google" buttons; admin-consent page; Reconnect |
| Error state | `mailboxes.status` `auth_error`; notice kind `auth_error` (`channels/notices.ts:265–289`) | No reason code | Reason codes `oauth_expired`, `oauth_revoked`, `admin_consent_required`, `protocol_disabled` |
| Mailbox remove | `mail/remove.ts`; text "Change its password in your mail provider's settings now." (`channels/texts.ts:21`) | Text fits passwords only | Token revoke (Google), text per secret kind |
| Notices | `channels/port.ts` `ChatChannel` (Telegram-shaped `chatId: number`); `outbox` stores rendered `text` + Telegram buttons + `external_message_id bigint` | One channel only | Push channel; notice stored as facts, rendered per channel and detail level at send time |
| Telegram content | `channels/notices.ts`, `texts.ts`, `packages/core/src/digest/approvals.ts`: sender, subject, summary, draft text in `outbox.text` | — | `minimal` render mode; per-user detail; org lock |
| PWA | Astro static panel (ADR 0016) on Tailscale Serve (ADR 0017); no manifest, no service worker | — | Manifest, app-shell service worker, push subscription table and API, VAPID keys, device list |
| Web approvals | E4-A builds `/approvals` (absorbs the web half of F075) | — | E9 only links to it |
| F040 alias addresses | `delegation/repo.ts` matches the delegate address only | — | Moves to E5 (§4) |

Correction to the epic page: "Graph or IMAP XOAUTH2 behind the `MailProvider` port" understated the cost of Graph. The port is IMAP-shaped. A Graph read adapter needs opaque message keys instead of UIDs in sync, locate, actions and the history check. IMAP XOAUTH2 needs no port change.

## 3. Research summary (sources in the notes file)

| # | Fact | Effect |
| --- | --- | --- |
| R1 | Exchange Online IMAP has XOAUTH2, UIDPLUS, MOVE, IDLE (SO answer, old) | The existing adapter fits; spike re-checks the list |
| R2 | Security defaults (on for tenants from 2019-10-22) turn off SMTP AUTH; the docs also say POP3 and IMAP4 are turned off; OAuth IMAP not addressed (Microsoft Learn) | Send through Graph; the spike must prove OAuth IMAP on a security-defaults tenant |
| R3 | Graph `sendMail` accepts base64 MIME and saves to Sent Items (Microsoft Learn) | The composer's raw MIME goes out unchanged; the committer's "locate first, APPEND only if missing" finds the Sent copy |
| R4 | Graph webhooks need a public HTTPS endpoint (Microsoft Learn) | No webhooks while the panel is tailnet-only |
| R5 | Unverified multi-tenant apps get no user consent for mail scopes; since late 2025 work tenants ask for admin approval by default (Microsoft 2020 blog; vendor page, marketing; Q&A 2026-01-12) | The connect flow must handle "admin approval needed" with a forwardable admin-consent link |
| R6 | Gmail testing mode: consent expires after 7 days; ≤ 100 users; a Workspace admin "trusted app" removes both limits (notes 2026-11-02) | Gmail OAuth needs a one-tap Reconnect; app password stays the durable path for personal Gmail |
| R7 | Gmail IMAP is always on for personal accounts since 2025-01; Workspace dropped password sign-in 2025-05-01; app passwords need 2SV (Google help) | The existing app-password preset is valid for personal Gmail; Workspace needs OAuth |
| R8 | iOS Web Push only for Home Screen apps (16.4+); manual install (OpenPWA 2026-06) | Install help text per platform; iOS documented, not tested |
| R9 | `web-push` 4.0.0 (2026-11-06) uses `node:crypto`; an old Bun issue is open; WebCrypto alternatives exist | E9b stage 1 proves one real push from Bun before the rest |
| R10 | M365 Developer Program sandbox only for qualifying members; Business Basic $7 per user per month after a 30-day trial | The owner buys one Business Basic seat as the test tenant, shared with the E7 identity B spike |

Market (from `04` §3): Fyxer, Inbox Zero and Superhuman cover Gmail and Outlook through the provider APIs and ship native apps. No 2026 competitor page found that offers push without content. "IMAP host + M365 + Gmail behind one IMAP core" is this product's shape and keeps every quality number (E2, E3) valid on all hosts.

## 4. Cross-epic notes (edits for other pages; the owner approves, this session edits no other page)

| Page | Edit |
| --- | --- |
| E5 Open loops | Take F040 (delegate reply from another address): reply detection is the open-loop engine's job; gate it on the E2b report of the planted case. The E5 session (in parallel) already absorbs part of it: Waiting loops close on a reply from any participant; the delegate alias list stays planned. E5's need "Graph and Gmail adapters list the Sent folder" is met by the IMAP path (`Sent Items`, `[Gmail]/Sent Mail`) with no new code |
| E6 Reply drafts | E6 (in parallel) expects Graph `createReply` and Gmail `threadId` for drafts inside the thread. With ADR 0031 drafts stay IMAP APPEND with `In-Reply-To`, `References` and the same subject. The spike checks that Gmail and Outlook on the web show the draft in the thread. Fallback for Microsoft only: Graph create-draft (MIME or `createReply`) behind the same draft step |
| E3 | Its cross-epic note "OAuth adapters return the same header fields" is met by construction (same IMAP adapter). With Graph send only, nothing changes for the header capture |
| E4 | Notice routing per user (PD-033: Telegram, mail, both) gains "push". E4-B builds the per-user channel setting; E9b adds the push value and the device list. The approvals page needs a stable deep link per item (`/approvals/<id>`) for push and minimal Telegram |
| E7 | Papers (S6e): Telegram detail levels, push services as recipients of encrypted ids, OAuth scopes; `TERMS_VERSION` bump when E9b lands. Flags (PD-045): `mail_oauth_microsoft`, `mail_oauth_google`, `web_push`, `telegram_minimal`. Org delete and export cover OAuth secrets and push subscriptions. One Microsoft test tenant serves the identity B spike and the E9a spike |
| E8 | Log allow-list: never log tokens, `state`, codes or push endpoints (the endpoint URL is a capability). IDLE (Should) must log in again when the 1-hour token expires. SLO "sync lag" covers OAuth mailboxes; an `auth_error` with reason `oauth_expired` is a user notice, not an operator alert |
| E2 | GreenMail cannot be Microsoft or Gmail. E9a adds a provider smoke on the real test mailboxes (§6); the CI contract suite uses a fake token server. E2 needs no change |
| E10 | The security page answers "who holds a copy": Telegram only in `full` mode; push services see encrypted ids only |
| E12 | The go or no-go waits for the PWA in daily use (unchanged) |
| `05` §2 | Already proposed by E7 (PD-050): E9 needs E7 send limits and flags, not identity tier 1. E9b also needs E4-A (approvals page) and E4-B (channel setting) |
| `03` §4 | The owner rewrites the Telegram clause (decision 8) |

## 5. Decided design detail (defaults)

### E9a Mailbox OAuth

- Flow: authorization code with PKCE; `state` row (single use, 10 min, bound to user, organization and provider); callback on `WEB_BASE_URL`; the address from the ID token or the provider's profile answer.
- Microsoft: one multi-tenant app per deployment, `common` authority (work and personal accounts). Scopes: `offline_access`, `https://outlook.office.com/IMAP.AccessAsUser.All`, Graph `Mail.Send`. The spike checks that one consent covers both resources and that the refresh token redeems for both. On AADSTS consent errors: page "Your administrator must approve this app" with the admin-consent URL, a copy button and the scope list in plain words. A single-tenant app is a doc option for a company that self-hosts.
- Gmail: one app per deployment in testing mode; the test users list holds the pilot accounts. Scope `https://mail.google.com/` (IMAP and SMTP need it). Doc option for a Workspace customer: an "Internal" app or the admin "trusted app" setting.
- Tokens: refresh token encrypted (ADR 0009, AAD `mailbox:<id>`); access token in memory for one job; a rotated refresh token is saved under a per-mailbox advisory lock.
- Errors: `invalid_grant` → `oauth_expired` or `oauth_revoked`; consent errors → `admin_consent_required`; IMAP `AUTHENTICATE` refused with a valid token → `protocol_disabled` (text: "Your administrator turned off IMAP for this mailbox"). Each reason has a user text and a Reconnect button in the panel; Telegram and push get the existing `auth_error` notice with a link.
- Remove: Google token revoke endpoint; Microsoft has no per-grant revoke for delegated tokens, so the text points to "My Apps" to remove access.
- The host guard (F084) does not apply: provider hosts are fixed constants.
- Send limits (PD-044) and feature flags (PD-045) apply unchanged.
- Spike (stage 1, about 2 stages, on the owner's test accounts):
  1. Microsoft tenant with security defaults on: consent screen (user or admin), OAuth IMAP login, CAPABILITY, LIST, MOVE with COPYUID, APPEND to Drafts (is it an editable draft in Outlook on the web?), APPEND to INBOX (report mail), IDLE.
  2. Microsoft send: SMTP XOAUTH2 (expected `5.7.139` under security defaults) and Graph `sendMail` MIME (Sent Items copy; `X-EA-Action-Id` header kept).
  3. Microsoft personal account (outlook.com) through `common`.
  4. Gmail testing mode: unverified-app screen, IMAP and SMTP XOAUTH2, MOVE to `AI/*` labels, APPEND to `[Gmail]/Drafts`, Sent copy dedup, delete from Drafts; the app-password preset once.
  5. Token refresh, rotation, revoke and the error codes of each step.
  6. A reply draft appended with `In-Reply-To` and `References`: does it show inside the thread in Gmail and in Outlook on the web (E6 need)?
  Result in `notes/` and the second pass of PD for decisions 2 and 3.

### E9b Phone channel

- PWA: manifest (name, icons, `display: standalone`, start URL `/activity`), service worker for the app shell only, install help per platform (Android Chrome prompt, iOS Share → Add to Home Screen).
- Push: VAPID keys in env; table of push subscriptions (user, session, endpoint encrypted, keys, created, last success); payload `{ kind, count, itemId }`; text rendered by the service worker from the kind and count in the user's locale ("1 urgent mail"); a tap opens the item. 404 or 410 from the push service deletes the subscription.
- Routing: per user and notice kind: Telegram, push, both. Default when a device subscribes: urgent and approvals to both; digest stays as set (PD-033). Quiet hours apply.
- Telegram detail: `minimal` renders every outbox kind as counts and a link; approvals show "1 draft waits for you" with "Open in panel", no Send or Reject button. `full` is today's render. The link step shows both with the consent text; `minimal` is preselected; the org owner can lock `minimal`. The pilot's existing link keeps `full` (opt-in already given at link time).
- Outbox: store facts (kind, ids, counts), render at send time for the channel and detail level (needed for both push and minimal Telegram). The planning session decides the migration shape; one migration at a time.
- Account card: device list (name from the user agent, created, last push), remove; sign-out of a session removes its subscriptions.
- Test: a test over every notice kind proves that a `minimal` outbox render holds no sender, subject, summary or draft (F075's done-when line); one real push to the owner's phone at the checkpoint.

## 6. Exit (rewritten)

- On the owner's test Microsoft 365 mailbox and test Gmail mailbox: connect with OAuth; a provider smoke appends 20 bank cases (E2a) into INBOX; the pipeline runs in assist; one delegation and one reply go out to the owner's own address only; disconnect and reconnect keep the history.
- CI: the contract suite runs the IMAP adapter with a fake token server; the Graph sender against a fake Graph endpoint.
- The PWA installs on the owner's Android phone; a planted urgent mail gives a push within the M5 target; the tap opens the item.
- A user in `minimal` mode gets counts and links only (test over every notice kind).

## 7. Size

| Ticket | Stages | Source lines | Content |
| --- | --- | --- | --- |
| E9a Mailbox OAuth | ≈ 19 | ≈ 3k | Spike (2); OAuth core: state, PKCE, callback, token store, refresh lock, error reasons, reconnect, remove (6); Microsoft: config, admin-consent page, Graph sender, fake Graph (4); Gmail: config, label and Sent quirks, XOAUTH2 SMTP (3); connect UI, reconnect UI, pl and en (3); operator doc for app registration, capability page (1) |
| E9b Phone channel | ≈ 14 | ≈ 2.6k | Push proof on the phone (1); outbox as facts with send-time render (3); push subscriptions, VAPID, sender, device list (4); manifest, service worker, install help (2); Telegram `minimal` render, setting, org lock, consent text (3); capability page (1) |
| **Total** | **≈ 33** | **≈ 5.6k** | Down from 40 / 6k: no Graph read adapter, no Gmail API adapter, F040 leaves |

If the spike shows that OAuth IMAP is blocked in a default Microsoft tenant: + ≈ 15 stages, + ≈ 3k lines (Graph read adapter, opaque message keys in the port). That is a new owner decision at the second pass.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| A default Microsoft tenant blocks OAuth IMAP (security defaults) | Spike first; the fallback (Graph read adapter) is sized and needs the owner's go at the second pass |
| Work tenants need admin consent | Admin-consent page with a forwardable link and plain-words scopes; doc for single-tenant self-hosting |
| Exchange APPEND to Drafts gives a non-editable item | Spike step 1; fallback: Graph "create draft from MIME" for Microsoft drafts only |
| Gmail testing mode: weekly re-consent | One-tap Reconnect; app password recommended for personal Gmail; Workspace "trusted app" doc |
| Rotated refresh token lost in a race | Per-mailbox lock; save the new token in the same transaction |
| A token or push endpoint in logs | E8 allow-list and canary test cover the new fields |
| Push library fails under Bun | E9b stage 1 real push; WebCrypto library as fallback |
| `minimal` default makes Telegram less useful | One-tap opt-in to `full`; the pilot keeps `full` |
| Phone outside the tailnet cannot open the panel | Push still arrives; doc says "Tailscale on the phone"; a public panel is an ADR 0017 change (E7/E10) |
| Provider quirks not covered by GreenMail | Provider smoke on real test mailboxes per E9a checkpoint; quirks go to `notes/` |
| Test tenant cost | One Business Basic seat (≈ $7 per month), shared with E7; cancel after Stage 2 |
