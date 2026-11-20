# F163 scouts (3, at 86e3469dd)

Packets copied whole. A packet is a lead; the planner read stylist.ts, style-suggest.ts, style-samples.ts, style-sources.ts, terms.ts, privacy.md and claims.ts at HEAD.

## Scout 1

Question: What exactly does the reply-style call in apps/server/src/modules/replies/stylist.ts send to the LLM provider (which mail, which fields, how the text is cut, char/count limits as named constants, retries and timeouts, LLM role and which providers that role can map to, the feature flag style_from_sent default and owner epic), who calls it (job/route/schedule), and what it stores (tables, llm_call rows, retention, org delete/DSR)?

Job: `2026-11-20-f163-scout-1-1bd902b7`

Packet: What the reply-style call sends to the LLM, who calls it, and what it stores
Base: 86e3469dd
Verified: `git status --short` -> (no output, worktree clean). I read the code and ran nothing else.
Unknowns:
- Whether the org delete and the DSR erase remove `audit_log` rows (`llm.call`, `mailbox.style_suggested`). I read no delete statement for `audit_log`. `docs/capabilities/retention.md:34` says the retention job never touches `audit_log` (ADR 0008: kept until the mailbox or organization is removed). `modules/privacy/export-map/tables-a-d.ts:34` lists `audit_log` in the export map. `modules/privacy/erase.ts:278-290` deletes `sent_emails` rows or sets `content='headers_only'`.
- The default retry and timeout values of the stylist role at runtime. The code default is `defaults.timeoutMs: 30000` per provider (`platform/llm/providers/openai.ts:214`, `gemini.ts:103`, `deepseek.ts:32`). `LLM_STYLIST_TIMEOUT_MS` (`config-llm.ts:26-36`, `.env.example:46`) overrides it. I did not read `.env`.
- I did not read the `DSR` request code (`privacy/dsr.ts:120`, `dsr-match.ts:48,136`) closely. It matches `sent_emails` rows.

1. What the call sends. Observed.
   - `apps/server/src/modules/replies/stylist.ts:suggestStyle` calls `llm.generate({ role: prompt.role, promptVersion, schema: stylistOutputSchema, system: prompt.buildSystem(), prompt: prompt.buildUser({ samples, language, nonce, retry }) })`.
   - The `prompt` is `prompts.stylist`. It lives in `modules/triage/prompts/stylist-v1.ts`, version `stylist-v1`.
   - The system prompt holds no mail. The user prompt holds the cut sent-mail samples between `<<<SENT_DATA {id}>>>` markers. `stylist-v1.ts:cleanSample` strips marker lines and calls `neutralize`.
   - Recipient addresses are not sent. `style-samples.ts:StyleSource` comment: they feed only the name check. The language (`pl` or `en`) goes with the prompt. On a retry, the failure codes go with it, never the failed text.
   - The mail text is sent from `sent_emails.body_text`. It goes in one call, or two with the retry.
2. Which mail is chosen. Observed. `modules/mail/repo/style-sources.ts:listStyleSources` reads `sent_emails` rows.
   - Filters: one mailbox, `origin = 'user'`, `content = 'stored'`, `body_text` not null, `internal_date >= since`.
   - Excluded: auto-submitted mail, list mail, bulk, list or junk precedence, calendar invites, and system drafts (`action_id` not null).
   - Order: newest first. Limit: `STYLE_MAX_SOURCES`.
   - With the `synthetic` LLM scope, only test mail passes (`sentTestMailFilter`).
   - The caller is `style-suggest.ts:run` (lines 144-148). The window is `STYLE_SUGGEST_WINDOW_MS = 14 * DAY_MS` (`style-suggest.ts:30`).
3. How the text is cut. Observed. `packages/core/src/replies/style-samples.ts:buildStyleSamples`.
   - `cutQuotedReply` (`style-cut.ts`) removes the quoted older mail, the forwarded part, Outlook header blocks and the signature. The signature is the stored one, else the fallbacks (`style-suggest.ts:137-143`).
   - `cutChars` limits each sample to `STYLE_SAMPLE_MAX_CHARS = 1500` characters.
   - Empty samples are dropped. The loop stops when the total would pass `STYLE_SAMPLES_MAX_CHARS = 40 * 1500 = 60000`.
   - The name tokens (`styleNameTokens`) are only for the output check, not sent.
