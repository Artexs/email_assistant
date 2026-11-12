> **Status 2026-11-12 — in progress — master plan written and cold-reviewed (22 findings fixed), waiting for the user's approval.** The user accepted all defaults (Q1–Q15). Left: the user's OK; user step U0 (the Telegram question to a lawyer); then the `plan-task` session of S6a (detailed stage files) and its build with `run-task`. The other user steps (U1–U10) can start now.

# S6 Pre-sale

Scope: `docs/roadmap.md` §2, row S6. Modules: `docs/modules.md`. Needs: S5 (done, `tasks/done/s5-web-panel.md`).
Git mode: master (this plan). Each segment builds in `worktree` mode on its own branch `task/s6<x>-<name>`.

## Goal

The first external customer can sign up: sign-up, billing, account and data deletion, hosted EU production, Vertex AI EU, privacy policy and DPA, cost model.

## Done when

- The first external customer got an invite, set a password on the public domain, accepted the terms, connected a mailbox, and gets triage results (S6b, S6f).
- Every mailbox of a customer is processed without `TEST_MAILBOX_ADDRESS`; a mailbox in `shadow` mode never gets a mailbox action; a `suspended` organization gets no sync, triage, action, send or digest (S6a tests).
- The retention job clears the texts after the periods of `docs/architecture.md` §7 (S6a tests, and one run on production).
- `platform/llm/` calls Vertex AI in an EU region with caching off and request logging off; the eval passes the gate of D16 (S6d).
- A deletion test removes every row of an organization; the panel tells the user to change the mailbox passwords (S6c).
- The privacy policy, the terms and the customer DPA are public pages in Polish and English, reviewed by a lawyer, and they name every sub-processor (S6e, user step).
- A one-page cost model gives the price per mailbox (`docs/cost-model.md`, S6e; the user sets the price).
- The pilot organization runs on the hosted EU production; the home VPS runs staging (S6f).

## Plan

> **How this plan is organised (same shape as S5, P15):** this file is the S6 **master plan**: the decisions, the facts, the rules for every step, the user steps, the checkpoints, the review model and the list of segments. Each segment is its own task file in `tasks/planned/s6a-…` to `s6f-…` (goal, scope, the decisions that it owns, a stage sketch, done-when). **A segment gets its detailed stages (Goal, Files, Interfaces, Decisions, Test, Check, Done when, Out of scope; one file per stage) in its own `plan-task` session right before its build.** That session reads this file first. The build of a segment runs with `run-task` (`Run mode: pipeline`, `Git mode: worktree`). The main session wrote this master plan with the `plan-task` skill; handoff `~/.pi/agent/notes/2026-11-12-handoff-s6-plan.md`.

### Planning progress

The resumed session reads this file, then continues at the first unticked item.

- [x] Collect: handoff, task files, ADR 0015–0017, roadmap, architecture §7 and §10, product brief, code of `platform/auth.ts`, `platform/llm/providers/gemini.ts`, `modules/tenancy`, `modules/actions/scope.ts`, `modules/triage/jobs.ts`, `scripts/web-invite.ts`, `scripts/org-create.ts`, migrations `tenancy`, `web_panel`, `delete_mailbox`, `.github/workflows/ci.yml` (2026-11-12).
- [x] Questions Q1–Q15 sent; the user answered "Go with defaults" (2026-11-12). Recorded as P1–P15.
- [x] Facts checked (section "Facts checked", 2026-11-12).
- [x] Design decisions D1–D33 (D31–D33 from the cold review), rules, user steps, checkpoints, review model, segments (2026-11-12).
- [x] Segment task files written: `tasks/planned/s6a-customer-core.md`, `s6b-public-login.md`, `s6c-account-data.md`, `s6d-vertex-eu.md`, `s6e-papers-cost.md`, `s6f-hosted-production.md` (2026-11-12).
- [x] Cold review by the `reviewer` subagent (Opus, high): VERDICT FAIL, 22 findings; all fixed in the plan text; result in "Cold review result" (2026-11-12).
- [ ] Commit and push; the user's OK.

### Input

User words (word for word):

- 2026-11-12, at the S5e close: "Can we skip all those steps? As they are not necessary and not relevant. I want to keep it as it is right now." (The S5e phone checks, the rest of the hand smoke, the 24 h day of use and the cleanup items. They are skipped, not passed: `tasks/planned/s5e-open-checks.md`.)
- 2026-11-12, plan session: "Read /home/artek/.pi/agent/notes/2026-11-12-handoff-s6-plan.md and follow its "Start here" section. Tell me what this planning session is about and EPIC. Then proceed."
- 2026-11-12, answer to Q1–Q15: "Go with defaults"

The epic: S6 Pre-sale makes the first external customer able to sign up. The panel leaves the tailnet (public proxy with TLS), and the login must hold up on the public internet.

**Size.** Roadmap: L. Expected: L+ (six segments, about 35–45 stages). Two segments are mostly operations and paperwork (S6e, S6f).

**Hard parts (most risk first):** 1. the gates that let a second organization in: the scopes, the consent per mailbox and the `suspended` state reach every job (S6a); 2. the public login: lockout, reset by e-mail without enumeration, hashed tokens (S6b); 3. the organization delete across every table, with the audit rows (S6c); 4. the move of the live pilot to a new host without double sync, double Telegram polling or lost secrets (S6f); 5. the LLM switch to Vertex AI without a drop in accuracy (S6d).

### Current state check (2026-11-12)

The handoff claims agree with the repo:

- `master` = `origin/master` = `4b90bda`. Uncommitted files of the other session only (`tasks/active/limen-transition*`, `notes/2026-11-10-limen-adoption.md`, `notes/decision-docs/`).
- CI of `4b90bda` and `c2c8eba`: `image` and `e2e` success; `ci` fails only on the two known timing tests (`runSend > 3`, `AgentMail fake > holdResponseNext`).
- ADR 0015, 0016, 0017 exist. `apps/web/src/i18n/` has `en.ts` only. `sendResetPassword` is an optional dependency in `apps/server/src/platform/auth.ts:19`. No tailnet name in the repo (`grep tail[0-9a-f]{6}`: no match).

Not checked: the VPS commit `8f6a8b2` (VPS access needs a fresh yes) and the test counts (no test run in a plan session).

### Findings at collect (not in the S6 sketch; they change the scope)

