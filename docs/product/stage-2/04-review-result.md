# Cold review of the Stage 2 plan (2026-11-12)

> Reviewer: Claude Fable 5.1 (`claude-fable-5-1`), independent of the plan author (Opus 5.5). Scope: product only (features, order, epics, metrics). Architecture, documentation structure and cleanup are noted only where they change the product plan. Every finding has a severity and a proposed fix; the owner accepts or rejects each one (§6). Nothing here is decided.

Read: `README.md`, `01-review.md`, `02-inventory-and-roadmap.md`, `03-product-frame.md` (written by this review), `docs/product-brief.md`, `spec/vision.md`, `docs/roadmap.md`, `docs/architecture.md` §4, `tasks/active/s6-pre-sale.md`, `spec/build.md`, the tickets F077, F082, F033, F048, F075, F028, the code folders `apps/server/src/modules`, `apps/web/src/pages`, `evals/cases`, and the web sources in §3.

## 1. State check against the handoff

| Handoff claim | Repo today | Effect |
| --- | --- | --- |
| Last commit `cab134f` (F077 group review) | `03bc210`: F082 (S6b login hardening) stages 2 and 8 are merged; F082 is in `spec/features/active/` next to F077 | The first review's advice "defer most of S6b" is overtaken: S6b is being built. The epic for platform work must treat S6b as in progress, not as a choice |
| `docs/product/` untracked | Still untracked; also `notes/decision-docs/` is untracked (one HTML file, not part of this plan) | First commit still needs the owner's go; stage by path |
| `spec/build.md` NEXT empty (01 §3.4) | NEXT holds F082 | Minor; still no order for the other 34 planned tickets |
| Eval assets: 108 cases | 3 case files in `evals/cases/` (`synthetic`, `injection`, `delegation`) | Consistent with the handoff |
| Panel pages: onboarding, mailboxes, settings, rules, activity | Confirmed (`apps/web/src/pages`); no delegates, approvals, delegation or stats page | Confirms the 02 §3.1 gaps |

## 2. Verdict

The plan is solid on diagnosis and weak on thesis. Its best parts are right: the proof gap is the real MVP gap, the quality lab (E2) must come before more platform work, and the safety design already matches what the 2026 product literature calls best practice (approval on the exact rendered mail, undo, audit, allow-listed recipients, progressive autonomy per category).

What is missing is a product thesis that sorts the idea list. The plan collects features from Gmail-only "inbox zero" tools and spreads them evenly over ten epics. The market input (§3) points the other way: executives pay to stop dropping follow-ups and to stop carrying the inbox in their head, not to read faster. The product's own unique assets (tracked delegation with a chaser, any IMAP provider, Polish and English, self-hosted) serve exactly that job. The review therefore proposes: keep the order (close, prove, measure), restate the metrics around "nothing slips", pull the open-loop features and reply drafts forward, push copy-the-competitor items out, and size the enterprise identity and operations epics to a sell-ready minimum.

Overall: accept the plan with the changes in §4 and the epic list in §5.

## 3. What the market says (web input, 2026-11-12)

Facts from vendor pages and 2026 articles. Vendor claims are marketing; read them as "what the market promises", not as measured truth.