4. Count and call limits as named constants. Observed.
   - `STYLE_MAX_SOURCES = 100` (`style-samples.ts:17`).
   - `STYLE_MIN_SAMPLES = 5` (`style-samples.ts:15`). Fewer gives `too_few` and no call (`style-suggest.ts:151`).
   - `STYLE_SUGGEST_DAILY_LIMIT = 3` runs with a call per mailbox and quota day (`style-suggest.ts:28`).
   - `STYLIST_MAX_CALLS = 2` (`stylist.ts:41`). `maxCalls` is lowered by the daily cap check `spend.ts:capVerdict` (`style-suggest.ts:157,175`).
   - The check limits are `STYLE_SUGGESTION_MAX_CHARS = 1000` and `STYLE_OUTPUT_MAX_CHARS = 4000` (`style-check.ts:8-9`).
5. Retries and timeouts. Observed.
   - Retry is in `stylist.ts:suggestStyle`. One retry follows an unreadable answer (`LlmOutputError`) or a failed `checkStyleSuggestion`.
   - A provider error ends the call with `StylistCallError` and no retry. The result is `failed` / `provider` (`style-suggest.ts:176-182`).
   - The SDK retries are off. `maxRetries: 0` is in `platform/llm/providers/openai.ts:126`. I did not check the other providers' adapters.
   - The timeout is per role: `platform/llm/client.ts:generate` uses `AbortSignal.timeout(row.timeoutMs)` plus `withTimeout`.
   - `roleTimeout ?? settings.timeoutMs` comes from `config-llm.ts:llmRoleTable`.
   - The role also has a provider-wide rate limiter and an optional `LLM_STYLIST_RPM`.
6. LLM role and providers. Observed.
   - The role is `stylist`. `llm-roles.ts:3` lists it. `llm-providers.ts:119` gives `{ tier: "light", effort: "low" }`.
   - Every role uses `LLM_PROVIDER` (`config-llm.ts:98`, `llmRoleTable`). The provider is one of `openai`, `gemini`, `deepseek` (`llm-providers.ts:llmProviderCatalog`).
   - The light-tier model is `gpt-6-luna`, `gemini-3.5-flash-lite` or `deepseek-flash`. A tool override can change the provider (`LlmRoleOverride`).
   - `realMail` is `true` for openai (`openai.ts:215`) and gemini (`gemini.ts:104`). It is `false` for deepseek (`deepseek.ts:34`).
   - `start/triage.ts:171` sets `realMail` from `llmTable.roles.stylist.provider`. If it is `false`, `style-suggest.ts:105` answers `llm_off` before it reads any mail.
   - `config-llm.ts:checkRealMail` refuses `TRIAGE_LLM_SCOPE=all` with a `realMail: false` provider outside the sim stack.
7. The feature flag. Observed. `packages/core/src/features.ts:199`: `style_from_sent`, `default: false`, `epic: "E6b"`, `removeBy: "2027-03-01"`.
   - The route also needs `reply_drafts`, and the service needs `sent_sync` plus the mailbox switch (`style-suggest.ts:sentTrackingOn`).
   - `lab/seed.ts:61` keeps the flag off.
8. Who calls it. Observed. It is an owner-only web route with no job or schedule.
   - `modules/replies/routes.ts:113`: `POST /mailboxes/:id/profile/style-suggestion`. Middleware order: `flagsFirst("reply_drafts", "style_from_sent")`, then `requireOwner`.
   - The handler calls `deps.styleSuggestion(ctx, id, { userId, language })`, built by `style-suggest.ts:createStyleSuggestion`. `start/triage.ts:166` wires it.
   - The service refuses OAuth mailboxes (`blocked`). It allows one run at a time per org and mailbox (an in-memory `running` set, so not shared across processes).
   - The eval path (`style-eval.ts`, `style-gate.ts`) calls `suggestStyle` with another prompt version. I did not follow it.
9. What it stores. Observed. Nothing holds mail text or the suggestion text.
   - The suggested text is returned to the owner in the HTTP answer only. `routes.ts` comment: "the server stores none of it".
   - `llm.call` audit rows go through `spend.ts:recordAttempts` to `audit/repo/llm-calls.ts:recordLlmCall`. They are `audit_log` rows with `event='llm.call'`.
   - The fields are `mailbox_id`, `role`, `model`, `endpoint`, `provider`, `prompt_version`, `tokens_in`, `tokens_out`, `latency_ms` and `reason_code = outcome`. `email_id` is null.
   - One row is written per attempt, including failed ones (`style-suggest.ts:164-183`).
   - `audit_log` row `mailbox.style_suggested` (`audit/repo/events.ts:41`, `style-suggest.ts:auditRow`): `mailbox_id`, `count`, `outcome`, `via`, never a text.
   - The log lines are `style_suggested` and `style_suggest_failed` (`count`, `reason`, error fields only).
   - The cap counts `llm.call` rows through `capVerdict` (the `tap` trigger, `LLM_DAILY_CAP`).
