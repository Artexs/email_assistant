# Architecture — AI Email Assistant

> **Accepted 2026-11-02** (user). Revised 2026-11-02 after the cold review (`spec/features/done/2026-11/F016-mvp-plan-review/plan.md`), the user's answers and a second review of the rewrite (`spec/features/done/2026-11/F009-docs-and-adr-review/plan.md`):
> pilot mailbox = Interia over IMAP, pilot host = home VPS, own Postgres. Based on `docs/product-brief.md`.
> Decisions are in `docs/decisions/` (ADR 0001–0017). The old specs in `.ai/architecture/` are history. When they disagree with this file, this file wins.

## 1. Goals and constraints

| Driver                                                      | Consequence for the architecture                                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| SaaS for business owners and managers                       | Tenant-aware data model from day one; strict tenant isolation; GDPR.                                                                   |
| Trust is the product value                                  | Every decision is logged with its reason; every mailbox change has an Undo; the user can correct each decision.                        |
| No send without the user's direct command                   | The LLM never acts. Code plans, a policy checks, a committer acts. "Send" needs an approval record.                                    |
| Telegram first, mobile app later                            | One channel-neutral backend API for notices, approvals and commands.                                                                   |
| IMAP + SMTP first (Interia), Gmail / Microsoft 365 later    | Mail access behind a `MailProvider` port (ADR 0010).                                                                                   |
| Polish + English, < 200 mails/day/mailbox, small LLM budget | Polling is enough; one cheap model call per mail; cost caps (ADR 0012).                                                                |
| One developer, home VPS                                     | One repo, one server process, two containers (`server`, `db`), no open inbound port (the web panel is reached through Tailscale only). |

## 2. System context

```mermaid
graph LR
    Exec([Executive / owner])
    EA([Assistant - Phase 2])

    subgraph Product["AI Email Assistant (Compose on the home VPS)"]
        Server[server<br/>Bun: API + workers + scheduler + Telegram bot]
        DB[(db<br/>Postgres 17)]
        Web[Web panel<br/>static build served by the server]
    end

    Mail[Mail provider<br/>IMAP 993 + SMTP 465<br/>Interia first]
    TG[Telegram Bot API]
    LLM[Gemini or OpenAI API<br/>Vertex AI EU before customers]

    Exec <-->|notices, digest, buttons| TG
    Exec -->|browser, phone| TS[Tailscale Serve<br/>HTTPS, tailnet only]
    EA -.-> TS
    TS -->|127.0.0.1:8080| Web
    Web -->|same origin, /api, session| Server
    Server <--> DB
    Server <-->|read, move, flag, draft, send| Mail
    Server <-->|long polling| TG
    Server -->|structured output| LLM
```

