# External facts for the MVP plan: Gmail, Gemini, Telegram (checked 2026-11-02)

Source of the check: the cold review of the MVP plan (`spec/features/done/2026-11/F016-mvp-plan-review/plan.md`).
Each fact has its source URL. Check the facts again if they are older than about 3 months.

## Google OAuth and Gmail

- **Testing status:** "Authorizations by a test user will expire seven days from the time of consent.
  If your OAuth client requests an `offline` access type and receives a refresh token, that token will also expire."
  Max 100 test users. — https://support.google.com/cloud/answer/15549945
- **Personal use without verification:** "If the app is for your personal use (fewer than 100 users), you and your limited
  number of users can continue using the app without going through verification (users will be allowed to click through
  'unverified app' warning screens during sign-in)." — https://support.google.com/cloud/answer/13464323
- **Published + unverified + restricted scopes:** "Strongly discouraged." The consent screen shows the unverified-app warning,
  and "a hard cap of 100 total users applies". The cap counts over the whole life of the project and cannot be reset.
  — https://developers.google.com/identity/protocols/oauth2/production-readiness/overview , https://support.google.com/cloud/answer/15549945
  The docs do not say in direct words that the 7-day expiry stops in production. Check it with a real token (more than 7 days).
- **Internal user type (Google Workspace):** "All users within your organization can access. Verification is not required."
  No unverified screen and no 100-user cap. The project must belong to the Workspace organization.
- **Admin-trusted app:** a Workspace admin can mark a third-party app as trusted in the Admin console. Users can then install it
  "whether the app is verified or not". The trusted status "overrides ... the 100-test-user cap and the 7-day refresh token
  expiration limit for apps in the Testing status" for that organization's users.
  — https://support.google.com/cloud/answer/13464323 , https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
- **Separate projects:** Google asks for separate Cloud projects for development/testing and production. Submit only the
  production project for verification. — https://support.google.com/cloud/answer/13464323