10. Retention and delete of the source mail. Observed.
    - The source is `sent_emails.body_text`. `mail/repo/retention.ts:clearSentBodies` sets it to null after `organizations.data_retention_days` (default 30, per `docs/capabilities/retention.md:76`), counted from `internal_date`.
    - The daily job `apps/server/src/retention.ts:createRetentionJob` calls it. The row stays with `content = 'stored'`.
    - Subject and addresses are cleared after 90 days (`clearSentHeaders`).
    - The DSR and erase paths are in `modules/privacy/erase.ts:278-290`, `dsr.ts:120` and `dsr-match.ts:48`. See Unknowns for `audit_log`.
    - Gap in the packet question: the sources stay readable for the 14-day suggestion window, which is shorter than the 30-day default body retention.

Checks: `modules/replies/stylist.test.ts` and `style-injection.test.ts` exist and cover this call. I did not run them (the reminders forbid running suites in a scout job). Not covered: the actual outbound request body, and the audit_log delete on org delete.

## Scout 2

Question: What is the state of the legal papers at HEAD: the legal version list (is 2026-11-20.2 present and unreleased, how is 'released' decided), the privacy page and terms page sources for en and pl, the sub-processor registry rows openai and gemini (dataReceived text), and how apps/server/src/legal-outside-calls.test.ts ties paper text to code constants?

Job: `2026-11-20-f163-scout-2-31bf814e`

Packet: State of the legal papers at HEAD (version list, privacy/terms sources, openai/gemini rows, outside-calls test)
Base: 86e3469dd
Verified: `git tag --contains 5666c3903` -> empty output (no tag contains the 2026-11-20.2 commit); `git status --short` -> empty
Unknowns: No code decides "released". The only signal is git tags. The newest tag is v0.4.4, and its `terms.ts` ends at `2026-11-20`. I did not check whether the VPS runs a build newer than v0.4.4.
1. `packages/core/src/web/terms.ts:TERMS_HISTORY` — Append-only list; the last entry is `2026-11-20.2` (sha256 `9af128497b…`, comment "papers: open-loops extractor, one-click unsubscribe request, report mail, shadow-mode exception"). `TERMS_VERSION` (`terms.ts:32`) is the last entry. It is unreleased: the commit that added it (5666c3903) is in no tag, and v0.4.3 and v0.4.4 both end at `2026-11-20`. The release step is a git tag; the code has no released flag. — observed
2. `apps/web/src/lib/legal-version.test.ts:29` ("2. the last TERMS_HISTORY digest equals the digest of the current texts") — The guard that forces a new entry. It hashes the six pages, both registries and the `legal_*` and `tg_consent_text` keys with `legalTextsDigest(legalTextParts())`. The failure message says to append `{version: nextLegalVersion(...), sha256}`. `nextLegalVersion` is in `packages/core/src/web/legal-version.ts`; it gives today's date, or the last date with the counter plus one. So F163 edits to the papers would need `2026-11-20.3`, unless the owner treats `.2` as still open and replaces its digest. Replacing a digest is guessed to break the append-only rule; `docs/capabilities/papers.md` rule 5 says append-only. — observed (the replace-vs-append reading is guessed)
3. `apps/web/src/legal/{en,pl}/privacy.md:48` (bullet "AI model" / "Model AI") — The reply-draft sentence lists what goes to the AI. It reads "the text of that mail with its quoted history, the subject, the sender and the date, the display name, the signature and the writing style of the mailbox, the one line of instruction ... and the time zone". No sentence says "cut sent mail" goes to a reply-style call. The open-loops sentence in the same bullet names 8,000 characters, 14 days and 10 recipients. Line 16 (AI results) and line 58 also mention reply drafts and open loops. Terms: `apps/web/src/legal/{en,pl}/terms.md` has only the "AI output" section (`en/terms.md:35`) plus the version-change rule (`en/terms.md:61`); it has no sentence about what goes to the AI. — observed
4. `packages/core/src/legal/subprocessors.ts:35` (`subprocessors`, ids `openai` and `gemini`) — `dataReceived` en and pl. The `openai` text has "for triage: …; for drafts: mail text, subject, sender, and for a reply draft also the display name, signature and writing style of the mailbox, the one line of instruction that the member typed and the time zone of the organization; for open loops: the subject, the local send time, the number of recipients and up to 8,000 characters of the text of own sent mail". The `gemini` text has the same triage and open-loops parts, but its drafts part is only "mail text, subject, sender", with no reply-draft fields. The Polish text writes `8000` with no separator. — observed
5. `apps/server/src/legal-outside-calls.test.ts` — Case shape: `test.each([{ name, actual, expected }])("the $name is pinned: if it changes, re-check the privacy papers", …)` with `expect(actual).toEqual(expected)`. Its 9 rows pin `EXTRACT_BODY_MAX` 8000, `SENT_MAX_AGE_DAYS` 14, `SENT_MAX_RECIPIENTS` 10, `EXTRACT_TEXT_MAX` 80, `MAX_ATTEMPTS` 3, `prompts.extractor.version` "extractor-v1", `ONE_CLICK_BODY`, `ONE_CLICK_USER_AGENT` and `reportMailKinds`. The text ties use number strings built from the constants (`bodyCap`, `ageLimit`, `recipientLimit`, en and pl). Tests: `extractorInputOf` returns exactly the keys `subject, sentLocal, recipientCount, body` and no address. Each privacy page contains the body cap, age limit and recipient limit, and `ONE_CLICK_BODY`. The claims rows C263, C264 and C265 in `docs/legal/claims.md` contain the constants. `test.each(["openai","gemini"])` checks that `dataReceived.en` and `dataReceived.pl` contain the body cap. The test also checks the `unsubscribe-data` subjects, the DPIA text and risk R10, and the deploy README. F162 added the whole file: c82ad25e8 (the pins and ties to the papers) and e978037c6 (the DPIA tests). The commit that added the papers text and `2026-11-20.2` is 5666c3903. The test has no reply-style constant, and no row ties the reply-draft fields or the cut sent mail to any text. — observed
Checks: `apps/web/src/lib/legal-version.test.ts` covers the digest-vs-last-entry guard; it does not cover whether a version was released. `apps/server/src/legal-outside-calls.test.ts` covers the extractor and one-click limits against the papers; it misses any reply-style call. I ran neither test; I only read them.