| Source | What it says | What it means for this plan |
| --- | --- | --- |
| Slashy, "State of Founder Email 2026" (customer conversations, 2026-09) | Founders lose 1–2 h a day to mail. The fear is dropped follow-ups, not a full inbox. The cost they name is anxiety. They want "task zero, not inbox zero": something that holds the open loops and reaches them on the channel they already use. Price $30 per user per month | Confirms the thesis in `03` §2. Waiting-for-reply and delegation tracking are the headline, not a late add-on. Telegram as the control channel is right |
| Superkind, "AI email for Mittelstand executives" (2026-04) | Five jobs: triage, summarise, draft, schedule, delegate. SME constraints: GDPR and data residency, on-prem or IMAP mail, works council. A 30-day pilot per executive: week 1 read-only classification, week 2 drafts in review, week 4 measure. Targets: 5+ h saved per week, under 2 serious mistakes per week | Confirms the shadow → assist ladder as a product feature, not only a safety step. Adds the metric "serious mistakes per week" (M3). Confirms the self-hosted IMAP niche for DE and PL SMEs |
| Zoho AgentInbox, "Human approval loops" (2026-09); Postfleet (2026-08); Koltrix (2026-11) | Approval must sit on the exact rendered mail (recipients, subject, full body, the thread it answers); any edit invalidates it. Approval fatigue makes oversight cosmetic, so autonomy must grow per task with explicit criteria. Hard send allow-lists bound the worst case | The current design already does this. The panel approvals page (E4) must show recipients, full body and the thread, and support inline edit (F039, F043). The go/no-go bar is the "explicit criteria" the literature asks for; show it in the product |
| Smashing Magazine, "Designing for agentic AI" (2026-02) | Six patterns: intent preview, autonomy dial, explainable rationale, confidence signal, action audit and undo, escalation pathway. Metric targets: undo rate < 5%, escalation 5–15% | The product has all six in code; the panel and the digest show only part (reason and confidence exist in the data but not as a user-facing "why" line). Name them as product features in E4 |
| Inbox Zero docs and site (open source, 2026) | Gmail and Outlook only. Features: "To Reply" label with a draft waiting, plain-English rules, cold-email blocker, bulk unsubscribe, analytics, Slack and Telegram chat, meeting briefs, organizations with shared rules, a "Security and AI" page. $20–25 per user per month | The IMAP niche is open. Copy only what serves the thesis: reply drafts, unsubscribe (cheap), a security-and-data page. Skip analytics, booking links, attachment filing |
| Fyxer (pricing and help pages, 2026-09/10) | $37–49 per user per month. Drafts are never sent by the tool; unused drafts expire after 14 days (1–30 configurable). Style learned from about 300 recent sent mails. Google and Microsoft verified. "Morning Briefing" and an "Actions Dashboard" | "Never auto-send" is market standard, not a weakness. Style cold start needs about 300 sent mails. A morning "needs you" brief is table stakes; the digest can become it |
| Duly, Chiefly, Fora, Serif, Multiplayer (vendor pages, 2026) | A new product class: "AI chief of staff" that tracks commitments you made, tasks you delegated, and follows up; "you approve, it chases" | Direct confirmation that delegation tracking plus commitments plus waiting-for-reply is one product, the "open-loop engine". Build it as one epic |
| commandmail.app, privacyfence.eu, email.eu (2026) | Buyers of EU mail ask three questions: who holds a copy of my mail, is it used for training, where is the processor. Self-hosted or EU processing is a buying reason | A "security and data" page with these three answers is a Stage 2 deliverable (E10). The local-LLM option is a story item, not a must |
| Microsoft Work Trend Index (2023), Grammarly/Harris (2024) | 64% of Copilot users say they spend less time processing mail; executives report 15+ h a week on mail | Background numbers only; not product-specific |

Not found (search provider rate-limited): a public benchmark for "urgent" or "needs reply" classification. The eval set stays the project's own (E2), with a public corpus as a drift check.

## 4. Findings

Severity: **H** changes the plan's direction or an epic's goal; **M** changes an epic's scope or order; **L** detail.

