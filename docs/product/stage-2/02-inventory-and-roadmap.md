# Feature inventory and roadmap proposal (2026-11-12)

Follows `01-review.md`. Nothing here is decided until the owner accepts section 6.

Sources read: `docs/product-brief.md`, `docs/architecture.md`, `docs/roadmap.md`, `spec/vision.md`, `tasks/active/s6-pre-sale.md`,
`tasks/planned/s6*.md`, the 34 planned tickets in `spec/features/planned/`, and the old specs in `.ai/`
(`prd.md`, `features.md`, `notes.md`, `architecture/main_overview.md`, `architecture/UI/ui.md`, `architecture/ai_assistant/asistant.md`,
`architecture/mental_model/mental_model_v2.md`, `architecture/triage/triage.v2.md`, `architecture/orchestrator/orchestrator_v2.md`,
`ddd/podsumowanie_event_stormingu.md` incl. HS1–HS15, epics 1–6 and the success metrics). Code checked: module folders, routes, web pages, scripts.

## 1. Product boundary (owner, 2026-11-12, second statement)

Owner words (summary): personal and learning project, but built as a real product with high quality, so that other people could use it.
It must reach the point of a standalone product that is ready to sell. It is not sold. All implementation and processes must be fit for a real product.

Consequence: "sell-ready, not sold". This replaces both earlier statements ("SaaS for sale" in the product brief, "educational, home VPS only" in the S6 scope change).

- In scope again: everything a buyer or an auditor would expect: public-internet-grade login (S6b in full), account delete and export, legal page drafts, cost model, measured quality, user docs, operations runbook.
- Still out: real sales, billing provider account, company, lawyer, real customers. Hosting stays on the home VPS, but the deploy must be portable (a hosted EU server is a documented, tested path, not a live system).
- Proposed text for `spec/vision.md` "Current direction" and `docs/product-brief.md` Q1 is in section 7. The owner approves it.

## 2. What the MVP is today (built and running on the home VPS)

| Area | Built |
| --- | --- |
| Mail | IMAP + SMTP with password (Interia first; STARTTLS 587, iCloud preset), several mailboxes per org, sync every 5 min of INBOX + provider sort folders + spam folder, encrypted credentials, `auth_error` flow, backfill |
| Triage | hard rules (whitelist, blocklist, VIP), LLM classifier with Zod schema and thread context (3 earlier mails), 7 categories, per-category thresholds, daily LLM cap, pause on soft errors, Gemini or OpenAI switch |
| Actions | plan → policy → committer, moves / mark read / flag / summary, `shadow` and `assist` modes, per-category `auto` and switches, Undo (7 days), user-moved-back detection as feedback |
| Drafts and send | delegation drafts and clarification drafts (fixed template + quoted original + optional `style_text`), approval by Telegram tap, SMTP send with Sent copy, 48 h approval expiry |
| Delegation | delegates (CLI), delegation tracking, reply detection in the thread, daily chaser with reminder drafts, "send all reminders" |
| Telegram | chat linking, digest at set times (sections, ✅ / ✏️ / ↩️ buttons), urgent and `auth_error` notices, quiet hours, `/digest /status /pause /resume /help` |
| Web panel | login (Better Auth), onboarding, mailboxes (connect, password, pause, delete), settings (mode, switches, auto per category, sync folders), rules (sender rules CRUD), activity log, Telegram link; Tailscale only |
| Platform | multi-tenant (org_id everywhere), plan state `trial/active/suspended`, mailbox limit, retention job, operator notices, audit log, heartbeat, nightly encrypted backup to Backblaze |
| Quality tooling | 108 eval cases (synthetic, injection, delegation), `eval --real`, labeling CLI, cost report, AgentMail test traffic (personas, batches, checker agent), fake Telegram, GreenMail, 232 test files, Playwright |

## 3. Inventory of the ideas in the documents

Mark: ✅ built · 🟡 partly · ❌ not built. Source: PRD = `.ai/prd.md`, ES = event storming, UI = `.ai/architecture/UI/ui.md`, AS = assistant spec, MM = mental model v2, OR = orchestrator v2, F = `.ai/features.md`, T = a planned ticket.

### 3.1 MVP ideas (the old docs called these MVP)