## Scout 3

Question: Under docs/legal: where are the DPIA, record B, the DPA, the ledger of outside calls, and the public security page claim about what goes to AI providers? Quote what each says now about AI provider inputs, and whether any text already mentions reply style or Sent mail. Also how F162 changed each of them.

Job: `2026-11-20-f163-scout-3-f0713b84`

Packet: where the privacy papers state AI provider inputs, what they say now, whether any names reply style or cut Sent mail, and what F162 changed.
Base: 86e3469dd
Verified: `git status --short | wc -l` -> `0`. Quotes below come from greps and reads of each file at HEAD.
Unknowns:
- Only `docs/legal/` holds the DPIA, record B and the claims ledger. The DPA, the public security claim and the sub-processor registry live elsewhere (paths below). I read "ledger of outside calls" as `docs/legal/claims.md`, because the F162 outcome calls it "the claims ledger (C263–C270)". The config-key map `apps/server/src/platform/outside-services.ts` is a second candidate. It holds no AI input text, and F162 did not touch it (observed, `git log`).
- Do `apps/web/src/legal/en/dpa.md` and the generated Annex 2 table repeat the registry text? I did not render Annex 2. I read only the registry source. The DPA body has no AI input text.
- I read the Polish pages only through the registry strings and the F162 diff stat.

1. **DPIA, `docs/legal/dpia.md`** — observed.
   - Flow line 12 (the AI-input paragraph): "For each mail that it classifies, the server sends the text, the subject, the sender, the To and Cc addresses and the date of the mail, the sender marks…, the delegates and up to three earlier mails of the thread as context to the LLM provider." It continues: "the server also sends each own Sent mail that it analyses to the LLM provider: the subject, the local date, time and weekday of the send, the number of recipients and up to 8,000 characters of the text, and no address from the headers."
   - Risk R1 (line 45) names the text of own Sent mail on each open-loops analysis. The R1 measures (line 62) repeat the open-loops limits.
   - Reply style: no mention (grep for "style" gives no hit). The reply-draft call is not in the flow. Sent mail appears only for the open-loops extractor.
