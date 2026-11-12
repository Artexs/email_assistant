> **Status 2026-11-02 — done.** The user decided on all findings (column "Decision"); the accepted fixes are in `docs/` and the slice files. Next: the user's ADR review (`planned/docs-and-adr-review.md`), then S0.

# Cold review of the MVP plan

Scope: `docs/product-brief.md`, `docs/architecture.md`, `docs/modules.md`, `docs/roadmap.md`, `docs/decisions/`, `tasks/planned/s0-*.md` … `s6-*.md`.
Needs: —. Handoff: `~/.pi/agent/notes/2026-11-02-handoff-mvp-plan-review.md`.

## Goal
A second agent, with no chat history, checks the MVP plan before S0 starts. It finds gaps, conflicts, wrong order, too large scope and risks.

## Done when
- The findings are in the "Findings" section below, each with a severity, the file and line, and a proposed fix.
- The user decided on each finding (accept / reject / later); accepted fixes are in `docs/` or the slice task files.

## Plan
- [x] Reviewer reads all scope files and checks them against each other and against the current code (`backend/`, `src/`).
- [x] Reviewer checks external facts that the plan depends on (Gmail scopes and verification, Gemini model and billing, Telegram Bot API), with sources. Facts and URLs: `notes/2026-11-02-external-facts-gmail-gemini-telegram.md`.
- [x] Reviewer writes the findings here. No changes to `docs/` before the user agrees.
- [x] User decides; agent applies the accepted fixes.

## Findings

Reviewer: Claude Code (claude-opus-5-5), 2026-11-02. Cold review: the reviewer did not write the plan.
Line numbers refer to commit `20c9a45`.

Severity:
- **blocker** — fix before S0 starts.
- **major** — fix before the slice that it affects starts. Else rework or risk.
- **minor** — clarity, cleanup or a small risk.

### Differences from the handoff "Current state"
- `backend/.env` already has a `GEMINI_API_KEY` value (not the placeholder). Nobody ran `bun run gemini:test` yet.
- `spec/features/done/2026-11/F011-gemini-setup/plan.md:21-24` ticks every done-checklist box. Line 18 says that nobody ran the test.
- `tasks/active/` also holds `agent-config-setup.md` (open since 2026-11-01). The handoff does not name it.
- Root `.env.example` still lists old keys: `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY`.
- All other claims match the repo. `git status` was clean at HEAD `20c9a45`.

### Summary

| ID | Severity | Finding | Fix before | Decision |
|---|---|---|---|---|
| F1 | blocker | Agents get the old code patterns during S0 | S0 | accepted, applied: `docs/code-patterns.md`, `CLAUDE.md:8` |
| F2 | major | S1 has no always-on host for one week of real mail | S1 | accepted: home VPS (Q10); slice S1a |
| F3 | major | The weekly Gmail re-connect breaks the one-week checks | S1 | dropped: IMAP, no OAuth (Q9) |
| F4 | major | The brief promises "zero retention" and "EU data"; the Gemini API gives neither | S1 real mail | accepted: Q11; ADR 0012 |
| F5 | major | No way to label, correct or undo; the success metric has no counter | S1 | accepted: architecture §4.4 |
| F6 | major | S1 has no quality bar; the S3 check cannot fail | S1 | accepted (98% bar): S1b, S3 files |
| F7 | major | The category list and "Manual Handling" differ between files | S1 | accepted: architecture §4.2 |
| F8 | major | Gmail thread and sync rules are not defined | S1 | accepted as IMAP rules: architecture §6.1 |
| F9 | major | Committer: two retry designs, and no exactly-once method for Gmail calls | S1 / S3 | accepted: architecture §4.1 rules 5–7 |
| F10 | major | Prompt injection can reach the user and the delegates as trusted text | S4 (evals in S1) | accepted: architecture §7; S4 file |
| F11 | major | Google verification comes last, but it is the longest wait | S3 | dropped for MVP: IMAP; returns with Gmail (Phase 2) |
| F12 | major | S0 is bigger than "S" and fixes tables before S1 can teach anything | S0 | accepted: S0 file; migrations per slice |
| F13 | major | Data model conflicts and gaps | each migration | accepted: architecture §5 |
| F14 | minor | RLS policies that nothing uses; append-only only by convention | S0 | changed: no Supabase; DB role `app` (ADR 0011) |
| F15 | minor | Data retention covers only the mail body | S1 | accepted: architecture §7 |
| F16 | minor | Weak done-when checks in S0, S2, S4, S6 | each slice | accepted: slice files |
| F17 | minor | The policy table is not complete | S2 | accepted: architecture §4.3 |
| F18 | minor | LLM cost and rate limits are not planned | S1 | accepted: ADR 0012 |
| F19 | minor | Telegram details | S2 | accepted: ADR 0005; architecture §6.2 |
| F20 | minor | Small conflicts between files | S0 | accepted: architecture, modules |
| F21 | minor | Before S5: check the customers' mail providers; cut the web panel | S5 | accepted: S5 file; roadmap |
| F22 | minor | Task hygiene | now | accepted: test run (503, still open); agent-config moved to `planned/` |

---