1. **The scopes serve one mailbox only.** `TRIAGE_LLM_SCOPE=all`, `ACTIONS_SCOPE=all` and `SEND_SCOPE=all` act only on the mailbox with the address `TEST_MAILBOX_ADDRESS` (`modules/triage/jobs.ts:46,67`; `modules/actions/scope.ts:15-33`; `platform/config.ts:116-121`). A customer's mailbox gets no triage, no action and no send. `tasks/planned/actions-scope-removal.md` names this. S6a fixes it (D1, D2).
2. **No retention job runs** (`tasks/planned/retention-job.md`). The privacy policy will promise the periods of `docs/architecture.md` §7, so the job must exist before the first customer. S6a builds it (D5).
3. **The running server gets every key** (`tasks/planned/server-env-scope.md`): also `POSTGRES_PASSWORD` and `MIGRATOR_PASSWORD`. S6f splits the env (D25).
4. **New users are `email_verified = true` by default** (migration `20261110000001_web_panel.sql`). That is correct for the invite flow: the invite link goes to the address, so the first password set proves the address (D9). No Better Auth e-mail verification is needed.
5. **`users.email` is unique for all organizations** (`users_email_lower_key`). One person = one organization in S6 (D9).
6. **The VPS builds the image** (673 MB; 3.8 GB disk free on the home VPS). CI builds the same image (`.github/workflows/ci.yml` job `image`) but does not push it. S6f pushes it to GHCR and the production pulls it (D23).
7. **Full zero data retention on Vertex AI is not open to us** (fact V2): the exemption from abuse-monitoring prompt logging needs a Google Cloud Master Agreement. What we can do: caching off, request logging off, an EU region. The privacy policy states the rest (D15). The done-when line changed to match.
8. **The web panel has no approval page** (Phase 2). Approvals, the digest and the urgent notices need Telegram. Telegram is a sub-processor outside the EU, and the papers must say so (D27). Telegram offers no DPA: the lawyer question U0 goes out before the S6a build (D32).
9. **`eval --real` makes no LLM call** (`docs/architecture.md` §9): it scores the stored results of the model that ran. A new provider cannot be measured on the real labels without a new eval mode (D16).
10. **`PUBLIC_PAGE_PATHS` (`platform/http.ts:121`) holds only `/login`, `/setup` and the assets.** Every other page redirects to `/login` without a session. The legal pages and the reset-request page must join the list (D8, D18).
11. **`host-check.ts` does not refuse `100.64.0.0/10`** (Tailscale and carrier NAT), `198.18.0.0/15` or `192.0.0.0/24`, and the check runs only in the connect form; sync and send resolve the name again on every connect (D11).

### User decisions (2026-11-12, "Go with defaults")

Each line is the default of the question with the same number (the questions with their reasons: section "Questions" below).