| Idea | State | Note / source |
| --- | --- | --- |
| Categorize, spam, info summary + archive, notifications auto-archive | ✅ | PRD US-006/007, ES 6–13 |
| Whitelist never spam, VIP as priority modifier | ✅ | PRD US-006, ES 8, HS1 |
| Low confidence → `unsure` / Manual folder | ✅ | PRD 3.2 |
| Delegation A/B/C (delegate draft, clarification draft, none → manual) | ✅ | ES 9; send only after tap (product decision) |
| Chaser + reminders (one or all) | ✅ | ES 20–22 |
| Sectioned report URGENT → NEEDS ACTION → DONE → REMINDERS, 2× a day, on demand | ✅ | ES 14–16 |
| Shadow / assist modes, ON/OFF per action, Undo | ✅ | brief |
| Audit log | ✅ | brief Q6 |
| Multi-mailbox per account; reply from the receiving mailbox | 🟡 | many mailboxes ✅; "new mail from the primary mailbox" has no feature because the system writes no new mail |
| Web: delegates list CRUD with mandatory competence field, block own address | ❌ | UI (MVP); delegates are CLI only |
| Web: delegation dashboard (overdue, in progress, "send reminder" button, filters) | ❌ | UI "Dashboard Status" (MVP), ES 22, ES US-6.1 |
| Web: style editor (one style text, limit 1000) | 🟡 | `organizations.style_text` exists; the panel edits it as a signature (`SignatureCard.tsx`), not as a writing style for the LLM |
| Web: onboarding checklist | ✅ | onboarding page |
| Stats view / "handled share" (main success metric) | ❌ | PRD US-013, ES metrics; T F033, F042 |
| Manual delegation from panel or chat, tracked like auto delegation | ❌ | PRD US-012, F (Sent-folder check) |
| Meeting requests: conflict check, propose 3–5 slots | ❌ | PRD US-009, ES 11 (product brief kept "conflict case only" in MVP, roadmap moved it to Phase 2) |
| Global "auto send / draft" switch | ✅ by design | product rule: never auto send; drafts + tap |
| Notice debounce ("3 new drafts to approve") | 🟡 | `approval_set` exists for reminders; per-tick limits exist |

### 3.2 Phase 2 ideas (in the docs, not built)

| Idea | Source | Value for a sell-ready product |
| --- | --- | --- |
| Gmail and Microsoft 365 by OAuth | brief §5, T F048 | **High.** Most business mail is there; password IMAP is off in M365 |
| Reply drafts for `needs_reply` (general reply writing) | brief conflict #1, PRD US-005 | **High.** The most visible time saver after triage |
| Style learning: cold start from Sent (100–2000 mails), draft-diff learning | PRD US-002/018, MM A/C, HS6, HS14 | High, after reply drafts exist |
| Contacts model ("who is this to me"): trust score, relation, competence tags of delegates, auto-suggest VIP | MM 3.1/D, F notes | Medium–high; improves urgent and delegate choice |
| Web approvals, digest and delegation pages; content-minimal Telegram | roadmap Phase 2, T F075 | High for privacy and for a non-Telegram user |
| Two-way chat intents: search mail, list reminders, send reminder, new mail, correct draft ("change X to Y"), add to whitelist | PRD 3.1 intents, ES 18, HS3–HS5, AS F2 | Medium; large effort (conversation state) |
| Voice notes (STT) | PRD US-016, AS F1 | Low–medium |
| EA role: assistant reviews drafts first, `EXECUTIVE_REVIEW` push only | PRD US-017, OR B | Medium; roles exist in the data model |
| Meetings + calendar (free/busy, auto-book, pre-meeting brief) | PRD US-009, ES 11, HS9, AS F3 | Medium; needs Google/M365 OAuth first |
| Thread summary (whole thread, not one mail) | OR C, F "Context Mapping" | Medium; thread context exists in triage |
| RAG / vector search of history, few-shot from user corrections | main_overview 6.C, F | Medium; test against the eval set before building |
| Local LLM option | brief Privacy, F | Medium for privacy story; low effort behind the provider switch |
| PII sanitizer before the LLM | MM 3.5, triage v2 3.5, F | Medium for GDPR story |
| Config history (versioned settings) | MM 3.5, F | Low; audit log covers part |
| Focus / vacation mode (mute notices for a period) | AS (WhatsApp config) | Low effort; `/pause` stops processing, not only notices |
| CSV import of delegates and whitelist | UI §5 | Low effort, good onboarding |
| "Brain last updated" indicator | UI §5 | Low |
| Mobile app | brief | Low now |
| Send the edited draft from the mail client | T F043 | Medium |
| Delegate reply from another address | T F040 | Medium |
| LLM provider fallback, budget alerts | T F072, F073, F023 | Medium for reliability |
| Live updates in the panel | T F055 | Low |