### F1 — blocker — Agents get the old code patterns during S0
- **Where:** `CLAUDE.md:8`, `.ai/AGENT.md:9-23`, `spec/features/done/2026-11/F003-s0-foundation/plan.md:13`, `CLAUDE.md:4`.
- **Problem:** `CLAUDE.md:8` imports `.ai/AGENT.md` into every agent session.
  That file tells agents to use an `IntegrationFactory` in `adapters/factory.ts` and generic adapters such as `IDatabaseProvider`.
  The new design removes them (`docs/architecture.md:287-290`). The plan rewrites the file only at the end of S0 (`s0-foundation.md:13`).
  `CLAUDE.md:4` also still says "frontend in `src/`, backend in `backend/`".
- **Why it matters:** the agent that builds S0 gets two opposite instructions. It can copy the old pattern into the new code.
- **Fix:** before S0, write a short code-patterns file from `docs/architecture.md` §3 and `docs/modules.md` §3:
  module `index.ts`, ports in the owning module, typed repositories, Zod env check, `log` util. Point `CLAUDE.md:8` to it.
  Keep the old text only as history. Update `CLAUDE.md:4` in S0, when the folders move.

### F2 — major — S1 has no always-on host for one week of real mail
- **Where:** `tasks/planned/s1-shadow-triage.md:11`, `docs/architecture.md:259-263`, `docs/roadmap.md:36-37,42`, `.claude/skills/vps-ssh/SKILL.md`.
- **Problem:** S1 is done when "one week of the user's mail is classified". This needs a server, a DB and the secrets online for a week.
  The plan has only local Supabase (S0) and the azyl server. The azyl server is "not for customer data" (`architecture.md:261`).
  Its home folder is shared with other projects and tools, so their processes can read this project's `.env`.
  EU production hosting comes only in S6 (`roadmap.md:42`).
- **Why it matters:** S1 cannot meet its done-when. Either a laptop stays on for a week,
  or the real Gmail token, `CREDENTIALS_KEY` and the Gemini key go into a shared folder.
- **Fix:** add a "pilot runtime" to S1:
  - one small EU VPS (or an EU container platform) on the user's own account;
  - a hosted Supabase project in an EU region (the free plan is enough for the pilot);
  - secrets only in that host's env; a deploy script;
  - `/health` with an external uptime check; an alert when the last good sync is older than 30 minutes.
  
  Use azyl only for demos with test data. Before S3, add backups (Supabase Pro or a daily `pg_dump`).
  From S3 on, the DB holds approvals and audit rows that Gmail does not have.

### F3 — major — The weekly Gmail re-connect breaks the one-week checks
- **Where:** `docs/product-brief.md:65`, `docs/architecture.md:215`, `docs/decisions/0004-gmail-api-first.md:9,19`, `docs/roadmap.md:80`,
  `tasks/planned/s1-shadow-triage.md:11`, `spec/features/done/2026-11/F005-s3-assist-actions/plan.md:11`.
- **Problem:** the plan accepts a weekly re-connect, because the OAuth app stays in "Testing".
  The S1 and S3 checks both need one full week. The token can expire inside that week.
  Then the system stops with no notice, because the Telegram notice comes only in S2.
- **Facts (2026-11-02, URLs in the note):**
  - "Testing" authorizations "expire seven days from the time of consent", the refresh token too.
  - An app for "personal use (fewer than 100 users)" can run without verification. Users click through the "unverified app" screen.
  - An "Internal" app of a Google Workspace organization needs no verification and has no user cap.
  - A Workspace admin can mark an app as trusted. This removes the 100-user cap and the 7-day limit for that organization.
- **Why it matters:** a weekly manual step for the pilot, gaps in the data, and a false picture of reliability.
- **Fix:**
  - (a) Pilot mailbox in Google Workspace: an Internal OAuth app in a Cloud project of that organization.
  - (b) Consumer `@gmail.com` mailbox: a separate pilot project, published ("In production"), unverified, for personal use.
    Check in S1 that its refresh token still works on day 8. Google does not say this in direct words.
  - (c) Keep a separate production project for verification. Google asks for separate dev and production projects.
  - (d) Until (a) or (b) works, S1 logs `auth_error` and the CLI shows it. S2 adds the Telegram notice.

### F4 — major — The brief promises "zero retention" and "EU data"; the Gemini API gives neither
- **Where:** `docs/product-brief.md:33,67-68`, `docs/architecture.md:238-239`, `docs/decisions/0007-llm-gemini.md:21-25`.
- **Problem:** the brief says "cloud LLM API with zero retention" (line 33) and "EU data location" (line 68).
  The chosen API (Gemini Developer API with an AI Studio key) gives neither.
- **Facts (URLs in the note):**
  - Paid tier: "Google logs prompts and responses for a limited period of time" for abuse checks.
    The period is 55 days. Google staff can review flagged content.
  - "This data may be stored transiently or cached in any country in which Google or its agents maintain facilities."
  - "If your workload requires guaranteed zero data retention or enterprise data processing agreements, use Vertex AI."
  - "You may use only Paid Services when making API Clients available to users in the European Economic Area ..."
    So the billing gate is also a rule of the terms, not only a privacy choice.
  - `@google/genai` also talks to Vertex AI (`vertexai: true`, `project`, `location`). Vertex AI has an EU multi-region endpoint.
- **Why it matters:** the privacy text is a sales promise to EU business customers.
  It is also the base for the DPA and for the privacy policy that Google verification needs.