| # | Sev | Finding | Proposed fix | Owner default |
| --- | --- | --- | --- | --- |
| R1 | H | **No product thesis.** The plan lists features but names no job that sorts them. Market input (§3) says the job is "nothing slips", and the product's unique assets serve it | Accept `03` §2 as the filter. Each epic item must serve "nothing slips", "less time with proof" or "trust and privacy". Items that only copy Gmail tools go to the non-goals | Accept |
| R2 | H | **The main metric measures the wrong thing.** "Handled share 80–90%" counts noise removal. It does not measure a missed urgent mail or a dropped follow-up, which is what users fear | Metric set `03` §5: M1 missed important mail, M2 open loops on time, M3 serious mistakes per week as the headline; handled share stays as M4. E3 builds all of them, not only F033/F042 | Accept |
| R3 | H | **The simulator can prove the wrong thing.** One LLM writes the mail and another labels it; "urgent" has no definition except the generator's. Ground truth for urgency is relative to the user (old ES 7: "what is urgent for me") | E2 defines a persona-level **urgency context** (people, topics, deadlines) as an input to both the generator and the classifier prompt. The scorer reports precision and recall; the headline number is the false-negative rate on `urgent` and `needs_reply`. Real labels from the pilot (F028 `/review`) stay the final arbiter; a public corpus checks drift | Accept |
| R4 | M | **E4 is overloaded and mixes two things.** It holds MVP completion (delegates, dashboard, approvals) and new intelligence (waiting-for-reply, unsubscribe, digest channel). Waiting-for-reply is the highest-value new feature in the whole plan and is buried in a list of seven | Split: E4 = control surface and trust UX only. New epic **E5 Open loops** = waiting-for-reply on the user's own sent mail with a follow-up draft, commitments from threads, manual delegation, a "needs you today" brief. It reuses the delegation tracker and chaser | Accept |
| R5 | M | **Reply drafts are too late.** 02 ranks them in R5 and then notes "move earlier". Every competitor leads with them; the draft, approval and send path already exists for delegations; the marginal cost is a planner and a prompt | Own epic **E6 Reply drafts** right after E4, before OAuth providers. Style learning from Sent (about 300 mails) is a later stage of the same epic, gated by the E2 eval | Accept |
| R6 | M | **Enterprise identity is oversized for the boundary.** SSO with org enforcement, SAML, SCIM, JIT, 2FA, passkeys is a year of enterprise work for zero outside organizations. The owner wants SSO; the plan should size it | Three tiers in E7. Stage 2: OIDC with Google Workspace and Microsoft Entra, domain verification, the "SSO required" switch, break-glass owner, TOTP second factor. Later: SAML, SCIM, passkeys, JIT. Each tier is its own ticket set | Accept |
| R7 | M | **The target user is undefined, so the provider order is undecided.** "Any IMAP" is the differentiator, but business executives are mostly on Microsoft 365; Gmail OAuth for public use needs CASA ($500–5,400 a year). The market check P9 (ask 5–10 target customers) was never done, and it costs nothing but the owner's time | `03` §3 proposes: Polish or EU SME executive on own-domain IMAP, Interia, or Microsoft 365. E9 order: Microsoft 365 before Gmail; Gmail in "testing" mode only. Add "5 conversations with target executives" to E1 as an optional owner item: it is the single cheapest product input | Decide: target user text; do the 5 conversations (yes/no) |
| R8 | M | **The EA (assistant) role is a named secondary user with no epic.** The product brief names it; roles exist in the schema | Non-goal for Stage 2, written in `03` §6, with the reason (no second person uses the panel). Stage 3 with the agent | Accept |
| R9 | M | **Onboarding and the trust ladder are not a feature.** The first hour and the first week decide whether an executive keeps the tool. Shadow → "what I would have done" report → autonomy per category exists in code, but no epic turns it into a flow | E4 item: onboarding flow = connect → shadow 3–7 days → "what I would have done" report → turn on `auto` per category with its measured accuracy shown ("notification: 96% on your mail"). Also the demo for E10 | Accept |
| R10 | M | **Stage 2 is too big to be one promise.** 10–11 epics with no must/should split; the author says so in 02 §15 | Tier the epics (§5): Must, Should, Later. Stage 2 "done" = the Must tier plus the exit criteria in `03` §7. Reorder after E3 numbers | Accept |
| R11 | M | **Copy-the-competitor items dilute.** Mail analytics, snooze, cold-email detector as a feature, plain-language rules, "ask the inbox", attachment filing | Remove analytics, snooze and attachment filing from Stage 2. Cold mail becomes a sub-label of `notification`/`spam` in E3, not a feature. Plain-language rules and "ask the inbox" go to Stage 3 with the agent (they need conversation state and a search index). Bulk unsubscribe stays: cheap and visible | Accept |
| R12 | M | **Docs still disagree on the goal** (01 §3.2). `docs/product-brief.md` Q1 and `spec/vision.md` still say "SaaS for sale" and "first external customer" | E1 item: apply the 02 §7 text after the owner's OK. The capability map (02 §13 option 1) is also an E1 item, because the epic sessions need an exact baseline | Accept the 02 §7 text |
| R13 | M | **Operations epic has no product cut line.** Logs, metrics, traces, error tracking, SLOs, staging, DR, security reviews, IDLE in one epic | Stage 2 minimum: JSON logs with redaction by allow-list, Docker log rotation, one log store on the tailnet, five SLO alerts to the operator chat, release checklist, one restore drill. Metrics dashboards, error tracking, traces, staging, IDLE: Should tier | Accept |
| R14 | L | **Approval content on Telegram.** The literature asks for recipients, full body and the thread on the approval. The Telegram card shows the draft and the quoted original; the panel has no approvals page | E4 approvals page: recipients spelled out, full body, the thread, inline edit (F039, F043), approval invalid after edit. Telegram keeps the short card plus a link (F075 later) | Accept |
| R15 | L | **"Why" is stored, not shown.** `reason`, `reason_code` and confidence are in the digest and activity data, but the user sees no "why" line per decision | E4: a "why" line and a confidence mark on every digest row and activity row (explainable rationale, confidence signal) | Accept |
| R16 | L | **Unit cost has no owner.** 02 §9.3 names a target (≤ 20% of price) but no epic measures it per release | E3 owns M7: cost per mailbox per simulated week, reported in the same table as precision. S6e cost model reads this number | Accept |
| R17 | L | **PWA before any mobile work is right; keep it.** Web push with ids and counts only | No change; E9 | — |
| R18 | L | **Calendar, voice, agent: Stage 3 is right.** The Stage 2 rule "every user action is a channel-neutral API command" is the cheap door-keeper | No change; written in `03` §4 | — |

