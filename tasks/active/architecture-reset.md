> **Status 2026-11-02 — in progress.** Docs done: product brief, architecture, modules, roadmap, ADR 0001–0009 (0007 = Gemini, accepted). Left: Gemini key from the user → `bun run gemini:test` passes; user review → set other ADRs to accepted; how tasks/docs are managed is decided in a separate chat (handoff `~/.pi/agent/notes/2026-11-02-handoff-docs-and-tasks.md`); then start S0 as its own task file.

# Architecture reset for email_assistant

The repo is an old project. The user returns to it and restarts it partly from scratch.
Goal: a clear architecture, a correct tech stack, better docs, and then working code.
Input: `notes/2026-11-01-docs-review-next-steps.md` (state of the docs and code, 16 conflicts).

## 1. Main idea (one paragraph)

An AI agent that does the first pass on an executive's inbox.
For each new email it does these steps: fetch → apply hard rules → classify with an LLM → plan one safe action →
apply the action (label, archive, draft, delegate) → write the reason to an audit log.
It sends the user a short report and asks for approval of risky actions.
Later it learns from the user's corrections (draft vs sent, mail moved to trash).
The product value is trust: the user can always see what the system did and why.

## 2. Questions for the user (answer before the architecture)

1. **Who uses it?** Only you / a few known people / a public SaaS product.
   This decides Gmail verification, multi-tenancy, security work and cost (see 4.3).
2. **Which mailboxes?** Personal Gmail, Google Workspace, Interia, other IMAP?
3. **First notification channel?** Telegram, email digest or WhatsApp.
4. **LLM provider and budget?** OpenAI direct, OpenRouter, Anthropic. Is mail content allowed to go to a cloud LLM?
5. **Hosting?** Own VPS (the `vps-ssh` skill exists), Supabase cloud or self-hosted Supabase.
6. **Main goal of the restart?** A tool you use every day, a portfolio / learning project, or a product to sell.

## 3. Proposed architecture (draft, depends on section 2)

### 3.1 One repo, modular monolith
Keep one repository. Use Bun workspaces:

```
apps/web/        Astro + React UI (config panel, delegations, audit view)
apps/server/     Bun backend: HTTP API + scheduler + workers (one process at the start)
packages/core/   domain types, Zod schemas, pure logic (triage rules, plans) — no I/O
supabase/        migrations, seed, generated DB types
docs/            architecture.md, decisions/ (ADRs), known-alerts.md
```

Why: one person works on it, one deploy, shared Zod schemas between UI and API.
Split into services only when one part needs to scale alone.

### 3.2 Email pipeline (the core)

```
Scheduler (every N min, per mailbox, Postgres job queue)
  → Ingest     fetch new mail with a sync cursor (Gmail historyId or IMAP UID); store raw + normalized email
  → Rules      hard rules first: whitelist never spam, blocklist, "Manual Handling" folder is skipped
  → Classify   LLM call with structured output (Zod schema), returns category + confidence + reason
  → Plan       the tool for the category returns an ExecutionPlan (data only, no side effects)
  → Policy     gate: tool switch ON?, draft-only mode?, confidence ≥ threshold?, VIP needs approval?
  → Commit     apply the plan to the mailbox, then write action_logs + domain rows; idempotent per message_id
  → Notify     urgent items now; the rest goes to the digest
```

Rules for this pipeline:
- The LLM never does side effects. It only returns data. Code decides and acts.
- Draft-only is the default. Auto-send is a later per-tool option.
- Each email is processed exactly once (unique key per mailbox + message_id, retry counter, dead letter → Manual Handling).
- Every decision has a row in `action_logs` with the reason and the rule or model that made it.
- Email text is untrusted input (prompt injection). Recipients come only from the delegates list.

### 3.3 Modules in `apps/server`
- `mail` — provider adapters (Gmail API, IMAP), sync cursor, token refresh.
- `triage` — rules, classifier, tools that build plans.
- `actions` — committer, draft-only switch, retries.
- `delegation` — delegations, chaser job.
- `reports` — digest job, notifier adapters (Telegram / email / WhatsApp).
- `config` — switches, lists, style prompt.
- `brain` (Phase 2) — cold start, draft-vs-sent diff, trust score.
- `assistant` (Phase 2) — two-way chat, intents, voice.

### 3.4 Tech stack (proposal)

| Area | Choice | Reason |
|---|---|---|
| Runtime | Bun + TypeScript (keep) | Already in the repo and in Hotshots-appbackend. |
| HTTP | Hono (replace unused Express) | Small, typed, made for Bun and edge runtimes. |
| DB | Supabase Postgres (keep) + Supabase Auth | Already set up. RLS for UI reads. |
| DB access in backend | Direct Postgres (Drizzle or `Bun.sql`) | Transactions for the committer. supabase-js has no transactions. |
| Job queue / cron | Postgres queue (pg-boss, or Supabase Queues/pg_cron) | No extra Redis service. |
| LLM | Vercel AI SDK (`ai`) + Zod structured output | One API for OpenAI / Anthropic / OpenRouter; replaces the custom `ILLMProvider`. |
| LLM observability | Langfuse (already in docs) | Trace each prompt, measure accuracy. |
| Mail | Gmail API (`googleapis`) for Gmail; `imapflow` + `mailparser` for other IMAP | Real thread ids, labels, drafts, history sync. |
| Notifications | Telegram bot first, WhatsApp later | No business verification, no template rules. |
| Frontend | Astro + React + Tailwind + shadcn (keep) | Already set up; enough for a config panel. |
| Tests | `bun test` + a labeled email set as prompt regression test | Fits Bun; catches prompt regressions. |
| Deploy | Docker on own VPS | One container for server, one for web. |