- **Fix:**
  1. Correct the brief: pilot = Gemini API paid tier, 55-day abuse logging, no EU location. The user accepts this for their own mail.
  2. ADR 0007 is accepted, so do not edit it. Write a new ADR: "before the first external customer,
     `platform/llm.ts` uses Vertex AI with the EU endpoint and the zero-retention setup". The change stays in one file, as ADR 0007 planned.
  3. Add the Vertex AI move to the S6 done-when.
  4. Never use Grounding with Google Search on mail: Google stores that data for 30 days, with no opt-out.

### F5 — major — No way to label, correct or undo; the success metric has no counter
- **Where:** `docs/product-brief.md:11,34`, `tasks/planned/s1-shadow-triage.md:12`, `docs/architecture.md:70,134,230`.
- **Problem:**
  - S1 needs "at least 100 labeled mails". No file says who labels them, with which tool, or where the labels live.
    `evals/` holds only synthetic or anonymized cases, so real labels cannot go to git.
  - The user cannot tell the system "this was wrong", and there is no Undo.
    A search for "undo", "feedback" and "correct" in `docs/` and `tasks/planned/` finds only "undo" in the spam row (`architecture.md:134`).
  - The success metric "share of mail handled without the user, target 80–90%" (`product-brief.md:34`) has no definition and no counter.
    The old PRD had a stats view (US-013). The new plan drops it with no decision.
- **Why it matters:** trust is the product value (`product-brief.md:11`). Without corrections, the plan cannot measure accuracy on real mail.
  It cannot decide when assist mode is safe, and it cannot show the metric to a buyer.
- **Fix:**
  1. S1: a `triage_feedback` table (email, true category, source, user, time).
     A labeling CLI shows sender, subject, AI category and reason; you type the right category.
  2. S1: the sync also stores the user's label changes on `AI/*` mail as implicit feedback. Gmail history returns label changes.
  3. S2: buttons under each digest line: "✅ right" / "✏️ wrong" → category list.
  4. S3: an "↩️ Undo" button for each applied plan. The committer applies the reverse plan.
  5. Define the metric: "handled" = mail with an applied plan that the user did not undo or correct in 7 days.
     Show it in one weekly digest line.

### F6 — major — S1 has no quality bar; the S3 check cannot fail
- **Where:** `tasks/planned/s1-shadow-triage.md:10-12`, `spec/features/done/2026-11/F005-s3-assist-actions/plan.md:10-11`, `docs/roadmap.md:6`, `docs/product-brief.md:23`.
- **Problem:**
  - S1 is done when accuracy "is measured". There is no target and no rule for a bad result.
    The roadmap says S1 "can change S3–S5", but it gives no rule for how.
  - S3 is done when assist mode "runs one week without a wrong irreversible action".
    All S3 actions are reversible by design (`architecture.md:130`). So this check cannot fail.
  - The model's own confidence decides "unsure" (threshold 0.7). LLM self-scores are often not calibrated. No step checks the threshold.
- **Why it matters:** without a bar, the move from shadow to assist is a guess. A wrong archive hides mail from an executive.
- **Fix:**
  - S1 done-when: a report with precision and recall per category, on the synthetic set and on ≥ 100 real labeled mails.
    The whitelist rule = 100%. A go/no-go table for S3.
    Proposed rule: turn on archive for a category only if its precision is ≥ 98%. The user sets the value.
    Pick the confidence threshold per category from the eval data.
  - S3 done-when: in one week, at most N wrong archives, found by Undo or feedback. The user sets N.
    Every applied action has an audit row. A test stops the process between the Gmail call and the DB commit, and shows no double action (F9).

### F7 — major — The category list and "Manual Handling" differ between files
- **Where:** `docs/product-brief.md:21-24`, `docs/architecture.md:113,130-139,275`, `docs/modules.md:139,142`, `docs/roadmap.md:13-16`.
- **Problem:**
  - The brief's priority list is Urgent > VIP > Delegation > Meeting > Info > Spam (line 21).
    Line 22 of the same file says VIP "is a priority modifier, not a category".
  - The architecture adds Notification and "Needs the user / unsure".
    Meeting is Phase 2, but no file says what the MVP does with a meeting request.
  - `modules.md:142` plans a "reply" planner in S4. `roadmap.md:16` and `architecture.md:275` say "no general reply writing in MVP".
  - Brief line 24: the system "puts mail" in a write-only Manual Handling folder.
    Architecture line 139: label `AI/Manual`, and the mail "stays in Inbox". Line 113 names a separate "user's Manual Handling label".
    No file gives the label names or says if the two labels are one.
- **Why it matters:** S1 builds the Zod enum, the prompt, the eval labels and the digest sections from this list.
  A change after S1 means new labels for the whole eval set.
- **Fix:** before S1, one category table in `docs/architecture.md`; `packages/core` `Category` copies it.
  - Proposal: `urgent`, `needs_reply`, `delegation`, `info`, `notification`, `spam`, `unsure`. Meeting requests → `needs_reply` in MVP. VIP is a sender flag.
  - Give the label names. Example: `AI/Manual` = set by the system; `Manual` = set by the user, never touched.
  - Check the user's label on the thread (F8). Remove "reply" from `modules.md:142`.

