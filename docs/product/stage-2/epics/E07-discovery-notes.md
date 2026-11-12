# E7 · Platform and trust — discovery notes (2026-11-13)

> Long detail for the "Discovery" section of `E07-platform-and-trust.md`. Session: Opus 5.5 (`claude-opus-5-5`), Stage 2 discovery queue row 3. Read the page first; this file holds the reasons, the facts with sources, and the design input for `plan-task`. Nothing here is a Limen ticket.

## 1. What the session read

- `docs/product/stage-2/03-product-frame.md`, `04-review-result.md`, `05-execution-plan.md`, `decisions.md` (PD-001–PD-012), every epic page.
- `tasks/active/s6-pre-sale.md` (S6 master plan: P1–P24, D1–D33, "Scope change"), `tasks/planned/s6c-account-data.md`, `s6e-papers-cost.md`, `s6f-hosted-production.md`.
- `spec/build.md`; tickets F021, F056, F069 (active), F076, F078, F081, F082 (active), F084, F023, F073, F075.
- Code: `apps/server/src/platform/{auth,config,http}.ts`, `modules/{tenancy,channels,actions,audit}`, `platform/db/schema.ts`, `db/migrations/`, `apps/web/src/{pages,components,i18n}`, `package.json` scripts, `node_modules/better-auth/dist/plugins/`.
- `docs/decisions/` (0001–0017, 0021 proposed by the E2 session), `notes/` (grep: no earlier note on SSO, TOTP, flags or send limits).

## 2. Code cross-check (detail)