## 4. Design problems found in the current code

### 4.1 Security
- `secrets` has an RLS SELECT policy for the owner. A logged-in browser can read OAuth tokens and mail passwords.
  Fix: no client access to secrets at all; only the backend (service role) reads them; encrypt with Supabase Vault or pgcrypto.
- `secrets` belongs to `user_id`, not `mailbox_id`. Two Gmail accounts of one user cannot be told apart. Link it to the mailbox.
- Interia IMAP config uses `tls: { rejectUnauthorized: false }`. This turns off certificate checks (MITM risk).

### 4.2 Code design
- `IDatabaseProvider` is a generic CRUD wrapper with table names as strings. It has no types per table and no transactions.
  Replace it with typed repositories per module.
- `ImapEmailProvider`: no body, `threadId` = UID, fetch by sequence numbers (no sync cursor), read-only.
- `ILLMProvider.generateResponse(prompt): string` cannot return structured data.
- `backend/src/index.ts` is empty; `express`, `helmet`, `cors`, `googleapis` are unused.
- `.ai/AGENT.md` describes `IntegrationFactory` in `factory.ts`; the code has `Providers` in `get_provider.ts`.

### 4.3 External rules that shape the design (checked 2026-11-01)
- Gmail scopes that read or change mail (`gmail.readonly`, `gmail.modify`, `gmail.compose`, …) are **restricted**.
  A public app that sends this data to its servers needs OAuth verification and a security assessment (CASA).
  Sources: https://developers.google.com/workspace/gmail/api/auth/scopes ,
  https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- An OAuth app in "Testing" status gets refresh tokens that expire after 7 days.
  For personal use: re-connect each week, use a Workspace "Internal" app, or use IMAP with an app password.
  Source: https://groups.google.com/g/adwords-api/c/uWfse4UjS0E (Google Ads API support, 2024-10)
- WhatsApp Business: messages outside the 24-hour window need approved templates (not checked again today).

## 5. Plan

1. **Decisions** — the user answers section 2. Agent writes `docs/architecture.md` (one page) and short ADRs in `docs/decisions/`.
   Mark old `.ai/` specs as history; keep the PRD as product input. Timebox: 1–2 sessions.
2. **Shadow triage slice** — ingest + rules + classify + `action_logs`, no change to the mailbox. Measure accuracy on real mail.
3. **Draft-only actions** — label, archive, draft, switches, Manual Handling, retries.
4. **Digest** — daily report on the chosen channel.
5. **Delegation + chaser.**
6. **Web UI** — login, switches, lists, delegation status, audit view.
7. **Phase 2** — brain (style learning), two-way assistant, meetings, RAG.

## 6. Log
- 2026-11-01: Read all docs and code. Wrote the review note and this plan. Removed flashcard text from `.ai/tech-stack.md`.
- 2026-11-01: Read event storming + detailed PRD summary in full. Wrote `docs/product-brief.md` (decided items, 6 conflicts, Q1–Q8 with defaults). Repo origin: 10xDevs Astro starter (2025-04-06).
- 2026-11-01: User answers: SaaS for business owners/managers; pilot = user + one Gmail; MVP cut OK; Telegram first (mobile app later); no send without direct user command; minimal audit log; defaults for language/volume/LLM. Wrote `docs/architecture.md` (diagrams, data model, slices S0–S6), `docs/decisions/0001–0009`, `.ai/README.md` (history marker); updated CLAUDE.md pointers.
- 2026-11-02: User asked for a high-level overview (repo split, tech, modules). Wrote `docs/modules.md`: monorepo layout, "DB state + small workers" communication, module/sub-module catalog with owned tables and slices, web pages, status flows. Linked it from architecture.md.
- 2026-11-02: User asked about AI SDK and the S0–S6 slices, scope and size. Wrote `docs/roadmap.md` (scope in/out, slices with size and dependencies, size estimate, LLM library options). ADR 0007 under review: recommend OpenAI SDK + configurable baseURL, Langfuse later. MVP drafts = delegation + clarification only.
- 2026-11-02: User chose Google Gemini (free tier for dev). Installed `@google/genai` 2.32.0 in backend, added `backend/.env.example` (GEMINI_API_KEY, GEMINI_MODEL=gemini-3.8-flash), script `bun run gemini:test`. Rewrote ADR 0007 (accepted) and updated architecture, modules, roadmap, product brief. Billing gate: paid tier before real mail (S1).