### F8 — major — Gmail thread and sync rules are not defined
- **Where:** `docs/architecture.md:85-87,193,211`, `docs/modules.md:119,124`, `docs/roadmap.md:80`.
- **Problem:** the plan triages single messages, but Gmail works in threads. The sync rules are open.
  - In Gmail, a thread stays in the Inbox while any message in it has the `INBOX` label.
    If the committer archives only the new message (`messages.modify`), an older message can keep the thread in the Inbox.
  - `history.list` also returns the user's sent mail, drafts and label changes, and the system's own drafts and sent mail.
    No file gives a filter. Without one, the system can triage its own delegation mail.
  - The user's Manual label: on the message or on the thread? A new reply in a Manual thread must also stay untouched.
  - On a history 404, the plan re-syncs only 24 hours (`architecture.md:211`). After a longer stop (for example an expired token), some mail never gets triaged.
    Google: history records are "typically available for at least one week ... might be significantly shorter".
- **Why it matters:** the roadmap names Gmail sync as risk 2 (`roadmap.md:80`), but the design does not decide these points. S1 builds on them.
- **Fix:** before S1, write a "Gmail rules" section:
  - Triage only new `INBOX` messages that the mailbox owner did not send.
    Skip `SENT`, `DRAFT`, `SPAM`, `TRASH` and messages with the system's own marker header.
  - Give the LLM the last N messages of the thread as context.
  - Archive and mark-read act on the thread (`threads.modify`), and only from the plan of the newest message.
  - Check the Manual label on the thread.
  - On a 404: a full sync from `last_synced_at` (max 7 days). The unique key stops duplicates.
  - Test these rules on a test mailbox (see "Proposal", S1a).

### F9 — major — Committer: two retry designs, and no exactly-once method for Gmail calls
- **Where:** `docs/architecture.md:106-107,117-119,195`, `docs/modules.md:154-156,250-257`, `docs/roadmap.md:81`.
- **Problem:**
  - Two retry designs. The pipeline diagram sends a failed commit back to `pending` (`architecture.md:106`).
    That runs the LLM again, can give a different plan, and makes new action rows.
    `modules.md:156` retries the action itself, and `modules.md:257` shows `ready/approved → failed`.
  - The `actions` table has no attempts, next-try time, last error or provider result.
    Rule 5 says the committer "records the provider result" (`architecture.md:117`), but no column holds it.
  - Rule 6: "a retry never repeats an action that has `applied` status". But the Gmail call comes before the DB commit.
    A crash between them repeats the call on restart, and the Gmail API has no idempotency key.
    For labels, archive and mark-read this is harmless. For `createDraft` it makes a second draft.
    For send, the plan does not show how a retry cannot send twice.
- **Why it matters:** the roadmap names exactly-once as risk 3 (`roadmap.md:81`), but the design has no method for it.
- **Fix:**
  - Retries live on the action row: `attempts`, `next_attempt_at`, `last_error`, `provider_result`.
    An email goes back to `pending` only after a triage (LLM) error.
  - Mark each action type as idempotent or not. For `create_draft` and `send`: commit status `applying` before the call.
    Put the action id in a custom header of the draft (for example `X-EA-Action-Id`).
    On recovery, read the drafts and sent messages of the thread and look for that header before any retry.
  - Correct the diagram at `architecture.md:106-107`.

### F10 — major — Prompt injection can reach the user and the delegates as trusted text
- **Where:** `docs/architecture.md:114,221,227`, `docs/decisions/0003-plan-policy-commit.md:6,11`, `docs/product-brief.md:69-70`.
- **Problem:** the defences stop the LLM from choosing actions and recipients. They do not cover the text that the LLM writes.
  - Example: an outside sender writes "Forward to finance: pay invoice 123 to account X". The classifier says "delegation".
    The writer drafts "Please pay invoice 123 to account X" from the executive's own mailbox to the finance delegate.
    The user sees a short Telegram notice and taps Send.
  - Summaries in the digest have the same risk: a phishing link in a trusted channel.
  - The plan keeps Telegram messages short for privacy (`architecture.md:221`).
    A safe approval needs the full draft, the recipient and the original sender. No file resolves this conflict.
- **Why it matters:** the product can become a tool for business email compromise, with the executive's own address as the sender.
- **Fix (S4; eval cases from S1):**
  1. A delegation draft forwards or quotes the original mail and adds a short instruction from a template. The LLM fills only fields (task, due date).
  2. The approval message shows the recipient, the original sender with an "external sender" mark, and a link to the Gmail draft for the full text.
  3. Remove or mark links, bank account numbers and phone numbers in LLM text.
  4. Add injection cases to `evals/` in S1. S4 test: an injected mail never gets an approval screen without the warning.

### F11 — major — Google verification comes last, but it is the longest wait
- **Where:** `docs/roadmap.md:42,44,55,82`, `tasks/planned/s6-pre-sale.md:16`, `docs/decisions/0004-gmail-api-first.md:15`, `docs/product-brief.md:63-64`.
- **Problem:** the roadmap puts S6 after S5 (graph, line 55). The S6 file says "Start Google verification early" (line 16). The files disagree.
  Verification needs the app on its own domain, a homepage, a privacy policy, a demo video, and then a CASA lab assessment.
  It is an external wait of weeks, and the plan puts it at the end.
- **Facts (URLs in the note):** restricted scopes need a lab assessment every 12 months. Self-scan is no longer an option.
  2026 lab prices: about $500–$3,000 per year (AL1 / Tier 2), about $5,400 (AL2 / Tier 3).
  A Workspace admin can trust an unverified app for their own organization.
