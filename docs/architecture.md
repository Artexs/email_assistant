# Architecture — AI Email Assistant

> **Accepted 2026-11-02** (user). Revised 2026-11-02 after the cold review (`tasks/done/mvp-plan-review.md`), the user's answers and a second review of the rewrite (`tasks/done/docs-and-adr-review.md`):
> pilot mailbox = Interia over IMAP, pilot host = home VPS, own Postgres. Based on `docs/product-brief.md`.
> Decisions are in `docs/decisions/` (ADR 0001–0012). The old specs in `.ai/architecture/` are history. When they disagree with this file, this file wins.

## 1. Goals and constraints

| Driver | Consequence for the architecture |
|---|---|
| SaaS for business owners and managers | Tenant-aware data model from day one; strict tenant isolation; GDPR. |
| Trust is the product value | Every decision is logged with its reason; every mailbox change has an Undo; the user can correct each decision. |
| No send without the user's direct command | The LLM never acts. Code plans, a policy checks, a committer acts. "Send" needs an approval record. |
| Telegram first, mobile app later | One channel-neutral backend API for notices, approvals and commands. |
| IMAP + SMTP first (Interia), Gmail / Microsoft 365 later | Mail access behind a `MailProvider` port (ADR 0010). |
| Polish + English, < 200 mails/day/mailbox, small LLM budget | Polling is enough; one cheap model call per mail; cost caps (ADR 0012). |
| One developer, home VPS | One repo, one server process, two containers (`server`, `db`), no inbound port for the pilot. |

## 2. System context

```mermaid
graph LR
    Exec([Executive / owner])
    EA([Assistant - Phase 2])

    subgraph Product["AI Email Assistant (Compose on the home VPS)"]
        Server[server<br/>Bun: API + workers + scheduler + Telegram bot]
        DB[(db<br/>Postgres 17)]
        Web[Web panel - S5<br/>static build served by server]
    end

    Mail[Mail provider<br/>IMAP 993 + SMTP 465<br/>Interia first]
    TG[Telegram Bot API]
    LLM[Google Gemini API<br/>Vertex AI EU before customers]

    Exec <-->|notices, digest, buttons| TG
    Exec -->|browser, S5| Web
    EA -.-> Web
    Web -->|HTTPS + session| Server
    Server <--> DB
    Server <-->|read, move, flag, draft, send| Mail
    Server <-->|long polling| TG
    Server -->|structured output| LLM
```

All connections from the server go out. The pilot needs no inbound port until the web panel (S5).

## 3. Repository layout

One repo, Bun workspaces (ADR 0002).

```
apps/
  server/              Bun + Hono. One process: API, workers, scheduler, Telegram bot.
    src/modules/
      tenancy/         organizations, users, memberships, roles, tenant context
      mail/            MailProvider port; imap/ adapter; sync cursor; connect; credentials
      triage/          rules, classifier (LLM), planners, policy call, feedback
      actions/         committer, approvals, undo, retries
      delegation/      delegates, delegations, chaser       (S4)
      reports/         digest builder, schedule
      channels/        ChatChannel port; telegram/ adapter; chat linking
      config/          per-mailbox mode and switches, category policy, sender rules, style text
      audit/           append-only action log
    src/platform/      db, llm client, crypto, logger, env config, scheduler, http
  web/                 Web panel (S5). Talks only to the server API.
packages/
  core/                Pure TypeScript: domain types, Zod schemas, categories, rules, policy, planners, digest. No I/O.
db/migrations/         SQL migrations (source of truth)
db/roles.sql           Postgres roles (`app`, `migrator`)
deploy/                compose.yaml, Dockerfile for server, backup script
deploy/db-init/        Init script that runs `db/roles.sql` in the db container
evals/                 Eval runner + synthetic and injection cases (no real mail in git)
docs/                  product-brief.md, architecture.md, modules.md, roadmap.md, decisions/, known-alerts.md, code-patterns.md
```

Full list of modules, sub-modules, jobs and pages: `docs/modules.md`. Code rules for agents: `docs/code-patterns.md`.

Module rules:
- A module exposes one `index.ts`. Other modules import only from it.
- `packages/core` has no I/O. Business rules there are unit-tested without mocks.
- Ports (interfaces) live in the module that owns them: `MailProvider` in `mail`, `ChatChannel` in `channels`.

## 4. The email pipeline

### 4.1 Flow

```mermaid
flowchart TD
    Tick[Scheduler: every 5 min per mailbox] --> Sync[mail.sync: INBOX mail above the UID cursor]
    Sync -->|known mail back in INBOX after a system move| Ret[(emails.returned_at set)]
    Ret --> FB[triage.worker writes triage_feedback: wrong]
    Sync -->|new dedup key| Store[(emails: status = pending)]
    Store --> Claim[triage.worker: claim pending email<br/>FOR UPDATE SKIP LOCKED]
    Claim --> Rules{hard rules}
    Rules -->|blocklist| PSpam[plan: move to AI/Spam]
    Rules -->|reply in a delegation thread - S4| Answered[delegation: answered + notice]
    Answered --> Classify
    Rules -->|other| Classify[LLM: category, confidence, reason, fields, summary<br/>Zod structured output]
    Classify --> Conf{confidence at least the category threshold?}
    Conf -->|no| PManual[plan: unsure, NEEDS ACTION, move to AI/Manual only if that switch is ON]
    Conf -->|yes| Plan[planner of the category builds an ExecutionPlan]
    PSpam --> Policy
    PManual --> Policy
    Plan --> Policy{policy: pure function, same transaction}
    Policy -->|log only| Logged[(actions: logged)]
    Policy -->|apply| Ready[(actions: ready)]
    Policy -->|needs the user| Await[(actions: awaiting_approval)]
    Ready --> Commit[actions.committer: applying, then applied]
    Await -->|button tap| Approved[(actions: approved)]
    Approved --> Commit
    Await -->|reject or 48 h| Closed[(actions: rejected / expired)]
    Commit -->|error, tries left: same status, retry later| Commit
    Commit -->|3 hard errors| Failed[(actions: failed + notice)]
    Logged --> Audit[(audit_log)]
    Commit --> Audit
    Closed --> Audit
    Failed --> Audit
```