## 5. Proposed epic structure

Tiers: **Must** = Stage 2 is not done without it. **Should** = in Stage 2 if the Must tier lands and E3 numbers allow. **Later** = Stage 3 candidates.

| Id | Epic | Tier | Outcome in one line | Needs |
| --- | --- | --- | --- | --- |
| E1 | Close the MVP | Must | F077 deployed; F037, F047 A and B run; docs agree on the boundary; `spec/build.md` NEXT ordered; capability map written; optional: 5 target-executive conversations | — |
| E2 | Quality lab | Must | Simulated executive mailbox with persona urgency context and ground truth; live delegate personas; offline and live runners; scorer with precision and recall; demo organization; public corpus drift check; separate test mailbox | E1 |
| E3 | Measured core and unit cost | Must | M1–M8 measured and in the weekly report; classifier work where E2 shows misses (folder hint, thresholds, urgency context, phishing flag, attachments awareness, cold-mail sub-label); cost per mailbox per week | E2 |
| E4 | Control surface and trust UX | Must | Panel: delegates CRUD, delegation dashboard, approvals with full context and edit, "why" and confidence per row, autonomy per category with its accuracy, spam review list, onboarding trust ladder with the "what I would have done" report, bulk unsubscribe, focus mode, mail digest as an alternative channel | E1 |
| E5 | Open loops | Must | Waiting-for-reply on the user's own sent mail with a follow-up draft; commitments extracted from threads; manual delegation from panel and Telegram; "needs you today" brief as the morning digest | E3 (metrics), E4 (dashboard) |
| E6 | Reply drafts and style | Must | `needs_reply` drafts in the thread, approval and send on the existing path; `style_text` as a writing style; send the edited draft (F043); later stage: style cold start from about 300 sent mails, gated by E2 | E2, E4 |
| E7 | Platform and trust | Must (tier 1) | S6b (F082, running), S6c delete and export plus data-subject requests, S6e legal drafts and cost model, S6f CI and restore, send rate limits, operator console, feature flags per organization, identity tier 1 (OIDC Google and Microsoft, domain verification, "SSO required", break-glass, TOTP) | E1; tier 1 identity after E4 |
| E8 | Operations | Must (minimum) | JSON logs with allow-list redaction, log rotation, log store on the tailnet, five SLO alerts to the operator chat, release checklist, restore drill. Should: metrics dashboards, error tracking, traces, staging, IMAP IDLE | E1 |
| E9 | Reach | Should | Microsoft 365 OAuth first, Gmail in testing mode; PWA with web push (ids and counts); content-minimal Telegram (F075) | E7 tier 1, E4 |
| E10 | Go-to-market readiness without sales | Should | Positioning page, security-and-data page (who holds the mail, training, where processed), pricing placeholder from M7, user docs and FAQ, changelog, demo video from the E2 demo organization | E2, E3, E7 |
| E11 | Contacts and context | Should | Contacts model (relation, trust, competence tags, VIP suggestions from reactions), thread summaries, PII sanitizer or local-LLM option as the privacy story | E3, E6 |
| E12 | Native mobile app | Later | Expo app on the same API; push through APNs and FCM | E4, E7, E9 |
| — | Stage 3 | Later | Assistant agent with voice in Telegram and mobile; plain-language rules; ask the inbox; calendar and meetings; EA review flow; Slack and Teams; SAML, SCIM, passkeys | E4, E5, E6, E7, E9 |