### 3.3 Metrics the docs define but nothing measures

| Metric | Target | Source | State |
| --- | --- | --- | --- |
| Handled share | 80–90% | brief, PRD, ES | ❌ (F033, F042) |
| Classification accuracy | > 85% overall (ES); 98% per category for auto (architecture) | ES 5, arch §4.3 | 🟡 only notification/spam on real data |
| Urgent mail → notice | < 5 min | ES 3 | 🟡 measured once (3 min 54 s) |
| Latency per mail | < 30 s | ES 7 | 🟡 stored, not reported |
| Uptime | 99.5% | ES 6 | 🟡 heartbeat, no report |
| Delegations closed on time | 90% | ES 4 | ❌ data exists, no report |
| Time to value | < 1 h from connect to first handled mail | PRD 6 | ❌ |

## 4. Verdict

- The MVP core of the old docs is built: triage, actions, Undo, delegation with chaser, digest, Telegram, web settings. The design is better than the old specs (plan-policy-commit, no auto send, tenant-aware).
- Not all MVP ideas are built. The gaps are mostly in the **web panel** (delegates, delegation dashboard, stats, manual delegation) and the **success metric**.
- The large unbuilt part is Phase 2: OAuth providers, reply drafts, style learning, contacts model, two-way chat, calendar, EA role.
- The weakest point is not a feature. It is **proof**: the categories that carry the value (`urgent`, `needs_reply`, `delegation`, `info`) have 0–1 real labels, and S4 never ran on real mail.

## 5. Roadmap proposal (order matters)

Rule for every release: one measurable outcome, proven by the simulator (R1) and by numbers in the weekly report.