Each step that crosses a module border is a DB status change that the next worker picks up (`docs/modules.md` §2).

Pipeline rules:
1. **Hard rules before AI.** Blocklisted sender → spam, no LLM call. Whitelisted or VIP sender → the classifier gets the category list without `spam`.
   The system reads only INBOX, so mail in the user's own folders is never touched.
2. **The LLM returns data only:** category, confidence, reason code + short reason, extracted fields, a delegate id from a given list,
   and the summary for `info` mail. It never names a free-form recipient.
3. **Planners are pure.** A planner turns (email, analysis, config) into an `ExecutionPlan`. Planners live in `packages/core`.
4. **The policy decides, inside the triage transaction.** The triage worker calls the pure policy and writes actions as
   `ready`, `awaiting_approval` or `logged`. There is no separate gate job and no `planned` status. Truth table: §4.3.
5. **Only the committer changes the mailbox or sends.** It applies one action at a time.
   For a non-idempotent action (`create_draft`, `send`) it first commits status `applying`. After the call it writes
   the provider result, the audit row and the new status in one transaction.
6. **Exactly-once for mail and drafts, at-most-once for send.** Unique key per email: `(mailbox_id, dedup_key)` (§6.1).
   Each action has an idempotency key. Drafts and sent mail carry the header `X-EA-Action-Id`.
   - Idempotent actions (move, flag, mark read, save summary) go `ready → applied` and may repeat.
   - `create_draft`: after a crash in `applying`, the committer searches Drafts for the header. Found → `applied`; not found → retry.
   - `send`: before the call the committer stores the outgoing `Message-ID` in the action and commits `applying`.
     When SMTP accepts the mail (250 after DATA), the committer at once commits `applied` with the SMTP response and the audit row.
     The copy to Sent is a separate idempotent step after that (search Sent by `Message-ID`, APPEND only if missing).
     If the copy fails, the action stays `applied` and the user gets the notice "sent; no copy in Sent".
     After a crash in `applying`, or an error with an unknown stage, the committer never sends again by itself:
     it searches Sent for the header and the `Message-ID`. Found → `applied`. Not found → `failed` (reason `outcome_unknown`)
     and a notice to the user; a new send needs a new tap.
     Only an error with a known stage before DATA (connect, TLS, AUTH, MAIL FROM, RCPT TO) is safe to retry: `applying → approved`.
     How `nodemailer` reports the stage of an error is checked when S4 starts [not verified].
7. **Retries live on the row that failed.** LLM errors retry the email (`emails.attempts`); mailbox errors retry the action (`actions.attempts`).
   Soft errors wait with backoff (`next_attempt_at`) and do not count; the row keeps its status.
   Hard errors add 1 to `attempts`. After 3 hard errors: an email becomes `unsure` (reason `triage_error`);
   an action becomes `failed`, and the user gets a notice. Rule 6 wins for `send`.
   The triage worker (S1b; `triage/service.ts`, `triage/jobs.ts`, `triage/pause.ts`) applies this rule to the email as follows:
   - **Soft error** (timeout, a lost network connection, HTTP 429, 500, 502, 503, 504): the LLM client of the process pauses. The pause is 5 min.
     Each next soft or config error without a good LLM answer in between doubles it, up to 60 min. The pause is in memory and covers all mailboxes.
     The mail goes back to `pending` with `next_attempt_at` = the pause end. It gets no count. The job claims no mail during the pause.
     Claimed mail that the worker did not try keeps its old `next_attempt_at`. One `warn` line per pause.
   - **Config error** (HTTP 401, 402, 403, 404; HTTP 400 with `FAILED_PRECONDITION` or `API_KEY_INVALID`): the same pause, no count.
     One `error` line names the keys to check.
   - **Safety block** (`llm_blocked`): the mail becomes `unsure` at once. The worker writes one `llm.call` row and does not retry.
   - **Hard error** (an HTTP 400 without the two config signs, an unreadable answer, an error without an HTTP status and without a network code, or any other HTTP status that is not listed):
     the mail waits a fixed 5 min and `attempts` goes up by 1. At 3 attempts the mail becomes `unsure` (`triage_error`).
     A stale claim (`locked_at` older than 5 min) that a later run takes back also counts one attempt.
     A mail that reaches 3 attempts this way becomes `unsure` (`triage_error`) without an LLM call.
   - **Error outside the LLM call** (thread read, save, DB): the mail in work counts one try, with a 5-min wait, like a hard error.
     At 3 tries it becomes `unsure` (`triage_error`). If that save fails, the mail goes back with a count.
     Mail that the worker claimed later in the same batch goes back with no count. The error stops this mailbox only; the next mailbox runs.
   - **Shutdown:** the server waits up to 30 s for a running batch. A batch that is cut off leaves claimed mail in `processing`;
     the next start takes it back and counts one attempt for each mail.
8. **Cost limits.** The daily cap (default 300, `LLM_DAILY_CAP`) counts every LLM call attempt (`audit_log` event `llm.call`)
   per mailbox per `America/Los_Angeles` day (the quota day of the free tier). At the cap the mail goes back to `pending`
   with `next_attempt_at` = the start of the next quota day, with no count. Mail older than 7 days is not sent to the LLM: status `skipped` (reason `too_old`);
   the digest lists it as "not processed" (ADR 0012). Mail with `emails.backfilled_at` set skips the 7-day rule (one-off backfill, §6.1).

### 4.2 Categories and folders