| Item | Exists today (file) | Partly | New |
| --- | --- | --- | --- |
| S6b login hardening | F082 stages 1–9 on `master`: migration `20261112200001_auth_public.sql` (`users.locale`, `users.terms_*`, `auth_lockouts`), `platform/auth-mail.ts` + `auth-mail-texts.ts` (pl and en), `org:invite`, lockout `platform/auth-lockout.ts`, `platform/pwned.ts`, terms `packages/core/src/web/terms.ts`, host guard `modules/mail/host-guard.ts` | Checkpoint A review `f1df613`: VERDICT FAIL, blocker B1 (lock state shows through Better Auth's form-CSRF check). Stages 10–15 left | — |
| Org delete | `delete_mailbox` function (`20261111000001_delete_mailbox.sql`) is the shape to copy | — | `delete_organization`, route, `org:delete`, the `information_schema` test |
| Export | — | — | `org:export` (D14) |
| Polish UI | `apps/web/src/i18n/en.ts` + test; `users.locale` column (F082 s1); auth mails in pl and en | Telegram texts English only (`modules/channels/texts.ts`) | `pl.ts`, language rule, Account choice, Telegram texts per locale |
| Data-subject requests | — | Address data lives in `emails.from_address`, `to_addresses`, `cc_addresses`, `subject`, `body_text`; `delegates.email`; `sender_rules.pattern`; `outbox.text`; `actions` payloads; `triage_results.reason` and `fields` | Find and erase by address (§4) |
| Papers | `TERMS_VERSION` and stub legal pages come from F082 (stages 7 and 11) | — | Texts (pl, en), DPIA, records of processing, breach procedure |
| Cost model | `triage:cost` CLI (`scripts/triage-cost.ts`) | — | `docs/cost-model.md` v1 |
| S6f | `deploy/backup.sh`, `deploy/restore-test.sh`, F021 planned, timing tests in `docs/known-alerts.md` | — | As `s6f-hosted-production.md` |
| Send limits | `SEND_SCOPE` kill switch (`platform/config.ts:121`); a tap before every send; retry caps (`modules/actions/send.ts`, `SEND_HARD_TRIES`); approvals older than 48 h refused (S6a D4) | No count limit per mailbox or per recipient | Rolling caps (§5) |
| Operator console | CLIs `org:create`, `org:invite`, `org:plan`, `org:status`; operator notices to Telegram or log (`modules/channels/operator.ts`, audit row `operator.notice`) | F081 (notice list) planned | Operator role, `/operator` page (§7) |
| Feature flags | Global env scopes (`TRIAGE_LLM_SCOPE`, `ACTIONS_SCOPE`, `SEND_SCOPE`); per-mailbox mode; per-category `auto` | — | Per-organization flags (§6) |
| Identity tier 1 | Better Auth 1.7.18, email and password, sign-up off (`platform/auth.ts:228-240`); the `two-factor` plugin ships inside `better-auth` (`node_modules/better-auth/dist/plugins/two-factor`) | — | `@better-auth/sso` (not installed), SSO tables, TOTP UI, break-glass, "SSO required" |
| Billing | Plan state `trial` / `active` / `suspended` (`20261112100001_org_plan.sql`, `org:plan`) | — | The page claimed "a billing provider port with a fake (built)": **not built** (grep finds no billing code). Decision: drop it (§9) |
| Portable install | `deploy/README.md` | — | Moves to E8 (§10) |

## 3. Research (web, 2026-11-13)

| # | Fact | Source (date read) | Kind |
| --- | --- | --- | --- |
| W1 | `@better-auth/sso` is a separate package. OIDC (with discovery) and SAML 2.0. Each connection is one `ssoProvider` row. "By default, any signed-in user can register up to 10 providers." `providersLimit` (a function, `0` = refuse) restricts it; `defaultSSO` defines providers in code. With domain verification on, "a provider whose domain is not verified returns 401"; "Changing `domain` resets `domainVerified` to `false`". Discovery needs the IdP origin in `trustedOrigins` | https://better-auth.com/docs/plugins/sso (2026-11-13) | vendor docs |
| W2 | SSO user matching is by provider id + OIDC `sub`, not by email. An existing user is linked only when `resolveUser` returns `link`, or when the provider domain is verified, the email domain matches, the local email is verified and account linking is on. `disableImplicitSignUp` only changes the default: "an OIDC sign-in still creates the user when `signIn.sso` is called with `requestSignUp: true`. Any client can send that flag." To refuse unknown users, return `{ action: "reject" }` from `resolveUser`. `resolveUser` runs in a DB transaction ("the adapter needs native transaction support"). Automatic organization provisioning needs the Better Auth organization plugin (this project does not use it) | https://better-auth.com/docs/plugins/sso/provisioning (2026-11-13) | vendor docs |
| W3 | A domain-verification race (TOCTOU) in the SSO plugin let an attacker verify a domain they do not own and take over accounts on it; any signed-in user could register a provider. Fixed in `@better-auth/sso@1.6.27` (advisory GHSA-8c5h-wx78-2cfg, published 2026-08-11) | https://verialabs.com/blog/securing-open-source-part-3-better-auth/ (published 2026-10-15) | security research |
| W4 | An open PR (2026-05/06) says the TXT check fails when the record holds the raw token | https://github.com/better-auth/better-auth/pull/9750 (2026-11-13) | issue tracker |
| W5 | npm: `better-auth` and `@better-auth/sso` both have 1.7.18–1.7.22; latest 1.7.22 (2026-11-12). `@better-auth/sso@1.7.18` peers `better-auth ^1.7.18` | `registry.npmjs.org` (2026-11-13) | registry |
| W6 | Better Auth `two-factor` plugin: TOTP, OTP, backup codes (single use), trusted devices (30 days, refreshed on sign-in) | https://better-auth.com/docs/plugins/2fa; https://www.turbostarter.dev/blog/better-auth-2fa-two-factor-authentication-guide (2026-10-23) | vendor docs, blog |
| W7 | Microsoft Entra multi-tenant apps use `/common`; the token `iss` holds the tenant id, so the app must validate tenant issuers itself; several auth libraries fail this (NextAuth PR 13440; Convex issue 304, 2026-04-04). A per-organization provider with a tenant-specific issuer avoids the problem | https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant; https://github.com/get-convex/convex-auth/issues/304 | vendor docs, issue |
| W8 | Google OAuth redirect URIs: HTTPS; no raw IP; "Host TLDs (Top Level Domains) must belong to the public suffix list"; no wildcards | https://support.google.com/cloud/answer/15549257 (2026-11-13) | vendor docs |
| W9 | `ts.net` is on the Public Suffix List (submitted by Tailscale). So a redirect URI on `<machine>.<tailnet>.ts.net` is allowed by Google and Entra: no public domain is needed for OIDC | https://publicsuffix.org/list/public_suffix_list.dat (2026-11-13, line "ts.net") | standard |
| W10 | Notion: enforced SSO applies only to members on a verified domain; "At least one domain must be verified"; owners keep an email-and-password bypass "in the event of IdP or SAML failure" | https://www.notion.com/help/saml-sso-configuration (2026-11-13) | vendor docs (market pattern for break-glass) |
| W11 | Exchange Online: 10,000 recipients per rolling 24 h, 30 messages per minute; after the limit the mailbox cannot send until the 24 h count drops | https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits (updated 2026-11-11) | vendor docs |
| W12 | Gmail (Workspace): 2,000 messages per day (500 for trial accounts), rolling 24 h; at the limit "Users can't send new messages for up to 24 hours"; spam senders "might be permanently restricted" | https://support.google.com/a/answer/166852 (2026-11-13) | vendor docs |
| W13 | GDPR processor clause (EU standard contractual clauses for Art. 28): "The processor shall promptly notify the controller of any request it has received from the data subject. It shall not respond to the request itself, unless authorised to do so by the controller", and must assist the controller | https://eur-lex.europa.eu/eli/dec_impl/2021/915/oj/eng (2026-11-13) | law |
| W14 | OpenFeature: "an open specification that provides a vendor-agnostic … API for feature flagging"; flags are evaluated with an evaluation context (user, request) | https://openfeature.dev/docs/reference/intro (2026-11-13) | standard |

Not checked (search provider rate-limited at 2026-11-13): the exact free sign-up path for a Microsoft Entra test tenant without a paid subscription; the TXT record format of Better Auth domain verification. Both go to the identity spike.

## 4. Data-subject requests (DSR) — design input

Roles (W13, D19 of the S6 plan): the organization is the controller of its mail; the service is the processor. A sender who asks to see or erase their data asks the controller; the processor assists on the controller's instruction.

- **One service command** `dsr.find` / `dsr.erase` (channel-neutral, typed, `03` §4), exposed now as CLI `org:dsr --org-id <id> --address <a> (--find | --erase --confirm)`. The operator runs it on the owner's instruction. A panel page for the owner can come later on the same command.
- **Find**: counts and ids per table, plus a JSON file for the controller (same `age` encryption and folder rule as `org:export`, D14).
- **Erase**: deletes `emails` rows where the address is the sender, or is the only other party (to/cc), with their cascade rows (triage results, feedback, actions, outbox lines of those mails); clears the address from `to_addresses`/`cc_addresses` of mails that other people sent; scrubs `outbox.text` lines that name it. It **lists, not deletes**, `delegates` and `sender_rules` that hold the address: they are the controller's own settings (for example a blocklist entry); the owner decides.
- **No re-import**: an erased mail is still in the user's IMAP mailbox. A rescan or backfill would import it again. Erase writes a tombstone (the `dedup_key`, a hash, no personal data) that sync, rescan and backfill skip. Future mail from the person is processed as normal; the controller can add a blocklist rule if the person objects to processing.
- **Audit**: one `dsr.find` or `dsr.erase` row with a keyed hash of the address (HMAC with a server key), counts per table, the actor. Never the address in clear.
- **Backups**: rows stay in backups until their period ends; the papers say so (as for the org delete).
- **Registry rule**: every column that can hold a third party's address is listed in one DSR address map in code; a test reads `information_schema` and fails when a column named like `*address*`, `*email*`, `from_*`, `to_*`, `pattern` or a `text` column of a known message table is not in the map or its "not personal" list. E5 (Sent rows) and E11 (contacts) must add their columns.
- Deadline: GDPR one month (Art. 12(3)); the runbook gives the steps.

## 5. Send limits — reasons for the defaults

Every send already needs a tap, so a normal user cannot send many mails. The risk is a bug: a loop in the chaser, a "send all reminders" button (E4), a follow-up job (E5), a reply-draft job (E6), or a duplicate of one action. A provider that sees a burst can suspend the mailbox (W12: up to 24 h, or for good for spam-like sending), which hurts the user far more than a delay.

- Per mailbox: 20 sends per rolling hour, 100 per rolling 24 h. Per recipient address: 5 per rolling 24 h. All three env keys with these defaults.
- These sit far below the provider limits (W11: 30 per minute, 10,000 recipients a day; W12: 2,000 or 500 a day) and above a heavy executive day (E2 scenario: 100–200 mails in, reply drafts and reminders out).
- Over a limit, the send is not dropped: the action waits with `next_attempt_at` at the end of the window and a reason code `send_limit`; the panel and the Telegram card show "waiting: send limit". The first hit per mailbox per day is an operator notice `send_limit` (the D31 frame).
- Counting reads the sent actions of the window (no new counter table). One check in the committer, before the SMTP call, inside the existing send lock.
- Second look after the E2 simulated week: if a normal week hits a limit, raise it (E3 owns the number).

## 6. Feature flags — design input

- Registry in `packages/core`: each flag has a key, a default, a description, the owner epic and a remove-by date.
- Table `org_features (org_id, flag, enabled, set_by, set_at)`; no row = the default. Env `FEATURES_OFF=<flag>,<flag>` turns a flag off for every organization without a DB write (the kill switch).
- One function `isFeatureOn(ctx, flag)`; jobs read it once per run. The function shape follows the OpenFeature idea (flag key + evaluation context, W14) so a provider could replace it later; no vendor and no SDK now.
- Writes: CLI `org:flag --org-id <id> --flag <key> --on|--off` and the operator console; audit row `org.feature_changed`.
- Rule for Stage 2: every new behaviour a user sees (E4 mail digest channel, E5 Sent sync and follow-ups, E6 reply drafts, E9 OAuth mailboxes and content-minimal Telegram) ships behind a flag, default off, turned on for the pilot first. Flags are not product settings: per-category `auto` and the mailbox mode stay as they are.

## 7. Operator console — design input

- Who is the operator: env `OPERATOR_USER_IDS` (user ids). A DB write cannot make an operator. Once TOTP exists, an operator must have it.
- Page `/operator` (tailnet only, like the panel): organizations with plan, trial end, mailbox count and statuses, linked chats count; per organization the last run of each job, derived from existing rows (last sync `mailboxes.last_synced_at`, last triage, last digest, last send) and the failures of the last 24 h (failed sends, failed Telegram lines, mailboxes in `auth_error` with `status_changed_at`); LLM calls and cost today (the E3 stats command); the notice list (F081) and the E8 SLO alerts (they are operator notices too); flags per organization; plan change, suspend and resume (the same service calls as `org:plan`); SSO provider setup (identity B). No new job-run table: E8 dropped its operations dashboard and relies on this page plus the SLO alerts (`E08-discovery-notes.md` §7).
- Reads across organizations go through one operator module with its own route group and route-matrix tests: an owner of any organization gets 404 on every `/api/operator/*` route.
- Ids, codes, counts and dates only. No mail content, no addresses of senders. Deep logs stay in the E8 log store (the console links by `org_id`, it does not read logs).
- ADR 0027 (proposed) records the role and the flags; ADR 0026 (proposed) records identity tier 1.

## 8. Identity tier 1 — design input

Two tickets.

**Identity A — TOTP and break-glass** (after F082; no spike):
- Better Auth `two-factor` plugin (inside `better-auth`, W6): TOTP with backup codes, trusted device 30 days.
- Optional for members; required for operators and for the break-glass owner of an organization with "SSO required".
- Enrolment and removal in the Account card; audit rows; the deletion test covers the new tables.

**Identity B — OIDC SSO per organization** (after the spike; second pass):
- `@better-auth/sso` pinned to the same version as `better-auth` (W5), never below the W3 fix.
- One generic OIDC path: each organization registers an app in its own IdP and gives issuer, client id and secret. A tenant-specific Entra issuer avoids the multi-tenant issuer problem (W7). Google Workspace uses the same path.
- Only the operator creates or changes providers (`providersLimit` returns 0 for every other user; changes through the operator console or a CLI). Users never register providers (W1, W3).
- Domain verification on. Normal path: DNS TXT. Test organizations without a domain: the operator attests the domain (CLI, audit row `sso.domain_attested`); this path is open to operators only.
- No just-in-time accounts: `resolveUser` returns `reject` unless the address belongs to an existing member of the provider's organization (the invite stays the only way in); `link` for that member. Do not rely on `disableImplicitSignUp` alone (W2: `requestSignUp`).
- "SSO required" per organization: the email-and-password sign-in and the reset request refuse members of that organization, except the break-glass owner (password + TOTP), as Notion does (W10).
- Offboarding: an SSO session lives at most 12 h; after that the user signs in through the IdP again, so a disabled IdP account loses access within 12 h. The owner can end a member's sessions.
- Audit rows for SSO sign-in, link, refusal, provider change, domain verified or attested.
- Redirect URI on `https://<machine>.<tailnet>.ts.net/...` works for Google and Entra (W8, W9). Users of the organization must be on the tailnet (ADR 0017); the docs say so.
- Real test: a Microsoft Entra test tenant (owner step, about 30 min). CI: a local fake OIDC IdP. Google Workspace: by config, real check only when a Workspace tenant exists.
- Spike questions (stage 1 of identity B): the plugin with our renamed Better Auth tables (`users`, `auth_*`) and the `pg` pool (transactions for `resolveUser`); `trustedOrigins` for discovery; the TXT format (W4); the Entra test tenant sign-up path; the session max age per sign-in method.

## 9. Items dropped or moved

- **Billing provider port with a fake**: drop. `03` §6 makes the billing provider a non-goal; a port with no real adapter adds code and tests with no user; the real choice (card provider vs a KSeF invoicing service, S6 P3) would change the interface anyway. The plan state stays.
- **Portable clean-server install** and **restore test**: one drill, owned by E8 (`E08-discovery-notes.md` §6: a clean VM, `deploy/README.md` "First install" only, the latest B2 backup restored, the wall time measured). It proves the E7 portable install, the S6f restore test and the E8 drill at once. S6f keeps the read-only Backblaze check, the failed-backup notice and ADR 0019, and points to the drill result.
- **DPIA draft, records of processing (Art. 30), breach procedure**: move from E8 should-tier to S6e (they are papers, and an auditor asks for them with the DPA). The E8 session proposes the same move.

## 10. Cross-epic edits for the owner (not applied; other pages belong to their sessions)

| Page | Edit |
| --- | --- |
| `E08-operations.md` | Agrees with the E8 session (`E08-discovery-notes.md` §6, §7): the E8 drill also proves the E7 portable install and the S6f restore test; DPIA, records of processing and breach procedure go to E7 S6e; the backup status file is shared with S6f. One addition: the E8 SLO alerts use the operator notice frame, so they appear in the E7 console list |
| `E04-control-surface.md` | Dependencies: the Polish i18n frame (E7, ticket "Polish UI") lands before the E4 page stages, so every new page ships pl and en keys; "send all" reminders need the E7 send limits; the mail digest channel needs an SMTP path (the auth-mail sender is off on the VPS: send from the user's own mailbox, or turn on the sender) and ships behind a feature flag |
| `E05-open-loops.md`, `E06-reply-drafts.md` | Need E7 send limits and feature flags first; new tables (Sent rows) join the org-delete test and the DSR address map |
| `E09-reach.md` | Needs F082, send limits and feature flags, not identity tier 1 (mailbox OAuth is not sign-in). Content-minimal Telegram changes the papers: bump `TERMS_VERSION` |
| `E10-go-to-market-readiness.md` | The security-and-data page reuses the S6e papers' sub-processor list (one source file) |
| `E11-contacts-and-context.md` | The contacts table joins the DSR address map from its first migration |
| `05-execution-plan.md` §2 | Graph: drop `E4 → E7i`; drop `E7i → E9` (E9 needs E7 send limits and flags). Wave 1 for E7 = F082 rest, Polish UI, platform controls, identity A |
| `README.md` epic table | E7 row: remove "billing port"; add send limits, flags, console, DSR, owner security log |

## 11. Ticket split for `plan-task` (proposal)

| Ticket | Content | Stages | Needs | Absorbs |
| --- | --- | --- | --- | --- |
| F082 (running) | S6b login hardening | 15 (9 landed) | — | F056 |
| E7-T1 Polish UI | i18n frame first (type check, language rule, Account choice), panel texts, auth mails check, Telegram texts per `users.locale`, Telegram consent text | 6 | F082 | S6c D12, D27 |
| E7-T2 Platform controls | Send limits, feature flags, operator role and console, owner security log | 12 | F082 | F081 |
| E7-T3 Account data | `delete_organization`, route, `org:delete`, `org:export`, DSR find and erase with tombstones and the address map, expired `auth_verifications` cleanup | 8 | F082, T1 (dialog texts) | S6c D13, D14; F078 |
| E7-T4 Papers and cost | Privacy, terms, DPA (pl, en), DPIA, records of processing, breach procedure, cross-check, cost model v1, ADR 0020 | 6 | T3 | S6e |
| E7-T5 Production on the VPS | As `s6f-hosted-production.md`, but the restore test is the E8 drill (§9) | 4 | T1–T4 | S6f, F021 |
| E7-T6 Identity A | TOTP, backup codes, break-glass rules | 4 | F082 | — |
| E7-T7 Identity B | Spike, OIDC per organization, domain verification, SSO required, 12 h session, audit | 10 | T2 (console), T6, spike | — |

Total about 65 stages (50 left), about 9k source lines. Lanes: T1 ∥ T2 ∥ T6 after F082 (one migration at a time); then T3 → T4 → T5; T7 after its spike and second pass. Not absorbed: F069 (active, own ticket), F084 (F082 follow-up, own ticket), F076 (stays out of Stage 2), F023 and F073 (E3), F075 (E9).
