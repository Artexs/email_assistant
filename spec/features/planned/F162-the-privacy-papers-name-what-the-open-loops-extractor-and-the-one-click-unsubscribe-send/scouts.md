# F162 scouts

Three scouts (claude-sonnet-5-5, medium), all at base `fb1df6d64`. Each packet is copied whole from the job log. A packet is a lead; the planner re-read the code for each fact a decision uses (plan.md § Facts checked).

## Scout 1 · job `2026-11-20-f162-scout-1-a24f72a2`

Question:

> Which fields does the open-loops extractor send to the LLM provider: the role name, the production prompt version, the mails it reads (Sent, INBOX, thread), each field of the prompt input with its size caps and count limits (constants and their files), when it runs (trigger, schedule, backfill), the flag that gates it, and any age limit? Also: is the flag open_loops on for the pilot organization, and where is that recorded? Context: spec/features/planned/F162-the-privacy-papers-name-what-the-open-loops-extractor-and-the-one-click-unsubscribe-send/ticket.md. Answer for the code at HEAD.

Packet:

````text
Packet: What the open-loops extractor sends to the LLM provider, when it runs, what gates it, and whether `open_loops` is on for the pilot org.
Base: fb1df6d64
Verified: `sed -n 80,100p packages/core/src/loops/extractor.ts` and `extractor-v1.ts` read -> `export const EXTRACT_BODY_MAX = 8000;` (no test run)
Unknowns:
- Whether `open_loops` is on in the live pilot DB. The `org_features` row is not in the repo, and I did not read the VPS. The only records are notes and the owner log (item 6).
- The provider and model for role `extractor`. The code gives tier `light`, effort `none`. The concrete model comes from the `LLM_PROVIDER` env, which is not in the repo.
- Whether `TRIAGE_LLM_SCOPE` is `all` on the VPS. `.env.example` has `off`. With `off`, `loops.analyze` is skipped, and with `synthetic` only test mail goes out (`composition.ts:81`).

1. `apps/server/src/modules/loops/extractor.ts:extractSent` — one `llm.generate` call per mail. The role is `extractor` and the production prompt version is `extractor-v1` (`triage/prompts/index.ts:201-205`, `extractor-v1.ts` `PROMPT_VERSION`). It sends the system prompt (fixed text), the user prompt, and the JSON schema `extractorOutputSchema`. The user prompt holds a random 16-byte nonce inside a data block. — observed
2. The prompt input is `ExtractorInput` (`packages/core/src/loops/extractor.ts:extractorInputOf`). `buildUserPrompt` (`extractor-v1.ts`) sends exactly: — observed
   - `subject`: full, no cap in the prompt input. Empty becomes "(no subject)". The row copy cuts to 300 characters in `analyze-write.ts`, but that is not the prompt.
   - `sentLocal`: `date`, `time`, and weekday name, in the org time zone.
   - `recipientCount`: `to.length + cc.length`, as a number only. No From, To or Cc address is sent.
   - `body`: the Sent body text cut to `EXTRACT_BODY_MAX = 8000` characters (`core/loops/extractor.ts:13`). `cut()` never splits a surrogate pair. An address or a quoted part inside the body is sent as written.
   - `EXTRACT_TEXT_MAX = 80` caps the model's output (`ask`, `promise`), not the input.
3. Mails read: only the user's own Sent mail (`sent_emails`, `origin = 'user'`, content not `pending`). The extractor does not read INBOX mail or thread mail. The thread, promise and delegation rules (`analyze-rules.ts`) use stored rows in the DB. A row that matches them gets no call. These rules read headers, ids and addresses, and they send nothing to the model. — observed (`analysis-repo.ts:listSentCandidates`)
4. Count and age limits (constants and files): — observed
   - `SENT_MAX_AGE_DAYS = 14` (`core/loops/extractor.ts:15`). It applies in the candidate query and in `sentSkipReason` (`too_old`). `SENT_MAX_RECIPIENTS = 10` (same file) skips mail with more recipients (`too_many`) before any call.
   - `DEFAULT_LIMIT = 20` rows per mailbox per run (`analyze.ts`). Oldest first.
   - `MAX_ATTEMPTS = 3` tries per mail (`analyze.ts`). Retry after 5 min × attempts.
   - The daily cap is 4/5 of `LLM_DAILY_CAP` per mailbox, all roles together (`CAP_SHARE_NUM/DEN`, `analyze.ts`).
   - No call is made for: system drafts, `no_text`, `own_only`, `list`, `auto`, `calendar` (`sentSkipReason` order).