- **Why it matters:** the first sale waits for the slowest step, and that step starts last.
- **Fix:** split S6.
  - **S6a "verification track":** buy the domain, publish the homepage and the privacy policy early (any time after S1).
    Submit the verification after S3, when the app shows its use of `gmail.modify`. Run it in parallel with S4 and S5.
  - **S6b "sale":** sign-up, billing, deletion, EU production.
  - First business customers on Google Workspace can start before CASA ends: their admin trusts the app.
  - Add the CASA cost to the cost model (F18).

### F12 — major — S0 is bigger than "S" and fixes tables before S1 can teach anything
- **Where:** `docs/roadmap.md:6,36`, `docs/architecture.md:271`, `spec/features/done/2026-11/F003-s0-foundation/plan.md:8-13`.
- **Problem:** S0 has 9 jobs: the move to workspaces (root lint, husky and lint-staged rules point to `backend/**`), env check, logger,
  DB layer with codegen, a migration of 9 tables with RLS, local Supabase, CI, removal of the old adapters, the AGENT.md rewrite.
  This is size M, not S. The migration also fixes `emails`, `triage_results`, `actions` and `audit_log` before S1 runs.
  The roadmap says that S1 results can change later slices (line 6). F9 and F13 show open points in these tables.
- **Why it matters:** a wrong size hides the real schedule, and an early schema locks in decisions that S1 can change.
- **Fix:** S0 = workspaces + CI + env check + logger + DB layer + tenancy tables (`organizations`, `memberships`) + `GET /health`.
  Each slice adds the migration for its own tables:
  S1: mailboxes, credentials, settings, rules, emails, triage results, actions, audit, feedback;
  S2: chat links, link tokens, digests; S4: delegates, delegations. Set S0 to size M.

### F13 — major — Data model conflicts and gaps
- **Where:** `docs/architecture.md:165-205`, `docs/modules.md:172`, `docs/decisions/0007-llm-gemini.md:18`, `docs/product-brief.md:19`.
- **Problem:**
  - `mailbox_settings.digest_times` is per mailbox (line 191). Digests are per user (line 198; `modules.md:172`).
    A user with 2 mailboxes gets 2 schedules.
  - `delegates` and `sender_rules` belong to a mailbox (lines 174, 180, 192).
    An owner with many mailboxes (`product-brief.md:19`) must copy each VIP and each delegate per mailbox.
  - Missing columns: action retry state (F9); `triage_results` latency (ADR 0007 line 18 says the table stores it);
    on `emails`: direction, Gmail labels, `In-Reply-To` / `References` (F8 and the delegation reply check need them).
    `delegates` and `delegations` have no columns in any file.
  - Missing tables: Telegram link tokens (`architecture.md:218`), OAuth `state` for the connect flow (CSRF protection), `triage_feedback` (F5).
  - Before S5 there is no login, but `memberships.user_id` and `chat_links.user_id` need a user.
    No file says how the pilot user comes to exist (for example, a CLI that calls the Supabase Admin API).
- **Why it matters:** each gap becomes a migration fix and code rework in a later slice.
- **Fix:** correct `docs/architecture.md` §5 before each table's migration (F12).
  Proposal: sender rules, delegates and style text per organization (a mailbox override can come later); digest times per membership.

### F14 — minor — RLS policies that nothing uses; append-only only by convention
- **Where:** `docs/architecture.md:200-203`, `docs/decisions/0006-postgres-data-auth-queue.md:14-15,21`, `docs/decisions/0008-minimal-audit-log.md:16`.
- **Problem:** the web app reads no domain tables (ADR 0006 line 14). So membership-based RLS policies on 14 tables are code that nothing uses or tests.
  The server connects with a role that bypasses RLS. The "append-only" rule of `audit_log` is only a convention.
- **Why it matters:** untested policies give a false sense of safety, and they cost work in S0.
- **Fix:** RLS on with no policies (deny all) on every domain table. Revoke the `anon` and `authenticated` grants,
  or use a schema that the Data API does not expose. The server uses its own DB role, not `postgres`.
  That role has only INSERT and SELECT on `audit_log`. Deletion runs in one privileged function.
  Option for S6: the server also runs under RLS, with `set_config('app.org_id', …)` in each transaction.

### F15 — minor — Data retention covers only the mail body
- **Where:** `docs/architecture.md:205,240`, `docs/decisions/0008-minimal-audit-log.md:16`.
- **Problem:** only `body_text` is cleared (after 30 days). Subjects, addresses, summaries (`actions.payload`), reasons, draft text,
  `audit_log.data` and `digests.content` stay forever. A mailbox removal must delete its audit rows,
  but ADR 0008 allows DELETE only on account removal. No step revokes the Google token when a mailbox goes away.
- **Why it matters:** GDPR storage limits. CASA checks that the app can "delete user data upon request".
- **Fix:** before S1, a retention rule per column. Proposal: body 30 days; summaries and drafts 90 days;
  audit keeps ids and event names, and free text goes after 90 days. Keep mail text out of `audit_log.data`.
  On mailbox removal: revoke the token at Google, then delete the rows.

### F16 — minor — Weak done-when checks in S0, S2, S4, S6
- **Where:** `spec/features/done/2026-11/F003-s0-foundation/plan.md:10-13`, `spec/features/done/2026-11/F004-s2-telegram/plan.md:10-12`,
  `spec/features/done/2026-11/F006-s4-drafts-approvals-delegation/plan.md:10-11`, `tasks/planned/s6-pre-sale.md:10-11`.