- **P1** First customers: Polish small businesses on IMAP hosts (Interia, Onet, WP, home.pl, OVH) or Gmail with an app password. Microsoft 365 is out of S6 (no password IMAP; OAuth is Phase 2, `tasks/planned/mail-oauth-adapters.md`).
- **P2** Sign-up by invite only. The owner (operator) makes an organization and an invite; the customer sets a password through the e-mailed link. No open sign-up form.
- **P3** Billing is manual: a 30-day free trial, then a monthly invoice from an invoicing service that sends to KSeF, paid by bank transfer. The app stores a plan state per organization (`trial`, `active`, `suspended`); `suspended` stops sync and triage. Stripe comes later. Open (not blocking): the user's business form and VAT status (ask the accountant).
- **P4** Hosted EU server: Hetzner Cloud in Germany, a small x86 VM (about 2 vCPU, 4 GB RAM), the same Compose files, backups to Backblaze B2 in an EU region.
- **P5** The pilot organization moves to the hosted server. The home VPS becomes staging.
- **P6** A domain that the user buys; Caddy on the hosted server with automatic TLS. No Cloudflare.
- **P7** LLM for customers: Vertex AI in an EU region (a Gemini model) for all organizations on production, behind an eval gate against `gpt-6-luna`. OpenAI EU stays a rejected option (it needs OpenAI's approval, fact V4).
- **P8** Auth mail through a generic SMTP sender (env keys, no provider name in code) and an EU transactional provider (default: Brevo), from an address on the domain of P6, with SPF, DKIM and DMARC.
- **P9** `web-public-hardening.md`, `web-hashed-reset-tokens.md` and `compose-network-subnet.md` are part of S6. No captcha (invite only). Leaked-password check through the Have I Been Pwned range API.
- **P10** Self-service "delete organization" in the Account card (password and typed confirmation), at once, through one privileged function. Backups expire after their period; the privacy policy says so. Data export: CLI `org:export` on request.
- **P11** The agent writes drafts of the privacy policy, the terms of service and the customer DPA in Polish and English. A lawyer reviews them (user step). The panel links them; the first password set records the accepted version and time.
- **P12** Polish UI: `pl.ts` for the panel and the auth mails, the browser language first, a per-user choice in the Account card. Telegram texts stay as they are.
- **P13** The agent writes a one-page cost model from real `triage:cost` data; the user sets the price.
- **P14** The week tasks run in parallel; S6 does not wait. The 39 `web` ✅ rows (2026-11-11 23:54 to 2026-11-12 00:03 UTC) are excluded from the go/no-go counts (`tasks/planned/s5e-open-checks.md` records it). S6 is planned with the current `plan-task` and `run-task`; `limen-transition` stays a separate task.
- **P15** A master plan with segments. Subagents yes; the `reviewer` does the cold review; one approval at the end. `Git mode: worktree` per segment.

### Facts checked (2026-11-12, sources)

- **V1 Vertex AI EU processing.** "The European Union multi-region (`eu`) endpoint strictly covers data residency within EU member states." Locational endpoints "ensure that ML processing remains entirely within the broader multi-regional or country jurisdiction associated with that region." All listed Gemini models have EU multi-region processing; Germany (`europe-west3`) has in-country processing for Gemini 3.5 Flash. The global endpoint has no residency guarantee. Source: `https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency`.
- **V2 Vertex AI zero data retention.** Steps: turn off caching per project (`PATCH https://<region>-aiplatform.googleapis.com/v1/projects/PROJECT_ID/cacheConfig` with `{"name": "projects/PROJECT_ID/cacheConfig", "disableCache": true}`, needs `roles/aiplatform.admin`; "the change applies to all Google Cloud regions"); do not turn on request-response logging (off by default); no grounding with Google Search or Maps. Abuse monitoring: for Google models that are not "Frontier" or "Advanced AI", prompts are logged only when classifiers flag them, "stored securely for up to 90 days in the same region or multi-region selected by the customer". "Customers with a Google Cloud Master Agreement are exempt from prompt logging for this abuse monitoring by default"; no request form exists. OpenAI models on Vertex (GPT Luna and others) are "Advanced AI": all prompts logged up to 30 days. Sources: `https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention`, `https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/abuse-monitoring`.
- **V3 Gemini Developer API (the current `gemini` provider):** for paid services "Google logs prompts and responses for a limited period"; "If your workload requires guaranteed zero data retention or enterprise data processing agreements, use Vertex AI." Source: `https://aistudio.google.com/docs/zdr`.
- **V4 OpenAI EU data residency:** "Contact our sales team to see if you're eligible"; regions other than the US need approval for abuse monitoring controls and "a Modified Retention amendment"; endpoint `https://eu.api.openai.com/v1`; a 10% price uplift for models released on or after 2026-03-05. Source: `https://platform.openai.com/docs/guides/your-data`.
- **V5 KSeF dates:** "1 kwietnia 2026 r. KSeF obowiązkowy dla pozostałych przedsiębiorstw … z wyjątkiem najmniejszych firm, których łączna sprzedaż dokumentowana jest fakturami ≤ 10 tys. zł miesięcznie"; "1 stycznia 2027 r. KSeF obowiązkowy dla wszystkich". So the invoicing service must send to KSeF (no app code). Source: `https://ksef.podatki.gov.pl/etapy-wdrozenia-ksef`. Not checked: the duty for a VAT-exempt seller (accountant).
- **V6 Better Auth 1.7.18 (local `node_modules/better-auth`):** the `haveibeenpwned` plugin exists (`dist/plugins/haveibeenpwned/index.mjs`). It sends only the first 5 characters of the SHA-1 hash (`https://api.pwnedpasswords.com/range/<prefix>`, header `Add-Padding: true`). It wraps `ctx.password.hash` for the default paths `/sign-up/email`, `/change-password`, `/reset-password` (and others), so our `/setup` (it uses `reset-password`) is covered. When the API fails it throws `INTERNAL_SERVER_ERROR` ("Failed to check password. Please try again later."): it fails closed. Option `enabled: false` turns it off (tests). The plugins folder also has `captcha`, `admin`, `organization`, `multi-session` (not used).
- **V7 Better Auth e-mail options:** `emailVerification.sendVerificationEmail`, `sendOnSignUp`, and `emailAndPassword.requireEmailVerification` exist (`@better-auth/core/dist/types/init-options.d.mts:635-661`). Not used (finding 4, D9).
- **V8 Repo facts:** `LLM_DAILY_CAP` is per mailbox (`modules/triage/service.ts:426`). `deploy/backup.sh` deletes local backups after `KEEP_DAYS` (default 7); the B2 period is a bucket lifecycle rule. `web:invite` makes the link with `requestPasswordReset` and prints it (`scripts/web-invite.ts`). Better Auth stores reset tokens in plain text (`web-hashed-reset-tokens.md`).

### Not verified (the segment stage that checks it)

- Which Gemini model ids answer in `europe-west3` (and in `eu`), and their price there: S6d stage 0 spike, with `llm:check`.
- `@google/genai` with `vertexai: true`, `project`, `location` and a service-account key file (`GOOGLE_APPLICATION_CREDENTIALS`) under Bun: S6d stage 0 spike.
- The `cacheConfig` `PATCH` and `GET` on the user's project: S6d user step, the `GET` answer is the evidence.
- A per-user lockout in Better Auth 1.7.18: no built-in option was found. The S6b plan session reads `hooks.before` / `databaseHooks` in `node_modules` and probes it.
- `verification.storeIdentifier: "hashed"` (reviewer's reading, not probed): S6b spike.
- `advanced.backgroundTasks.handler` and `runInBackgroundOrAwait` (cold reviewer's reading of `node_modules/better-auth`); `hooks.before` / `after` on `/reset-password` see the request body (D10): S6b spike.
- The policy `iam.disableServiceAccountKeyCreation` on a new Google Cloud organization: U3.
- The SMTP port and TLS mode of the chosen transactional provider (465 implicit TLS is the only mode that the code supports now; STARTTLS 587 is `tasks/planned/mail-smtp-starttls-587.md`): S6b user step.
- Hetzner VM type, price and region; the region of the existing B2 bucket: S6f stage 0 (user step) and the cost model (S6e).
- Caddy `reverse_proxy` header behaviour (`X-Forwarded-For` append, `X-Forwarded-Proto`) against the server's trusted-proxy rule: S6f probe in staging.
- GHCR push from CI and anonymous pull on the production host: S6f stage 1.

### Design decisions (main session, 2026-11-12; why in each line)

**Customer core (S6a)**

- **D1 Scopes without `TEST_MAILBOX_ADDRESS`.** `TRIAGE_LLM_SCOPE`, `ACTIONS_SCOPE` and `SEND_SCOPE` stay global kill switches (`off`, `synthetic`, `all` / `self`). `all` now means every mailbox that passes D2. `TEST_MAILBOX_ADDRESS` stays only for the `testmail:*` tools and the probes. Why: the operator still needs one switch to stop all changes; the per-mailbox choice is D2. Rejected: a second per-mailbox scope table (D2 already has the per-mailbox state).
- **D2 Consent per mailbox.** Triage of real mail: the mailbox is `active` and its organization is not `suspended`; the connect form says that the mail goes to the AI provider (the terms, D10, cover it). Mailbox actions: only in `assist` mode, for the categories whose `auto` flag is on (as today). Sends: only after an approval tap (as today). A test per gate: a `shadow` mailbox gets only `logged` action rows (never `ready`); a mailbox of a `suspended` organization gets no LLM call. Why: the existing modes are the consent; no new UI. **Before the S6a deploy** the agent lists the mailboxes on the VPS (`select org_id, id, status, mode from mailboxes`, ids only in the log) and the user pauses or removes every mailbox that is not the pilot mailbox: after D1, `all` reaches them all.
- **D3 Plan state.** New columns on `organizations`: `plan text not null default 'trial' check (plan in ('trial','active','suspended'))`, `trial_ends_at timestamptz` (a check: `plan <> 'trial' or trial_ends_at is not null`), `max_mailboxes int not null default 2`, `resumed_at timestamptz` (set when the plan goes from `suspended` to another value). Every organization that exists at migration time gets `active` (the pilot; the e2e seed sets its own value). `org:create` gets `--plan <trial|active>` (default `trial` with now + 30 days); `org:invite` sets `trial` and `trial_ends_at` = now + `--trial-days`. A `--max-mailboxes` value below the current count is allowed: it blocks new connects only. The trial date shows in the organization's time zone. No automatic suspend at the trial end: the operator runs `org:plan --org-id <id> --plan <trial|active|suspended> [--max-mailboxes N]` after the payment or a missed payment. The panel shows "Trial ends on <date>" to owners. Why: manual billing (P3); an automatic suspend after a forgotten payment record would stop a paying customer. Audit row `org.plan_changed` (ids and the two values). `org:status [--org-id <id>]` prints per organization: plan, `trial_ends_at`, mailbox count and statuses, last sync, LLM calls today, linked Telegram chats (ids and counts only).
- **D4 What `suspended` stops.** Sync, triage, `triage.returned`, the committer, the send, the chaser, the digest and the notices skip the organization; a job that is running finishes its current item. These keep running for every organization: the approval expiry (so an old approval cannot go out at resume) and the retention job. The committer also refuses a send whose approval is older than 48 h (any plan). Telegram taps and commands of a paused organization (Send, Undo, ✅ / ✏️, `/digest`, `/resume`) answer "account paused" and change nothing. The web: login works; a banner "Account paused, contact <operator address>"; the server refuses every write route with `403 org_suspended` except sign-out, password change and "delete organization" (the UI read-only state is only a mirror). Back from `suspended`: `resumed_at` = now; sync goes on from the cursor; mail with `received_at < resumed_at − 24 h` goes `skipped` with reason `suspended_backlog` (no LLM call); the "sync late" notice counts its time from `resumed_at`, not from the old `last_synced_at`. Normal downtime and a capped backlog are not touched by this rule (it needs `resumed_at`). Why: a long pause must not burn the LLM budget in one go. The segment plan solves states × events for each job.
- **D5 Retention job.** As `tasks/planned/retention-job.md` (the table of `docs/architecture.md` §7), daily, per organization with `data_retention_days`. It is idempotent (it clears only rows that still have text); a crash in the middle is safe to repeat. Why: the privacy policy promises these periods.
- **D6 Mailbox limit.** Connect (web and CLI) refuses with `mailbox_limit` when the organization has `max_mailboxes` mailboxes. The IMAP login check runs first, outside any lock; then one short transaction takes `pg_advisory_xact_lock` on the organization id, counts again and inserts (two connects at once: one success, one `mailbox_limit`). Not `FOR UPDATE` on `organizations`: it would block every foreign-key insert of the organization. Why: cost control per customer. The pilot has one mailbox (below the default 2; S6a checks it on the VPS).

**Public login (S6b)**

- **D7 Auth mail sender.** Env keys `AUTH_SMTP_HOST`, `AUTH_SMTP_PORT` (default 465), `AUTH_SMTP_USER`, `AUTH_SMTP_PASSWORD`, `AUTH_MAIL_FROM`; the config check needs all five or none. Without them the server works as in S5: `request-password-reset` answers 404, and the CLI prints the links (so staging and the pilot start without a sender). Production (S6f) sets them. It uses `nodemailer` with certificate checks. It sends at once with a 15 s timeout; no outbox row (the link is a secret and must not sit in a table). A failed send is a log line with the user id and the error code only, and an operator notice (D31). Mails: invite, reset, lockout notice; each in the user's language (D12). Click and open tracking are off at the provider (U2): click tracking would store the setup link at a third party. Why: one small sender, no new vendor SDK. D7 and D8 amend ADR 0016 (sign-up off stays; the reset request opens): S6b writes the amendment.
- **D8 Reset request without enumeration.** `request-password-reset` goes back on the allow-list. The answer is always the same `200` with the same body, for a known and an unknown address. The send does not hold the request: Better Auth waits for `sendResetPassword` unless `advanced.backgroundTasks.handler` is set (reviewer's reading of `runInBackgroundOrAwait`), so S6b sets that handler or our `sendResetPassword` starts the send without `await` and with a `.catch` that logs. Rate limit: 3 per 15 min per client address, and 3 per hour per address (lower-case). Expiry: Better Auth reads only the global `resetPasswordTokenExpiresIn` (no per-call value), so it becomes an `AuthDeps` field: 1 h in the server, 24 h in the `org:invite` and `web:invite` CLIs (they build their own `createAuth`). A reset page `/forgot` (request form) joins `PUBLIC_PAGE_PATHS` (finding 10). The S5 HTTP block of `request-password-reset` is removed.
- **D9 Invite.** `org:invite --org-name <name> --email <email> --display-name <name> [--lang pl|en] [--timezone <tz>] [--trial-days 30]` makes the organization and the owner (one transaction, `createOrganizationWithOwner`), sets `plan = 'trial'` and `trial_ends_at`, and mails the setup link (D7). An address that exists already: exit 1 with "user exists" (finding 5). `web:invite` mails the link too (and still prints it with `--print`, for the operator's own account). A failed invite mail after the commit: the organization stays; the operator runs `web:invite --org-id <id>` to send the link again (the CLI says so). The link opens `/setup`; the first password set proves the address.
- **D10 Terms acceptance.** `/setup` shows links to the privacy policy, the terms and the DPA and a required checkbox. The client sends the acceptance with the password-set request; a Better Auth `hooks.before` on `/reset-password` refuses the request without it, and an `after` hook stores `users.terms_version` and `users.terms_accepted_at` (one request, no second route; the S6b spike checks that the hooks see the body). S6b owns `TERMS_VERSION` (in `packages/core`) and the stub pages `/legal/<lang>/<doc>` ("text follows"), in `PUBLIC_PAGE_PATHS`; S6e fills the texts. A newer `TERMS_VERSION` in the code makes the panel show a blocking dialog after the next sign-in until the user accepts. Audit row `web.terms_accepted` (user id, version). The pilot owner accepts at the first sign-in on production.
- **D11 Login hardening.** As `tasks/planned/web-public-hardening.md`, without captcha (P9): a per-user lockout (10 failed sign-ins in 15 min → 15 min lock; the answer is the same as a wrong password, and a locked attempt also hashes a dummy password so the time does not show the lock; one lockout mail per lock, at most 3 per user per day; a successful password reset clears the lock), the Have I Been Pwned plugin (fail closed, V6), the session list in the Account card with "sign out everywhere" and its audit row (B13), the address check of the mail host: `host-check.ts` also refuses `100.64.0.0/10`, `198.18.0.0/15`, `192.0.0.0/24` (finding 11), and every IMAP and SMTP connect (form, sync, send) resolves the name with a `lookup` that refuses a local address, so a DNS change after the connect (rebinding) is caught too; a Tailscale ACL lets the production host start no connection to other tailnet devices (S6f), hashed reset tokens (`web-hashed-reset-tokens.md`). Unknown address at sign-in: same answer and about the same time as a wrong password (Better Auth hashes a dummy password; the segment checks it).
- **D12 Polish UI.** `apps/web/src/i18n/pl.ts` with the same keys as `en.ts` (a type check and a unit test fail on a missing key). The language: `users.locale` (`pl`, `en` or null); null → the browser language (`navigator.language` starts with `pl` → Polish), else English. The Account card has the choice. Auth mails use `users.locale`, else the `--lang` of the invite. Telegram texts stay as they are (P12). S6c builds it (it touches every page; it comes after the S6b pages).

**Account and data (S6c)**

- **D13 Organization delete.** A function `delete_organization(p_org_id uuid)`: `SECURITY DEFINER`, owned by `migrator`, `EXECUTE` only for `app`, fixed `search_path` (the shape of `delete_mailbox`). In one transaction: lock the organization row, delete its `audit_log` rows, delete the `auth_verifications` rows of its members (`value` = the user id; the identifier is the hashed token), delete the users whose only membership is this organization (their `auth_sessions`, `auth_accounts` and the S6b lockout rows go by cascade), then delete the organization (cascade). The server writes one log line `org deleted <org id> at <time>` (no personal data) as the record for billing, because the audit rows are gone. The web route: owner only, the current password and the typed organization name; then the session ends and the page shows "change the passwords of these mailboxes: <addresses>" (the addresses are read before the delete). A job that holds a row of the organization at that time fails its commit; the IMAP change that it already made stays (as with `delete_mailbox`). The deletion test seeds one row in every table and checks that no row with the org id or a member's user id is left (the list of tables comes from `information_schema`: every table with an `org_id` or a `user_id` column, plus `auth_verifications` by `value`; so a new table cannot be forgotten). CLI `org:delete --org-id <id> --confirm <name>` for the operator.
- **D14 Export.** CLI `org:export --org-id <id> --out <path>` writes JSON with the organization, members (no auth rows, no password hashes), mailboxes (no credentials), rules, delegates, delegations, emails (subject, addresses, stored body text), triage results, feedback, actions (payloads), `outbox` texts, chat links (chat ids), audit rows. In Compose the path is a mounted folder; the file is encrypted with `age` to a recipient that the customer gives (or a one-time passphrase sent by another channel), mode 600, and deleted after the delivery (the runbook says so). Why: GDPR access and portability on request (P10).

**LLM (S6d)**

- **D15 Vertex AI provider.** A provider id `vertex` in `platform/llm/providers/index.ts`. It uses `@google/genai` with `vertexai: true`, `project` (`VERTEX_PROJECT`), `location` (`VERTEX_LOCATION`, default `europe-west3`; the config check refuses `global` and any region outside the EU list in the code). Auth: a service-account key file mounted read-only into the container (`GOOGLE_APPLICATION_CREDENTIALS`), role `roles/aiplatform.user` only. The config schema, `LlmSettings` and `createLlmClient` take an `apiKey` today: the `vertex` provider needs a key-file branch there (no API key). The EU list holds `eu` and the EU single regions of V1. New Google Cloud organizations can block service-account key creation (`iam.disableServiceAccountKeyCreation`; not verified): U3 checks it. The ESLint rule that allows `@google/genai` only in `providers/gemini.ts` is extended to the new file (or the vertex mode lives in `gemini.ts`; the segment decides). Models: `VERTEX_MODEL`, `VERTEX_MODEL_CLASSIFIER`. Price rows for `triage:cost`. Caching off (V2) is a user step with the evidence of the `GET cacheConfig` answer. Why: P7; the Gemini code exists already.
- **D16 Eval gate.** `eval --real` scores stored results only (finding 9), so S6d adds a mode `eval --real --reclassify --provider <id> --model <id>`: it classifies again the labeled pilot mails that still have `body_text` (30-day retention; run it on the home VPS, where that mail is; the pilot owner's own mail to Vertex EU is inside the accepted terms) and scores the new answers against the labels, beside the stored `gpt-6-luna` results of the same mails. Gate before production switches to `vertex`: (a) injection 16/16; (b) on the synthetic cases, the accuracy of each category with at least 10 cases is not lower than `gpt-6-luna` by more than 3 points; (c) on the reclassified real mails, the same rule for each category with at least 10 labels; a category with fewer is reported as "too few" and does not pass by default. Fail or "too few" → checkpoint 3: the user decides (another Vertex model, prompt work, or accept). Why: the user picked `gpt-6-luna` for accuracy (ADR 0015).
- **D17 One provider for production.** `LLM_PROVIDER=vertex` for all organizations on production, also the pilot. The staging (home VPS) may keep `openai` with test data. A Cloud Billing budget alert on the Vertex project (`tasks/planned/gemini-billing-budget-alert.md`, now for Vertex). ADR 0018 records it (amends 0015).

**Papers and cost (S6e)**

- **D18 Papers as pages.** Markdown sources in `apps/web/src/content/legal/{pl,en}/{privacy,terms,dpa}.md`, rendered as static pages `/legal/<lang>/<doc>` (the route, the stubs and `PUBLIC_PAGE_PATHS` come from S6b, D10); linked from `/login`, `/setup` and the Account card. The Playwright test opens each page without a session and asserts that no redirect happened. `TERMS_VERSION` in `packages/core` (a date string, from S6b) changes with every text change. The texts say "draft" until the lawyer review is logged in this task. Why: the version in the code and the text stay together.
- **D19 What the papers must say** (from the code, not from memory): the data and periods of `docs/architecture.md` §7 (retention table, backups), the sub-processors (D27), the LLM terms (V2: caching off, flagged prompts up to 90 days in the EU region), Telegram (D27), the deletion path (D13) and the export (D14), the mailbox password advice, the controller and processor roles (the customer is the controller of their mail; we are the processor; we are the controller of the account data).
- **D20 Cost model.** `docs/cost-model.md`: tokens per mail from `triage:cost` on the pilot (real numbers, date), the Vertex price of the D16 model, hosting (P4), the mail sender, B2, the domain; cost per mailbox at 50, 100 and 200 mails a day; break-even price at 5, 10 and 20 mailboxes. The user writes the price.

**Hosted production (S6f)**

- **D21 Host.** Hetzner Cloud VM in Germany (P4), Ubuntu LTS, Docker from the Docker repository, `unattended-upgrades` on. SSH only through Tailscale (the Hetzner Cloud firewall opens only 80 and 443 to the internet); key login only. Why: no public SSH port.
- **D22 Caddy.** A `caddy` service in `deploy/compose.prod.yaml` (an overlay of `compose.yaml`) with ports 80 and 443, the `Caddyfile` in `deploy/`, certificates in a named volume. The `server` service has no host port on production. The Compose network has a pinned subnet (`compose-network-subnet.md`); `WEB_TRUSTED_PROXIES` is the Caddy container address in that subnet (a fixed `ipv4_address`). HSTS stays in the server.
- **D23 Image from CI.** CI pushes the image of each `master` commit to `ghcr.io/<owner>/email-assistant:<sha>` (and `:master`); production pulls a pinned `<sha>`. The push job needs `ci`, `image` and `e2e`; the `ci` job fails today on the two known timing tests (`docs/known-alerts.md`), so S6f stage 1 fixes them first. The CI image job already checks the image content; it never holds `.env`. Why: no image build on the host; the same image on staging and production.
- **D24 Staging.** The home VPS runs staging after the move: Tailscale Serve (ADR 0017 stays for it), `TRIAGE_LLM_SCOPE=synthetic`, `ACTIONS_SCOPE=synthetic`, `SEND_SCOPE=off`, its own bot (the old pilot bot becomes the staging bot, D33; the dev bot stays with the Mac: one poller per token), a new `CREDENTIALS_KEY`, its own backup bucket or prefix, test data only. A deploy goes to staging first, then to production. A restore test of a production dump never runs on staging or on the Mac: it runs on a short-lived Hetzner VM that is deleted after the test (the papers say so).
- **D25 Env split.** As `tasks/planned/server-env-scope.md`: the long-running `server` gets only its keys; migrations run in a one-off service with the migrator URL.
- **D26 Pilot move.** Order:
  1. Freeze: stop `server` on the home VPS (one Telegram poller and one sync per mailbox); keep `db`.
  2. Backup (`deploy/backup.sh`), and copy the dump to the production VM over the tailnet.
  3. On production: an empty DB volume; run the `db-init` roles; restore **with** owners and privileges (not the `--no-owner --no-privileges` of `deploy/restore-test.sh`), then `db:migrate` with the pinned image. Check the grants: `app` cannot delete from `audit_log`; `delete_mailbox` and `delete_organization` are owned by `migrator`. `delete from auth_sessions;`.
  4. The same `CREDENTIALS_KEY` (else the mailbox secrets cannot be read); a new `WEB_AUTH_SECRET` and `WEB_BASE_URL`; the production bot token (D33).
  5. Start production with `ACTIONS_SCOPE=off`, `SEND_SCOPE=off`, `TRIAGE_LLM_SCOPE=off`. Check: sync, `/health`, the panel sign-in on the domain.
  6. **Rollback point:** until the scopes go on, a rollback is "stop production, start the home VPS `server`" (the home DB has the same cursor; production made no mailbox change). Then the scopes go on: one triage on Vertex, the digest, the Telegram link of the owner to the new bot.
  7. After a 7-day rollback window: wipe the home VPS pilot state (`docker compose down -v`, delete the local `BACKUP_DIR` dumps, remove the old `.env` and every `.env.bak-*`), then set it up as staging (D24) with a new `.env`.
     Gate: the user's go, outside a pilot week.
- **D27 Sub-processors.** Hetzner (hosting, Germany), Google Cloud (Vertex AI, EU region), the auth mail provider (Brevo, France, by default), Backblaze (B2 backups, EU region; encrypted with `age` before upload), Telegram (bot messages: sender, subject, AI summary, draft text; not end-to-end encrypted; servers outside the EU). Have I Been Pwned gets no personal data (a hash prefix). Tailscale carries only the operator's SSH traffic. The Telegram link step in the panel shows a consent text per user that names what goes to Telegram (sender, subject, AI summary, draft text); the link is refused without it (S6c builds it with the i18n; the text comes from the U0 answer).

**Docs**

- **D28 ADRs.** 0018 LLM for customers: Vertex AI EU (amends 0015). 0019 Hosted production and public access: Hetzner, Caddy, GHCR (amends 0017: Tailscale Serve stays for staging). 0020 Customer accounts: invite, plan state, consent by mode, deletion. Each segment writes its ADR with its last stage.
- **D29 Operator address.** The banner and the papers name one contact address on the domain of P6 (user step). It never goes into the repo as a literal: env `OPERATOR_CONTACT` (public value, but kept out of the code so that the repo stays generic).
- **D30 Secrets on the new host.** The `.env` (mode 600) and the service-account key file (mode 600, mounted read-only) never go into the repo, a log line, an error text or a chat reply. No `.env.bak-*` copies stay on any host after a step (S5e left one: `s5e-open-checks.md`).
- **D31 Operator notices.** Env `OPERATOR_TELEGRAM_CHAT_ID` (optional): the bot sends the operator ids-only notices: a failed auth mail (D7), a customer mailbox in `auth_error` for more than 24 h, the daily LLM cap reached for a mailbox, a trial that ends in 3 days, a failed backup. Without the key, the same events are log lines at `warn`. S6a builds the frame and the trial, cap and `auth_error` events; S6b adds the auth-mail event; S6f adds the backup event and sets the key on production. Why: the customer may not link Telegram, so the operator must see these first.
- **D32 Telegram legal question first.** Telegram is required (finding 8) and offers no DPA. User step U0 sends the lawyer one question before the S6a build: may the service send sender, subject, AI summary and draft text through Telegram for business customers, with a per-user consent? Plan B, if the answer is no: content-minimal notices ("3 new urgent mails, open the panel") and web pages for approvals; recorded now as `tasks/planned/telegram-content-minimal.md`. The answer can change S6c (consent text) and S6e (papers).
- **D33 Production bot.** A new production bot with the product name (user step U10); the old pilot bot becomes the staging bot. The pilot owner opens the new bot and links again from the panel after the move (D26 step 6). Why: customers see the bot name; the pilot name is not a product name.

### Rules for every step (the segment plans copy this block)

- Read `CLAUDE.md`, `docs/code-patterns.md` and the segment task file first.
- Format only the files of the step (`bunx prettier --write <files>`), never the whole repo (S2 incident).
- No secret, token, password, reset link, mailbox address of a customer, or mail text in a log line, an error text, an audit row or a test snapshot. Logs and audit rows hold ids, codes, counts and times; errors go through `describeError`.
- The repo is public: never write the tailnet name, the production IP, a customer name or address, or the operator's private data into a file. Docs write `<domain>`, `<machine>.<tailnet>.ts.net`.
- Template literals for strings with variables; `const` / `let` only.
- Every new table or column with `org_id` gets a tenant-filter test and is covered by the D13 deletion test.
- Only one checkout runs `test:int`, `db:migrate` or a dev server at a time; only one task at a time adds a migration or changes `bun.lock` (the other session works in the main checkout: stage by explicit path, never `git add -A`).
- Run `git fetch && git merge origin/master` in the segment branch at the start and before the merge (S5e conflict).
- Docker on this PC: `newgrp docker <<'EOF' … EOF`; `docker compose run -T` with a heredoc (`notes/2026-11-08-docker-socket-newgrp.md`). Git push: `export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes"` (`notes/2026-11-10-git-ssh-push.md`).
- The two known timing tests fail in CI (`docs/known-alerts.md`); every other failure is a stop.
- Checks per stage: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`; web stages also `bun run web:build` and the Playwright specs of the stage.

### User steps (start early; the agent never reads or prints a secret)

| #   | Step                                                                                                                                                                                                                                                                                                                  | Needed by                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| U0  | Ask a lawyer the Telegram question of D32 (one paragraph; the agent drafts it on request).                                                                                                                                                                                                                            | before the S6a build     |
| U1  | Buy the domain; give the agent the name (it is public).                                                                                                                                                                                                                                                               | S6b (sender), S6f        |
| U2  | Make a Brevo (or other EU provider) account; verify the domain (SPF, DKIM, DMARC records); turn off click and open tracking; put the `AUTH_SMTP_*` values in `.env`.                                                                                                                                                  | S6b checks on staging    |
| U3  | Make a Google Cloud project with billing, turn on Vertex AI, make a service account with `roles/aiplatform.user` (check that the organization policy allows key creation), put its key file on the hosts (mode 600); turn off caching (the `PATCH cacheConfig`), send the agent the `GET` answer; set a budget alert. | S6d                      |
| U4  | Make a Hetzner Cloud account and project; the agent gives the VM and firewall settings.                                                                                                                                                                                                                               | S6f                      |
| U5  | Choose the invoicing service with KSeF; ask the accountant about the business form and VAT.                                                                                                                                                                                                                           | before the first invoice |
| U6  | Lawyer review of the papers (S6e drafts).                                                                                                                                                                                                                                                                             | S6f go-live              |
| U7  | Set the price (S6e cost model).                                                                                                                                                                                                                                                                                       | first invite             |
| U8  | Set the B2 bucket lifecycle (delete after 30 days) and check that the bucket region is in the EU.                                                                                                                                                                                                                     | S6e papers               |
| U9  | Give the operator contact address (D29) and, optionally, the operator Telegram chat (D31).                                                                                                                                                                                                                            | S6a banner               |
| U10 | Make the production bot with BotFather (D33); put its token in the production `.env`.                                                                                                                                                                                                                                 | S6f                      |

### User checkpoints (each with a group review)

1. After S6a: the gates (D1–D6) on the dev stack; before the S6a deploy the mailbox list of D2 (every mailbox that is not the pilot mailbox is paused or removed); the pilot still works on the home VPS after the deploy (one day).
2. After S6b: the login on staging with real mail (invite, reset, lockout, Have I Been Pwned); security group review with the stronger reviewer.
3. After the S6d eval: the user accepts the model (D16) before production switches.
4. Before S6f go-live: the lawyer review is logged (U6), the price is set (U7).
5. Before the pilot move (D26): the user's go, outside a pilot week.
6. Before the first customer invite: a full run on production with a second test organization (invite, connect, triage, delete).

### Review model

- Stronger reviewer (Opus, high): S6a (gates, migration), S6b (auth), S6c (the delete function), S6f (deploy and the pilot move).
- Sonnet, high: S6d, S6e, the i18n stages.
- Cold review of each segment plan in its own `plan-task` session, as in S5.

### Segments

| Segment               | File                                     | Content                                                                                                                                                                                                                                                               | Decisions                             | Needs                                         |
| --------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------- |
| S6a Customer core     | `tasks/planned/s6a-customer-core.md`     | Scopes without `TEST_MAILBOX_ADDRESS`, consent by mode, plan state, `org:plan`, `org:status`, `suspended` gate in every job, mailbox limit, retention job, trial banner, operator notices frame                                                                       | D1–D6, D29, D31                       | S5, U0 sent                                   |
| S6b Public login      | `tasks/planned/s6b-public-login.md`      | Auth mail sender, `/forgot` and reset by e-mail without enumeration, `org:invite`, terms acceptance with `TERMS_VERSION` and stub legal pages, lockout, Have I Been Pwned, session list, address check on every mail connect, hashed reset tokens, ADR 0016 amendment | D7–D11, D31 (auth mail event)         | S6a                                           |
| S6c Account and data  | `tasks/planned/s6c-account-data.md`      | `delete_organization` and the Account card delete, `org:delete`, `org:export`, Polish UI and language choice, Telegram consent text                                                                                                                                   | D12–D14, D27 (consent), D32           | S6b, U0 answer                                |
| S6d Vertex AI EU      | `tasks/planned/s6d-vertex-eu.md`         | Spike, `vertex` provider, config, prices, eval gate, budget alert, ADR 0018                                                                                                                                                                                           | D15–D17                               | S5 (can run beside S6b and S6c; no migration) |
| S6e Papers and cost   | `tasks/planned/s6e-papers-cost.md`       | Privacy policy, terms, DPA (pl, en) as pages, `TERMS_VERSION`, cost model, ADR 0020                                                                                                                                                                                   | D18–D20, D27, D28                     | S6c, S6d (the facts that the texts state)     |
| S6f Hosted production | `tasks/planned/s6f-hosted-production.md` | Timing-test fix, GHCR image, Hetzner VM, Tailscale SSH and ACL, Caddy, pinned subnet, env split, backups, restore test VM, pilot move, staging on the home VPS, second-organization run, first invite, ADR 0019                                                       | D21–D26, D30, D31 (backup event), D33 | S6a–S6e; U6, U7 before stage 7 only           |

Order: `S6a → S6b → S6c → S6e → S6f`, with `S6d` beside S6b or S6c.

### Follow-ups (`tasks/planned/`; not in S6)

- Stripe or another card payment (after P3 manual billing).
- Open sign-up with captcha and abuse limits (after P2).
- Telegram texts in Polish (P12).
- `tasks/planned/telegram-content-minimal.md`: plan B of D32.
- Web pages for approvals and the digest, so a customer can work without Telegram (Phase 2, roadmap §1).
- Several organizations per user (finding 5).
- `mail-oauth-adapters.md` (Gmail, Microsoft 365), `mail-smtp-starttls-587.md`, `llm-provider-fallback.md` stay as they are.

### Cold review result (2026-11-12, `reviewer` subagent, Opus, high; VERDICT FAIL; blocker 1, major 10, minor 9, question 2; all fixed in this commit)

Pre-mortem areas: the pilot move and the staging switch (1–3), the `suspended` gaps (7), security and legal items found too late (6, 8). The reviewer checked the code references of the plan and found them correct.

1. Blocker: the home VPS kept the pilot state when it became staging (double sync, double poller, real data in the backups) → D24, D26 step 7, D33.
2. Restore method: `--no-owner --no-privileges` would break the `SECURITY DEFINER` functions and the `audit_log` grants; no observable rollback point → D26 steps 3, 5, 6.
3. A restore test of production dumps on staging or the Mac → D24 (short-lived VM).
4. `eval --real` makes no LLM call; the synthetic set cannot reach 30 rows per category → finding 9, D16 (reclassify mode, minimum 10).
5. `/legal/*` and a reset page are not public pages; a test that follows the redirect hides it → finding 10, D8 (`/forgot`), D10, D18.
6. `host-check.ts` misses `100.64.0.0/10` (tailnet); DNS rebinding after the form check → finding 11, D11.
7. `suspended` states × events: approval expiry, Telegram taps, connect, `triage.returned`, retention, server-side read-only, the backlog rule, the sync-late notice → D3 (`resumed_at`), D4.
8. Telegram has no DPA and the lawyer sees it only at go-live → D32, U0, D27 consent text.
9. After D1, `all` reaches every mailbox on the VPS → D2 (list and pause before the S6a deploy).
10. `auth_verifications` keyed by identifier is wrong; tables with `user_id` and the lockout store → D13.
11. No operator monitoring → D31, `org:status` (D3).
12. `FOR UPDATE` on `organizations` blocks foreign-key inserts → D6 (advisory lock, IMAP check outside).
13. No per-call reset expiry; the send is awaited unless a background handler is set → D8.
14. Lockout timing and mail flood; reset clears the lock → D11.
15. Brevo click and open tracking → D7, U2.
16. Text conflicts (D14 → D16, `planned` → `logged`, D10 one request, `TERMS_VERSION` owner, ADR 0016 amendment, S6f needs) → fixed in place.
17. The push job cannot need a red `ci` → D23 (fix the timing tests first).
18. `vertex` needs a key-file branch; `eu` in the list; key-creation policy → D15, U3.
19. Export misses tables; the file path in a container; delivery → D14.
20. Plan-state details (trial without end, max below count, pilot count, time zone) → D3, D6.
21. Invite mail fails after the commit → D9 (`web:invite` resends).
22. The pilot bot becomes the customer bot? → D33 (new production bot, default).

## Questions (asked 2026-11-12; answered "Go with defaults")

1. **Q1 First customer and mail provider.** Is the first customer known, and which mail do they use? Default: a Polish small business on an IMAP host (Interia, Onet, WP, home.pl, OVH) or Gmail with an app password. Microsoft 365 stays out of S6. Why: Microsoft 365 has no password IMAP, so it needs the OAuth adapter (Phase 2). The market check (S5 P9) was not done.
2. **Q2 Sign-up mode.** Default: invite only. The owner makes an invite (extend `web:invite`: new organization + owner + link). The customer sets a password and confirms the e-mail address. No open sign-up form. Why: a smaller attack surface, no captcha vendor, no fake accounts that spend LLM money. Rejected: open self-service sign-up (needs captcha, abuse limits and billing before first use).
3. **Q3 Billing.** Default: manual for the first customers. A free trial (30 days), then a monthly invoice from an invoicing service that sends to KSeF (the Polish e-invoice system), paid by bank transfer. The app stores a plan state per organization (`trial`, `active`, `suspended`); `suspended` stops sync and triage. Stripe comes later. Why: few customers; Stripe does not send invoices to KSeF. Also: do you invoice as a company, and are you a VAT payer?
4. **Q4 Hosted EU server.** Default: Hetzner Cloud in Germany, a small x86 VM (about 2 vCPU, 4 GB RAM), the same Compose files, backups to Backblaze B2 in an EU region. Alternative: OVHcloud in Warsaw. Why: low price, EU location, a DPA in the standard terms.
5. **Q5 Pilot after S6.** Default: the pilot organization moves to the hosted server too. The home VPS becomes staging. Why: one production to operate; the home VPS has 3.8 GB free disk only.
6. **Q6 Domain and public proxy.** Default: a domain that you buy or have; Caddy on the hosted server with automatic TLS. No Cloudflare. Why: Cloudflare Tunnel ends TLS at Cloudflare, so a US company sees the panel traffic and becomes one more processor.
7. **Q7 LLM for customers.** Default: Vertex AI with an EU region for all organizations on production, behind an eval gate against `gpt-6-luna`. Alternative: an OpenAI project with EU data residency and zero data retention (needs OpenAI approval). Why: no approval wait.
8. **Q8 E-mail sender for auth mail.** Default: a generic SMTP sender through an EU transactional provider (for example Brevo or Mailjet), from an address on the domain of Q6, with SPF, DKIM and DMARC.
9. **Q9 Public hardening.** Default: `web-public-hardening.md` with `web-hashed-reset-tokens.md` and `compose-network-subnet.md`; no captcha with invite only; the Have I Been Pwned range API.
10. **Q10 Deletion and export.** Default: self-service "delete organization", at once, through one privileged function; backups expire after their period; export by CLI on request.
11. **Q11 Papers.** Default: agent drafts in Polish and English, lawyer review, links in the panel, accepted version and time recorded.
12. **Q12 Polish UI.** Default: yes for the panel and the auth mails; Telegram stays.
13. **Q13 Cost model and price.** Default: the agent writes the model from real data; the user sets the price.
14. **Q14 Order with other work.** Default: the week tasks run in parallel; the 39 `web` ✅ rows are excluded; Limen stays separate.
15. **Q15 How to run.** Default: a master plan with segments, like S5; subagents yes; one approval at the end; worktree per segment.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-02: Created from `docs/roadmap.md` and `docs/architecture.md` §11.
- 2026-11-02: Changed after the cold review (`tasks/done/mvp-plan-review.md`) and the user's answers (IMAP, home VPS, own Postgres).
- 2026-11-12: Moved to `active/` by the S6 plan session (`plan-task`). Current state checked; questions Q1–Q15 sent; the user answered "Go with defaults".
- 2026-11-12: Facts checked (V1–V8), findings 1–8, decisions P1–P15 and D1–D30, six segment files written.
- 2026-11-12: Cold review (reviewer subagent, Opus, high): FAIL, 22 findings; fixed: findings 9–11, D31–D33, U0, U10, changes to D2–D4, D6–D11, D13–D16, D18, D23, D24, D26, D27; segment files updated.