5. Trigger and flags: — observed
   - `loops.analyze` runs on cron `35 * * * * *`, every 60 seconds (`apps/server/src/start/triage.ts:143`). It is registered only inside the triage block, so the scope must not be off (`composition.ts:loopsLlmScope`).
   - `analyzeSent` returns with no call unless `open_loops` and `sent_sync` are both on for the org and the per-mailbox "Track my sent mail" switch is enabled (`analyze.ts:trackingOn`). Suspended orgs are skipped (`jobs.ts`). `FEATURES_OFF` can kill a flag (`tenancy/features.ts:26`).
   - Backfill: no separate backfill or one-off job. After the flags turn on, the same query picks up unanalysed Sent rows from the last 14 days, 20 per run per mailbox. Manual run: `bun run job:run --name loops.analyze`.
   - `featureFlags.open_loops` (`packages/core/src/features.ts:118`) has `default: false`.
6. Pilot status — recorded in notes, not in code: `notes/2026-11-15-vps-deploy-queue.md:128` lists `open_loops` among the pilot flags on at v0.4.1 (on at or before 2026-11-19 20:29Z). `notes/2026-11-19-coordinator-handoff.md:22` says the same. The owner's decision is at `docs/owner-decisions.md:713`: "Flags `contact_wait`, `open_loops`, `delegate_button` on for the pilot org". The runtime record is the per-org `org_features` row. The F162 ticket says the same ("already on"). — observed (the notes), guessed (that the live row still matches)

Checks: `apps/server/src/modules/loops/extractor.test.ts` and `packages/core/src/loops/extractor.test.ts` exist and cover the extractor and the input shape; I did not run them or read them. `docs/capabilities/open-loops.md` rule 2 states the same behaviour in prose and matches the code I read. It misses the field-by-field list of the prompt input.
````

## Scout 2 · job `2026-11-20-f162-scout-2-91e001ec`

Question:

> What exactly does the server send after a one-click unsubscribe tap (flag bulk_unsubscribe): the HTTP method, the target URL source, the body, the headers (User-Agent, others), the source address, when it runs, retries, and what is stored? Also: what is the 'unsubscribe-data' category in the legal data catalog and its subjects (is 'members' missing?), and what is the 'report mail appended into the member INBOX' (which code appends it, what it holds, which flag). Context: spec/features/planned/F162-the-privacy-papers-name-what-the-open-loops-extractor-and-the-one-click-unsubscribe-send/ticket.md. Answer for the code at HEAD.

Packet:

````text
Packet: What the server sends after a one-click unsubscribe tap, the `unsubscribe-data` category and `members`, and the report mail appended into the INBOX
Base: fb1df6d64370639d6f28a0d0e53673e2f72b30d8
Verified: `git status --short | wc -l` -> `0` (worktree clean). I ran no code. All findings come from reading files at HEAD.
Unknowns:
- Source IP: the code does not name it. The request leaves the server directly with no proxy in code. Observed: `sendPinned` uses `httpsRequest` with `agent: false`. The address the other side sees is the server's egress IP (guessed). `outside-services.ts:43` says "it receives the address of this server".
- "Whose" `from` address the report mail carries: I did not read `buildReportMail` past `from: own`.