Dependency order for the sessions: E1 → E2 → E3 → (E4 ∥ E7 ∥ E8) → E5 → E6 → E9 → E10 → E11 → E12. E4, E7 and E8 can run next to E2 and E3 because they do not depend on the simulator numbers. After E3 the owner re-reads this table: the numbers may move E6 before E5, or add classifier work.

Items removed from Stage 2 (R11): mail analytics, snooze, attachment auto-filing, cold-email detector as a feature, plain-language rules, ask the inbox, SAML and SCIM, event sourcing, vector DB, auto-booking.

## 6. Decisions for the owner (defaults in brackets; "Go with defaults" accepts all)

1. Boundary and the `02` §7 text for `spec/vision.md` and the product brief. [accept]
2. The thesis and target user in `03` §2–3: "nothing slips, on any mailbox"; Polish or EU SME executive on own-domain IMAP, Interia or Microsoft 365. [accept]
3. The metric set `03` §5 with M1–M3 as the headline. [accept]
4. The epic structure and tiers in §5, with the two new epics E5 Open loops and E6 Reply drafts. [accept]
5. Microsoft 365 before Gmail in E9. [accept]
6. A separate test mailbox for the simulator (E2). [yes]
7. Five conversations with target executives as an E1 item: the owner's time, about 30 min each. [owner's call; the review recommends yes]
8. EA role, calendar, agent and voice stay out of Stage 2. [accept]
9. Documentation: capability map in E1; the rule "a landed feature updates its capability page"; user docs and the docs site in E10. [accept]
10. Findings R1–R18: accept all, or name the ones to reject.

After the owner answers: write one page per epic in `epics/`, start `decisions.md` with PD-001 to PD-010, and run the E1 session.

## 7. Risks the review adds

- **Simulator self-confirmation.** If the same model family writes and classifies, the numbers look better than real mail. Mitigation in R3; also use a different model for the generator than for the classifier.
- **Owner attention.** Each epic session needs decisions; batch them with defaults, as here.
- **Prompt-injection surface grows** with E5 and E6: mail text reaches drafts that go to third parties. The injection eval set grows with each such epic (author concern in 02 §15, kept).
- **Cost ceiling.** M7 at $5 per mailbox per month is below the roadmap's $20 estimate. E3 must show a path (cheap first pass, hard rules and sender history before the LLM, a stronger model only for unclear mail) or the target changes.