One category per mail (Zod enum `Category` in `packages/core`). One folder per mail. Tags use IMAP keywords when the server allows them; else they live only in the DB.

| Category | Meaning | Plan in `assist` mode |
|---|---|---|
| `urgent` | Needs the user today | Flag, stays in INBOX, Telegram notice now |
| `needs_reply` | Needs the user's own answer. Meeting requests go here in MVP (meetings are Phase 2) | Stays in INBOX; digest section NEEDS ACTION |
| `delegation` (S4) | A task for a delegate | Delegation draft + `delegations` row + approval request |
| `info` | Information, no action | Summary saved; move to `AI/Info` |
| `notification` | Automatic mail from systems | Mark read; move to `AI/Notifications` |
| `spam` | Unwanted mail (blocklist or AI) | Move to `AI/Spam` (not the provider's spam folder, so Undo is easy) |
| `unsure` | Low confidence, or triage failed 3 times | Digest section NEEDS ACTION. Move to `AI/Manual` only if the switch `move_unsure` is ON (default OFF: the mail stays in INBOX) |

- **VIP** is a sender flag (`sender_rules.kind = vip`), not a category. A VIP is also whitelisted. The system never moves or marks read a VIP mail automatically.
- **`AI/Manual`** is the "Manual Handling" folder of the product brief: the system puts mail there and never reads that folder again.
- Folder names come from `mailboxes.folder_map` (per provider). The connect step creates the `AI/*` folders.
- Confidence threshold: one per category, set from the S1b eval data (start value 0.7). Stored in `mailbox_settings.category_policy`.
- `unsure` has no precision, so it has no go/no-go bar. Only the `move_unsure` switch controls its move (decision 2026-11-02, safer default).

### 4.3 Mailbox modes and the policy table

| Mode | Meaning |
|---|---|
| `shadow` (default for a new mailbox) | The system changes nothing in the mailbox. It logs what it would do and reports it. |
| `assist` | The system applies allowed actions. Send happens only after the user's approval. |

There is no auto-send mode in MVP (ADR 0003). Each action type has an ON/OFF switch per mailbox (`tool_switches`).
A category gets automatic moves only after it passes the go/no-go bar of the S1b report (default: precision ≥ 98%).
The policy returns one of three values per action: `apply`, `await_approval`, `log_only`.

| Action | `shadow` | `assist` | Sender is VIP |
|---|---|---|---|
| Telegram notice, digest line | apply | apply | apply |
| Save summary (DB only) | apply | apply | apply |
| Move to an `AI/*` folder | log only | apply if the switch is ON, the category passed go/no-go (`unsure`: only the `move_unsure` switch) and the mailbox supports moves (§6.1); else log only | log only |
| Mark read | log only | apply if the switch is ON and the category passed go/no-go; else log only | log only |
| Flag | log only | apply if the switch is ON | apply if the switch is ON |
| Create draft (APPEND to Drafts) | log only | apply if the switch is ON | apply if the switch is ON |
| Send (SMTP) | log only (never sent) | await approval; log only when its draft is log only | await approval; log only when its draft is log only |
| Undo (reverse plan) | — | apply on the user's tap | apply on the user's tap |

### 4.4 Feedback, Undo and the success metric

- **Feedback sources:** labeling CLI (S1b); ✅ / ✏️ buttons under each digest line (S2); the Undo button (S3);
  a mail that the user moves back to INBOX after a system move (§6.1); the web panel (S5).
  Every source writes a `triage_feedback` row through `triage.recordFeedback()`. A known mail is never triaged again (no loop).
- **Moved back by the user:** `mail.sync` only sets `emails.returned_at` (when the system moved the mail, §6.1).
  The triage worker turns the flag into one feedback row (verdict `wrong`, source `imap_move`) and clears `returned_at` in the same transaction.
  It writes no row when the last move is `undone` or has a reverse action in `ready`, `applying` or `applied` (the Undo is under way).
- **Undo:** the tap creates a reverse action (`reverses_action_id`) with status `ready`. The committer applies it (move back to INBOX,
  mark unread, remove the flag), then sets `emails.folder` = INBOX and the original action to `undone` in the same transaction.
  The caller (Telegram handler or API route) writes the feedback row (verdict `wrong`, source `undo`).
- **Feedback rows:** `verdict` (`right` / `wrong`) and an optional `true_category`. A row with a `true_category` counts for precision and recall.
  A row with only `wrong` counts only against the precision of the predicted category.
- **Eval on real mail:** the eval runner reads the labels from `triage_feedback` in the DB. Real labels never go to git.
  Real-mail evals use mail younger than 30 days (the body is cleared after that, §7). Pilot exception: backfilled mail up to 180 days (§6.1).
- **Success metric** ("share of mail handled without the user", target 80–90%):
  handled = mail in `spam`, `notification`, `info`, or `delegation` sent after one tap, with an applied plan
  that the user did not undo or correct within 7 days. Share = handled ÷ all triaged mail. One line in the weekly digest.

### 4.5 Approval flow (Telegram)

```mermaid
sequenceDiagram
    participant W as Triage worker
    participant DB as Postgres
    participant N as Notifier
    participant TG as Telegram
    participant U as User
    participant C as Committer
    participant M as Mail server

    W->>DB: action send = awaiting_approval, depends on its create_draft action
    N->>TG: only after the draft is applied - To, From of the original, external-sender warning, full draft text, [Send] [Reject] (callback = action id)
    U->>TG: taps [Send]
    TG->>DB: handler checks chat → user → org owns the action, then status = approved only WHERE status = awaiting_approval
    TG-->>U: answer "⏳ Sending"
    C->>DB: store the outgoing Message-ID, status = applying (own commit)
    C->>M: SMTP send with X-EA-Action-Id and the stored Message-ID
    C->>DB: at once after the 250 - status = applied + SMTP response + audit row (one transaction)
    C->>M: copy to Sent if the server does not save it (search first, APPEND if missing)
    N->>TG: edit the message to "✅ Sent" (or "✅ Sent, no copy in Sent")
```

- Before S5 the approval message shows the full draft text, because there is no web link to the draft. From S5 it shows a link to the web panel.
- A second tap finds the status changed and does nothing. An expired or rejected action cannot send.
- A `send` action has `depends_on_action_id` = its `create_draft` action. The notifier asks for approval only after the draft is `applied`.
  The policy makes the send `log_only` when its draft is `log_only`. The expiry job sets the send to `expired` (reason `draft_missing`)
  when its draft is `failed` or `undone`, and after 48 hours counted from `notified_at`.
- The send uses the text that the user approved (from the DB). Edits of the draft in the mail client do not count in MVP (Phase 2: send the edited draft).
- After the send, the committer removes the draft from Drafts when the server has UIDPLUS; else the draft stays, and the notice says so.
- Never retry a send by itself (§4.1 rule 6).
- "Send all reminders" (brief, follow-up) is one approval for a listed set of reminder actions.

### 4.6 Status flows

```
emails.status:   pending → processing → triaged → done                (done = all its actions have an end status)
                 processing → pending                                 (soft error, config error or daily cap: no count; untried claimed mail keeps its next_attempt_at)
                 processing → pending                                 (hard error with tries left: attempts + 1, next try after 5 min)
                 processing → pending                                 (error on the mailbox, for example a DB error: untried claimed mail goes back, no count)
                 processing → triaged as `unsure`                     (after 3 hard errors, reason triage_error)
                 processing → triaged as `unsure`                     (safety block, reason llm_blocked)
                 processing → processing                              (stale claim: locked_at older than 5 min, taken again by a later run;
                                                                       the take-back counts one attempt; a mail at 3 attempts ends as unsure / triage_error without an LLM call)
                 processing → skipped                                 (older than 7 days and not backfilled, reason too_old)
                 skipped → pending                                    (one-off backfill re-queue of too_old mail in the window)

actions.status:  ready → applied                                      (idempotent: move, flag, mark read, save summary)
                 ready → applying → applied                           (create_draft)
                 awaiting_approval → approved → applying → applied    (send: applied at once after the SMTP 250)
                 awaiting_approval → rejected | expired               (expired 48 h after notified_at, or draft_missing)
                 applied → undone                                     (Undo button)
                 logged                                               (policy log_only, for example shadow mode)
                 ready | approved → same status, retry later          (soft error: no count; hard error: attempts + 1)
                 applying → applied | ready                           (create_draft recovery: Drafts search)
                 applying → approved                                  (send: error with a known stage before DATA; attempts + 1)
                 applying → applied | failed                          (send recovery: Sent search, else outcome_unknown)
                 ready | approved | applying → failed                 (after 3 hard errors; notice to the user)
```

## 5. Data model (MVP, tenant-aware)

```mermaid
erDiagram
    organizations ||--o{ memberships : has
    users ||--o{ memberships : "is member"
    organizations ||--o{ mailboxes : owns
    mailboxes ||--|| mailbox_credentials : "encrypted password"
    mailboxes ||--|| mailbox_settings : "mode, switches, category policy"
    organizations ||--o{ sender_rules : "whitelist / blocklist / VIP"
    mailboxes ||--o{ emails : syncs
    emails ||--o{ triage_results : "one per attempt"
    emails ||--o{ triage_feedback : "user labels"
    emails ||--o{ actions : plans
    actions ||--o{ audit_log : records
    users ||--o{ chat_links : "Telegram chat"
    users ||--o{ chat_link_tokens : "one-time link"
    organizations ||--o{ digests : "sent reports"
    organizations ||--o{ delegates : "S4"
    emails ||--o{ delegations : "S4"
```

| Table | Key columns | Slice |
|---|---|---|
| `organizations` | id, name, timezone, data_retention_days (default 30), style_text | S0 |
| `users` | id, email, display_name (login method decided in S5, ADR 0011) | S0 |
| `memberships` | org_id, user_id, role (`owner` / `assistant`), digest_times | S0 |
| `mailboxes` | id, org_id, protocol (`imap`), address, imap_host, imap_port, smtp_host, smtp_port, status (`active` / `auth_error` / `paused`), uidvalidity, last_uid, last_synced_at, capabilities jsonb, folder_map jsonb | S1a |
| `mailbox_credentials` | mailbox_id, encrypted_secret, secret_kind (`password` / `app_password`), key_version — server only (ADR 0009) | S1a |
| `mailbox_settings` | mailbox_id, mode, tool_switches jsonb, category_policy jsonb (auto on/off + threshold per category) | S1a |
| `sender_rules` | org_id, mailbox_id (null = all mailboxes), pattern (address or domain), kind (`whitelist` / `blocklist` / `vip`) | S1b |
| `emails` | id, org_id, mailbox_id, dedup_key (unique per mailbox), message_id_header, content_hash, uid, folder, returned_at, thread_key, in_reply_to, references_header, from_address, to_addresses, cc_addresses, subject, received_at, body_text (retention), status (§4.6), skip_reason, attempts, next_attempt_at, locked_at, backfilled_at (S1b; set by the one-off backfill) | S1a |
| `triage_results` | email_id, org_id, category, vip, confidence, reason_code, reason, fields jsonb, model, prompt_version, tokens_in, tokens_out, latency_ms, created_at | S1b |
| `triage_feedback` | org_id, email_id, verdict (`right` / `wrong`), true_category (nullable), source (`cli` / `telegram` / `undo` / `imap_move` / `web`), user_id, created_at | S1b |
| `actions` | id, org_id, email_id, type, payload jsonb, status (§4.6), status_reason, attempts, next_attempt_at, locked_at, last_error (no mail text), provider_result jsonb, idempotency_key, outgoing_message_id, depends_on_action_id, reverses_action_id, notified_at, approved_by, approved_at, approved_via | S1b |
| `audit_log` | id, org_id, email_id, action_id, actor (`system` / user id), event, reason_code, data jsonb (ids, codes, numbers only), created_at — append-only. S1b events: `email.triaged`, `email.skipped`, `action.planned`, `llm.call` (`reason_code` = outcome: `ok` or the error code), `email.requeued` | S1b |
| `chat_links` | user_id, channel (`telegram`), external_chat_id, linked_at | S2 |
| `chat_link_tokens` | token_hash, user_id, expires_at (15 min), used_at | S2 |
| `digests` | org_id, user_id, period_start, period_end, content (retention), sent_at | S2 |
| `delegates` | id, org_id, name, email, competence_tags, active | S4 |
| `delegations` | id, org_id, email_id, delegate_id, action_id, task_summary, due_at, status (`drafted` → `sent` → `answered` / `overdue` → `done`), sent_message_id, last_reminder_at, answered_email_id | S4 |

Each slice adds the migration for its own tables (column "Slice"). Column names avoid SQL reserved words (`from`, `to`, `references`).

Tenancy:
- Every domain table has `org_id` (copied down for simple filters).
- The server uses its own DB role `app`. Every repository function takes a `TenantContext` and filters by `org_id`. Integration tests check this (ADR 0011).
- Roles: a plain SQL file `db/roles.sql` creates two login roles (passwords from env as `psql` variables): `migrator` owns the tables
  and runs the migrations; `app` is the server's role. The superuser (`POSTGRES_USER`) runs `db/roles.sql` once: the `db` init script on the Mac
  and the VPS, a `psql` step in CI. Migrations grant `app` its rights (default privileges for new tables; on `audit_log` only INSERT and SELECT).
  The server connects as `app`, never as `migrator` or the superuser.
- No client reads the DB directly. Option for S6: RLS for the server role with `set_config('app.org_id', …)` per transaction.

## 6. Integrations

### 6.1 Mail: IMAP + SMTP (ADR 0010)

- **Connect:** CLI `bun run mailbox:connect` (S1a), web form in S5. It asks for the address and the password (an app password if the provider has one),
  tests the IMAP and SMTP login, reads the server capabilities and the special-use folders (Drafts, Sent, Trash),
  creates the `AI/*` folders, and stores the encrypted secret. TLS certificates are always checked.
- **Sync cursor:** INBOX `UIDVALIDITY` + last UID. Every 5 minutes: fetch UIDs above the cursor. IMAP IDLE (push) can come later.
  Trap: `UID FETCH n:*` also returns the highest message when its UID is below n (RFC 3501 range rule, `*` = highest UID). Filter `uid > last_uid` in code.
- **Dedup key:** `Message-ID` + `content_hash` (hash of the `From` address, the `Date` header (else INTERNALDATE) and RFC822.SIZE).
  Mail without a `Message-ID`: the hash only.
  The same `Message-ID` with a different hash is a new mail (duplicate copies, aliases, a reused id from an outside sender).
- **Which mail is new:** a message in INBOX with a dedup key that the DB does not know. Skip it only when its `X-EA-Action-Id`
  matches an `actions` row of this mailbox (the system's own draft or sent mail). The owner's address in `From:` is not a reason
  to skip (a sender can forge it).
- **Known mail in INBOX:** if `emails.folder` ≠ INBOX (the system moved it), search that folder by `Message-ID` first.
  The mail is still there → the INBOX mail is a second identical copy: store it as a new email (dedup key + `#2`, `#3`, …) and triage it.
  The mail is gone → the user moved it back: set `emails.returned_at` and `folder` = INBOX (§4.4).
  If `emails.folder` = INBOX, update `uid` silently. In shadow mode the system moves nothing, so no flag is set. Never triage a known mail again.
- **First connect:** only INBOX mail from the last 24 hours.
- **After an outage:** the next sync takes all UIDs above the cursor (IMAP keeps them). Mail older than 7 days is stored but not sent to the LLM.
- **Backfill (S1b, one-off):** `bun run mailbox:backfill --org-id <uuid> --mailbox-id <uuid> [--days 1-180]` reads INBOX mail of the last days.
  It stores the missing mail with `emails.backfilled_at` set and never moves the cursor. It changes nothing in the mailbox.
  It refuses a window of more than 180 days. Then it re-queues real mail of the window that the worker
  skipped as `too_old` (`skipped → pending`, one `email.requeued` audit row for each mail).
  The re-queue sets `backfilled_at` = now, so re-queued mail skips the 7-day rule.
  Pilot exception (user, 2026-11-06): a window above 30 days keeps mail bodies longer than the 30-day retention (§7).
  The retention cleanup clears them when it exists.
- **UIDVALIDITY change:** rescan INBOX mail of the last 7 days; the dedup key stops duplicates; known mail only gets its new `uid`.
- **Threads:** `thread_key` = the first `Message-ID` in `References`, else `In-Reply-To`, else the mail's own `Message-ID`.
  The LLM gets the last 3 mails with the same `thread_key` from the DB as context.
- **Move:** `UID MOVE` if the server has MOVE; else `UID COPY` + `\Deleted` + `UID EXPUNGE` (needs UIDPLUS). A move gives a new UID;
  the system finds the mail again by `Message-ID` (`SEARCH HEADER Message-ID`). The committer sets `emails.folder` after each move.
  No MOVE and no UIDPLUS: the mailbox is marked "moves not supported", and the policy logs moves only
  (a plain EXPUNGE would also delete the user's own `\Deleted` mail).
- **Mark read / flag:** `\Seen` / `\Flagged`.
- **Draft:** APPEND to the Drafts folder with the `\Draft` flag and the header `X-EA-Action-Id`.
- **Send:** SMTP (`nodemailer`) with `X-EA-Action-Id`, a `Message-ID` that the committer made and stored, `In-Reply-To` and `References`.
  After the SMTP 250 the action is `applied` at once; then a copy goes to Sent (search first, APPEND if missing), but only if the server
  does not save sent mail by itself (S1a checks this at Interia). At-most-once: never retry a send by itself (§4.1 rule 6).
- **Capabilities to check per mailbox (S1a):** IDLE, MOVE, UIDPLUS, CONDSTORE, SPECIAL-USE, custom keywords (`PERMANENTFLAGS \*`), auto-save of sent mail,
  `SEARCH HEADER` on a custom `X-` header.
- **Interia facts (checked 2026-11-03, `notes/2026-11-03-interia-imap-capabilities.md`):** IDLE and UIDPLUS yes; MOVE, CONDSTORE, SPECIAL-USE and custom keywords no.
  So moves use `UID COPY` + `\Deleted` + `UID EXPUNGE`. No `UIDNEXT` on SELECT: the adapter asks `STATUS`, then uses the highest UID + 1.
  `SEARCH HEADER` finds nothing for `X-` headers and for `Message-ID` (Subject works): S3 must find moved mail another way. SMTP does not save sent mail: the committer APPENDs to `Wysłane`.
  A move keeps the UID (against RFC 3501): a mail moved back to INBOX is below the cursor, so S3 needs another "returned" check.
- **Interia setup:** the user turns on "korzystam z programu pocztowego" (Ustawienia → Główne ustawienia → Parametry).
  IMAP `poczta.interia.pl:993`, SMTP `poczta.interia.pl:465`, both SSL/TLS, login = the full address.
- **Later:** Gmail (OAuth, or an app password with 2-Step Verification) and Microsoft 365 (OAuth / Graph; password IMAP is off) as new adapters.
  Gmail OAuth needs Google verification and a yearly CASA assessment (`notes/2026-11-02-external-facts-gmail-gemini-telegram.md`).

### 6.2 Telegram (ADR 0005)
- One bot per environment: a dev bot and a pilot bot. Telegram allows only one update consumer per bot token.
- Long polling on the dev machine and on the home VPS. A webhook with the `X-Telegram-Bot-Api-Secret-Token` header only when the server has a public HTTPS address.
- Linking: the web panel (or a CLI before S5) creates a one-time token bound to one user, valid for 15 minutes.
  The user opens `t.me/<bot>?start=<token>`. The server stores the `chat_id` for that user.
- The server accepts updates only from linked chats. Inline buttons carry only the action id (`callback_data` is max 64 bytes).
- Content on Telegram: notices, digest lines (sender, subject, AI summary), draft text for approval. No raw mail bodies.
  Bot chats are not end-to-end encrypted; the user accepts this content on Telegram servers.

### 6.3 LLM (ADR 0007, ADR 0012, ADR 0013)
- Google Gemini through `@google/genai`, only inside `platform/llm.ts`. Model ids from config: `GEMINI_MODEL` (writer role, S4; dev: `gemini-3.8-flash`),
  `GEMINI_MODEL_CLASSIFIER` (default `gemini-3.5-flash-lite`). Two roles: `classifier` (one call per mail, summary included) and `writer` (drafts, S4).
- **Classifier model (provisional, stage 34, 2026-11-05):** `gemini-3.5-flash-lite`. The eval on the 92 synthetic and injection cases ran with it:
  91 cases answered (1 `http_503`), whitelist 12/12, injection 12/12, hard rules 6/6. Precision was 76.5% for `info` and 84.2% for `spam`,
  so no category reaches the 98% bar yet. The comparison with `gemini-3.8-flash` (stage 36) was dropped after the OpenAI switch.
  The model choice lives here and not in ADR 0013.
- **Real-mail result (S1b stage 40, 2026-11-06):** 123 labeled real pilot mails (Gemini 36, `gpt-6-luna` 87). Every category is no-go:
  notification 96.2%, spam 83.6% precision; urgent, needs_reply and info have 1 kept row each. The pilot VPS uses OpenAI `gpt-6-luna` since 2026-11-06.
  Detail: `tasks/done/s1b-shadow-run.md` "Results".
- Structured output: JSON schema from the Zod schema in `packages/core`; the result is checked with Zod again.
- Each call: timeout 30 s (`GEMINI_TIMEOUT_MS`); a rate limiter keeps calls under `GEMINI_RPM` (default 12) in this process.
  Simple calls: no `temperature` and no thinking setting; each model uses its default thinking (`gemini-3.5-flash-lite` defaults to minimal, Google thinking page, read 2026-11-04).
  Error classes (soft, config, safety block, hard) and the pause: §4.1 rule 7.
- `triage_results` stores model, prompt version, tokens in/out and latency. Output tokens include thinking tokens.
- **Triage config keys:** `TRIAGE_LLM_SCOPE` (default `off`): `off` = no triage worker; `synthetic` = only the seeded test mail of every mailbox;
  `all` = also real mail, only of the mailbox `TEST_MAILBOX_ADDRESS`. The server refuses to start with `synthetic` or `all` and no `GEMINI_API_KEY`,
  and with `all` and no `TEST_MAILBOX_ADDRESS`. `LLM_DAILY_CAP` (default 300): the cap of §4.1 rule 8.
  `GEMINI_RPM` (default 12). The LLM pause (§4.1 rule 7) has no key: 5 min, doubling to 60 min.
- **Data by stage:** pilot = Gemini API free tier for the temporary pilot mailbox (ADR 0013; the free-tier terms allow human review and training;
  accepted by the user 2026-11-04); the paid tier (55-day abuse logging, no EU location, accepted 2026-11-02) when billing goes on.
  Vertex AI with the EU endpoint and its zero-data-retention setup before the first external customer.
- **Billing gate:** free tier only with test data. The temporary pilot Interia mailbox counts as test data (ADR 0013, user 2026-11-04).
  Cloud Billing (or Vertex AI) on before any other person's mail.
- `evals/` holds synthetic and injection cases. A prompt or model change must pass the eval before merge (§9).

## 7. Security and privacy

- **Credentials (ADR 0009):** AES-256-GCM in the server, key `CREDENTIALS_KEY` from env with a key version. The secret is decrypted only in memory.
  It never goes to logs, to the web app or to Telegram. Prefer an app password: the stored secret opens the whole mailbox.
- **TLS:** IMAP and SMTP always check certificates.
- **Tenant isolation:** `TenantContext` in every server query; DB role `app` without superuser rights; tests for the filters (ADR 0011).
- **Untrusted text in and out.** Mail text is untrusted, and so is text that the LLM writes from it.
  - The email goes into a marked data block; the output schema has enums and ids only; the policy checks every action.
  - Delegation drafts quote the original mail and add an instruction from a template. The LLM fills only fields (task, due date).
  - Links, bank account numbers and phone numbers in LLM text are removed or marked.
  - The approval message shows the recipient, the original sender with an "external sender" warning, and the full draft (§4.5).
  - `evals/` has prompt-injection cases from S1b; S4 has a test that an injected mail never reaches approval without the warning.
- **Logs:** no mail bodies, no passwords, no keys.
- **Retention:**

  | Data | Where | Kept |
  |---|---|---|
  | Mail body text | `emails.body_text` | 30 days (`organizations.data_retention_days`) |
  | Subject, addresses | `emails` | 90 days, then cleared (the row stays for counts) |
  | Summaries, draft text, reasons, extracted fields | `actions.payload`, `triage_results.reason`, `triage_results.fields` | 90 days |
  | Task text | `delegations.task_summary` | 90 days after the delegation is `done`, or 90 days after its last change |
  | Error text | `actions.last_error` | 90 days (and no mail text in it) |
  | Digest text | `digests.content` | 90 days |
  | Audit events (ids, codes, numbers) | `audit_log` | until the mailbox or organization is removed |
  | Labels (no mail text) | `triage_feedback` | until the mailbox or organization is removed |

- **Delete:** removing a mailbox deletes the mailbox, its credentials, settings, mailbox-scoped sender rules, emails, results, feedback,
  actions, delegations and audit rows, and clears `digests.content` of the organization (digests mix mailboxes) — one privileged function.
  Then it tells the user to change the mailbox password.
  Removing an organization deletes everything.
- **Privacy by stage:**

  | | Pilot (the user's own mail) | External customers (S6) |
  |---|---|---|
  | LLM | Gemini API free tier for the temporary pilot mailbox (ADR 0013: human review and training allowed by the free-tier terms, accepted). Paid tier (55-day abuse logging, no EU location) when billing goes on | Vertex AI EU endpoint; zero-data-retention setup |
  | Server + DB | home VPS of the user | hosted EU VPS |
  | Papers | — | Privacy policy names Google as processor; DPA with Google |

## 8. Reliability and operations

- **Scheduler** (in the server process, `croner`, one tick never overlaps the next): mail sync every 5 min per mailbox;
  triage worker, committer and notifier every 15 s; digest at each member's times (organization timezone); approval expiry hourly;
  retention cleanup daily; chaser daily (S4).
- **Work queue:** `emails` and `actions` rows with `status`, `attempts`, `next_attempt_at`, `locked_at`, claimed with `FOR UPDATE SKIP LOCKED`.
- **Mailbox errors:** IMAP/SMTP login error → mailbox `auth_error`, a Telegram notice, other mailboxes continue. Connection errors → backoff.
- **Liveness:** the server sends a heartbeat every 5 min to Healthchecks.io (`HEARTBEAT_URL`, outbound only; period 5 min, grace 10 min, email alert). The service alerts when heartbeats stop.
  A Telegram admin notice goes out when the last good sync is older than 30 min. Every digest shows "last sync HH:MM", also when it is empty.
- **`GET /health`:** DB reachable, last good sync per mailbox.
- **Backups:** `deploy/backup.sh` at 03:30 every night: `pg_dump`, encrypted with `age` (only the public key on the VPS), copied with `rclone` to a
  Backblaze B2 bucket with a write-only key; remote retention is a bucket lifecycle rule. `deploy/restore-test.sh` on the Mac; one restore test per month.
- **Logging:** `log` util with levels and a `[module]` prefix.

## 9. Testing

- **Unit** (`bun test`, `packages/core`): categories, rules, policy, planners, digest. Pure, no mocks, no containers.
- **Integration** (`apps/server/test/integration/`): repositories and tenant filters against Postgres in a container. Start the container once; a normal test runs in a transaction that rolls back.
  Tests that need several connections (`SKIP LOCKED` claims, the crash tests of S3 and S4) use a fresh schema or truncate the tables.
- **Mail adapter:** contract tests — the fake `MailProvider` and the IMAP adapter pass the same suite.
  CI runs the IMAP adapter against a local mail-server container (for example GreenMail). Check that it has the same extensions as Interia.
- **Test mailbox:** there is no second Interia account; the pilot mailbox is the test mailbox (user 2026-11-04). A seed script APPENDs the synthetic eval mails
  (`@ea-seed.test` Message-IDs) into its INBOX (APPEND does not send). Use them for the eval and the 48-hour sync test (S1a).
- **Evals** (`evals/`): synthetic and injection cases in git; real labels only in the DB. Report per category: precision and recall; whitelist rule 100%.
  `bun run eval` options: `--per-category n` (a subset), `--retries n` (soft-error retries per case), resume from a state file in `evals/.runs/`
  (`<model>-<prompt-version>-<set>[-pc<n>].jsonl`, outside git; `--state` sets another file, `--fresh` starts again),
  a minimum support of 30 kept rows per category (`--min-kept`), a confidence histogram, and `--real` (labels from `triage_feedback`, no LLM call).
  Exit code 0 = pass, 1 = a check failed (whitelist, injection, or too many error cases), 2 = the run is not complete (run the same command again).
  `evals/README.md` has the commands.
  CI runs the eval only when `prompts/`, `evals/` or the model config change, with a paid key and a budget alert.
- **Web:** Playwright smoke tests (S5).
- **CI:** GitHub Actions — lint, typecheck, unit tests, integration tests (service containers: Postgres, mail server).
- **Containers and time (estimates):**

  | Step | Container use | Time |
  |---|---|---|
  | Dev loop on the Mac | only `db` runs in a container; the server runs with `bun --watch` | restart < 1 s |
  | Unit tests | none | seconds |
  | Integration tests | `db` (and the mail server) already running | seconds to start, plus test time |
  | CI | service containers start in parallel with checkout and install | about +10–20 s per run |
  | Server image build (deploy only) | `oven/bun` base; the dependency layer is cached while `bun.lock` does not change | first build about 1–2 min, later about 10–30 s |
  | Postgres image | stock `postgres:17`, no build | one pull, start in seconds |

## 10. Deployment

- **Dev:** the user's Mac (Docker CLI + Colima, started at login). `docker compose up db`, server with `bun --watch`, the dev Telegram bot, GreenMail as the local test mail server (no second Interia account: the pilot mailbox is the test mailbox, ADR 0013).
- **Pilot:** the home VPS, on all the time. Compose (Docker, user decision 2026-11-03) with two services:
  - `db`: `postgres:17`, a named volume, no public port;
  - `server`: an image built on the VPS from the repo, `restart: unless-stopped`, env file with mode 600.
  `deploy/compose.yaml` is the VPS file; `deploy/compose.dev.yaml` adds the dev `db` port 5433 and GreenMail on the Mac.
  Restart after a reboot: `systemctl enable docker` + `restart: unless-stopped` (reboot test passed 2026-11-03). Facts: `notes/2026-11-03-pilot-vps.md`.
  No inbound port: IMAP, SMTP, Telegram long polling and Gemini are outbound connections.
  The web panel (S5) needs inbound access: a reverse proxy with TLS or a tunnel (decide in S5).
- **Production for external customers (S6):** a hosted EU VPS with the same Compose files (availability, physical security, GDPR duties of a processor).
- **azyl dev server:** demos with test data only. Its home folder is shared with other projects (skill `vps-ssh`).
- **Config:** env only; `.env.example` lists every key; the server checks env with Zod at start.

## 11. Delivery slices

Detail, scope, sizes and dependencies: `docs/roadmap.md`. Goal, done-when, plan and status of each slice: its task file in `tasks/`.

| Slice | Content | Task file |
|---|---|---|
| S0 Foundation | Workspaces, env check, logger, DB layer + migration runner, tenancy tables, Compose `db` for dev, CI, `/health`, old code removed | `s0-foundation.md` |
| S1a IMAP read + pilot host | IMAP adapter (read), connect CLI, encrypted password, sync with the IMAP rules, test mailbox, Compose on the home VPS, heartbeat, backups | `s1a-imap-read-pilot-host.md` |
| S1b Shadow triage | Hard rules, classifier, planners, policy (`shadow`), audit, feedback table, labeling CLI, eval runner, cost caps; gate: free tier only for the temporary pilot mailbox (ADR 0013), Cloud Billing before any other person's mail | `s1b-shadow-triage.md` |
| S2 Telegram | Bot, chat linking, shadow digest with feedback buttons, urgent and `auth_error` notices, commands | `s2-telegram.md` |
| S3 Assist actions | Committer, folder moves / mark read / flag, Undo, retries, go/no-go per category, mode switch | `s3-assist-actions.md` |
| S4 Drafts + approval + delegation | Delegation and clarification drafts, approval with buttons, send by SMTP, delegations, chaser, injection guards | `s4-drafts-approvals-delegation.md` |
| S5 Web panel (lite) | Login, connect mailbox, link Telegram, settings, rules, activity | `s5-web-panel.md` |
| S6 Pre-sale | Sign-up, billing, deletion, hosted EU production, Vertex AI EU, privacy policy + DPA, cost model | `s6-pre-sale.md` |
| Phase 2 | Gmail and Microsoft 365 adapters (OAuth; Gmail needs Google verification), style learning, two-way chat + voice, meetings + calendar, mobile app, RAG | — |

## 12. What happens to the current code

| Current | Decision |
|---|---|
| `backend/` (Bun package) | Becomes `apps/server/` (S0). |
| `src/` Astro starter | Becomes `apps/web/` (S0); the web stack is decided at the S5 start (static build served by the server is preferred). |
| `backend/supabase/` and migration `20251202212208_…` | Removed in S0 (ADR 0011). New SQL migrations in `db/migrations/`. |
| `IDatabaseProvider` / `SupabaseAdapter` (generic CRUD) | Removed. Typed repositories per module with transactions. |
| `ImapEmailProvider` | Deleted in S0. S1a reads it from git if needed: `git show 29e9522:backend/src/adapters/providers/email.provider.ts`. |
| `get_provider.ts` (`Providers` factory) | Removed. It turns off the TLS check for Interia (line 35). |
| `OpenAIAdapter` / `ILLMProvider` | Replaced by `platform/llm.ts` (Gemini). |
| `backend/src/scripts/gemini_test.ts` | Moved in S0 to `apps/server/src/scripts/gemini-check.ts`; `bun run gemini:test` runs from the repo root. |
| Dependencies `openai`, `express`, `helmet`, `cors`, `googleapis`, `@supabase/supabase-js`, `dotenv` | Removed in S0 (Bun reads `.env`). `imapflow` and `@google/genai` stay. |
| `utils/log.ts` | Kept and extended (levels, module prefix). |
| `.ai/` docs | Kept as history. Code rules for agents: `docs/code-patterns.md`. |