All connections from the server go out, except the web panel: Tailscale Serve on the host proxies tailnet requests to `127.0.0.1:8080` (ADR 0017).
The server port is bound to the loopback address of the host. The router has no open port.

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
    src/platform/      db, llm client, crypto, logger, env config, scheduler, http, auth
                       (`auth.ts`: Better Auth on our Postgres, ADR 0016)
  web/                 Astro static build with React islands; served by the server; talks only to `/api` (ADR 0016).
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
    Tick[Scheduler: every 5 min per mailbox] --> Sync[mail.sync: INBOX and the synced folders above each folder's UID cursor]
    Sync -->|known mail back in a synced folder after a system move| Ret[(emails.returned_at set)]
    Ret --> FB[triage.returned writes triage_feedback: wrong]
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
   The system reads INBOX and the synced folders of `mailbox_folders` (ADR 0014; at Interia `Oferty`, `Społeczności`, `Rachunki` and the spam folder `Wiadomości-śmieci`).
   It never reads `AI/*`, Sent, Drafts, Trash or the user's own folders, so that mail is never touched.
2. **The LLM returns data only:** category, confidence, reason code + short reason, extracted fields, a delegate id from a given list,
   and the summary for `info` mail. It never names a free-form recipient.
   The delegate id comes from the delegates list in the prompt: the output schema allows only these ids (or null), and the code checks the id again.
   The recipient of a draft comes from the `delegates` row, or from the sender address of the mail (a clarification), never from LLM text.
3. **Planners are pure.** A planner turns (email, analysis, config) into an `ExecutionPlan`. Planners live in `packages/core`.
4. **The policy decides, inside the triage transaction.** The triage worker calls the pure policy and writes actions as
   `ready`, `awaiting_approval` or `logged`. There is no separate gate job and no `planned` status. Truth table: §4.3.
5. **Only the committer changes the mailbox or sends.** It applies one action at a time.
   For a non-idempotent action (`create_draft`, `send`) it first commits status `applying`. After the call it writes
   the provider result, the audit row and the new status in one transaction.
6. **Exactly-once for mail and drafts, at-most-once for send.** Unique key per email: `(mailbox_id, dedup_key)` (§6.1).
   Each action has an idempotency key. Drafts and sent mail carry the header `X-EA-Action-Id`.
   - Idempotent actions (move, flag, mark read, save summary) go `ready → applied` with no `applying` status and may repeat (S3, `actions/apply.ts`).
     The committer makes it so (the ensure rule, D5). A move first locates the mail by identity (§6.1) in the target folder and in the source folder.
     In both: delete the source copy (a leftover of a COPY before a crash), then `applied`. Only in the target: `applied` (the IMAP part was done before a crash).
     Only in the source: move, then `applied`. Nowhere: `failed` with `mail_not_found`. When the source folder is the target (a reverse after the user moved the mail back), it only locates and never deletes.
     After the IMAP call, `emails.folder`, `uid`, `moved_at`, the action status, `applied_at` and the audit row go in one transaction.
     A crash between the IMAP call and that commit leaves the action `ready`; the next run finds the mail in the target and writes the rows without a second IMAP change.
   - `create_draft` (S4, `actions/drafts.ts`): the committer commits `applying`, builds the message and looks for it in Drafts by the header `X-EA-Action-Id` (`locateByActionId`, §6.1).
     Found → `applied`. Not found → APPEND with `\Draft` and the INTERNALDATE = `created_at`, then `applied` with the folder and the UID in `provider_result`.
     After a crash in `applying`, the next claim locates first, so the draft exists once. An error before the APPEND returns a row that started in this call to `ready`; an error at the APPEND leaves it `applying`.
     A draft is made only while its send waits for approval. When that send has ended before the APPEND (`rejected`, `expired`), no draft is made: the row becomes `expired` (`status_reason` = `send_closed`).
     A soft error waits 5 min with no count. The third hard error makes the draft `failed` (`hard_error`) and expires its open sends (`draft_missing`).
   - `send` (S4, `actions/send.ts`): the committer claims a send only when it is `approved` with `approved_at` set, its draft is `applied` and `SEND_SCOPE` admits it (§4.3).
     It builds the same message as the draft (same `Message-ID` `<ea-<draft id>@<domain>>`, same `Date`, header `X-EA-Action-Id` = the id of the draft action).
     Before the call it commits `applying` with the `Message-ID` in `outgoing_message_id` (own commit). Then it makes one SMTP call (`MailSender`, one connection per call, no retry inside it).
     When SMTP accepts the mail (250 after DATA), the committer at once commits `applied` with the SMTP response and the audit row.
     In the same transaction the delegation becomes `sent` and the draft gets a reverse row (§4.5).
     The copy to Sent is a separate step after that: locate in Sent by the header and APPEND with `\Seen` only if missing. `provider_result.sent_copy` goes from `pending` to `appended`, `found` or `failed`.
     If the copy fails, the action stays `applied` and the user gets the notice "sent; no copy in Sent".
     After a crash in `applying`, the committer never sends again by itself: it searches Sent for the header. Found → `applied` (`recovered`). Not found → `failed` (`outcome_unknown`) and a notice.
     A soft error inside this recovery leaves the row `applying`. A hard error counts, and the third ends as `outcome_unknown`.
     A new send needs a new tap on "Send again" (below).
   - **SMTP stage (D10).** `openSmtpSender` (`mail/imap/smtp.ts`) uses nodemailer's `SMTPConnection` directly. Every error is a `SmtpSendError` with a `stage`: `connect`, `login`, `envelope`, `content` or `unknown`.
     A logger hook of the connection counts the client lines and the server replies (counts and flags only, no text).
     A server reply after the client `DATA` line (the `(2 + recipients)`-th reply after `MAIL FROM`; the reply code does not matter, because nodemailer accepts any 2xx or 3xx reply to `DATA`) starts the content phase.
     The nodemailer code `EENVELOPE` gives `envelope`, `EMESSAGE` gives `content`. Another error during the send step gives `unknown` when the content phase started or no client line was seen, else `envelope`.
     An error that is not a `SmtpSendError` is `unknown` too. `content` and `unknown` mean that the server may have the mail: the committer never retries after them.
   - **"Send again":** after `smtp_error` and `outcome_unknown` the notice has the button 📤 Send again (callback `ag:<action id>`).
     The tap is the approval: it inserts one new `approved` send for the same draft (key `<failed id>:again`, so one resend per failed row) when the draft is still `applied` and the delegation, if any, is open.
   - **"It went out":** after `outcome_unknown` of a delegation send the notice has a second button ✅ It went out (callback `gw:<action id>`). Only an owner can tap it.
     It makes no SMTP call and no new send row. In one transaction (lock order: send, then delegation) it checks that the send is `failed` / `outcome_unknown`, has a stored `outgoing_message_id` and has no resend (key `<failed id>:again`).
     Then the `onWentOut` hook sets the delegation from `cancelled` (`outcome_unknown`) to `sent` with `sent_message_id` = that message id, so a reply of the delegate is matched and the chaser works. The send row stays `failed`.
     Audit: `action.went_out` and `delegation.sent` (`went_out: true`), both with the owner as actor. A second tap, a delegation in another state, a resent send and a send that is not `outcome_unknown` answer with a toast and change nothing. Reminder and clarification sends have no such button: a failed reminder does not cancel the delegation.
     After `smtp_rejected` there is no button: the address is wrong, so the user fixes the delegate and the mail is a new one.

**Outcomes of a send error (rule 6, `sendOutcomeOf`):**

| Error                                                                               | The row goes to                                                                                      | `attempts`                                                          |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Login refused (`EAUTH`)                                                             | `approved`; the mailbox becomes `auth_error`                                                         | no change                                                           |
| Soft error at `connect`, `login` or `envelope` (lost connection, timeout, DNS, 4xx) | `approved`, retry in 5 min, no notice; from 6 h after the tap `failed` / `smtp_error` (the soft cap) | no change (retry without a count)                                   |
| Hard error at `connect`, `login` or `envelope` (not a 5xx at `envelope`)            | `approved`, retry in 5 min                                                                           | + 1 (retry with a count); the third ends as `failed` / `smtp_error` |
| 5xx at `envelope`, or 5xx after the content                                         | `failed` / `smtp_rejected`                                                                           | no change                                                           |
| 4xx or another error after the content (`content`)                                  | `failed` / `smtp_error`, no retry                                                                    | no change                                                           |
| `unknown` stage, or an error that is not a `SmtpSendError`                          | `failed` / `outcome_unknown`                                                                         | no change                                                           |

A compose error before `applying` returns the row to `approved` with a count; the third ends as `failed` / `smtp_error`. Each `failed` send gets a result notice (§4.5).
**The soft cap (F044):** a soft error before the content (`connect`, `login` or `envelope`) retries every 5 min without a count. A soft error that comes 6 h or more after the tap (`approved_at`, constant `SEND_SOFT_CAP_MS`) ends the send as `failed` / `smtp_error` with `provider_result.cap = "soft_retry"`, `attempts` unchanged, and the delegation `cancelled` (`send_failed`). The result notice has its own text ("did not accept the mail for 6 hours … nothing was sent") and the button 📤 Send again; the tap sets a new `approved_at`, so the new send gets its own 6 h.
The cap does not touch a retry with a count (a hard error keeps its 3 tries) and there is no retry after `content`. A send that waits for another reason (a draft not applied, a mailbox in `auth_error`) also uses up the 6 h; the first soft error after that ends it. `held_timeout` (48 h, §4.6) still ends an `approved` send that no try reaches.

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

   The committer (S3; `actions/committer.ts`, `actions/apply.ts`, every 15 s) applies the rule to the action row as follows:
   - **Soft error** (a lost connection, a timeout): the row goes back to `ready` with `next_attempt_at` = now + 5 min and gets no count. The run stops for this mailbox; the rest of its batch is released.
   - **Login error** (`MailAuthError`): the mailbox becomes `auth_error` (the S2 notice), the batch is released with no count.
   - **Hard error:** `attempts` + 1 and a wait of 5 min. At 3 tries the action is `failed` (`status_reason` = `hard_error`) and the linked owners get an `action_failed` notice (§8).
   - **`mail_not_found`:** the action is `failed` at once, with no count. An original row gets no notice (the user moved or deleted the mail). A reverse row gets a notice.
   - **`bad_payload`** (a move without a known folder key): `failed` at once, no count, with a notice.
   - **Stale claim:** a row with `locked_at` older than 10 min is taken back with no count (the actions are idempotent).
   - **Expiry (D21):** the committer claims an original `move`, `flag` or `mark_read` only within 24 h of `created_at` and only for mail received in the last 7 days.
     At the start of each mailbox run it sets older `ready` originals to `expired` (`status_reason` = `stale`, audit `action.expired`). Reverse rows and `save_summary` never expire.
   - The committer opens one IMAP connection per mailbox per run, and only when it claims a mailbox-changing action. Order per mail: `save_summary`, `flag`, `mark_read`, `move`.

8. **Cost limits.** The daily cap (default 300, `LLM_DAILY_CAP`) counts every LLM call attempt (`audit_log` event `llm.call`)
   per mailbox per `America/Los_Angeles` day (the quota day of the free tier). At the cap the mail goes back to `pending`
   with `next_attempt_at` = the start of the next quota day, with no count. Mail older than 7 days is not sent to the LLM: status `skipped` (reason `too_old`);
   the digest lists it as "not processed" (ADR 0012). Mail with `emails.backfilled_at` set skips the 7-day rule (one-off backfill, §6.1).

### 4.2 Categories and folders

One category per mail (Zod enum `Category` in `packages/core`). One folder per mail. Tags use IMAP keywords when the server allows them; else they live only in the DB.

| Category          | Meaning                                                                             | Plan in `assist` mode                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `urgent`          | Needs the user today                                                                | Flag, stays in INBOX, Telegram notice now                                                                                                                                                                                                                                                                                                                 |
| `needs_reply`     | Needs the user's own answer. Meeting requests go here in MVP (meetings are Phase 2) | Stays in INBOX; digest section NEEDS ACTION                                                                                                                                                                                                                                                                                                               |
| `delegation` (S4) | A task for a delegate                                                               | A `delegation` draft to the chosen delegate (fixed template with the task, the due date and the quoted original) + its `send` that waits for approval + a `delegations` row. No delegate fits but the model gives a question: a `clarification` draft to the sender (not to a no-reply address) + its `send`. Neither: no action, the mail stays in INBOX |
| `info`            | Information, no action                                                              | Summary saved; move to `AI/Info`                                                                                                                                                                                                                                                                                                                          |
| `notification`    | Automatic mail from systems                                                         | Mark read; move to `AI/Notifications`                                                                                                                                                                                                                                                                                                                     |
| `spam`            | Unwanted mail (blocklist or AI)                                                     | Move to `AI/Spam` (not the provider's spam folder, so Undo is easy)                                                                                                                                                                                                                                                                                       |
| `unsure`          | Low confidence, or triage failed 3 times                                            | Digest section NEEDS ACTION. Move to `AI/Manual` only if the switch `move_unsure` is ON (default OFF: the mail stays in INBOX)                                                                                                                                                                                                                            |

- **VIP** is a sender flag (`sender_rules.kind = vip`), not a category. A VIP is also whitelisted. The system never moves or marks read a VIP mail automatically (also not into INBOX, and also for spam folder mail).
- **Mail from the spam folder (ADR 0014, D11, D12).** The mail goes through the same pipeline, to find a valid mail that landed there by accident. The plan differs from the table above:
  `spam` → no action (the mail stays in the spam folder); `info` and `notification` → as in the table;
  `urgent`, `needs_reply` and `delegation` → a move into INBOX (the "rescue", no flag); `delegation` gets no draft, no send and no approval message; `unsure` → as in the table.
  The rescue move follows the policy of §4.3, so it is `log_only` while the `auto` flag of its category is OFF.
- **`AI/Manual`** is the "Manual Handling" folder of the product brief: the system puts mail there and never reads that folder again.
- Folder names come from `mailboxes.folder_map` (per provider). The connect step creates the `AI/*` folders.
- Confidence threshold: one per category, set from the S1b eval data (start value 0.7). Stored in `mailbox_settings.category_policy`.
- `unsure` has no precision, so it has no go/no-go bar. Only the `move_unsure` switch controls its move (decision 2026-11-02, safer default).

### 4.3 Mailbox modes and the policy table

| Mode                                 | Meaning                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `shadow` (default for a new mailbox) | The system changes nothing in the mailbox. It logs what it would do and reports it. |
| `assist`                             | The system applies allowed actions. Send happens only after the user's approval.    |

There is no auto-send mode in MVP (ADR 0003). Each action type has an ON/OFF switch per mailbox (`tool_switches`).
The policy is the first gate. `ACTIONS_SCOPE` (env, S3) is a second gate next to the mode, and the committer checks it when it claims:
`off` (default) = the committer applies no mailbox change (only `save_summary`); `synthetic` = mailbox changes only for mail with a synthetic `Message-ID` (`@ea-seed.test>`), in every mailbox;
`all` = every active mailbox of an organization that is not `suspended` (§8), by the mode, the switches and the `auto` flags of each mailbox. The modes are the consent (D2): `shadow` changes nothing in the mailbox. No scope reads `TEST_MAILBOX_ADDRESS` (only the `testmail` and probe tools read it).
Actions that the scope holds back stay `ready` and wait (they expire after 24 h, §4.1 rule 7). `synthetic` is a test gate, not a security boundary: any sender can write such an id.
`SEND_SCOPE` (env, S4) is a third gate, for the send only. `off` (default) = no send goes out: an approved send waits and ends as `held_timeout` 48 h after the tap; `self` = only a send whose every recipient is in `SEND_TEST_ADDRESSES`; `all` = every send of every active mailbox of an organization that is not `suspended` (delegations, reminders and clarification questions to the original sender); a send still needs the owner's tap. The server refuses `self` without a valid address list. A draft is made under `ACTIONS_SCOPE`: with `off`, no draft is made, so no approval request goes out. A tap on 📤 Send is the approval; the scope still decides whether the mail goes out.
The mode, the `auto` flags and the switches change only through `bun run mailbox:settings` (audit rows `mailbox.mode_changed`, `mailbox.policy_changed`, `mailbox.switch_changed`).
A change that closes a gate (`mode shadow`, `auto … off`, `switch … off`, and `mode assist` without `--keep-switches` for each switch it turns off) also expires the `ready` rows it closes, in the same transaction. `mode shadow` and `switch create_draft off` also expire the `awaiting_approval` sends (`policy_changed`). `saveTriage` share-locks the settings row and compares the settings version: a triage batch planned under old settings writes nothing and releases its mails.
A category gets automatic moves only after it passes the go/no-go bar of the S1b report (default: precision ≥ 98%).
The policy returns one of three values per action: `apply`, `await_approval`, `log_only`.
The rescue move of spam folder mail into INBOX (§4.2) follows the same go/no-go rule: the category needs `auto` ON. `delegation` has no `auto` flag, so its rescue is always `log_only`.
The urgent notice skips mail from the spam folder (D23): an injected "urgent" text must not push such mail to the phone. The digest still shows it with its folder.
The known limits of the folder sync are in ADR 0014 (D24).

| Action                                                        | `shadow`              | `assist`                                                                                                                                               | Sender is VIP                                       |
| ------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Telegram notice, digest line                                  | apply                 | apply                                                                                                                                                  | apply                                               |
| Save summary (DB only)                                        | apply                 | apply                                                                                                                                                  | apply                                               |
| Move to an `AI/*` folder or, for spam folder mail, into INBOX | log only              | apply if the switch is ON, the category passed go/no-go (`unsure`: only the `move_unsure` switch) and the mailbox supports moves (§6.1); else log only | log only                                            |
| Mark read                                                     | log only              | apply if the switch is ON and the category passed go/no-go; else log only                                                                              | log only                                            |
| Flag                                                          | log only              | apply if the switch is ON                                                                                                                              | apply if the switch is ON                           |
| Create draft (APPEND to Drafts)                               | log only              | apply if the switch is ON                                                                                                                              | apply if the switch is ON                           |
| Send (SMTP)                                                   | log only (never sent) | await approval (the committer then also needs `SEND_SCOPE`); log only when its draft is log only                                                       | await approval; log only when its draft is log only |
| Undo (reverse plan)                                           | —                     | apply on the user's tap                                                                                                                                | apply on the user's tap                             |

### 4.4 Feedback, Undo and the success metric

- **Feedback sources:** labeling CLI (S1b); ✅ / ✏️ buttons under each digest line (S2); the Undo button (S3);
  a mail that the user moves back to a synced folder after a system move (§6.1); the web panel (S5).
  Every source writes a `triage_feedback` row through `triage.recordFeedback()`. A known mail is never triaged again (no loop).
- **Moved back by the user:** `mail.sync` only sets `emails.returned_at` (when the system moved the mail, §6.1).
  The job `triage.returned` (every 15 s, no LLM) handles each flagged mail in one transaction. It locks the mail's latest original `move` action (the lock Undo takes too, so the two never both write feedback).
  When the move is `applied` and has no reverse row, or only a `failed` one, it sets the move to `undone` (`status_reason` = `user_moved_back`).
  It writes one feedback row (verdict `wrong`, source `imap_move`) only when there is no reverse row at all, the latest category is not `unsure`, and the latest feedback row has no `true_category` (a ✏️ label stays).
  It always clears `returned_at` and writes the audit row `email.returned`. A mail returned after an Undo gets no row, because the Undo wrote one.
  A second return of the same mail at Interia is not seen: after the first return the row says its source folder and leaves the below-cursor list (D12).
- **Undo (S3):** the ↩️ button on a digest line (callback `fu:<emailId>`) works per mail. The tap runs `actions.undo()` in one transaction:
  it locks the mail's original actions and, for each `applied` original (`move`, `flag`, `mark_read`) whose `applied_at` is at most 7 days old and that has no reverse row, inserts a reverse row
  (same type and payload, `reverses_action_id` = the original, `ready`) and the audit row `action.undo_requested`. A `ready` original of the mail (a move in a retry wait) becomes `expired` (`status_reason` = `undo`).
  The committer applies the reverse row as the inverse operation (move: ensure the mail in its source folder, `emails.source_folder`; flag: remove `\Flagged`; mark read: remove `\Seen`),
  then sets the original to `undone` and writes the new location in one transaction. A reverse move that stops between the copy and the expunge leaves the mail in both folders;
  `emails.undo_pending_at` tells the sync to store no copy of it meanwhile (D22). An Undo into a `sort` folder (`Oferty`, `Społeczności`, `Rachunki`) is an APPEND transfer, not a COPY (U11, §6.1).
  A final failure of such an APPEND move (also of the rescue) leaves the mail in both folders; the `action_failed` notice tells the user (ADR 0014).
  The caller (the Telegram handler) writes the feedback row (verdict `wrong`, source `undo`) in the same transaction when at least one reverse row was created and the latest category is not `unsure`.
  The tap answers with a toast only: started, already requested, nothing to undo, too old (7 days), not possible now (`ACTIONS_SCOPE=off` or a paused mailbox: nothing is written), or "not in your account" (the same text as the feedback buttons).
  A move that a committer run holds at the second of the tap still finishes; the line then shows ↩️ again and the user taps again.
- **Buttons under a digest line (S2):** ✅ means "the shown category is right": it writes `true_category` = the shown category (verdict `right`).
  ✏️ opens a picker with five categories (Urgent, Reply, Info, Notification, Spam) and Cancel; a pick writes `true_category` = the pick
  (verdict `right` or `wrong`). The latest row of a mail wins (as in `listLabeledResults`). The same answer twice writes nothing
  (the bot answers "Already saved"). An `unsure` line has only ✏️, because a verdict without a category is not valid for `unsure`.
- **Feedback rows:** `verdict` (`right` / `wrong`) and an optional `true_category`. A row with a `true_category` counts for precision and recall.
  A row with only `wrong` counts only against the precision of the predicted category.
- **Eval on real mail:** the eval runner reads the labels from `triage_feedback` in the DB. Real labels never go to git.
  Real-mail evals use mail younger than 30 days (the body is cleared after that, §7). Pilot exception: backfilled mail up to 180 days (§6.1).
- **Success metric** ("share of mail handled without the user", target 80–90%):
  handled = mail in `spam`, `notification`, `info`, or `delegation` sent after one tap, with an applied plan
  that the user did not undo or correct within 7 days. Share = handled ÷ all triaged mail. One line in the weekly digest.
  The weekly line is not built yet (follow-up `spec/features/planned/F033-handled-share-metric/plan.md`, `spec/features/planned/F042-handled-share-delegations/plan.md`).
- **Digest lines for delegations (S4):** a `logged` send reads "would ask you to send it"; the phrases for the other statuses are `waits for your approval`, `approved, sending`, `sending`, `sent`, `rejected`, `not sent (approval expired)` and `not sent (failed)`. The footer shows `👥 Delegations: <n> waiting for a reply, <m> overdue` when there are open delegations.

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

    W->>DB: create_draft = ready, send = awaiting_approval (depends on the draft)
    C->>M: APPEND the draft to Drafts (under ACTIONS_SCOPE)
    N->>TG: only after the draft is applied - recipient, original sender with external-sender warning, full draft text, quote, [Send] [Reject]
    U->>TG: taps [Send]
    TG->>DB: handler checks chat → user → owner role → org owns the action, then status = approved only WHERE status = awaiting_approval
    TG-->>U: toast, and the message gets the line "Approved HH:MM, sending"
    C->>DB: store the outgoing Message-ID, status = applying (own commit)
    C->>M: SMTP send with X-EA-Action-Id and the stored Message-ID
    C->>DB: at once after the 250 - status = applied + SMTP response + audit row (one transaction)
    C->>M: copy to Sent (search first, APPEND if missing), remove the draft
    N->>TG: a new message: Sent to <recipient> (or the failure text)
```

- **The approval message** (`renderApprovalRequest`, plain text, at most 4096 characters): the title (`📤 Send? Delegation to <name> <address>`, `Question to the sender <address>` or `Reminder to <name> <address>`), `From:` the original sender with `⚠️ external sender` when the sender is not the mailbox, a delegate, a whitelisted or a VIP address,
  `Subject:`, `Due:`, `Draft:` with the full template text, `Quoted original:` with at most 1500 characters (links show as `[link]`; the quote shrinks first when the message is too long) and the line "The system sends it after your tap. Do not send the draft from your mail client."
  Buttons: 📤 Send and ✖️ Reject. A reminder has no quote and no sender line. Mail with a synthetic `Message-ID` is marked `🧪 test`.
  The notifier and the committer build the text with the same function, so the user sees what goes out.
- **Reminder sets:** the chaser (§8) plans up to 10 reminders at once. They go as one message `📤 Send <n> reminders?` with 📤 Send all and ✖️ Skip all (`as:<set id>`, `rs:<set id>`). Each item shows the recipient, the subject and the task (cut to 150 characters).
  A tap approves only the sends that the message showed.
- **Taps:** the callback data is a kind and a UUID: `ap:` approve, `ar:` reject, `as:` send all, `rs:` skip all, `ag:` send again, `dd:` done. The handler checks the chat link, then the role: **only an owner can approve, reject or send again**; `dd:` (Done) works for every linked member.
  An unknown id and an id of another organization get the same answer. A second tap finds the status changed and answers with it. An expired or rejected action cannot send.
  `approve` refuses while the draft is not `applied` (`draft_not_ready`), and a tap later than 48 h after `notified_at` expires the send (the hourly job can be late by up to an hour).
- **The edit after the tap:** the approval message keeps its text and gets one line: `⏳ Approved HH:MM, sending.`, `✖️ Rejected HH:MM.`, `⌛ Expired HH:MM. The mail was not sent.` or `✅ Done HH:MM.` or `✅ Marked as sent HH:MM.` (after ✅ It went out). An approved send that is held (by `SEND_SCOPE`, a paused mailbox or a login error) says so, keeps the ✖️ Reject button and expires 48 h after the tap.
- **The result notice** is a new message (outbox kind `send_result`), one per owner, when the send ends: `✅ Sent to …`, `❌ Not sent …` (`smtp_rejected`, `smtp_error`), `⚠️ Unknown whether the mail … went out` (`outcome_unknown`; "Check Sent or ask the recipient before you send again"), `⌛ Not sent: …` for each `expired` reason, `✖️ Rejected`.
  A `sent` notice adds "No copy in Sent" when the copy failed and "The draft stays in Drafts" when the server has no UIDPLUS. A `pending` Sent copy older than 10 min counts as failed. An edit of the approval message instead of a new message is a follow-up (`spec/features/planned/F039-approval-edit-in-place/plan.md`).
- **Notice kinds (S4):** `approval`, `approval_set`, `send_result` (owners only) and `delegation_answered` (every linked member, with a ✅ Done button). The notifier queues a request only after the draft is `applied`, and only for an `active` mailbox.
  With no linked owner it queues nothing and sets nothing: `notified_at` stays null, and after 7 days from creation the expiry job ends the send as `not_notified`.
- A `send` action has `depends_on_action_id` = its `create_draft` action. The policy makes the send `log_only` when its draft is `log_only`. The expiry job (§8) ends a send that nobody answered, and a send whose draft is `failed` or `undone` (`draft_missing`).
- The send uses the text that the user approved (the draft payload in the DB). Edits of the draft in the mail client do not count in MVP (Phase 2: send the edited draft, `spec/features/planned/F043-send-draft-edits/plan.md`). The approval record is `approved_by`, `approved_at` and `approved_via`; a database check refuses `approved`, `applying` and `applied` sends without `approved_at`, and a send is never `ready`.
- After a send is `applied`, a reverse `create_draft` row removes the draft from Drafts when the server has UIDPLUS; else the draft stays, and the notice says so. A reject or an expiry removes the draft the same way. A send that the server refused (`smtp_rejected`) or that failed keeps its draft, so the user can read it.
- Never retry a send by itself (§4.1 rule 6).
- "Send all reminders" (brief, follow-up) is one approval for a listed set of reminder actions (above).

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
                 processing → skipped                                 (received more than 24 h before resumed_at and not backfilled, reason suspended_backlog; §8)
                 skipped → pending                                    (one-off backfill re-queue of too_old mail in the window)

actions.status:  (code map: apps/server/src/modules/actions/transitions.ts; tests compare it with the guards)
                 ready → applied                                      (idempotent: move, flag, mark read, save summary; the ensure rule, §4.1 rule 6)
                 ready → expired                                      (stale: older than 24 h; policy_changed; undo; manual)
                 ready → applying → applied | expired                 (create_draft; expired = send_closed: its send ended before the APPEND)
                 ready | applying → failed                            (create_draft: bad_payload, or hard_error after 3 tries; its open sends expire: draft_missing)
                 awaiting_approval → approved → applying → applied    (send: applied at once after the SMTP 250)
                 awaiting_approval → rejected                         (the Reject tap)
                 approved → rejected                                  (the Reject tap on an approved send that no committer holds, or whose lock is stale)
                 awaiting_approval → expired                          (timeout: 48 h after notified_at, request received | draft_missing | not_notified: 7 days after creation, no owner | not_seen: request not received, at the resume of a suspended organization or 48 h after notified_at |
                                                                       policy_changed | delegation_closed)
                 approved → expired                                   (held_timeout: 48 h after the tap, when no committer holds it; or delegation_closed)
                 applied → undone                                     (Undo button, or the user moved the mail back: user_moved_back)
                 logged                                               (policy log_only, for example shadow mode)
                 ready | approved → same status, retry later          (soft error: no count; hard error: attempts + 1)
                 applying → applied                                   (create_draft recovery: Drafts search)
                 applying → ready                                     (create_draft: an error before the APPEND, on a row that the same call set to applying)
                 applying → applying                                  (create_draft APPEND error, or send recovery error: the row stays applying; the next claim tries again)
                 applying → approved                                  (send, a known stage before the content: a soft error without a count, a hard error with attempts + 1)
                 applying → applied | failed                          (send recovery: Sent search, else outcome_unknown)
                 applying → failed                                    (send: smtp_rejected | smtp_error | outcome_unknown; the third hard error before the content: smtp_error)
                 failed → new send row, approved                      ("Send again" after smtp_error | outcome_unknown; the failed row stays failed)
                 create_draft reverse row: ready → applied            (removes the draft after sent | rejected | expired; the original draft becomes undone; failed after 3 hard errors)
                 ready | approved | applying → failed                 (after 3 hard errors; notice to the user)
                 ready → failed                                       (mail_not_found, bad_payload: at once, no count)
                 approved → failed                                    (send: bad_payload, or the third compose error with smtp_error, before the SMTP call)

delegations.status: drafted → sent                                    (the delegation send is applied; due_at = 3 days later when the mail states no date)
                 drafted → cancelled                                  (reason: rejected | expired | draft_missing | send_failed | outcome_unknown)
                 cancelled → sent                                     ("Send again" after send_failed | outcome_unknown, when the new send is applied; or "It went out" after outcome_unknown, with the stored outgoing_message_id and no new send)
                 sent → overdue                                       (the chaser, after due_at)
                 sent | overdue → answered                            (a mail from the delegate in the thread of the sent mail; the pending reminders expire)
                 answered | overdue → done                            (the Done tap, or bun run delegations:done; the pending reminders expire)
```

## 5. Data model (MVP, tenant-aware)

```mermaid
erDiagram
    organizations ||--o{ memberships : has
    users ||--o{ memberships : "is member"
    organizations ||--o{ mailboxes : owns
    mailboxes ||--o{ mailbox_folders : "synced folders and cursors"
    mailboxes ||--|| mailbox_credentials : "encrypted password"
    mailboxes ||--|| mailbox_settings : "mode, switches, category policy"
    organizations ||--o{ sender_rules : "whitelist / blocklist / VIP"
    mailboxes ||--o{ emails : syncs
    emails ||--o{ triage_results : "one per attempt"
    emails ||--o{ triage_feedback : "user labels"
    emails ||--o{ actions : plans
    actions ||--o{ audit_log : records
    memberships ||--o| chat_links : "Telegram chat"
    memberships ||--o{ chat_link_tokens : "one-time link"
    memberships ||--o{ digests : "sent reports"
    memberships ||--o{ outbox : "messages to send"
    digests ||--o| outbox : "digest message"
    emails ||--o{ outbox : "urgent notice"
    mailboxes ||--o{ outbox : "sync and login notices"
    organizations ||--o{ delegates : "S4: people who get tasks"
    emails ||--o{ delegations : "S4: one per delegated mail"
    delegates ||--o{ delegations : "S4"
    actions ||--o| delegations : "S4: draft and send"
```

| Table                 | Key columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Slice    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `organizations`       | id, name, timezone, data_retention_days (default 30), style_text, plan (`trial` / `active` / `suspended`; the column default is `active`, `org:create` sets `trial`), trial_ends_at (set exactly when `plan = 'trial'`), max_mailboxes (default 2), resumed_at (set when the plan leaves `suspended`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | S0       |
| `users`               | id, email (stored lower-case: a check `users_email_lower_check`), display_name, email_verified, image, updated_at (the login columns of Better Auth, ADR 0016), locale (`pl` / `en`, nullable; set by `org:invite`, S6b), terms_version and terms_accepted_at (null together or set together; S6b)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | S0       |
| `auth_sessions`       | id, user_id, token (unique), expires_at, ip_address, user_agent, created_at, updated_at. Written only by Better Auth; no `org_id`, keyed by user (ON DELETE CASCADE)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | S5       |
| `auth_accounts`       | id, user_id, account_id, provider_id (`credential` for a password), password (hash), token columns (unused), created_at, updated_at; unique (provider_id, account_id). Written only by Better Auth; no `org_id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | S5       |
| `auth_verifications`  | id, identifier, value, expires_at, created_at, updated_at (the one-time password-reset token). Written only by Better Auth; no `org_id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | S5       |
| `auth_lockouts`       | user_id (primary key, ON DELETE CASCADE), window_started_at, failed_count, locked_until, mail_day, mail_count, updated_at (the sign-in lock, §7). Written by `platform/auth-lockout.ts`; no `org_id`, keyed by user                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | S6b      |
| `memberships`         | org_id, user_id, role (`owner` / `assistant`), digest_times (default `{08:00,16:00}` since S2; existing rows keep their value)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | S0       |
| `mailboxes`           | id, org_id, protocol (`imap`), address, imap_host, imap_port, smtp_host, smtp_port, smtp_security (`tls` / `starttls`, F049), status (`active` / `auth_error` / `paused`), status_changed_at (S2; moves only when the status really changes), uidvalidity, last_uid (both: a copy of the INBOX cursor, written with it, so that a code rollback works; the sync reads `mailbox_folders`, ADR 0014), last_synced_at, capabilities jsonb, folder_map jsonb                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | S1a      |
| `mailbox_folders`     | id, org_id, mailbox_id, key (`inbox`, `offers`, `social`, `bills`, `junk`), path, role (`inbox` / `sort` / `junk`), enabled, uidvalidity, last_uid (the cursor of this folder). One `inbox` row per mailbox; unique (mailbox_id, key) and (mailbox_id, path). Cursor columns of `mailboxes` stay for a code rollback (ADR 0014)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | ADR 0014 |
| `mailbox_credentials` | mailbox_id, encrypted_secret, secret_kind (`password` / `app_password`), key_version — server only (ADR 0009)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | S1a      |
| `mailbox_settings`    | mailbox_id, mode, tool_switches jsonb, category_policy jsonb (auto on/off + threshold per category)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | S1a      |
| `sender_rules`        | org_id, mailbox_id (null = all mailboxes), pattern (address or domain), kind (`whitelist` / `blocklist` / `vip`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | S1b      |
| `emails`              | id, org_id, mailbox_id, dedup_key (unique per mailbox), message_id_header, content_hash, uid, folder, returned_at, thread_key, in_reply_to, references_header, from_address, to_addresses, cc_addresses, subject, received_at, body_text (retention), status (§4.6), skip_reason, attempts, next_attempt_at, locked_at, backfilled_at (S1b; set by the one-off backfill), source_folder (ADR 0014; the synced folder where the sync found the mail, default `INBOX`; `folder <> source_folder` means a system move put the mail in `folder`), inbox_uid (S3; the name is old: the last known UID in `source_folder`; `uid` is the UID in `folder`), moved_at (S3; time of the last system move, null in the source folder), undo_pending_at (S3; the name is old: a system move into a synced folder is in flight. Set by Undo and by the rescue move, cleared when that move ends, D22). Indexes since S3: `emails_claim_idx (mailbox_id, status, received_at)`, `emails_moved_idx (mailbox_id, moved_at) WHERE folder <> source_folder`, `emails_returned_idx (mailbox_id) WHERE returned_at IS NOT NULL`                                                                                                                                                  | S1a      |
| `triage_results`      | email_id, org_id, category, vip, confidence, reason_code, reason, fields jsonb, model, prompt_version, tokens_in, tokens_out, latency_ms, created_at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | S1b      |
| `triage_feedback`     | org_id, email_id, verdict (`right` / `wrong`), true_category (nullable), source (`cli` / `telegram` / `undo` / `imap_move` / `web`), user_id, created_at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | S1b      |
| `actions`             | id, org_id, email_id, type, payload jsonb, status (§4.6), status_reason, attempts, next_attempt_at, locked_at, last_error (no mail text), provider_result jsonb, idempotency_key, outgoing_message_id, depends_on_action_id, reverses_action_id, notified_at (S3: also set by the `action_failed` detector), approved_by, approved_at, approved_via, applied_at (S3; set with `applied`; the Undo window counts from it; a check requires it for `applied` and `undone`), result_notified_at (S4; set when the `send_result` notice is queued). Since S4 `type` also allows `create_draft` and `send`; checks: a `send` in `approved`, `applying` or `applied` has `approved_at`, and a `send` is never `ready`. Indexes since S4: `actions_depends_on_idx`, `actions_org_type_status_idx`. Indexes since S3: `actions_email_type_idx (email_id, type)` and a unique index on `reverses_action_id` (one reverse row per original)                                                                                                                                                                                                                                                                                                                            | S1b      |
| `audit_log`           | id, org_id, email_id, action_id, actor (`system` / user id), event, reason_code, data jsonb (ids, codes, numbers only), created_at — append-only. S1b events: `email.triaged`, `email.skipped`, `action.planned`, `llm.call` (`reason_code` = outcome: `ok` or the error code), `email.requeued`. S2 events: `chat.linked`, `chat.unlinked`, `mailbox.paused`, `mailbox.resumed`, `mailbox.password_changed`. S3 events: `action.applied`, `action.failed`, `action.expired`, `action.undo_requested`, `action.undone`, `email.returned`, `mailbox.folder_created`, `mailbox.mode_changed`, `mailbox.policy_changed`, `mailbox.switch_changed` (data: ids, action types, folder keys, attempts, codes, booleans). S4 events: `action.applying`, `action.approved`, `action.rejected`, `action.send_again`, `action.sent_copy_failed`, `delegate.added`, `delegate.changed`, `delegation.created`, `delegation.sent`, `delegation.answered`, `delegation.overdue`, `delegation.cancelled`, `delegation.done`, `delegation.chaser_run` (ids, codes, counts; no mail text). Web login events (S5, S6b): `web.login`, `web.password_set`, `web.password_changed`, `web.login_locked`, `web.terms_accepted`, `web.sessions_revoked`, `web.other_sessions_revoked` | S1b      |
| `chat_links`          | id, org_id, user_id (FK to `memberships`, cascade), channel (`telegram`), external_chat_id (private chat ids only, > 0), linked_at. Unique: `(channel, external_chat_id)` (one user per chat) and `(org_id, user_id, channel)` (one chat per member); a new link replaces the old one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | S2       |
| `chat_link_tokens`    | token_hash (SHA-256 hex, the token itself is never stored), org_id, user_id, expires_at (15 min), used_at, created_at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | S2       |
| `digests`             | id, org_id, user_id, slot_key (local wall-clock `YYYY-MM-DDTHH:MM`, unique per member), period_start, period_end, sent_at, created_at. No text: the text is in `outbox.text`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | S2       |
| `outbox`              | id, org_id, user_id, kind (`digest` / `urgent` / `auth_error` / `sync_stale` / `sync_ok` / `action_failed` / `approval` / `approval_set` / `send_result` / `delegation_answered` / `mailbox_removed`), dedup_key (unique per `(org_id, user_id)`: one row per event), email_id, mailbox_id, digest_id, text, buttons jsonb, status (`pending` / `sending` / `sent` / `failed`), attempts, next_attempt_at, locked_at, sent_at, external_message_id, error_code (`blocked` / `bad_request` / `expired` / `no_chat` / `outdated` / `too_many_errors`), created_at. Dedup keys: `digest:<slot>`, `urgent:<email id>`, `auth_error:<mailbox id>:<status_changed_at ms>`, `sync_stale:<mailbox id>:<last_synced_at ms or never>`, `sync_ok:<mailbox id>:<episode>`, `action_failed:<action id>`, `approval:<action id>`, `approval_set:<set id>`, `send_result:<action id>`, `delegation_answered:<delegation id>` (the four S4 kinds need `email_id`)                                                                                                                                                                                                                                                                                                            | S2       |
| `delegates`           | id, org_id, name (1–100 characters), email (lower case; unique per organization), competence_tags text[], active, created_at, updated_at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | S4       |
| `delegations`         | id, org_id, mailbox_id, email_id, delegate_id, draft_action_id, send_action_id (unique), task_summary, due_at, status (`drafted` / `sent` / `answered` / `overdue` / `done` / `cancelled`, §4.6), status_reason, sent_message_id, sent_at, last_reminder_at, reminders_sent (0–2), answered_email_id, answered_at, answered_notified_at (S4; set when the `delegation_answered` notice is queued), created_at, updated_at. A check requires `sent_message_id` and `sent_at` for `sent`, `answered` and `overdue`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | S4       |

Each slice adds the migration for its own tables (column "Slice"). Column names avoid SQL reserved words (`from`, `to`, `references`).

Tenancy:

- Every domain table has `org_id` (copied down for simple filters).
- The server uses its own DB role `app`. Every repository function takes a `TenantContext` and filters by `org_id`. Integration tests check this (ADR 0011).
- Roles: a plain SQL file `db/roles.sql` creates two login roles (passwords from env as `psql` variables): `migrator` owns the tables
  and runs the migrations; `app` is the server's role. The superuser (`POSTGRES_USER`) runs `db/roles.sql` once: the `db` init script on the Mac
  and the VPS, a `psql` step in CI. Migrations grant `app` its rights (default privileges for new tables; on `audit_log` only INSERT and SELECT).
  The server connects as `app`, never as `migrator` or the superuser.
- The three Better Auth tables (`auth_sessions`, `auth_accounts`, `auth_verifications`) have no `org_id`: they are keyed by user. Only the library reads and writes them. `auth_lockouts` has no `org_id` either (S6b).
  The server finds the tenant of a web request with `listMembershipsOfUser` (the oldest membership of the session user), never from the request (ADR 0016).
- No client reads the DB directly. Option for S6: RLS for the server role with `set_config('app.org_id', …)` per transaction.

## 6. Integrations

### 6.1 Mail: IMAP + SMTP (ADR 0010)

- **Connect:** CLI `bun run mailbox:connect` (S1a), web form in S5. It asks for the address and the password (an app password if the provider has one),
  tests the IMAP and SMTP login, reads the server capabilities and the special-use folders (Drafts, Sent, Trash),
  creates the `AI/*` folders, and stores the encrypted secret. TLS certificates are always checked.
- **SMTP modes (F049):** each mailbox row has `smtp_security`. `tls` (the default) = implicit TLS, as a rule port 465 (`secure: true`).
  `starttls` = port 587: the connection starts plain and nodemailer must upgrade it (`secure: false`, `requireTLS: true`).
  When the server offers no STARTTLS, the connection ends before the login, so the password never goes out in plain text. Both modes check the certificate; no option turns the check off or sets `ignoreTLS`.
  The web form and `mailbox:connect --smtp-security` choose the mode; a preset sets it (iCloud: `smtp.mail.me.com:587` `starttls`, app-specific password). IMAP stays on port 993 with TLS.
- **Synced folders (ADR 0014):** INBOX and the rows of `mailbox_folders`. At Interia the job inserts a row for each default name that the server lists exactly: `Oferty`, `Społeczności`, `Rachunki` (role `sort`) and `Wiadomości-śmieci` (role `junk`; Interia's tabs are folders, `notes/2026-11-07-agentmail-test-mail.md` §10).
  Never `AI/*`, Sent, Drafts, Trash or a user folder. One run per mailbox goes folder by folder: INBOX, the `sort` folders, then the spam folder. An error in a folder other than INBOX gives a warning and the run goes on.
  `bun run mailbox:settings sync-folder --key offers|social|bills|junk --value on|off` is the off switch per folder (INBOX has none); on again clears the cursor (a new 24 h first sync).
- **Sync cursor:** one per folder: `UIDVALIDITY` + last UID in its `mailbox_folders` row. Every 5 minutes: fetch UIDs above the cursor.
  The INBOX cursor is also written to `mailboxes.uidvalidity` and `last_uid` (dual write, for a code rollback). IMAP IDLE (push) can come later.
  Trap: `UID FETCH n:*` also returns the highest message when its UID is below n (RFC 3501 range rule, `*` = highest UID). Filter `uid > last_uid` in code.
- **Dedup key:** `Message-ID` + `content_hash` (hash of the `From` address, the `Date` header (else INTERNALDATE) and RFC822.SIZE).
  Mail without a `Message-ID`: the hash only.
  The same `Message-ID` with a different hash is a new mail (duplicate copies, aliases, a reused id from an outside sender).
- **Which mail is new:** a message in a synced folder with a dedup key that the DB does not know. Skip it only when its `X-EA-Action-Id`
  matches an `actions` row of this mailbox (the system's own draft or sent mail). The owner's address in `From:` is not a reason
  to skip (a sender can forge it).
- **Known mail:** the folder being synced is S. If `emails.folder` ≠ `emails.source_folder` (the system moved it), locate the mail in that folder by identity (`locateMessage`, D3; below).
  The mail is still there → the mail in S is a second identical copy: store it as a new email (dedup key + `#2`, `#3`, …) and triage it.
  The mail is gone → the user moved it back: set `emails.returned_at`, `folder` and `source_folder` = S (§4.4).
  If the known mail is in its source folder, update `uid` silently. If it is in its source folder and that is not S, the mail sits in two synced folders (a cross copy): store nothing and count it. If it is gone there, the user moved it between synced folders: set `folder` and `source_folder` = S, with no feedback and no triage.
  In shadow mode the system moves nothing, so no flag is set. Never triage a known mail again.
  While a system move of the mail runs (`emails.undo_pending_at` set by Undo or the rescue, younger than 24 h), the sync stores no copy of it (D22).
- **Locate by identity (D3):** the server has no usable `SEARCH HEADER` (Interia), so `locateMessage(provider, folder, key)` (`mail/locate.ts`) reads the folder instead.
  It first fetches the stored UID as a hint and compares the identity; else it searches the folder `SINCE` the day before `received_at`, fetches the candidates in chunks of 100 and compares.
  Identity = the normalized `Message-ID` and the `content_hash` (`sameMailIdentity` in `sync-rules.ts`; mode `strict`, also checked at Interia: a COPY keeps size, INTERNALDATE and the `Message-ID`).
  It skips every message with `\Deleted` and every UID that another `emails` row of the same identity holds in that folder (`listFolderUids`), so identical copies are never taken for one mail.
- **Returned below the cursor (D4):** at the end of each incremental sync, the mail that the system moved in the last 7 days (at most 500, newest `moved_at` first) is looked up only in the folder that it came from
  (in the pass of folder S: the mail that the system moved and whose source folder is S; `listRecentlyMoved({ sourceFolder })`), by its `inbox_uid` and its folder `uid`. An identity match that is no longer in the system folder means the user put the mail back: `emails.returned_at` is set (§4.4).
  A match that is still in the system folder is a copy below the cursor: the sync logs and counts it, and stores nothing (follow-up `spec/features/planned/F032-copy-below-cursor/plan.md`).
  An RFC server puts a returned mail above the cursor; the rule above marks it first, and this check then does nothing.
- **First connect:** only mail of the last 24 hours, in INBOX and in every new synced folder (a folder with no cursor yet, also one that is switched on again).
- **After an outage:** the next sync takes all UIDs above the cursor (IMAP keeps them). Mail older than 7 days is stored but not sent to the LLM.
- **Backfill (S1b, one-off):** `bun run mailbox:backfill --org-id <uuid> --mailbox-id <uuid> [--days 1-180]` reads INBOX mail of the last days.
  It stores the missing mail with `emails.backfilled_at` set and never moves the cursor. It changes nothing in the mailbox.
  It refuses a window of more than 180 days. Then it re-queues real mail of the window that the worker
  skipped as `too_old` (`skipped → pending`, one `email.requeued` audit row for each mail).
  The re-queue sets `backfilled_at` = now, so re-queued mail skips the 7-day rule.
  Pilot exception (user, 2026-11-06): a window above 30 days keeps mail bodies longer than the 30-day retention (§7).
  The retention cleanup clears them when it exists.
- **UIDVALIDITY change:** per folder: rescan that folder's mail of the last 7 days; the dedup key stops duplicates; known mail only gets its new `uid`.
- **Threads:** `thread_key` = the first `Message-ID` in `References`, else `In-Reply-To`, else the mail's own `Message-ID`.
  The LLM gets the last 3 mails with the same `thread_key` from the DB as context.
- **Move:** `UID MOVE` if the server has MOVE; else the adapter's own `UID COPY` + `\Deleted` + `UID EXPUNGE` (needs UIDPLUS; never imapflow's built-in fallback, which deletes the source also when the COPY failed).
  `transferByAppend` is the other move: APPEND of the raw source with its flags (no `\Recent`, `\Deleted`, `$Junk`, `Junk`) and INTERNALDATE, then `UID EXPUNGE` of the source. The committer uses it for a move into INBOX of mail whose source folder is not INBOX (the rescue), and for an Undo into a `sort` folder (U11), because Interia sorts a COPY back (F12). It needs UIDPLUS.
  The reverse move (Undo) goes to `emails.source_folder`.
  A move can give a new UID; the system finds the mail again by identity (above), never by `Message-ID` search. The committer sets `emails.folder`, `uid` and `moved_at` after each move.
  No MOVE and no UIDPLUS: the mailbox is marked "moves not supported", and the policy logs moves only
  (a plain EXPUNGE would also delete the user's own `\Deleted` mail). Every `false` that imapflow returns from a write is a hard error.
- **Folders (D9):** `ensureFolder(name)` lists the folders and, when the folder is missing, creates each missing level, parent first. It returns the path as the server lists it.
  The committer calls it once per target per run. When the real path differs from `mailboxes.folder_map`, it stores the real path (audit `mailbox.folder_created`, folder key only).
  `emails.folder` always holds the real path.
- **Mark read / flag:** `\Seen` / `\Flagged`.
- **Draft (S4):** APPEND to the Drafts folder (the real path from `folder_map`) with the `\Draft` flag, the INTERNALDATE = the action's `created_at` and the header `X-EA-Action-Id` = the id of the draft action. APPEND returns the UID (UIDPLUS).
  The committer finds its own draft again with `locateByActionId(provider, folder, { actionId, hintUid, since })` (`mail/locate.ts`): it fetches the stored UID as a hint and compares the header; else it searches the folder `SINCE` the day before and fetches the headers in chunks.
  It never uses `SEARCH HEADER`. Nothing here writes to the mailbox.
- **Send (S4):** SMTP (`nodemailer`, `SMTPConnection`, port 465 with TLS, or port 587 with required STARTTLS, `smtp_security`) with `X-EA-Action-Id` (= the id of the draft action), a `Message-ID` that the builder made from the draft id (`<ea-<draft id>@<domain>>`) and the committer stored, `In-Reply-To` and `References`.
  The envelope sender is the mailbox address. The raw message is built only by `buildOutgoingMessage` (`packages/core`) and `composeMessage` (nodemailer `MailComposer`), so the draft and the send are byte-equal.
  After the SMTP 250 the action is `applied` at once; then a copy goes to Sent (search first, APPEND with `\Seen` if missing), because Interia saves no sent mail by itself (probe, below). At-most-once: never retry a send by itself (§4.1 rule 6).
  The error stage rule and the outcomes: §4.1 rule 6.
- **Own mail comes back (S4):** a send to an address of the same mailbox, or a copy of it, lands in INBOX with the header intact. The sync skips every INBOX message whose `X-EA-Action-Id` matches an `actions` row of the mailbox (`isOwnActionId`, wired in `main.ts` and in `backfillMailbox`); the owner's address in `From:` alone is no reason to skip.
- **Capabilities to check per mailbox (S1a):** IDLE, MOVE, UIDPLUS, CONDSTORE, SPECIAL-USE, custom keywords (`PERMANENTFLAGS \*`), auto-save of sent mail,
  `SEARCH HEADER` on a custom `X-` header.
- **Interia facts (checked 2026-11-03, `notes/2026-11-03-interia-imap-capabilities.md`):** IDLE and UIDPLUS yes; MOVE, CONDSTORE, SPECIAL-USE and custom keywords no.
  So moves use `UID COPY` + `\Deleted` + `UID EXPUNGE`. No `UIDNEXT` on SELECT: the adapter asks `STATUS`, then uses the highest UID + 1.
  `SEARCH HEADER` finds nothing for `X-` headers and for `Message-ID` (Subject works): S3 finds moved mail by identity (above). SMTP does not save sent mail: the committer APPENDs to `Wysłane`.
  A move keeps the UID (against RFC 3501): a mail moved back to INBOX is below the cursor, so S3 has the below-cursor "returned" check (above).
- **Interia move facts (S3 stage 1, 2026-11-07, `notes/2026-11-03-interia-imap-capabilities.md` "Move probe"):**
  - The hierarchy delimiter is `/`. A nested folder needs its parent first (`AI/…` with no `AI` gives `NO [ALERT]`).
  - A protocol `UID COPY` returns `COPYUID` and a new UID; a webmail move keeps the UID.
  - A COPY keeps RFC822.SIZE, INTERNALDATE, the envelope date and the `Message-ID`; `SEARCH SINCE` works in other folders.
  - `UID EXPUNGE` removes only the given UID; a COPY back to INBOX lands above the cursor; `\Flagged` and `\Seen` are set and removed as asked.
- **Interia sort folder facts (ADR 0014, `notes/2026-11-03-interia-imap-capabilities.md` § "Sort-folder probe", `notes/2026-11-07-agentmail-test-mail.md` §10):** the tabs `Oferty`, `Społeczności`, `Rachunki` and the spam folder `Wiadomości-śmieci` are IMAP folders (delimiter `/`).
  UIDVALIDITY is 1 for all folders, and the mailbox has one UID counter. STATUS gives `UIDNEXT` 1 for every folder (wrong), so `folderStatus` uses the largest of STATUS, SELECT and the highest UID + 1: the cursor of an empty first sync is the highest UID (D4).
  A `UID COPY` into `Oferty` is sorted into INBOX within minutes; an APPEND into `Oferty` stays; a COPY into `AI/*` and into the spam folder stays. `UID SEARCH SINCE` misses a mail that Interia re-sorted.
- **Interia draft and send facts (S4 stage 1, 2026-11-07, `notes/2026-11-07-send-approval-facts.md`):** the folders are `Wersje robocze` (`\Drafts`) and `Wysłane` (`\Sent`); UIDPLUS and SMTP PIPELINING are on. An APPEND with `\Draft` gives an APPENDUID, `SEARCH SINCE` finds the draft, a FETCH of the UID returns the `X-EA-Action-Id` header, and size, INTERNALDATE and the flag are kept; `UID EXPUNGE` removes it. The SMTP server answers `DATA` with 354 and the end of the data with 250. It saves no copy in `Wysłane` (polled 60 s), so the committer APPENDs one. A mail sent to the mailbox's own address is in INBOX after about 1 s, with the header intact. The test send to a real delegate is stage 22 and 23 of the S4 task (not done).
- **Interia setup:** the user turns on "korzystam z programu pocztowego" (Ustawienia → Główne ustawienia → Parametry).
  IMAP `poczta.interia.pl:993`, SMTP `poczta.interia.pl:465`, both SSL/TLS, login = the full address.
- **Later:** Gmail (OAuth, or an app password with 2-Step Verification) and Microsoft 365 (OAuth / Graph; password IMAP is off) as new adapters.
  Gmail OAuth needs Google verification and a yearly CASA assessment (`notes/2026-11-02-external-facts-gmail-gemini-telegram.md`).

### 6.2 Telegram (ADR 0005)

- One bot per environment: a dev bot and a pilot bot. Telegram allows only one update consumer per bot token.
- Long polling (grammY `bot.start`, `allowed_updates` = `message` and `callback_query`) on the dev machine and on the home VPS.
  A webhook with the `X-Telegram-Bot-Api-Secret-Token` header only when the server has a public HTTPS address.
  A 401 stops polling with one `error` line. A 409 (another process polls this token) logs one `error` line and starts again after 1, 2, 4 … at most 30 minutes.
  Any other polling failure retries on the same schedule. The command list is set with `setMyCommands` at each start.
- Linking: the CLI `telegram:link` (the web panel in S5) creates a one-time token bound to one member, valid for 15 minutes.
  The user opens `t.me/<bot>?start=<token>`. The server stores the `chat_id` for that member (table `chat_links`, §5).
- Private chats only: updates from groups, channels and bots get no reply. The server accepts updates only from linked chats:
  an unlinked chat gets no reply. Exception (D3): `/start <token>` where the token exists but is used or expired gets one short reply
  ("ask for a new link"). A chat that is linked already and sends a used token gets "This chat is linked already" and the help. An unknown token gets no reply. Inline buttons carry only a kind and ids (`callback_data` is max 64 bytes).
- Messages are plain text (no `parse_mode`) with link previews off (`link_preview_options.is_disabled`). Subjects lose links, control characters and bidi marks.
  One digest is one message of at most 4096 characters with at most 15 lines. No silent sends.
- Two bots: the dev bot (`@Email_assistant_local_bot`) and the pilot bot (`@Email_assistant_vps_bot`). Each environment has its own token.
- Token handling (D8): `TELEGRAM_BOT_TOKEN` comes only from env; an empty value switches Telegram off (`telegram is off`). No log line, error text or DB row holds it.
  Telegram errors are logged only as `telegramErrorLabel(error)` (`GrammyError <method> <code>` or `HttpError <method>`), never as `error.message`, `payload` or `description`.
- Fake Bot API (dev only): `TELEGRAM_API_ROOT` points the bot at the local fake `tools/fake-telegram`. Empty = the real Telegram.
  The config accepts only a loopback root (`127.0.0.1`, `localhost`, `[::1]`, no path, no trailing `/`); other values stop the start. The server logs one `warn` line when it is set and Telegram is on. `telegram:check`, `telegram:link` and the Telegram jobs of `job:run` use the same key. Never set it on the VPS.
- Messages to the user are rows in the `outbox` table (§5). Delivery is at least once: a duplicate is possible only when the process dies
  or the network breaks between the Telegram answer and the DB commit. Command replies and button answers go out at once, not through the outbox.
- Content on Telegram: notices, digest lines (sender, subject, AI summary), draft text for approval. No raw mail bodies.
  Bot chats are not end-to-end encrypted; the user accepts this content on Telegram servers.

### 6.3 LLM (ADR 0007, ADR 0012, ADR 0013, ADR 0015)

- Two providers behind one switch (ADR 0015): `LLM_PROVIDER` = `gemini` (code default) or `openai`; a restart applies it. The shared client is `platform/llm/`; the adapters are `platform/llm/providers/gemini.ts` (the only file that imports `@google/genai`) and `providers/openai.ts` (the only file that imports `openai`; Responses API, strict JSON schema, `store: false`). The pilot VPS runs `openai` with `OPENAI_MODEL_CLASSIFIER` = `gpt-6-luna` (default pick, user 2026-11-07). OpenAI keys: `OPENAI_API_KEY`, `OPENAI_MODEL_CLASSIFIER`, `OPENAI_TIMEOUT_MS`, `OPENAI_RPM`, `OPENAI_REASONING_EFFORT`. A third provider = one adapter file, one registry row, one config block, price rows and one eval run. No automatic fallback.
- Roles come from one role table (`llmRoleTable`, `platform/config.ts`): five roles, `classifier`, `judge`, `drafter`, `extractor`, `escalation`. The classifier reads `LLM_PROVIDER`, `GEMINI_MODEL_CLASSIFIER` or `OPENAI_MODEL_CLASSIFIER`, `*_TIMEOUT_MS`, `*_RPM` and `OPENAI_REASONING_EFFORT`. The other roles read `LLM_<ROLE>_PROVIDER`, `_MODEL`, `_TIMEOUT_MS`, `_RPM`, `_REASONING`; an empty key falls back to the classifier (same provider) or to the provider's keys (D10). The start checks refuse a role whose provider has no API key, a reasoning key on Gemini, and `_MODEL` without `_PROVIDER` (D11). There is one rate limiter per provider, and one more per role with `LLM_<ROLE>_RPM` (D12). The provider SDK client is built at the first call. Code calls `llm.generate({ role, … })` and never picks a model. Gemini model ids from config: `GEMINI_MODEL_CLASSIFIER` (default `gemini-3.5-flash-lite`).
  **The writer role is not used in S4:** drafts are templates (`packages/core/src/outgoing/templates.ts`); the fields (delegate id, task, due date, question) come from the classifier (prompt `classifier-v2`). The drafter role replaces the writer role.
- The `llm.call` audit row carries `role` and `prompt_version`. `countLlmCallsSince` counts per role; rows without a role are classifier rows.
- **Classifier model (provisional, stage 34, 2026-11-05):** `gemini-3.5-flash-lite`. The eval on the 92 synthetic and injection cases ran with it:
  91 cases answered (1 `http_503`), whitelist 12/12, injection 12/12, hard rules 6/6. Precision was 76.5% for `info` and 84.2% for `spam`,
  so no category reaches the 98% bar yet. The comparison with `gemini-3.8-flash` (stage 36) was dropped after the OpenAI switch.
  The model choice lives here and not in ADR 0013.
- **Real-mail result (S1b stage 40, 2026-11-06):** 123 labeled real pilot mails (Gemini 36, `gpt-6-luna` 87). Every category is no-go:
  notification 96.2%, spam 83.6% precision; urgent, needs_reply and info have 1 kept row each. The pilot VPS uses OpenAI `gpt-6-luna` since 2026-11-06.
  Detail: `spec/features/done/2026-11/F025-s1b-shadow-run/plan.md` "Results".
- Structured output: JSON schema from the Zod schema in `packages/core`; the result is checked with Zod again.
- **`classifier-v2` (S4):** the prompt adds the category `delegation` (only when the mailbox has active delegates), a `Delegates` block (id, name, tags) after the sender context, and the fields `delegate_id` (an enum of the listed ids, or null), `task` (at most 300 characters) and `clarification` (at most 200 characters).
  A real-provider check with the delegates block passed on Gemini and OpenAI (a nullable field with an empty list is accepted by both).
- **Eval of `classifier-v2` (S4 stage 20, 2026-11-07, OpenAI `gpt-6-luna`, 108 cases, 0 errors, `evals/results/2026-11-07-gpt-6-luna-classifier-v2.md`):** injection 16/16, whitelist 12/12, delegate pick 8/8, draft kind 16/16. **The gate has one miss:** on the same 92 old cases, `info` precision falls 5.8 points against v1 (limit 5; one mail, `syn-urgent-16`). The result waits for the user's decision; until then no VPS deploy of a commit after `c0340b4`.
- Each call: timeout 30 s (`GEMINI_TIMEOUT_MS`); a rate limiter keeps calls under `GEMINI_RPM` (default 12) in this process.
  Simple calls: no `temperature` and no thinking setting; each model uses its default thinking (`gemini-3.5-flash-lite` defaults to minimal, Google thinking page, read 2026-11-04).
  Error classes (soft, config, safety block, hard) and the pause: §4.1 rule 7.
- `triage_results` stores model, prompt version, tokens in/out and latency. Output tokens include thinking tokens.
- **Triage config keys:** `TRIAGE_LLM_SCOPE` (default `off`): `off` = no triage worker; `synthetic` = only the seeded test mail of every mailbox;
  `all` = also real mail of every active mailbox of an organization that is not `suspended`. The server refuses to start with `synthetic` or `all` and no key for the chosen provider (`GEMINI_API_KEY` or `OPENAI_API_KEY`).
  `LLM_DAILY_CAP` (default 300): the cap of §4.1 rule 8.
  `GEMINI_RPM` (default 12). The LLM pause (§4.1 rule 7) has no key: 5 min, doubling to 60 min.
- **Data by stage:** OpenAI (pilot, since 2026-11-06): paid API terms, no training on API data, abuse logs up to 30 days, no EU location; accepted by the user for their own mail (ADR 0015). Gemini: pilot = Gemini API free tier for the temporary pilot mailbox (ADR 0013; the free-tier terms allow human review and training;
  accepted by the user 2026-11-04); the paid tier (55-day abuse logging, no EU location, accepted 2026-11-02) when billing goes on.
  Vertex AI with the EU endpoint and its zero-data-retention setup before the first external customer.
- **Billing gate:** free tier only with test data. The temporary pilot Interia mailbox counts as test data (ADR 0013, user 2026-11-04).
  Cloud Billing (or Vertex AI) on before any other person's mail.
- `evals/` holds synthetic and injection cases. A prompt or model change must pass the eval before merge (§9).

## 7. Security and privacy

- **Credentials (ADR 0009):** AES-256-GCM in the server, key `CREDENTIALS_KEY` from env with a key version. The secret is decrypted only in memory.
  It never goes to logs, to the web app or to Telegram. The Telegram bot token (`TELEGRAM_BOT_TOKEN`) is also a secret: env only, never in a log line, error text or DB row (§6.2). Prefer an app password: the stored secret opens the whole mailbox.
- **TLS:** IMAP and SMTP always check certificates.
- **Mail host check (S6b):** every IMAP and SMTP connect (connect form, sync, send, checks, probes) resolves the host once. It refuses loopback, private, link-local, `100.64.0.0/10`, `198.18.0.0/15`, `192.0.0.0/24`, multicast, reserved, NAT64, 6to4 and the IPv6 local ranges. It connects to the checked address and passes the host name for the certificate (`modules/mail/host-guard.ts`). `MAIL_ALLOW_LOCAL_HOSTS=true` turns the check off for local hosts: only in dev and e2e (the old name `WEB_MAIL_ALLOW_LOCAL` still works). A host the guard refuses is a `sync <id> failed: host not allowed` log line today.
- **Web access (ADR 0017):** the panel is reachable only through Tailscale Serve (HTTPS, tailnet members only, no Funnel). The server listens on `127.0.0.1:8080` of the host. The code treats the panel as public; the S6 scope change keeps it behind Tailscale.
- **Web security (ADR 0016):** the server runs these checks. The list is by topic, not in the order of the code.
  - **Secret:** `WEB_AUTH_SECRET` (at least 32 characters, env only, never in a log) signs the session. The config check needs it when `WEB_BASE_URL` is set. An empty `WEB_BASE_URL` turns the web off.
  - **Session cookie:** Better Auth sets it (prefix `ea`): `HttpOnly`, `SameSite=Lax`, `Secure` when `WEB_BASE_URL` starts with `https://`. The session lasts 30 days and renews after one day of use (sliding). There is no cookie cache, so a revoked session ends at the next request. A password reset ends all sessions of the user.
  - **Origin check:** every method except GET, HEAD and OPTIONS under `/api` needs an `Origin` that is `WEB_BASE_URL` or in `WEB_TRUSTED_ORIGINS`. Without an `Origin` (or with `null`), the header `Sec-Fetch-Site` must be `same-origin`. Else the answer is `403 bad_origin`.
  - **Body and headers:** `bodyLimit` of 64 KB under `/api`. `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, HSTS only on `https://`.
  - **CSP (D5):** the header has `frame-ancestors 'none'`. Astro adds a meta CSP to each page (`default-src 'self'`, `img-src 'self' data:`, `connect-src 'self'`, `font-src 'self'`, `form-action 'self'`, `base-uri 'self'`, `object-src 'none'`) with hashes for the inline island scripts. `script-src` never has `'unsafe-inline'`. `style-src` has it (the Radix scroll lock injects a style); the integration `apps/web/integrations/csp-style-src.ts` sets that after the build.
  - **Auth allow-list:** only `sign-in/email`, `sign-out`, `get-session`, `reset-password` (POST, and GET `reset-password/<token>`), `change-password`, `revoke-other-sessions` and `revoke-sessions` reach Better Auth, and `request-password-reset` (POST) when the auth-mail sender is on (else 404). Every other `/api/auth/*` path answers 404. `list-sessions` is not open: it returns session tokens (the panel uses `GET /api/me/sessions`). Sign-up is off (`disableSignUp`); the password has 12 to 128 characters.
  - **Rate limit and trusted proxy:** Better Auth limits requests per client address (`reset-password` and `change-password`: 5 per 60 s). The server computes that address: the TCP peer, or the last `X-Forwarded-For` hop that is not trusted when the peer is in `WEB_TRUSTED_PROXIES`. It passes the result in `x-client-ip` and deletes any `x-client-ip` from the client. With Tailscale Serve the peer is the Compose gateway, so `WEB_TRUSTED_PROXIES` is that gateway (`deploy/README.md`, Web panel).
  - **Reset request:** `POST /api/auth/request-password-reset` gives the same answer for every address. Limits: 3 per 15 min per client address and 3 per hour per address (the 4th gets the same answer and no mail). The send does not hold the request. A server link lasts 1 hour; a CLI link (`org:invite`, `web:invite`) lasts 24 hours.
  - **Auth mail:** `AUTH_SMTP_HOST`, `AUTH_SMTP_PORT`, `AUTH_SMTP_SECURITY`, `AUTH_SMTP_USER`, `AUTH_SMTP_PASSWORD`, `AUTH_MAIL_FROM`: host, user, password and from are all set or all empty. Certificates are checked; the timeout is 15 s; the mail is plain text with no tracking; no outbox row exists (the link is a secret). A failed mail is a `warn` line (user id and code) and the operator notice `auth_mail_failed` (one per user, code and day). The sender is off on the home VPS: the CLI prints the links.
  - **Lockout:** 10 failed sign-ins in 15 minutes lock the user for 15 minutes. A locked user gets the same answer and time as a wrong password. One mail goes per lock, at most 3 per day. A password reset ends the lock. Audit `web.login_locked`; table `auth_lockouts`.
  - **Leaked passwords:** a password set or change asks the Have I Been Pwned range API (`platform/pwned.ts`; 5 hex characters of the SHA-1 leave the server). The timeout is 5 s. The check fails closed: `400 PASSWORD_COMPROMISED` for a listed password, `503 PASSWORD_CHECK_UNAVAILABLE` when the API fails; nothing changes. `AUTH_PWNED_CHECK=off` is for tests only.
  - **Terms:** `TERMS_VERSION` is in `packages/core`. Every password set through a link (`/reset-password`) needs it (`400 TERMS_REQUIRED`); a password change in the Account card does not (B10) and writes `users.terms_version` and `terms_accepted_at`; audit `web.terms_accepted`. A newer version shows a blocking dialog after sign-in; `POST /api/me/terms` accepts it. The stub pages `/legal/{pl,en}/{privacy,terms,dpa}` are public.
  - **Sessions:** the Account card lists the live sessions (device, address, last day of use), never the token (`GET /api/me/sessions`, through the Better Auth internal adapter; `deviceOf` in `packages/core` makes the device text). "Sign out everywhere" writes `web.sessions_revoked` or `web.other_sessions_revoked`.
  - **Tenant and role:** the session gives the user, the user's oldest membership gives the organization and the role (D3). Pages, except `/login`, `/setup`, `/forgot`, the legal pages and the static assets, redirect to `/login` without a session.
  - **Audit:** a login, a first or reset password, a password change, a lock, accepted terms and ended sessions are audit rows (`web.login`, `web.password_set`, `web.password_changed`, `web.login_locked`, `web.terms_accepted`, `web.sessions_revoked`, `web.other_sessions_revoked`; ids only).
- **Backups hold auth secrets:** the dump holds live `auth_sessions` tokens, password hashes and reset tokens. After a real restore, run `delete from auth_sessions;` and ask the members to sign in again.
- **Tenant isolation:** `TenantContext` in every server query; DB role `app` without superuser rights; tests for the filters (ADR 0011).
- **Untrusted text in and out.** Mail text is untrusted, and so is text that the LLM writes from it.
  - **The schema enum:** the email goes into a marked data block (a random id per request); the output schema has enums and ids only. The delegate id is an enum of the ids in the prompt (or null), and the code checks it again. A recipient is never LLM text (§4.1 rule 2).
  - **The marked text:** LLM text that reaches a draft (task, question) goes through `markUntrustedText` and loses line breaks: addresses become `[address]`, links `[link]`, account and phone numbers `[account number]` and `[phone]`, and `@` becomes `(at)`.
  - **The template:** a delegation, clarification or reminder is a fixed template. The LLM fills only the task, the due date and the question. The delegation quotes the original mail under the template line. The approval message shows the quote with links as `[link]`.
  - **The warning:** the approval message shows the recipient, the original sender with an "external sender" warning, and the full draft (§4.5). Only an owner can tap Send.
  - **The eval:** `evals/` has prompt-injection cases from S1b and four more for delegation (`inj-13` to `inj-16`). `injectionHolds` fails a case when the model plans any `create_draft` or `send` for an injected mail, or when a payload holds an `@`. Result of `classifier-v2`: 16/16 (§6.3).
- **Logs:** no mail bodies, no passwords, no keys. S3 logs and audit rows hold ids, counts, action types, folder keys (not paths from mail data or user input), codes and times; an error goes through `describeError`.
- **Retention:**

  | Data                                             | Where                                                               | Kept                                                                                                                                      |
  | ------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
  | Mail body text                                   | `emails.body_text`                                                  | 30 days (`organizations.data_retention_days`)                                                                                             |
  | Subject, addresses                               | `emails`                                                            | 90 days, then cleared (the row stays for counts)                                                                                          |
  | Summaries, draft text, reasons, extracted fields | `actions.payload`, `triage_results.reason`, `triage_results.fields` | 90 days                                                                                                                                   |
  | Task text                                        | `delegations.task_summary`                                          | 90 days after the delegation closes (`done`, `answered`, `cancelled`, or `overdue` with both reminders sent); an open delegation keeps it |
  | Error text                                       | `actions.last_error`                                                | 90 days (and no mail text in it)                                                                                                          |
  | Message text                                     | `outbox.text` (digests and notices)                                 | 90 days                                                                                                                                   |
  | Audit events (ids, codes, numbers)               | `audit_log`                                                         | until the mailbox or organization is removed                                                                                              |
  | Labels (no mail text)                            | `triage_feedback`                                                   | until the mailbox or organization is removed                                                                                              |

  The job `platform.retention` runs daily at 02:40 for every organization, of every plan (a paused mailbox, a `suspended` organization and `TRIAGE_LLM_SCOPE=off` change nothing). It clears each text of the table in batches of 1 000 rows, skips rows that another job holds (they wait for the next day), and logs counts only. It never touches `audit_log` or `triage_feedback`. Old `chat_link_tokens` rows go after 1 day (used or expired). The technical ids `message_id_header`, `dedup_key`, `thread_key` and `content_hash` stay: the sync finds mail by them.
  The rule for pending and processing rows: the body of a `processing` mail stays while its lock is younger than both the retention period and 7 days (the running triage reads it; an older lock is stuck), and the body of a `pending` mail goes only after 7 days. A backfilled `pending` mail that lost its body is `skipped` with `body_expired` (no LLM call). The payload of an `applying` `create_draft` or `send` goes 90 days after its last change; the applied draft of an open delegation keeps its payload (the chaser reads its language and due date). A `pending` or `sending` `outbox` row older than 90 days becomes `failed` / `expired` and loses its text. A draft of a mail without a body quotes nothing, and "Send again" on a failed send without a payload answers `draft_gone`.

- **Delete:** removing a mailbox deletes the mailbox, its credentials, settings, mailbox-scoped sender rules, emails, results, feedback,
  actions, delegations and audit rows, and clears the text of the digest rows in `outbox` of the organization (digests mix mailboxes) — one privileged function.
  Then it tells the user to change the mailbox password.
  The web calls the function `delete_mailbox(org_id, mailbox_id)` (migration `20261111000001`): `SECURITY DEFINER`, owned by `migrator` (it runs the migration), `EXECUTE` only for `app`, a fixed `search_path`.
  It is the only path that deletes `audit_log` rows, because `app` may not. The function also drops pending and sending digest rows and sets the text of sent and failed digest rows to `[removed]`.
  The web then queues a `mailbox_removed` notice to every owner (no address in the text).
  Removing an organization deletes everything.
- **Privacy by stage:**

  |             | Pilot (the user's own mail)                                                                                                                                                                                | External customers (S6)                                   |
  | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
  | LLM         | Gemini API free tier for the temporary pilot mailbox (ADR 0013: human review and training allowed by the free-tier terms, accepted). Paid tier (55-day abuse logging, no EU location) when billing goes on | Vertex AI EU endpoint; zero-data-retention setup          |
  | Server + DB | home VPS of the user                                                                                                                                                                                       | hosted EU VPS                                             |
  | Papers      | —                                                                                                                                                                                                          | Privacy policy names Google as processor; DPA with Google |

## 8. Reliability and operations

- **Scheduler** (in the server process, `croner`, one tick never overlaps the next): mail sync every 5 min per mailbox;
  triage worker, committer and returned job every 15 s; approval expiry hourly; retention job `platform.retention` daily at 02:40 (the backup runs at 03:30);
  operator notices `channels.operator` hourly at minute 13; chaser every 15 min (S4, acts at 07:30 local time).
  S2 jobs: `channels.notifier` every 15 s (notice detection, then the outbox sender; at most 3 messages per user per tick;
  a 429 waits `retry_after`, a network error or HTTP 5xx backs off from 30 s to 15 min, a 401 pauses sending for 10 min,
  a 403 marks the row `failed` / `blocked`, a row older than 24 h becomes `failed` / `expired`) and `channels.digest` every minute
  (the digest at each member's times in the organization timezone; a missed slot is sent if the server is back within 6 hours).
- **S3 jobs:** `actions.committer` (every 15 s; per active mailbox it expires stale `ready` originals, claims by `ACTIONS_SCOPE`, applies, §4.1 rules 6 and 7)
  and `triage.returned` (every 15 s, always on; turns `returned_at` into feedback, §4.4).
  `channels.notifier` also detects failed actions: one `action_failed` notice per failed action (not for `save_summary`) to the linked owners (dedup `action_failed:<action id>`; `actions.notified_at` is set in the same transaction;
  a row older than 24 h is marked notified with no notice; an original row with `mail_not_found` gets none). The text names the action, the cleaned subject, "tried 3 times" and where the mail is.
- **S4 jobs:** `actions.expiry` (`actions/expiry.ts`, every hour at minute 7; all mailboxes, also paused ones) ends a send that nobody answered or that is held: `timeout` (`awaiting_approval` 48 h after `notified_at`, with a `sent` outbox row of its request), `not_seen` (the same age and no `sent` row; not for a suspended organization), `draft_missing` (its draft is `failed` or `undone`), `not_notified` (no approval request went out within 7 days of creation) and `held_timeout` (`approved` 48 h after the tap, not locked). It cascades in one transaction: the send, the draft (a reverse row or `expired`) and the delegation (`cancelled`). A send in flight (`applying`, or `approved` with a fresh lock) finishes. The log line holds the counts per reason.
  `delegation.chaser` (`delegation/chaser.ts`, a tick every 15 min) acts once per local day per mailbox, from 07:30 in the organization timezone, only in `assist` mode with the switch `create_draft` on: it marks `sent` delegations past `due_at` as `overdue` and plans a reminder (draft + send, `awaiting_approval`) for every overdue delegation with an active delegate, at most 2 reminders per delegation, 3 days apart, at most 10 per run (one set message, §4.5). A reminder is never sent without a tap. The run writes an audit row `delegation.chaser_run`; the first statement of its transaction share-locks the settings row and compares the settings version (the S3 `saveTriage` rule), so a settings change makes it skip.
  `bun run job:run --name <job> [--force]` runs one of them once (`actions.expiry`, `delegation.chaser`, `actions.committer`, `channels.notifier`, `platform.retention`); `--force` skips the 07:30 and once-per-day gate of the chaser.
- **Plan state (S6a):** `organizations.plan` is `trial`, `active` or `suspended`. The operator changes it with `bun run org:plan` (audit row `org.plan_changed`). A `suspended` organization is paused by the operator:
  - **Jobs.** These skip it: mail sync, triage worker, `triage.returned`, committer, chaser, notice detection, digests and the outbox sender (its pending rows wait). The approval expiry and `platform.retention` still run for it. Every job reaches mailboxes through `listSyncTargets`, `listMailboxTargets` or `listLinkedChats`, which skip a `suspended` organization unless the caller sets `includeSuspended`. The sync, triage and committer loops check the plan before each mailbox, so a run that started before the change stops at the next mailbox. A send in flight finishes.
  - **Queued messages.** The change to `suspended` sets every `pending` outbox row of the organization to `failed` / `outdated`, except the kinds `approval` and `approval_set` (the notifier queues them only once).
  - **Approval requests at resume (F079).** The change from `suspended` to `trial` or `active` ends every send that is `awaiting_approval` with `notified_at` before `resumed_at` and no `sent` outbox row of its request (`approval:<send id>` or `approval_set:<set id>`): a request that no owner saw. The send ends as `expired` with the reason `not_seen`, in the same transaction as the plan change (`setOrgPlan` hook `onResumed`; `bun run org:plan`). The cascade is the one of `expireSend`: the draft (a reverse row or `expired`), the delegation (`cancelled`), one `action.expired` audit row. Each owner gets the result notice "you did not receive the approval request (the account was paused, or it did not go out)". The `pending` approval requests of the ended sends, and a `sending` one with a claim older than 5 min (a crash left it), become `failed` / `outdated`, so no stale request goes out; a `sending` row with a fresh claim finishes. A request that an owner already received stays: its send waits for a tap or ends by the 48 h rule. A send with `notified_at` null stays: the notifier queues its request after the resume with a fresh text. The expiry job (it also runs for a suspended organization) ends a send as `timeout` only when a `sent` outbox row of its request exists. An old request with no `sent` row ends as `not_seen` when the organization is not suspended; while it is suspended, the send waits for the resume hook. So no send ends as `timeout` without a delivered request.
  - **Telegram.** Every command except `/help`, and every tap, answers "account paused" and changes nothing. `/start` linking still works.
  - **Web.** Every write under `/api` answers `403 org_suspended`, except the paths in `SUSPENDED_WRITE_ALLOW` (none in S6a). Sign-out and the password routes are Better Auth paths outside `/api`, so they work. Reads work. The panel shows a paused banner with `OPERATOR_CONTACT`.
  - **Resume.** The change from `suspended` to `trial` or `active` sets `resumed_at`. Mail with `received_at` more than 24 h before `resumed_at`, stored before `resumed_at` + 24 h and not backfilled, becomes `skipped` with `suspended_backlog` (no LLM call; the digest counts it on its own line). The sync-late notice and its 30 min grace count from `resumed_at`, and the urgent look-back starts at `resumed_at`. Stale `ready` actions expire at the first committer run (24 h rule).
  - **48 h rule.** For every plan, the committer claims an `approved` send only when the tap is less than 48 h old. A send approved before a pause ends as `held_timeout` after it.
  - **Mailbox limit.** `connectMailbox` (web and CLI) refuses a mailbox above `max_mailboxes` with `mailbox_limit` (web: `409`). The count runs under an advisory lock after the IMAP check, so two connects at once give one success.
- **Operator notices (S6a):** `channels.operator` sends three events to the operator chat `OPERATOR_TELEGRAM_CHAT_ID` by a direct send, or writes a `warn` log line when the key is empty. The texts hold ids, dates and counts only. The events and their keys are `trial_ending` (`trial_ending:<org id>:<trial_ends_at ms>`, 3 days before the end and after it), `llm_cap` (`llm_cap:<mailbox id>:<quota day start>`, sent by the triage job when a mailbox reaches `LLM_DAILY_CAP`) and `auth_error_24h` (`auth_error_24h:<mailbox id>:<status_changed_at ms>`, a mailbox in `auth_error` for 24 h). The dedup is an audit row `operator.notice` with the key, written after a successful send: a crash between the send and the row repeats one notice (at least once). A failed send is tried again at the next hourly run. Quiet hours do not apply. A suspended organization gets no `trial_ending` or `auth_error_24h` notice.
- **Work queue:** `emails` and `actions` rows with `status`, `attempts`, `next_attempt_at`, `locked_at`, claimed with `FOR UPDATE SKIP LOCKED`.
- **Mailbox errors:** IMAP/SMTP login error → mailbox `auth_error`, a Telegram notice to the linked owners (one per `status_changed_at`), other mailboxes continue.
  The way out is `bun run mailbox:password` (new password on stdin, login test, `auth_error` → `active`). Connection errors → backoff.
- **Notices (S2):** urgent mail goes to every linked member (24 h look-back, one notice per mail). `auth_error`, sync late and sync works again go to linked owners only.
  Notices never go out in quiet hours (22:00–07:00 in the organization timezone); they wait until 07:00. Digests go out at their times.
  Sync late: an `active` mailbox whose last good sync is older than 30 min, not within 30 min after the mailbox became `active` again,
  and only 10 min after the process started. One notice per episode (the episode is the `last_synced_at` value). When the sync is fresh again, a sent
  "late" notice gets one "sync works again" notice. An unsent notice that is out of date becomes `failed` / `outdated`. A paused mailbox gets no urgent or sync notice.
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
  `bun run llm:check --provider <gemini|openai>` sends the real triage schema to one provider. `bun run eval --provider <id> --model <id>` runs the cases per provider (results in `evals/results/`).
  `bun run eval` options: `--per-category n` (a subset), `--retries n` (soft-error retries per case), resume from a state file in `evals/.runs/`
  (`<model>-<prompt-version>-<set>[-pc<n>].jsonl`, outside git; `--state` sets another file, `--fresh` starts again),
  a minimum support of 30 kept rows per category (`--min-kept`), a confidence histogram, and `--real` (labels from `triage_feedback`, no LLM call).
  Exit code 0 = pass, 1 = a check failed (whitelist, injection, or too many error cases), 2 = the run is not complete (run the same command again).
  `evals/README.md` has the commands.
  CI runs the eval only when `prompts/`, `evals/` or the model config change, with a paid key and a budget alert.
- **Web (Playwright, as built in S5d):** `bun run test:e2e` (`apps/web/e2e/`). Two projects, run one after the other with one worker: `mobile` (Pixel 7) and `desktop` (1280×800). 20 tests per project, 40 in all (specs: auth, account, mailboxes, onboarding, settings, rules, activity).
  The run uses its own database (`E2E_DATABASE_URL`, `E2E_MIGRATOR_DATABASE_URL`; a target that the seed would wipe is refused), the real server on port 8081, the fake Telegram server (`tools/fake-telegram`) on port 8092 and the GreenMail of `bun run dev:up`.
  `bun run e2e:seed` creates the fixed organization. CI has an `e2e` job with the same keys. Server code has route tests with `app.request` (`apps/server/src/**/*.test.ts`) next to the integration tests.
- **CI:** GitHub Actions — lint, typecheck, unit tests, integration tests (service containers: Postgres, mail server).
- **Containers and time (estimates):**

  | Step                             | Container use                                                                    | Time                                           |
  | -------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
  | Dev loop on the Mac              | only `db` runs in a container; the server runs with `bun --watch`                | restart < 1 s                                  |
  | Unit tests                       | none                                                                             | seconds                                        |
  | Integration tests                | `db` (and the mail server) already running                                       | seconds to start, plus test time               |
  | CI                               | service containers start in parallel with checkout and install                   | about +10–20 s per run                         |
  | Server image build (deploy only) | `oven/bun` base; the dependency layer is cached while `bun.lock` does not change | first build about 1–2 min, later about 10–30 s |
  | Postgres image                   | stock `postgres:17`, no build                                                    | one pull, start in seconds                     |

## 10. Deployment

- **Dev:** the user's Mac (Docker CLI + Colima, started at login). `docker compose up db`, server with `bun --watch`, the dev Telegram bot, GreenMail as the local test mail server (no second Interia account: the pilot mailbox is the test mailbox, ADR 0013).
- **Pilot:** the home VPS, on all the time. Compose (Docker, user decision 2026-11-03) with two services:
  - `db`: `postgres:17`, a named volume, no public port;
  - `server`: an image built on the VPS from the repo, `restart: unless-stopped`, env file with mode 600.
    `deploy/compose.yaml` is the VPS file; `deploy/compose.dev.yaml` adds the dev `db` port 5433 and GreenMail on the Mac.
    Restart after a reboot: `systemctl enable docker` + `restart: unless-stopped` (reboot test passed 2026-11-03). Facts: `notes/2026-11-03-pilot-vps.md`.
    No inbound port: IMAP, SMTP, Telegram long polling and Gemini are outbound connections.
    The web panel is the one inbound path, and it does not open a port on the router: the server port is published on `127.0.0.1:8080` only (`ports: ["127.0.0.1:8080:8080"]`).
    Tailscale on the host (`tailscale serve --bg 8080`) gives HTTPS at `https://<machine>.<tailnet>.ts.net` to tailnet members only (ADR 0017). `WEB_BASE_URL`, `WEB_AUTH_SECRET` and `WEB_TRUSTED_PROXIES` are the env keys of the web.
    The steps (Tailscale, turn on, first password, access checks, roll back) are in `deploy/README.md`, section Web panel.
- **Production for external customers (S6):** a hosted EU VPS with the same Compose files (availability, physical security, GDPR duties of a processor).
- **azyl dev server:** demos with test data only. Its home folder is shared with other projects (skill `vps-ssh`).
- **Config:** env only; `.env.example` lists every key; the server checks env with Zod at start.

## 11. Delivery slices

Detail, scope, sizes and dependencies: `docs/roadmap.md`. Goal, done-when, plan and status of each slice: its task file in `tasks/`.

| Slice                             | Content                                                                                                                                                                                                                         | Task file                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| S0 Foundation                     | Workspaces, env check, logger, DB layer + migration runner, tenancy tables, Compose `db` for dev, CI, `/health`, old code removed                                                                                               | `s0-foundation.md`                  |
| S1a IMAP read + pilot host        | IMAP adapter (read), connect CLI, encrypted password, sync with the IMAP rules, test mailbox, Compose on the home VPS, heartbeat, backups                                                                                       | `s1a-imap-read-pilot-host.md`       |
| S1b Shadow triage                 | Hard rules, classifier, planners, policy (`shadow`), audit, feedback table, labeling CLI, eval runner, cost caps; gate: free tier only for the temporary pilot mailbox (ADR 0013), Cloud Billing before any other person's mail | `s1b-shadow-triage.md`              |
| S2 Telegram                       | Bot, chat linking, shadow digest with feedback buttons, urgent and `auth_error` notices, commands                                                                                                                               | `s2-telegram.md`                    |
| S3 Assist actions                 | Committer, folder moves / mark read / flag, Undo, retries, go/no-go per category, mode switch                                                                                                                                   | `s3-assist-actions.md`              |
| S4 Drafts + approval + delegation | Delegation and clarification drafts, approval with buttons, send by SMTP, delegations, chaser, injection guards                                                                                                                 | `s4-drafts-approvals-delegation.md` |
| S5 Web panel (lite)               | Login, connect mailbox, link Telegram, settings, rules, activity                                                                                                                                                                | `s5-web-panel.md`                   |
| S6 Pre-sale                       | Sign-up, billing, deletion, hosted EU production, Vertex AI EU, privacy policy + DPA, cost model                                                                                                                                | `s6-pre-sale.md`                    |
| Phase 2                           | Gmail and Microsoft 365 adapters (OAuth; Gmail needs Google verification), style learning, two-way chat + voice, meetings + calendar, mobile app, RAG                                                                           | —                                   |

## 12. What happens to the current code

| Current                                                                                             | Decision                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/` (Bun package)                                                                            | Becomes `apps/server/` (S0).                                                                                                                                    |
| `src/` Astro starter                                                                                | Becomes `apps/web/` (S0); the web stack is decided: Astro static build with React islands, served by the server (ADR 0016).                                     |
| `backend/supabase/` and migration `20251202212208_…`                                                | Removed in S0 (ADR 0011). New SQL migrations in `db/migrations/`.                                                                                               |
| `IDatabaseProvider` / `SupabaseAdapter` (generic CRUD)                                              | Removed. Typed repositories per module with transactions.                                                                                                       |
| `ImapEmailProvider`                                                                                 | Deleted in S0. S1a reads it from git if needed: `git show 29e9522:backend/src/adapters/providers/email.provider.ts`.                                            |
| `get_provider.ts` (`Providers` factory)                                                             | Removed. It turns off the TLS check for Interia (line 35).                                                                                                      |
| `OpenAIAdapter` / `ILLMProvider`                                                                    | Replaced by `platform/llm/` (Gemini and OpenAI adapters; ADR 0015).                                                                                             |
| `backend/src/scripts/gemini_test.ts`                                                                | Moved in S0, replaced by `apps/server/src/scripts/llm-check.ts`; `bun run llm:check --provider <id>` runs from the repo root (`gemini:test` stays as an alias). |
| Dependencies `openai`, `express`, `helmet`, `cors`, `googleapis`, `@supabase/supabase-js`, `dotenv` | Removed in S0 (Bun reads `.env`). `imapflow` and `@google/genai` stay.                                                                                          |
| `utils/log.ts`                                                                                      | Kept and extended (levels, module prefix).                                                                                                                      |
| `.ai/` docs                                                                                         | Kept as history. Code rules for agents: `docs/code-patterns.md`.                                                                                                |