- **CASA:** apps with restricted scopes need a security assessment every 12 months (from the date of the last Letter of Validation).
  — https://support.google.com/cloud/answer/13463816 . The assessment checks that the app "can securely handle data and delete
  user data upon request". — https://support.google.com/cloud/answer/13465431
  Tier 2 self-scan is no longer an option; an authorized lab does the assessment (Google groups post, 2024-05).
  Lab prices: about $500–$3,000 per app per year for AL1 (Tier 2), about $5,400 for AL2 (Tier 3)
  (https://www.secusy.ai/blog/google-casa-assessment-cost , 2026-10; TAC Security list $540–$720 in 2024).
- **Limited Use (Google API Services User Data Policy):** transfers only to provide user-facing features with the user's consent.
  "Don't allow humans to read the data, unless: You first obtained the user's affirmative agreement to view specific messages ..."
  So eval cases made from a customer's mail need that customer's consent per message.
  — https://developers.google.com/terms/api-services-user-data-policy
- **History sync:** "History records are typically available for at least one week and often longer. However, the time period
  ... might be significantly shorter." A `startHistoryId` outside the range gives HTTP 404; then the client must do a full sync.
  History returns message-added and label-changed events. — https://developers.google.com/workspace/gmail/api/guides/sync
- **`users.messages.insert`:** "Directly inserts a message into only this user's mailbox similar to IMAP APPEND ...
  Does not send a message." Scope `gmail.modify` is enough. Use it to fill a test mailbox with synthetic mail.
  — https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/insert

## Google Gemini

- **Model:** `gemini-3.8-flash` exists, label "New Stable", "Our most intelligent Flash model". Previous: `gemini-3.6-flash`.
  Cheaper: `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`. — https://ai.google.dev/gemini-api/docs/models (page updated 2026-10-28)
- **Price `gemini-3.8-flash`, paid tier, per 1M tokens:** input $0.75 and output $3.75 (output includes thinking tokens)
  through 2026-12-31; **$1.50 and $7.50 from 2027-01-01**. Free tier: yes. Flash-Lite: about $0.25–0.30 input, $1.50–2.50 output.
  — https://ai.google.dev/gemini-api/docs/pricing
- **Paid tier data use:** Google does not use prompts or responses to improve products. It processes them under the
  "Data Processing Addendum for Products Where Google is a Data Processor". — https://ai.google.dev/gemini-api/terms (effective 2026-03-23)
- **Paid tier logging:** "Google logs prompts and responses for a limited period of time, solely for detecting and preventing
  violations of the Prohibited Use Policy". The period is **55 days**. Authorized Google employees can review flagged content.
  — https://ai.google.dev/gemini-api/terms , https://ai.google.dev/gemini-api/docs/usage-policies
- **No data location:** "This data may be stored transiently or cached in any country in which Google or its agents maintain facilities."
  — https://ai.google.dev/gemini-api/terms
- **EEA rule:** in the EEA, Switzerland and the UK, the paid-tier data terms apply also to the free tier.
  And: "You may use only Paid Services when making API Clients available to users in the European Economic Area,
  Switzerland, or the United Kingdom." — https://ai.google.dev/gemini-api/terms
- **Zero data retention:** "If your workload requires guaranteed zero data retention or enterprise data processing agreements,
  use Vertex AI." Grounding with Google Search stores data for 30 days, with no opt-out. — https://ai.google.dev/gemini-api/docs/zdr
- **Vertex AI (now "Gemini Enterprise Agent Platform"):** EU multi-region endpoint keeps ML processing in the EU for the listed models.
  The `global` endpoint gives no data-residency promise. `gemini-3.8-flash` is in the data-residency table
  (check its EU mark on the live page). — https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/data-residency
- **SDK:** `@google/genai` (2.32.0 in `backend/`) talks to the Gemini API with `apiKey`, or to Vertex AI with
  `vertexai: true`, `project` and `location`. — https://googleapis.github.io/js-genai/release_docs/classes/client.GoogleGenAI.html

## Telegram Bot API

- "There are two mutually exclusive ways of receiving updates for your bot - the getUpdates method on one hand and webhooks
  on the other." Telegram keeps unread updates for max 24 hours. So one bot token cannot do dev long polling and a server
  webhook at the same time: use a dev bot and a pilot bot. — https://core.telegram.org/bots/api
- `callback_data`: 1–64 bytes. — https://core.telegram.org/bots/api/types/inlinekeyboardbutton.md
- `setWebhook` `secret_token`: 1–256 characters `A-Z a-z 0-9 _ -`, sent in header `X-Telegram-Bot-Api-Secret-Token`.
  — https://core.telegram.org/bots/api/methods/setwebhook.md

## Interia mail (IMAP) — the pilot mailbox since 2026-11-02

- Turn on mail-client access first: Ustawienia → Główne ustawienia → Parametry → "korzystam z programu pocztowego" = TAK.
- IMAP `poczta.interia.pl`, port 993 SSL/TLS. SMTP `poczta.interia.pl`, port 465 SSL/TLS (or 587 STARTTLS); SMTP needs login.
  User name = the full address. — https://pomoc.poczta.interia.pl/programy-pocztowe/news-parametry-do-konfiguracji-programow-pocztowych,nId,2136275
- Interia turns off the unencrypted port 143. — https://pomoc.poczta.interia.pl/programy-pocztowe/news-wylaczamy-nieszyfrowany-port-143-sprawdz-jak-przejsc-na-port,nId,23503253
- Not checked yet: app passwords, and the server's IMAP extensions (IDLE, MOVE, UIDPLUS, CONDSTORE, custom keywords).
  Check them with `imapflow` on the real account before S1.
- Google verification and CASA apply only to Gmail scopes. They do not apply to Interia IMAP.

## Local facts (this repo and the dev server)

- The azyl dev server home folder is shared with other projects and tools (`.claude/skills/vps-ssh/SKILL.md`).
  Secrets in that folder are readable by other processes of the same user. Do not keep real-mail tokens there.
- `astro.config.mjs` uses `output: "server"` with the Node adapter: the web app is a second server process.