- **Why it matters:** a check that cannot fail does not protect the slice. The agent stops at "done" too early.
- **Fix (proposed checks):**
  - S0: the server starts and `GET /health` returns 200. The env check stops the start on a missing key (test).
    `openai`, `express`, `helmet`, `cors` are not in `package.json`. One lockfile only
    (now `bun.lock` and `package-lock.json` are in the root and in `backend/`). Root `.env.example` lists only keys that the code reads.
    README says Bun, not npm.
  - S2: an update from an unlinked chat gets no reply (test). A used or old link token fails (test).
    An urgent notice comes ≤ 10 minutes after the mail arrives (5-minute sync + one tick). The digest shows "last sync HH:MM", also when it is empty.
  - S4: no code path sends without an approval row (test). Two taps send once (test). An expired approval cannot send (test).
    A delegate's reply in the thread sets the delegation to `answered`.
  - S6: Google's verification letter is in. A deletion test removes every row of an organization. The privacy policy names Google as the LLM processor.
  - S1 and S3: see F6.

### F17 — minor — The policy table is not complete
- **Where:** `docs/architecture.md:116,121-128`, `docs/modules.md:152`, `docs/decisions/0003-plan-policy-commit.md:13`.
- **Problem:** the policy gate uses "sender VIP status" and "risk". No table says what VIP changes, or which action has which risk.
  No file says if Telegram notices go out in `shadow` mode. If they do not, S2 (built before S3) has nothing to show.
- **Why it matters:** the policy gate is the safety core of ADR 0003. Each agent fills the gaps differently.
- **Fix:** one truth table in `architecture.md`: mode × action type × VIP → apply / await approval / log only.
  Proposal: notices and digests go out in every mode, because they do not change the mailbox.
  The system never archives or marks read a VIP mail automatically.

### F18 — minor — LLM cost and rate limits are not planned
- **Where:** `docs/architecture.md:15,119`, `docs/decisions/0007-llm-gemini.md:13-17,29`, `docs/modules.md:143`, `docs/roadmap.md:92`.
- **Facts (pricing page, 2026-11-02):** `gemini-3.8-flash`, paid tier, per 1M tokens: input $0.75, output $3.75 until 2026-12-31;
  **$1.50 and $7.50 from 2027-01-01**. Output includes thinking tokens. Flash-Lite: about $0.25–0.30 input, $1.50–2.50 output.
- **Estimate:** 200 mails/day, 3,000 input and 300 output tokens per mail, 30 days:
  about $20 per mailbox per month now, about $40 from 2027, about $85 with 1,000 thinking tokens per call.
  Info summaries add a second call (`modules.md:143`).
- **Problem:**
  - `architecture.md:15` says "one cheap model for classification". ADR 0007 line 17 uses the newest Flash for both roles.
  - No budget alert, no daily cap per mailbox, no cost model (LLM + CASA + hosting) for a price.
  - The first connect takes 24 hours of mail at once. Rule 7 (`architecture.md:119`) counts a 429 as one of 3 tries, then labels the mail `AI/Manual`.
    With free-tier limits, many mails can fall to `AI/Manual` at once.
- **Why it matters:** the price per mailbox doubles in two months, and a loop bug has no cap.
- **Fix:** the lowest thinking setting for `classify`; the info summary in the same structured output (one call);
  a Flash-Lite model in the S1 eval for comparison; a Cloud Billing budget alert and a daily call cap per mailbox (S1);
  a rate limiter in `platform/llm.ts`, where a 429 does not count as a try; a one-page cost model before S6.

### F19 — minor — Telegram details
- **Where:** `docs/architecture.md:153-160,217-222`, `docs/modules.md:46-47,55,181-185`, `docs/product-brief.md:69-70`.
- **Facts:** getUpdates and webhooks are "two mutually exclusive ways of receiving updates".
  The plan has the 64-byte `callback_data` limit and the secret-token header right.
- **Why it matters:** small gaps here break the dev setup or leak more mail content than the user expects.
- **Fix:**
  1. One bot token cannot do dev long polling and a server webhook at the same time. Use two bots: dev and pilot.
  2. Link tokens: one-time (planned), plus bound to one user and valid for 15 minutes.
  3. Digest lines hold subjects and AI summaries: mail content on Telegram servers. The brief says "short notices and links".
     Write down what goes to Telegram, so the user accepts it knowingly.
  4. The sequence diagram (`architecture.md:153-160`) sends the mail inside the button handler. In `modules.md:46-47` the committer job picks up `approved` actions and sends them.
     Pick one. Proposal: the handler writes `approved` and answers "⏳ Sending"; the committer sends; the notifier edits the message to "✅ Sent".

### F20 — minor — Small conflicts between files
- **Why it matters:** the next agent follows one file and breaks the other.
- **Items and fixes:**
  - `architecture.md:163` and ADR 0003 line 15: a "direct command" (for example "send a reminder to Jan") counts as approval.
    MVP Telegram has only fixed commands (`modules.md:183`; `product-brief.md:41`).
    Brief line 26 "send a reminder (one or all)": define "all" as one approval for a listed set of reminders.
  - `roadmap.md:67` lists an "action gate" job; `modules.md:33-38` has no gate job.
    Proposal: the triage worker runs the pure policy in the same transaction. Drop the status `planned` and the gate job.
  - `modules.md:250-251`: no rule says when an email with many actions becomes `done`. Proposal: when all its actions have an end status.
  - ADR 0004 line 13 names `googleapis`; `roadmap.md:75` names `@googleapis/gmail`. Proposal: `@googleapis/gmail` (smaller).
  - `product-brief.md:30` says "global test mode"; the architecture has per-mailbox modes (`architecture.md:121-128`). Use the mode names in the brief.
  - `architecture.md:230` "A prompt change must pass the eval before merge": CI then needs a paid key with a budget,
    and a rule for which file changes start the eval.
  - Old items with no decision: manual delegation (PRD US-012), the stats view (US-013, see F5),
    the "Sent folder" check for manual delegations (`.ai/notes.md:12`). Put each in Phase 2 or drop it, in writing.