### R0 Close the open work (now, days)
- F077 stage 18 (S6a checkpoint and deploy; owner's go).
- F037, F047 part B on 2026-11-14; F047 part A (one real delegation round trip, 15 min on the phone).
- Docs agree on the boundary of section 1. Move S6b–S6f into Limen tickets; fill `spec/build.md` NEXT.

### R1 Quality lab: a simulated executive (the owner's synthetic-mail idea; highest value)
Goal: every category and every flow has measured precision and recall on realistic mail at realistic volume, without a second real mailbox.
- **Scenario generator**: a company with 10–20 personas (boss, team, delegates, clients, vendors, newsletters, systems, spammers, a phishing actor), Polish and English, threads over days, 100–200 mails a day. Each mail carries its ground-truth label (category, expected delegate, urgent reason) in a sidecar file, never in the mail.
- **Live delegates**: AgentMail persona inboxes that receive delegations and answer (done, late, other address, out of office) (F065, F066, F040).
- **Two runners**: (a) offline eval on the generated set (fast, every prompt change, in CI with a budget); (b) live run on a dedicated test mailbox through the real pipeline for a "simulated week", scored automatically (`testmail-checker` grows into a scorer).
- **Report**: per-category precision, recall, the go/no-go table, handled share, urgent latency, delegation on-time share. Same format each run, stored in `evals/results/`.
- Hard cases on purpose: injection, VIP mail that looks like spam, urgent mail with no "urgent" word, delegation with missing data, mail forwarded into a thread, Polish diacritics, HTML-only mail, attachments.
- A public business corpus (Enron, English) as a second, independent check against overfitting to own generator.
- Uses existing parts: `modules/testmail`, `evals/testmail/personas.json`, the `testmail-writer` and `testmail-checker` agents, `eval --real`.

### R2 Measure and improve the core (driven by R1)
- Handled-share line and a stats page (F033, F042, PRD US-013); urgent latency and delegation on-time in the weekly report.
- Classifier work only where R1 shows misses: folder hint (F061), few-shot examples from user corrections, thresholds per category, model choice per category.
- Goal: each value category passes go/no-go on simulated data; `notification` and `spam` pass on real data.

### R3 Finish the MVP surface (the missing MVP ideas of 3.1)
- Web: delegates page (CRUD, competence field, block own address, CSV import), delegation dashboard (filters, "send reminder"), approvals page (approve, reject, edit text), style text editor.
- Manual delegation (panel and a Telegram command) tracked like auto delegation.
- Then content-minimal Telegram becomes possible (F075).

### R4 Sell-ready platform (S6, back to full depth)
- S6b in full (public login: lockout, leaked passwords, invite, terms, sessions, mail host check). The panel can stay on Tailscale, but must be safe on the internet.
- S6c (delete, export, Polish UI), S6e (legal drafts, cost model from R1/R2 numbers), S6f (CI green, env split, restore test).
- Add: a portable deploy (a documented and once-tested install on a clean VPS from the README), user manual (HS13), status / uptime report, LLM provider fallback and budget alerts (F072, F073).
- Billing: plan state only (built); a "billing provider" port with a fake, no real account.

### R5 Reach and the next value (Phase 2, pick by R2 data)
1. Gmail + Microsoft 365 by OAuth (F048). Biggest reach gain; in "testing" mode Gmail OAuth needs no Google verification for own test users.
2. Reply drafts for `needs_reply` + style learning from Sent (cold start, draft diff).
3. Contacts model (relation, trust, competence tags; auto-suggest VIP and delegate).
4. Thread summaries, PII sanitizer, local LLM option.
5. Later: calendar and meetings, two-way chat intents, EA role, voice, mobile app.

## 6. Decisions for the owner

1. Accept the boundary of section 1 ("sell-ready, not sold") and the text of section 7 for `spec/vision.md` and `docs/product-brief.md`.
2. Accept the order R0 → R1 → R2 → R3 → R4 → R5. The main choice: R1 (quality lab) before R4 (S6b, S6c, S6e).
3. R1 needs a dedicated test mailbox (a free Interia or other IMAP account) for the live runs, so test traffic does not mix with the pilot mailbox. Yes or no.

## 7. Proposed text (owner approves)

`spec/vision.md`, "Current direction", first bullet:
> Goal (owner, 2026-11-12): a sell-ready product that is not sold. It is built, tested, documented and operated as a real product for other people, but it runs only on the owner's home VPS for the owner and test organizations. No real customer, billing account, company or lawyer. Each feature must meet the bar a paying customer would set.

`docs/product-brief.md` Q1: append
> Changed 2026-11-12: sell-ready, not sold (see `spec/vision.md`). The product must be ready for outside users; no outside user is served.

## 8. Stage name and additions (2026-11-12, second pass)

Name: **Stage 2 "Product readiness" (post-MVP)**. MVP = S0–S6a. Stage 2 = R0–R5 above plus the items below.
Exit criteria of Stage 2 (proposal): every value category passes go/no-go on the simulator; handled share ≥ 80% on a simulated week;
a clean-server install from the README works; S6b/S6c/S6f done; Gmail or M365 connect works; the release checklist passes once.

Items a real product needs that sections 1–7 did not list:

| Area | Item |
| --- | --- |
| Observability | metrics (sync lag, triage latency, queue depth, LLM errors, cost per day), error tracking, one dashboard, alert rules with runbook links |
| SLOs | write targets (urgent notice < 5 min, sync lag < 10 min, uptime 99.5%) and a weekly SLO report |
| Release process | semantic versions, changelog, release checklist, a staging stack on the VPS (second Compose project), migration rollback rule tested, one-command deploy and rollback |
| Security | threat model (STRIDE) per flow, dependency audit and update bot, secret scanning in CI, container image scan, an own pentest pass on the panel and the bot, key rotation runbook |
| Data protection | DPIA draft, records of processing, data map (which column holds personal data, its retention), breach procedure |
| Scale | load test: 10 orgs × 200 mails/day through the simulator; IMAP connection limits; LLM rate limits |
| Disaster recovery | restore drill monthly with a measured restore time; VPS-lost runbook |
| Support | in-app "report a problem", support runbook, user FAQ |
| UX quality | accessibility check (WCAG AA), empty and error states, time-to-value measure from connect to first handled mail |
| Product feedback | weekly product report (usage, handled share, corrections) as the review input for each next release |

## 9. Completeness check (2026-11-12, third pass)

Sources: the rest of `.ai/` (`features.md` notes, `ddd/szczegółowe_podsumowanie_planowania_prd.md`, `ddd/strategy.md`), a web scan of
current products (Fyxer, Superhuman, Shortwave, SaneBox, Inbox Zero (open source), Fireflies email, Briefly, Lindy; comparison pages dated 2026-07 to 2026-10),
and general product knowledge. Prices quoted are from those comparison pages.

### 9.1 Ideas in the old docs that sections 3–8 missed

| Idea | Source | Proposal |
| --- | --- | --- |
| User-defined urgency context ("what is urgent for me": people, topics, deadlines), second check step for `urgent` | ES 7 | Add to R2 (classifier) |
| Spam "to check" review: a short list of what went to spam, to catch false positives | ES 6, PRD 3.2 "silent spam log" | Add to R3 (digest or web) |
| Attachments: awareness in triage and summary (name, type, size), never sent raw to Telegram | `features.md` "obsługa załączników?" | Add to R2 |
| Lists that update from user reactions (suggest VIP, suggest blocklist), user confirms | `features.md` notes | Add to R5 contacts model |
| Pre-meeting note | `features.md`, AS F3 | Keep with calendar (R5, late) |
| Focus / vacation mode (notices only) | AS | Small; add to R3 |

### 9.2 What current products have that the plan lacks (market scan)

| Feature | Seen in | Value | Proposal |
| --- | --- | --- | --- |
| **Waiting-for-reply tracking of the user's own sent mail** ("you asked X on Monday, no answer yet"), with a follow-up draft | Fyxer, Fireflies, Inbox Zero, AI Emaily | High; same engine as delegation tracking | New epic item in R3 |
| **Commitments and action items** from threads ("you promised the offer by Friday") | Briefly, Serif | High for executives | R5, with thread summaries |
| Reply drafts ready in the thread, "To reply" label | Fyxer, Inbox Zero, Superhuman | High | Already R5 #2; move earlier (R3/R4) |
| Rules in plain language ("newsletters: archive") turned into checked rules | Inbox Zero | Medium; must compile into the existing hard rules, never free LLM actions | R5 |
| Cold-email / sales outreach detector | Inbox Zero | Medium; a sub-category of `notification`/`spam` | R2 |
| Bulk unsubscribe from newsletters (List-Unsubscribe header, one tap, approval) | Inbox Zero, SaneBox | Medium; easy win, visible | R3 |
| Phishing / suspicious mail flag (sender mismatch, look-alike domains, link checks) | Fireflies | High for trust; rule-based first | R2 |
| Snooze / defer ("show me again Monday") | SaneBox, Superhuman | Medium | R5 |
| Ask the inbox (question → answer with the source mails) | Shortwave | Medium–high; needs search index | R5, after RAG eval |
| Email digest as an alternative channel to Telegram (many users do not use Telegram); Slack later | Inbox Zero (Slack/Telegram) | High for reach | R3 |
| Near-real-time arrival (IMAP IDLE; Gmail Pub/Sub, Graph webhooks) instead of the 5-min poll | Inbox Zero | Medium; helps the < 5 min urgent target | R4 |
| Mail analytics for the user (who sends most, response times) | Inbox Zero | Low–medium | R5 |

### 9.3 Product points from general knowledge

- **Positioning.** The listed competitors support Gmail and Outlook only. This product supports any IMAP provider (Interia, WP, Onet, home.pl, own domains), Polish and English, self-hosted, EU, with tracked delegation. Write this as one positioning paragraph in the product brief; it decides priorities (for example IMAP quality before Gmail OAuth).
- **Unit economics.** Competitor prices are about $20–49 per user per month. The roadmap LLM cost is about $20 (rising to about $40) per mailbox per month at 200 mails/day. A sell-ready product needs a target cost per mailbox (for example ≤ 20% of a $25 price) and work to reach it: a cheap model for the first pass, a stronger model only for unclear mail, hard rules and sender history before the LLM, caching. Add to R2 and to the S6e cost model.
- **Model lifecycle.** LLM models are retired often. Add a model-upgrade gate: a new model or prompt passes the simulator and the real-label eval before deploy; record the model per decision (already stored) and keep a fallback provider (F072).
- **Trust UX.** Show "why" for each decision (rule hit or model reason, confidence) in the digest and the panel. Turn the shadow week into a "what I would have done" report; this is also the best demo.
- **Demo mode.** A demo organization filled by the simulator (R1). A sell-ready product needs a safe demo with no real mail.
- **Sales assets without selling.** Landing page, product docs site, public changelog, pricing page with placeholder prices, a 2-minute demo video. Cheap, and they force clear product thinking.
- **Operator console.** Organizations, plans, mailboxes and notices are CLI only. A small admin page (operator role) is part of a real product.
- **Send safety.** Rate limits per mailbox on SMTP sends, so a bug never sends many mails from the user's address.
- **GDPR rights.** Data subject requests (access, delete) also for people who are not users (the senders), not only org delete. Add to S6c.
- **PWA.** An installable web app with push notices is a cheap step before a mobile app and an alternative to Telegram.

### 9.4 What to leave out or defer (and why)

- CQRS / event sourcing and a separate audit DB (`ddd/strategy.md`): the audit log already covers the need; high cost.
- Vector DB / RAG before the simulator shows that context improves accuracy.
- Auto-booking meetings and any auto-send: against the product rule "never send without a tap".
- Voice notes and a native mobile app: low value per effort now.

### 9.5 Proposed epics (input for the decomposition session)

1. E1 Close the MVP (R0).
2. E2 Quality lab and simulator (R1), incl. demo organization.
3. E3 Measured core quality and unit cost (R2): handled share, classifier, urgency context, phishing and cold-mail detection, attachments, cost per mailbox.
4. E4 Complete the control surface (R3): delegates, delegation dashboard, approvals, spam review, unsubscribe, waiting-for-reply tracking, email digest channel, focus mode.
5. E5 Platform and trust (R4 / S6): login, delete and export, GDPR rights, legal drafts, operator console, send rate limits.
6. E6 Operations (section 8): observability, SLOs, release process, staging, DR, security reviews, IMAP IDLE.
7. E7 Reach (R5): Gmail and M365 OAuth, PWA, Slack later.
8. E8 Assistant intelligence (R5): reply drafts, style learning, contacts model, thread summaries with commitments, plain-language rules, ask the inbox, snooze.
9. E9 Go-to-market readiness without sales: positioning, landing, docs site, changelog, pricing placeholder, demo video.

## 10. Identity (SSO) and mobile app (owner ideas, 2026-11-12)

### 10.1 SSO for the panel, enforced per organization

Two different things. Keep them apart in the design:

| | Sign-in to the panel (identity) | Access to the mailbox (data) |
| --- | --- | --- |
| Protocol | OpenID Connect (Google Workspace, Microsoft Entra ID); SAML 2.0 for other identity providers (Okta and others) | OAuth 2.0 with mail scopes (Gmail API or IMAP XOAUTH2; Microsoft Graph or IMAP/SMTP XOAUTH2) |
| Question it answers | "Who is this person?" | "May the system read and change this mailbox?" |
| Token life | a session in our app | a refresh token, stored encrypted, renewed by the server |
| Epic | E5 Platform: identity | E7 Reach (F048) |

One consent screen can ask for both. They still need separate storage, separate revocation and separate error states.

Organization rules (proposal for the epic session):
- The owner verifies the organization's mail domain (a DNS TXT record).
- The owner connects an identity provider: Google Workspace or Microsoft Entra ID by OIDC first; generic OIDC and SAML later.
- Switch "SSO required": users with the verified domain sign in only through the provider. The password sign-in and the password reset are off for them.
- Just-in-time accounts: a person of the domain who signs in for the first time gets a member account with the default role (owner decides: on or off; invite-only stays the default).
- Break-glass: one owner keeps a password and a second factor, so a broken provider setup cannot lock the organization out.
- Offboarding: a user removed in the provider loses access at the next session check. SCIM (automatic provisioning and deprovisioning) comes later.
- Audit rows for every SSO setting change and every SSO sign-in.
- Users without a company identity provider (for example Interia mail users) keep password sign-in. Add a second factor (TOTP) and passkeys for them. Better Auth has a `two-factor` plugin in `node_modules`; SSO and passkeys are separate packages (`@better-auth/sso`, passkey plugin); the epic spike checks versions and fit.
- Provider facts to check in the spike: Google sensitive or restricted mail scopes need app verification for public use, and an organization admin can trust an app for the whole Workspace; Microsoft Entra needs admin consent for a multi-tenant app in many organizations.

### 10.2 Mobile app

- Goal: the phone becomes the main control channel: notices, digest, approvals, Undo, delegation status. Mail content stays out of Telegram (F075).
- Steps: (1) a PWA (installable web app, Web Push) on the existing web panel; (2) a native app (for example Expo / React Native) on the same channel-neutral API, with push through APNs and FCM, biometric unlock, approvals from the notice.
- Needs before it: web approvals and the delegation pages (E4), a stable public API with versioning, token auth for a mobile client (Better Auth has a `bearer` plugin), the public-login hardening (E5).
- Push notices carry ids and counts only; the app fetches the content over the authenticated API.
- Epic: E7 Reach (PWA) and a new E10 Mobile app (native), after E4 and E5.

## 11. Observability: logs, metrics, errors (owner idea, 2026-11-12)

### 11.1 State today (checked in code)

- `apps/server/src/platform/log.ts`: plain text lines with a `[module]` prefix to stdout and stderr (`console.log` / `console.error`). No JSON, no request or job id, no fields.
- The only store is the Docker log of the `server` container (`docker compose logs`). `deploy/compose.yaml` sets no `logging:` options, so the default `json-file` driver has no size limit and no rotation: a log flood can fill the VPS disk [check the Docker daemon config on the VPS: `/etc/docker/daemon.json`].
- Access: only by `ssh` to the VPS. No search, no dashboard, no history after a container rebuild.
- Health: `GET /health`, Healthchecks.io heartbeat, Telegram operator notices. No metrics, no error tracking.
- Good base: the rule "no address, subject or mail text in logs" exists and the audit log in Postgres holds the business events.

### 11.2 Proposal (epic E6)

1. **Structured logs**: one JSON object per line: time, level, module, message, `org_id`, `mailbox_id`, `job`, `run_id`, `request_id`, `action_id`, error code. A redaction step drops any field outside an allow-list (privacy by construction, not by care). Keep the human text mode for dev.
2. **Log store with search**, self-hosted on the VPS, reachable only over Tailscale: Grafana + Loki (or VictoriaLogs, lighter on a small host) with a collector (Grafana Alloy or Vector) that reads the Docker logs. Retention 14–30 days, set by a size and time limit. Docker log rotation (`max-size`, `max-file`) in any case.
3. **Metrics**: OpenTelemetry or a Prometheus `/metrics` endpoint (bound to the internal network): sync lag per mailbox, triage latency, queue depth, LLM calls / errors / tokens / cost per day, sends, approvals waiting, outbox failures, job run time. Grafana dashboards: "Operations", "Quality" (fed from the eval and feedback tables), "Cost".
4. **Error tracking**: GlitchTip (self-hosted, Sentry protocol) or the Sentry SDK pointed at it; server and web panel; no mail content in events.
5. **Alerts**: Grafana alert rules for the SLOs of section 8 (sync lag, urgent latency, error rate, disk, backup age), sent to the operator Telegram chat; each alert links a runbook entry in `docs/known-alerts.md`.
6. **Traces** (later): OpenTelemetry traces across sync → triage → committer → send, with the same ids.
7. **In-app view** (product feature): the operator console (E5) shows the last errors and job runs per organization; a customer sees only their own activity page, never server logs.

Decision for the epic session: Loki stack vs Victoria stack vs a hosted service (Grafana Cloud free tier). Default proposal: self-hosted, because mail metadata must not leave the host. Check the RAM budget of the VPS first.

## 12. Last completeness items (2026-11-12)

Small items that do not fit an epic above; the review decides where they go:
- Feature flags per organization (gradual roll-out of new behaviour, kill switch per feature).
- A versioned, documented public API (OpenAPI) — the mobile app (E10) and any integration need it.
- Data import on onboarding (delegates and whitelist from CSV, contacts from the Sent folder).
- Accessibility (WCAG AA) and a design system pass on the panel before E9.
- A product changelog that the panel shows ("What is new").

## 13. Open question: project documentation as current-state product knowledge (owner, 2026-11-12)

Owner idea: documentation of the whole project that always describes the **current state** of the application, so that agents (and people) get the main idea fast; perhaps written **before** the epics, and used as the product knowledge base. To decide when the epics are defined.

Facts today:
- Current state and history are mixed: `docs/architecture.md` (801 lines) holds the design, per-slice "S3 jobs", "S4 jobs" notes and decisions; `docs/roadmap.md` holds per-slice state lines; plans and logs live in `spec/features/*/plan.md` and `tasks/`. An agent must read many files to learn "what the system does now".
- No user documentation exists (manual, FAQ). No capability list ("feature X: what it does, its rules, where in code, its status").

Options for the discussion:
1. **Capability map before the epics** (small): one page per capability (sync, triage, actions and Undo, drafts and send, delegation, digest and notices, web panel, tenancy and plans, retention, backups): what it does now, the rules, the entry points in code, the limits, links to ADRs. Built from 02 §2 and the code. Gives the epic sessions an exact baseline.
2. **Documentation epic (E11)** (full): split the docs by purpose (Diátaxis: tutorial, how-to, reference, explanation): user docs (manual, FAQ, onboarding), operator docs (runbooks, deploy, alerts), developer and agent docs (architecture as current state only, modules, code patterns), product docs (capabilities, decisions). Move history out of the current-state files.
3. **Rule for every later change**: a landed feature updates its capability page in the same change (the Limen ticket's done list checks it), so the docs never drift.

Proposal (author): 1 before the epic pages, 3 from then on, 2 as its own epic with E9 (it also feeds the docs site). The owner decides in the epic session.

## 14. Optional, Stage 3 candidate: assistant agent with voice (owner, 2026-11-12)

Owner idea: a voice / AI agent in Telegram and in the mobile app, the same in both. Lowest priority; every Stage 2 epic comes first. The owner leaves the Stage 2 vs Stage 3 choice to the review.

Author view: **Stage 3**, with one Stage 2 rule that keeps the door open.
- What it is: a conversational assistant over the mailbox: ask ("what did the bank write this week?"), act ("delegate this to Anna", "remind all overdue delegates", "draft a reply: yes, Tuesday"), correct ("change Friday to Monday"), configure ("mute until Monday"). Old docs: PRD US-016/US-019 and 3.1 intents, event storming 18–19 and HS3–HS5, `.ai/architecture/ai_assistant/asistant.md` F1–F6.
- Design: one channel-neutral **assistant core** (conversation state, intent → tool calls on the same backend API the panel uses) with thin channel adapters (Telegram, mobile, web chat). Voice is a speech-to-text step in front of the same core (and optional text-to-speech back); it adds no logic of its own.
- Safety: the existing product rules apply unchanged: the LLM proposes, code checks, nothing is sent without an explicit confirmation tap; LLM text is never a recipient or a command without a check; a tool allow-list per role; prompt-injection evals for the agent (mail text reaches the agent's context).
- Why Stage 3: it needs Stage 2 parts first: the approvals and delegation API (E4), search over mail ("ask the inbox", E8), the mobile app (E10), identity and roles (E5); it is a large epic on its own (conversation state, disambiguation, many intents).
- **Stage 2 rule (cheap, important):** every new user action in E4, E5, E8 and E10 is a channel-neutral API command with a typed input and output, so the later agent calls the same commands as a tool and adds no second path.
- Privacy: audio goes to a speech-to-text provider; this is a new sub-processor (or a local model). Decide in the Stage 3 session.

## 15. Author concerns for the review (2026-11-12)

- **Size.** Stage 2 holds 10–11 epics. For one owner with agents this is many months. Give each epic a size budget and cut scope by the exit criteria, not by the idea list.
- **Owner attention.** Many decisions wait on the owner. Batch them per epic session, with defaults, as in the S6 planning ("Go with defaults").
- **Proof before breadth.** E2/E3 numbers may show that the core needs more work than the new features; the review should allow the order to change after E3.
- **Agent safety grows with features.** Reply drafts, plain-language rules and the later agent all put mail text near actions. Keep the injection eval set growing with each such epic.