1. **The request** (`apps/server/src/platform/public-http.ts`, `sendPinned`, observed)
   - Method and body: POST, body `List-Unsubscribe=One-Click` (`ONE_CLICK_BODY`).
   - Headers: `Host: <hostname>`, `Content-Type: application/x-www-form-urlencoded`, `Content-Length`, `User-Agent: email-assistant-unsubscribe/1`, `Accept: */*`, `Connection: close`. No cookies, no auth, no mailbox data.
   - Target: the first `https` URI of the stored `List-Unsubscribe` header of the newest mail (`newsletter-senders.ts` `firstHttpsUnsubscribeUrl`, `linkUrl`). It is untrusted mail text. It is sent only for a sender with `oneClick`: `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, an `Authentication-Results` from a trusted authserv-id, and `List-Unsubscribe` in a DKIM `h=` list.
   - Guard: https only, port 443, no userinfo, no IP literal, no local TLD. It resolves DNS once and refuses if any answer is non-public. It connects to the checked IP with SNI. It never follows a redirect (3xx gives `failed/redirect`). Timeout is 10 s (`ONE_CLICK_TIMEOUT_MS`). It reads at most 4096 bytes and drops them.
2. **Timing, retries, storage** (`triage/newsletter-unsubscribe.ts`, `newsletter-routes.ts`, observed)
   - Runs only when an owner taps (`POST /newsletters/:mailboxId/unsubscribe`, flag `bulk_unsubscribe` first, then `requireOwner`). No job or scheduler sends it.
   - No retry. The intent row is committed before the request. A crash leaves status `requested` and never a second request. A second tap returns `already_requested`. Unique key `(mailbox_id, sender_lower)`.
   - Limits per hour: 20 per organization, 3 per organization and sender domain (`UNSUBSCRIBE_ORG_LIMIT`, `UNSUBSCRIBE_DOMAIN_LIMIT`).
   - Stored in `unsubscribe_requests` (`db/migrations/20261117140001_unsubscribe_data.sql`): `org_id`, `mailbox_id`, `sender_lower`, `sender_domain`, `method='one_click'`, `status` (requested/done/failed/refused), `code`, `created_at`, `finished_at`. Plus an audit row `newsletterUnsubscribe` with mailbox_id, domain, status, code. The URL is never stored, logged or audited. The response body is dropped.
3. **`unsubscribe-data` category** (`packages/core/src/legal/data-categories.ts:277-288`, observed)
   - Columns `unsubscribe_requests.*`, `subjects: ["others"]`, kept `untilMailbox`. The `members` subject is missing. The `subjects` type has `users` for members and `others` for non-members (line 30). `outside-services.ts:39` (`unsubscribe_target`) already describes the request.
   - The owner decision logs the three items as one batch: the one-click line, `members` in `unsubscribe-data`, and the report-mail line (`docs/owner-decisions.md:600`). I read it as "members" meaning the `users` subject, since the owner taps. Guessed.
4. **Report mail appended into the INBOX** (observed)
   - Flag: `report_mail` (`packages/core/src/features.ts:161`, default false). The sender checks it per row (`channels/report-mail-sender.ts:100`). With it off, rows wait 15 min.
   - Code: `createReportMailSender` claims `channel='mail'` outbox rows. It calls `ReportMailbox.append` (`channels/report-mailbox-imap.ts:38-67`), which runs `provider.appendMessage(INBOX, raw, [], now)`. It sets no flags and does no SMTP. It checks the Message-ID first on a retry.
   - Content: kinds `digest`, `weekly_report`, `trust_report_ready`, `autonomy_paused` (`notices/kinds.ts:41`). The message (`outgoing/report-mail.ts`) holds Message-ID `<ea-report-<outboxId>@<mailbox domain>>`, a date, `from`, `to` (only the mailbox's own address), a subject by kind and locale, text, html, and header `X-EA-Action-Id` = outbox id. Only links that start with `WEB_BASE_URL` become links. `isOwnReportMail` (`own-report-mail.ts`) stops sync from triaging it.

Checks: `apps/server/test/integration/unsubscribe-data-schema.test.ts` and `apps/server/src/trust-docs.test.ts` exist; I did not run or read them. They probably cover the schema and the legal/claims text. Nothing run covers the packet.
````

## Scout 3 · job `2026-11-20-f162-scout-3-88567a26`

Question:

> How are the legal papers built and checked at HEAD: the text tables in packages/core/src/legal/ (data catalog, sub-processor registry, which rows name LLM calls per role), the TERMS_HISTORY / legal version mechanism and its test, apps/web/src/legal/{en,pl}/privacy.md structure, docs/legal/claims.md format and the highest claim id, the claims checks (claimProblems, legal-papers.test.ts, docs:build claim_check), and the DPIA draft file. Which privacy-text sentences are pending from other tickets (for example F120 sender context, F115 drafts) and whether any branch or planned ticket also adds a legal version now? Context: spec/features/planned/F162-the-privacy-papers-name-what-the-open-loops-extractor-and-the-one-click-unsubscribe-send/ticket.md. Answer for the code at HEAD.

Packet:

````text
Packet: How the legal papers are built and checked at HEAD, and which privacy sentences or legal versions are pending (for F162)
Base: fb1df6d64
Verified: `grep -o "^| C[0-9]*" docs/legal/claims.md | sort -t C -k2 -n | tail -2` -> `| C262` | `git status --short` -> empty
Unknowns:
- I ran no test, so I did not prove that the claims and legal-papers tests pass at HEAD.
- Branch `limen/2026-11-19-f138-stage-02-remove-gemini-prov-e2edaabc` adds `{ version: "2026-11-19-3", … }` to `TERMS_HISTORY` (observed in `git diff master...`). The 2026-11-19-3 version sorts BEFORE the 2026-11-20 entry already on master, so a merge would break the ordering test (guessed). I did not check whether it is merged or abandoned. It also changes both privacy.md files and `subprocessors.ts`.
- No planned or active ticket body adds a legal version. F115 and F122 are active. Their plan files mention privacy text. I did not read them in full.
- The F120 sender-context and F115 sentences are not pending. The `sender-context` category and the sender-counts text already exist. The F115 reply-draft text landed as version 2026-11-19-2. The F110 "batched with F115 stage 17" decision is superseded by F162.

1. `packages/core/src/web/terms.ts` `TERMS_HISTORY` — append-only list of `{version, sha256}`. The last entry is `2026-11-20` (comment "AI provider: thread context, history check"), and `TERMS_VERSION` is the last entry. New versions use `YYYY-MM-DD.N`, so F162 needs `2026-11-20.2`. `apps/web/src/lib/legal-version.test.ts` test 2 fails until the last digest equals `legalTextsDigest` (`apps/web/src/lib/legal-checks.ts`) of the six pages, two registries, `legal_*` keys and `tg_consent_text`. Its message prints the line to append. `packages/core/src/web/terms.test.ts` checks the version format, ordering and that every legacy hyphen version stays. `apps/server/test/integration/web-terms.test.ts` also uses it. — observed
2. `packages/core/src/legal/` — `data-categories.ts` (386 lines): `dataCategories` with `id, label, purpose, columns, subjects, kept`. It already has `open-loops` (`open_loops.*` columns, ~line 237) and `unsubscribe-data` (`unsubscribe_requests.*`, ~line 278). `subprocessors.ts`: `Subprocessor` has `purpose`, `dataReceived`, `location`, `termsUrl`, `personalData` and `activeWhen`. The `dataReceived` text of the `openai` row (line ~50) names the triage inputs and the draft inputs. No row names the open-loops extractor input or the unsubscribe request. The registry has no per-role table: roles are named only in prose ("triage", "drafts"). `subprocessors.ts` still has a `gemini` row, which the F138 branch removes. — observed
3. `apps/web/src/legal/{en,pl}/privacy.md` — `##` sections: Who is responsible, What data, Why and on what basis, How long, Who receives data, AI and decisions, Your rights, Security, Changes. The "AI and decisions" bullets (line ~53) name sorting, reasons, summaries and reply drafts. They do not name open loops, the extractor, one-click unsubscribe or the report mail. grep finds no "open loop", "unsubscribe" or "extractor" in the en privacy.md. `deploy/README.md:853` holds the line to delete ("The privacy text does not yet name the one-click request"). — observed
4. `docs/legal/claims.md` — a count table at the top (rows, gap, unverified, id range per paper). It has a "Later additions (F153)" row `C261 to C262`, and the total is `262 | 3 | 29 | C001 to C262`. Each row is `| Cnnn | claim | source | condition |`. The source is a repo path or an ADR, `gap` or `unverified` marks a weak source, and a public URL needs `read YYYY-MM-DD`. Highest id: C262 (line 336). A new section or row needs the table updated: the new paper row, the total, and the id range. — observed
5. Claims checks:
   - `apps/server/src/legal-papers.test.ts` — ids in order with no gap, source paths exist, ADR numbers exist, URLs dated, the table counts match the rows. Tests 3 to 8 of the 7-day group tie rows C261, C262, the privacy pages and the DPIA to the code constants (`THREAD_MAILS`, `EXCERPT_CHARS`, `HISTORY_*`). Also checks the DPIA headings and its eight risk rows, and that every category and every sub-processor with personal data is named in the records of processing.
   - `apps/docs/src/security/claims.ts` `claimProblems` — each public claim needs ledger rows (`ledger_missing`, `ledger_weak`), proof paths that exist and that a cited row's source names (`proof_not_in_ledger`), and a condition when a row has one (`condition_missing`).
   - `apps/docs/integrations/claim-check.ts` — the `docs:build` step; it prints `claim_check ok N` or throws `claim_check failed:` plus the problems.
   - `apps/docs/src/security/claims.ts` — `ai-provider-receives` cites C261 and C262. A new AI-input row would extend this list. — observed

The DPIA draft is `docs/legal/dpia.md`. The "Flow" bullet and the "Necessity and proportionality" bullets describe the triage send. The history check and the sender-counts text are present. There is no extractor text and no unsubscribe request text. Its sections are fixed by test 3 of `legal-papers.test.ts`: Description of the processing, Necessity and proportionality, Risks, Measures, Residual risk, Decision. — observed

Checks: `legal-version.test.ts` and `terms.test.ts` cover the digest and version rules. `legal-papers.test.ts` covers the ledger shape and the DPIA and records structure. `claim-check.test.ts` covers the build check. They miss any link between a new claim row and the code field it describes, so a new row needs its own assertion, like C261 and C262.
````