### F21 — minor — Before S5: check the customers' mail providers; cut the web panel
- **Where:** `docs/product-brief.md:63-66`, `docs/roadmap.md:19,28,41`, `docs/modules.md:224-237`, `astro.config.mjs:11,17-19`, `docs/architecture.md:262`.
- **Problem:**
  - The sale depends on Gmail; Microsoft 365 is Phase 2. If most first customers use Microsoft 365 or IMAP at a local host, the MVP cannot sell to them.
  - S5 is size L with 10 pages. Approvals and digests already work in Telegram.
    The first customers need only: connect mailbox, link Telegram, settings, rules, activity.
  - Astro runs with `output: "server"` and the Node adapter: a second server and a second container. The panel is behind login and uses only the server API.
- **Why it matters:** S5 is the largest item before the sale, and part of it repeats Telegram.
- **Fix:** before S5, ask 5–10 target customers which mail they use. Then decide if Microsoft Graph comes before S6.
  Cut S5 to "S5-lite" (the 5 pages above). At the S5 start, decide on a static build that the Hono server serves (one container).

### F22 — minor — Task hygiene
- **Where:** `spec/features/done/2026-11/F011-gemini-setup/plan.md:18,21-24`, `tasks/README.md:9`, `spec/features/planned/F001-agent-config-setup/plan.md:1`.
- **Problem:** `gemini-setup.md` ticks all done-checklist boxes, but line 18 says nobody ran the test. `backend/.env` now has a key.
  `tasks/active/` has 3 files; the README says normally 1–2. `agent-config-setup.md` is open since 2026-11-01.
- **Why it matters:** the next agent trusts ticked boxes.
- **Fix:** run `cd backend && bun run gemini:test`, log the output, then move the task to `done/`.
  Close `agent-config-setup.md` or move it to `planned/`.

### What is good (keep)
- Plan → policy → commit with a pure core (ADR 0003). This is the right shape for a safe agent.
- Shadow mode first, and the billing gate before real mail.
- DB state + small workers: safe after a crash, and easy to show in the panel.
- Tenant-aware schema; encrypted credentials with a key version (ADR 0001, 0009).
- Ports for mail and chat; evals in the repo; the LLM picks delegate ids only from a given list.
- These external facts in the plan are correct: `gemini-3.8-flash` exists ("New Stable"); "Testing" tokens expire after 7 days;
  max 100 test users; `callback_data` max 64 bytes; webhook secret header.

### Proposal: changed slice plan
Why: the current order puts the longest external wait (verification) last. It has no host for the pilot,
and no feedback loop that tells when assist mode is safe. The changes keep all user decisions:
Gemini, Telegram first, Gmail first, no send without the user's approval.

| Step | Content | Done when (short) | Size | Fixes |
|---|---|---|---|---|
| Pre-S0 | Code-patterns file. The user decides F3 (OAuth project type), F4 (privacy text), F7 (categories) and reviews the ADRs | ADRs accepted; `CLAUDE.md` points to the new patterns | XS | F1, F3, F4, F7 |
| S0 Foundation | Workspaces, CI, env check, logger, DB layer, tenancy tables, `/health` | F16 S0 checks | M | F12 |
| S1a Gmail read + pilot host | Pilot OAuth project; CLI connect; encrypted tokens; sync with the Gmail rules; EU pilot host + hosted Supabase (EU); uptime alert; a test mailbox with synthetic mail (`messages.insert`, no send) | 48 h sync of the test mailbox with no loss and no duplicates; a forced 404 starts a full sync | M | F2, F3, F8 |
| S1b Shadow triage | Rules, classifier, planners, shadow policy, audit, eval runner (synthetic + injection cases), labeling CLI, feedback table, cost cap. **Billing gate, then real mail** | F6 S1 report and go/no-go table | L | F5, F6, F10, F18 |
| S2 Telegram | Linking, shadow digest with ✅/✏️ buttons, urgent notice, `auth_error` notice, "last sync" line | F16 S2 checks | M | F5, F17, F19 |
| S3 Assist actions | Committer with retries on the action row and the `applying` status; Undo button; archive only for categories that passed go/no-go | F6 S3 checks | M | F6, F9 |
| S6a Verification track (parallel from S3) | Domain, homepage, privacy policy (start after S1); submit after S3; CASA lab | Letter of Validation | external wait | F11 |
| S4 Drafts, approvals, delegation | As now + injection guards + link to the full draft in the approval | F16 S4 checks | L | F9, F10 |
| S5-lite Web panel | Login, connect mailbox, link Telegram, settings, rules, activity | Setup without the CLI; Playwright smoke | M | F21 |
| S6b Sale | Sign-up, billing, deletion, EU production, Vertex AI with the EU endpoint | The first external customer signs up | L | F4, F15 |

