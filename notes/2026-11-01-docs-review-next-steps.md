# Docs review and next steps (2026-11-01)

> **Superseded 2026-11-01** by `docs/product-brief.md`, `docs/architecture.md` and `docs/decisions/`. Kept as the review record.

Source: full read of `.ai/` (prd, features, tech-stack, notes, architecture/*, ddd/*, database/*), `README.md`,
`backend/README.md`, and the code in `backend/src`, `backend/supabase/migrations`, `src/`.
This note gives the current state, the conflicts in the docs, and a proposed order of work.
Nothing in this note is decided. The user must approve the decisions in section 3.

## 1. Current state

### Docs (very detailed, mostly Polish)
- Product: AI email assistant for an executive ("Prezes") and an optional EA (executive assistant).
- Modules: Orchestrator, Triage Engine + "Hard 6" tools, Mental Model ("Brain"), AI Assistant (WhatsApp, voice), Web UI.
- Most modules have two spec versions: `X.md` (v1) and `X_v2.md` (v2). v2 is newer. v1 is not marked obsolete.
- `.ai/ddd/` holds raw LLM chat output (event storming, PRD planning, DDD strategy). `domain_overview.md` is a prompt, not a result.

### Code (early bootstrap)
- `backend/src/index.ts`: empty. All lines are comments. No HTTP server, no cron, no modules.
- `backend/src/adapters/`:
  - `ImapEmailProvider`: read-only. It has `listFolders` and `fetchEmails` (envelope only).
    The body is a placeholder (`"(Body parsing requires mailparser)"`). `threadId` = IMAP UID (not a real thread id).
    No send, draft, move, label or archive operations.
  - `OpenAIAdapter`: one method `generateResponse(prompt): string`. Default model `gpt-5-nano`. No structured (JSON) output.
  - `SupabaseAdapter`: generic CRUD (select/insert/update/delete/upsert/count). No transactions or RPC.
  - `Providers` class in `get_provider.ts` (factory). Providers: GMAIL and INTERIA over IMAP with password.
  - `test_adapter.ts`: manual smoke script for IMAP.
- `googleapis`, `express`, `helmet`, `cors` are in `backend/package.json` but no code uses them.
- DB: one migration `20251202212208_create_mental_model_schema.sql`.
  Tables: users, mailboxes, secrets, categories, contacts, delegates. RLS on all of them.
  Missing tables from the specs: emails, action_logs, delegations, configurations (switches), draft audit.
- Frontend: Astro starter only (`Welcome.astro`, one shadcn `button`). No pages from the UI spec.
- No tests, no CI workflow (`.github/` has only `copilot-instructions.md`), no Dockerfile.

## 2. Conflicts between docs (and between docs and code)

| # | Topic | Conflict | Where |
|---|---|---|---|
| 1 | MVP scope | Event storming puts Cold Start (style learning) and two-way WhatsApp in Phase 2. PRD puts them in MVP (US-016, US-018, US-019, 8 intents). | `ddd/podsumowanie_event_stormingu.md` "MVP Scope" vs `prd.md` 5.4 |
| 2 | Style scan size | 100 sent emails (US-002) vs 2000 emails / 6 months (US-018, 3.3). | `prd.md` |
| 3 | Action switches | 4 switches (US-004) vs "Hard 6" tools vs triage v2 tools (Priority, Auto-Archive, no Clarification). | `prd.md`, `main_overview.md`, `triage.v2.md` |
| 4 | Vector DB / RAG | main_overview: pgvector, Vector Trainer, RAG before each classification. DB plan: "no vector DB in MVP". features: optional. | `main_overview.md`, `database/mental_model/podsumowanie.md`, `features.md` |
| 5 | Draft audit | Separate `draft_audit` table vs JSONB field in contacts and delegates. Migration uses JSONB. | `mental_model_v2.md` vs `db-plan.md` |
| 6 | Table names | `email_accounts` (orchestrator v2) vs `mailboxes` (DB plan and migration). | `orchestrator_v2.md` |
| 7 | Delegation status | `CREATED, SENT, IN_PROGRESS, COMPLETED, OVERDUE` vs `DRAFT_CREATED, SENT, IN_PROGRESS, COMPLETED`. | `orchestrator_v2.md` vs `triage.v2.md` |
| 8 | Mail transport | Specs use Gmail API (`gmail.modify`, threads, drafts, labels, history). Code uses IMAP with password (Gmail + Interia). | all specs vs `email.provider.ts` |
| 9 | LLM | Specs: OpenAI `gpt-4o`. Code: `gpt-5-nano`. `.env.example`: `OPENROUTER_API_KEY` (code does not read it). | `orchestrator_v2.md`, `openai.provider.ts`, `.env.example` |
| 10 | Tool side effects | main_overview: tools are pure, return an ExecutionPlan, one Committer applies it. triage v2: `ITriageTool.execute()` calls Gmail directly. | `main_overview.md` 6.A vs `triage.v2.md` 3.2 |
| 11 | "Manual Handling" folder | PRD: system never reads it. Mental Model maintenance reads it for feedback (trust score, few-shot examples). | `prd.md` 3.4 / US-010 vs `mental_model_v2.md` 3.2.B |
| 12 | EA role in MVP | PRD planning summary: only Prezes in MVP. PRD and orchestrator v2: EA Hand-Off in MVP. | `ddd/podsumowanie_planowania_prd.md` vs `prd.md` US-017 |
| 13 | API location | tech-stack: Astro API routes. main_overview: separate Express/Fastify server. backend has express deps. | `tech-stack.md`, `main_overview.md` |
| 14 | Runtime | README: Node 22 + npm. Repo: Bun (`bun.lock`, scripts). | `README.md` |
| 15 | Factory name | AGENT.md: `IntegrationFactory` in `adapters/factory.ts`. Code: `Providers` in `adapters/get_provider.ts`. | `.ai/AGENT.md` |
| 16 | Audit architecture | DDD strategy recommends CQRS + Event Sourcing and a separate audit DB. Other specs use one `action_logs` table. | `ddd/strategy.md` |

## 3. Decisions the user must make first

1. **MVP scope.** Recommendation: use the event-storming cut. MVP = read → classify → act (draft-only) → report.
   Move Cold Start, two-way WhatsApp, voice, Meeting tool, RAG and EA Hand-Off to Phase 2.
2. **Mail transport.** Options:
   - Gmail API with OAuth: real thread ids, labels, drafts, incremental sync (history API), push.
     Risk: `gmail.modify` / `gmail.readonly` are restricted scopes. A public app needs Google verification and a security assessment.
     For own use (test users or own Workspace) this is not necessary. Check the current Google rules before the decision.
   - IMAP/SMTP with app password (current code): works for Gmail and Interia. Weak thread support, drafts only by IMAP APPEND, passwords in DB.
   - Recommendation: keep `IEmailProvider`. Use Gmail API for Gmail. Keep IMAP for other providers.
3. **Notification channel for the first report.** WhatsApp Business API needs a Meta business account.
   Messages outside the 24-hour window need pre-approved templates (check current Meta rules).
   Recommendation: send the first daily report by email or Telegram. Add WhatsApp after the core works.
4. **LLM provider.** OpenAI direct or OpenRouter (env file suggests OpenRouter). Pick one model for classification and one for drafts.
5. **Where the API lives.** Recommendation: the Bun backend owns all logic and the API. Astro only renders UI and calls it.
6. **Side-effect model.** Recommendation: tools return an ExecutionPlan, one Committer applies it (main_overview 6.A).
   This makes draft-only mode, retries and tests simple.
7. **Audit.** Recommendation: one append-only `action_logs` table, not event sourcing, for MVP.

## 4. Proposed order of work

### Step 0 — Clean the docs (small, fast)
- Write one decisions file (for example `docs/decisions.md` or ADR files) with the answers from section 3.
- Mark v1 specs as obsolete or delete them. Keep v2 as the source.
- Fix README (Bun, scripts), `.ai/AGENT.md` (factory name), `.env.example` (all keys the code reads).
- Done on 2026-11-01: flashcard text removed from `.ai/tech-stack.md`.

### Step 1 — "Shadow triage" vertical slice (main risk: AI accuracy)
Goal: measure classification accuracy on real mail with zero risk. The system changes nothing in the mailbox.
- Migration: `emails` (mailbox_id, message_id, thread_id, processed state, retry_count) and `action_logs`.
- Email adapter: parse the body (for example `mailparser`), real Message-ID / In-Reply-To / References, fetch only new mail (UID or history id cursor).
- LLM adapter: structured output with a Zod schema (`TriageAnalysisResult` from `triage.v2.md`).
- Triage: whitelist rule first (hard rule), then LLM, then the 70% confidence threshold.
- Scheduler: one Bun process with a cron loop (every 5 min). Idempotent: one email is processed once.
- Output: only rows in `action_logs`. Then label a sample by hand and compute accuracy.
- Add Langfuse traces for each LLM call (it is in the stack docs).

### Step 2 — Actions in draft-only mode
- Gmail actions: label, move, archive, create draft. Global switch "Auto-Send/Draft" default = Draft.
- Per-tool ON/OFF switches (`configurations` table).
- Tools: Spam, Summary, Auto-Archive (notifications), Manual Handling (fallback).
- Retry with `retry_count`, then Manual Handling.

### Step 3 — Daily report
- Report cron (for example 08:00 and 16:00): counts per category, items for review.
- Channel from decision 3.

### Step 4 — Delegation
- `delegations` table (one status enum, decision from conflict 7).
- Delegation tool: pick a delegate by competence tags, create draft.
- Chaser cron: overdue delegations, check replies in the thread.

### Step 5 — Web UI (config panel)
- Supabase Auth login, switches, whitelist CRUD, delegates CRUD (competence field required), style editor, delegation status.

### Phase 2
- Mental Model: Cold Start style scan, Draft-vs-Sent diff, trust score updates.
- Two-way WhatsApp, voice (Whisper), 8 intents, EA Hand-Off.
- Meeting tool (calendar), RAG / pgvector, multi-tenant.

## 5. Technical risks the docs do not cover

- **Prompt injection.** Email bodies are untrusted input to an LLM that can create drafts and delegate tasks.
  Keep draft-only as default, use an allowlist of actions, never let email text pick recipients outside the delegates list.
- **Secrets.** `secrets.credentials` is plain JSONB. Use Supabase Vault or pgcrypto before real tokens go in.
  The backend needs the service role key to work for all users. RLS does not protect data from the backend.
- **Privacy.** Mail content goes to a third-party LLM. Decide on a zero-retention setting and the optional PII filter.
- **Job queue.** The docs mention Redis. A Postgres queue (for example pg-boss) fits Supabase and removes one service.
- **Tests.** Backend uses Bun: `bun test` is a better fit than Vitest there. Keep a labeled email set as a regression test for prompts.
- **Gmail limits.** Exponential backoff on 429 (in `triage.v2.md`), and token refresh per mailbox.