## 8. The cut items: never, or later (owner question, 2026-11-12)

The owner asked whether the items removed in R11 and `03` §6 are unneeded now or unneeded for good.

| Item | Verdict | Why |
| --- | --- | --- |
| Auto-booking, any auto-send | Never | Breaks the rule "no send without a tap"; the market (Fyxer, Slashy) confirms "never auto-send" is standard |
| Event sourcing, CQRS, separate audit DB | Never | The audit log already gives the history; a second write path adds cost and no user value |
| Attachment auto-filing to Drive or OneDrive | Never for this product | Needs storage scopes and a second integration; not the "nothing slips" job |
| Plain-language rules | Later, Stage 3 | Good feature; it must compile into checked hard rules, never free LLM actions. That safety design belongs with the agent |
| Ask the inbox | Later, Stage 3 | Needs a search index and conversation state; the same core as the agent |
| Calendar and meetings, voice and agent, EA review flow, native mobile app, SAML and SCIM | Later, Stage 3 | Each needs Stage 2 parts first (API commands, identity tier 1, approvals pages). SAML and SCIM only when a real organization asks |
| Snooze | Later, small | Fits the "needs you today" brief (E5) once it exists; about a day of work then |
| Mail analytics | Later, only if wanted | Low value for an executive; after E3 the data exists, so a page is cheap when wanted |
| Cold-email detector | Kept as a sub-label in E3 | A feature only if the simulator shows cold mail is a large share of the inbox |
| Vector DB and RAG | Later, only if the evals show a gain | E2 tests whether more context improves accuracy before any index is built |

## 9. Size of the plan (owner question, 2026-11-12)

Unit: one Limen stage = one worker job. Baseline: the MVP (S0–S6a) = about 250 stages, 44.7k source lines (103k with tests), 14 migrations, built 2026-11-01 → 2026-11-12. Module sizes today: mail 6.7k, web 6.5k, actions 5.0k, core 4.1k, channels 3.4k, triage 3.1k, platform 2.5k, testmail 1.2k, delegation 1.1k.

| Epic | Stages | Source lines | Comparable slice | Note |
| --- | --- | --- | --- | --- |
| E1 | 10 | 1k | S0 | Docs and runs; owner: 15 min phone (F047 A), optional 2.5 h conversations |
| E2 | 28 | 7k | S4 | Largest new tool code; generation LLM cost small |
| E3 | 20 | 4k | S3 | |
| E4 | 38 | 9k | S5 | Six new panel pages and routes |
| E5 | 25 | 5k | S4 | Design change: the system starts to read Sent (today it never does, architecture §4.1 rule 1); needs an ADR |
| E6 | 14 | 2.5k | S2 | Reuses the approval and send path |
| E7 | 75 | 10k | S5 + S6 | Half is S6b–S6f as planned; identity tier 1 ≈ 15 stages |
| E8 | 12 | 1.5k | — | Config and compose; VPS RAM is the risk |
| **Must** | **~220** | **~40k** | **≈ 0.9 × MVP** | about 12 migrations |
| E9 | 40 | 6k | S5 | Two OAuth adapters, PWA, F075 |
| E10 | 12 | 2k | — | Text and pages |
| E11 | 20 | 4k | S3 | |
| **Should** | **~70** | **~12k** | **≈ 0.3 × MVP** | |
| E12 | 40+ | 8k | — | Second codebase |

Wall time: Must ≈ 2 weeks at MVP pace; 3–4 weeks with the discovery sessions and the E2/E3 gates. The owner's attention is the limit: one 1–2 h session per epic plus one VPS checkpoint per epic.