Order: `Pre-S0 → S0 → S1a → S1b → S2 → S3 → S4 → S5-lite → S6b`, with S6a in parallel from S3.
Milestones: **pilot MVP** = S0–S4 (the user's own mailbox, Telegram + CLI). **Sellable MVP** = pilot MVP + S5-lite + S6a + S6b.

### Questions for the user
1. Is the pilot mailbox in Google Workspace or a consumer `@gmail.com` account? (F3)
2. Do you accept the Gemini API paid tier for your own mail in the pilot: 55-day abuse logging, no EU location? (F4)
3. Where must the pilot run: a small EU VPS on your own account, or another host? (F2)
4. Is "precision ≥ 98% per category" the right bar for automatic archive? (F6)
5. Do you accept the changed slice plan, in full or in part?

### User answers (2026-11-02)
- **Pilot host (Q3):** a home VPS that runs all the time. → F2 is solved in principle.
  A home host needs no inbound port: IMAP polling and Telegram long polling use outbound connections only.
  Still open: the DB on the VPS (self-hosted Postgres / Supabase) or hosted Supabase in the EU; backups.
- **Pilot mailbox (Q1):** IMAP at Interia (`@poczta.interia.pl`), not Gmail. This changes ADR 0004 (Gmail API first).
  - Google verification and CASA do not apply to Interia. They apply only to apps that use Gmail scopes.
    → F3 and F11 drop out for the pilot. They come back only if the product later serves Gmail users.
  - F8 becomes "IMAP rules": folders instead of labels, cursor = UID + UIDVALIDITY,
    threads from `Message-ID` / `In-Reply-To` / `References`, drafts by APPEND to the Drafts folder, send by SMTP + APPEND to Sent.
  - F9 still applies: a folder MOVE gives the mail a new UID, and SMTP has no idempotency key.
    Find a moved or sent mail again by its `Message-ID`.
  - New: the IMAP password (or app password) goes into `mailbox_credentials`, encrypted (ADR 0009 stays).
    Fix the old Interia config: `tls: { rejectUnauthorized: false }` in `backend/src/adapters/get_provider.ts:35` turns off the certificate check.
  - New: check the server features on the real account before S1: IDLE, MOVE, UIDPLUS, CONDSTORE, custom keywords (for tags).
  - Interia setup: turn on "korzystam z programu pocztowego" (Ustawienia → Główne ustawienia → Parametry).
    IMAP `poczta.interia.pl:993` SSL/TLS, SMTP `poczta.interia.pl:465` SSL/TLS (pomoc.poczta.interia.pl).
- **Second answers (2026-11-02):**
  1. Q2: "ok" — the user accepts the Gemini API paid tier for the Interia mail (ADR 0012).
  2. IMAP with the mailbox password is the product's mail access for now; Google sign-in (OAuth / SSO) maybe later (ADR 0010).
     POP3 is not supported: it has no folders, no flags and no drafts.
  3. Own database on the home VPS; Compose with `server` + `db` (ADR 0011). The user asked how containers change build and test time:
     answer in `docs/architecture.md` §9 ("Containers and time").
  4. Q4 and Q5: "use your suggestion" — all findings accepted; 98% bar; changed slice plan. The verification track (S6a) is dropped
     because of IMAP; S1 is split into S1a and S1b.

## Done-checklist
- [x] Done-when checks pass (every finding has a decision; fixes listed in the "Decision" column).
- [x] `docs/` describe the accepted fixes; related ADRs updated (new 0010–0012; 0004, 0006 superseded; 0001, 0003, 0005, 0007, 0008, 0009 changed).
- [x] Learned facts are in `notes/` (`notes/2026-11-02-external-facts-gmail-gemini-telegram.md`).
- [x] Follow-up ideas are in `planned/` (`docs-and-adr-review.md` scope updated; slice files S0–S6 rewritten; new `s1a-imap-read-pilot-host.md`).

## Log
- 2026-11-02: Created. The user asked for a cold review of the MVP plan by another agent.
- 2026-11-02: Reviewer (Claude Code, claude-opus-5-5) read all scope files, the old `.ai/` docs and the code in `backend/` and `src/`.
  Checked the external facts with sources (note above). Wrote 22 findings (1 blocker, 12 major, 9 minor) and a changed slice plan.
  No change to `docs/` or the slice files.
- 2026-11-02: User answers: the pilot runs on a home VPS; the pilot mailbox is Interia IMAP, not Gmail.
  Recorded under "User answers": F3 and F11 drop out for the pilot; F8 becomes IMAP rules; 4 points still open.
- 2026-11-02: Second user answers (Gemini terms OK, IMAP with password, own Postgres in Compose, "use your suggestion").
  Applied all fixes: new ADR 0010 (IMAP first), 0011 (own Postgres, no Supabase), 0012 (LLM data and cost); 0004 and 0006 superseded;
  0001, 0003, 0005, 0007, 0008, 0009 changed; `docs/architecture.md`, `docs/modules.md`, `docs/roadmap.md` rewritten; product brief Q9–Q11;
  new `docs/code-patterns.md` + `CLAUDE.md` pointer; slice files rewritten (`s1-shadow-triage.md` → `s1b-…`, new `s1a-…`).
  Ran `cd backend && bun run gemini:test`: key accepted, model answered 503 "high demand" (alert in `docs/known-alerts.md`).
  Moved `agent-config-setup.md` to `planned/`.