2. **Record B, `docs/legal/records-of-processing.md`** — observed.
   - Purposes (line 48): "open loops in the own sent mail of a member (an optional feature: the AI reads the subject, the send time, the recipient count and up to 8,000 characters of the text)".
   - Recipients (line 51): `openai` and `gemini`, plus the note on newsletter sender servers.
   - The categories table carries `reply-texts` ("sample drafts that the AI writes to show its style", line 72) and `mailbox-profile` ("the writing style that you set for a mailbox, used in the drafts that the AI writes", line 73). These two lines name style as stored data. They do not say that style or Sent mail goes to the AI provider. `mail-body` (line 62) says "received and sent mail, read by the AI".
3. **DPA, `apps/web/src/legal/{en,pl}/dpa.md`** — observed.
   - No AI input text and no "style". Annex 2 is built from `packages/core/src/legal/subprocessors.ts`.
   - Registry `openai` `dataReceived`: "for drafts: mail text, subject, sender, and for a reply draft also the display name, signature and writing style of the mailbox, the one line of instruction that the member typed and the time zone of the organization; for open loops: the subject, the local send time, the number of recipients and up to 8,000 characters of the text of own sent mail".
   - Registry `gemini`: "for drafts: mail text, subject, sender; for open loops: …" (no style).
   - Both name "writing style of the mailbox" (openai only) as a stored field. Neither names cut Sent mail in the reply-style call.
4. **Claims ledger, `docs/legal/claims.md`** — observed.
   - C136 (openai) repeats the registry text, including "also the display name, signature and writing style of the mailbox".
   - C139 (gemini) has no style.
   - C173 says the category `mailbox-profile` is kept until the mailbox or organization is deleted. C263 to C270 cover the extractor call, one-click unsubscribe, report mail and risk R10.
   - Nothing names the reply-style call or cut Sent mail.
5. **Public security claim, `apps/docs/src/security/claims.ts:48`, shown by `apps/docs/src/content/docs/security.mdx`** — observed.
   - Text: "This install uses OpenAI as the AI model. For each mail that it classifies, the assistant sends the text, subject, sender, To and Cc addresses and date… An optional feature, off by default, that tracks answers to the user's own sent mail also sends, for each such mail of the last 14 days, its subject, the local time of the send, the number of recipients and up to 8,000 characters of its text, but no address from the headers; the text can hold quoted mail of other people."
   - No reply-draft input and no style.
   - Related: the privacy page `apps/web/src/legal/en/privacy.md:48` says "To write a reply draft, it sends the text of that mail with its quoted history, the subject, the sender and the date, the display name, the signature and the writing style of the mailbox…". It does not say that cut Sent mail goes to the AI. Line 15 says "The assistant can read the Sent folder".

**What F162 changed.** Four commits. Outcome: `spec/features/done/2026-11/F162-*/outcome.md`. It says "Not covered: the reply-style call sends cut Sent mail to the AI and no paper names it (follow-up ticket)." All five items below are observed from `git show` and the diffs.
- `5666c3903`: the privacy and DPA texts in en and pl, the terms (en and pl), `terms.ts`, `subprocessors.ts` (open-loops input added to `openai` and `gemini`), `data-categories.ts`, `docs/legal/claims.md` and `records-of-processing.md` (+1 line), `deploy/README.md`, `claims.ts` (the security claim, via the claims test).
- `77e54b4d3`: the privacy retry wording (en and pl), `claims.md`, `records-of-processing.md`, `terms.ts`.
- `c82ad25e8`: new `apps/server/src/legal-outside-calls.test.ts`, which pins the extractor limits, the one-click body and agent, and the report-mail kinds; `claims.md`; the capability pages.
- `e978037c6`: the DPIA (flow, recipients, modes, purposes, R1 text, new R10 and its measures), `records-of-processing.md`, `claims.md`, the claims test, and the outside-calls test.
- DPIA: open-loops flow and limits added, the Sent-mail text added to R1, R10 added. Record B: purposes and recipients extended. Claims: C263 to C270 added (total 270). DPA: +4 lines (open loops and newsletters). Security claim: the open-loops sentence added.

Checks: `apps/server/src/legal-outside-calls.test.ts` covers the extractor limits, the one-click values and the report-mail kinds; it misses the reply-style call and cut Sent mail. I did not run it (read-only, and the project rule bars suite runs).
