# 0012 — LLM: data rules, endpoint per stage, cost and failure limits
- Status: accepted (user, 2026-11-02)
- Date: 2026-11-02
- Amends: 0007 (Gemini and `@google/genai` stay)

## Context
The product brief promised "zero retention" and "EU data location". The Gemini Developer API gives neither (checked 2026-11-02,
`notes/2026-11-02-external-facts-gmail-gemini-telegram.md`):
- Paid tier: Google logs prompts and responses for 55 days for abuse checks. Staff can review flagged content.
- Data "may be stored transiently or cached in any country in which Google or its agents maintain facilities".
- Google: for guaranteed zero data retention or enterprise data terms, use Vertex AI. Vertex AI has an EU endpoint.
- Only Paid Services are allowed when an app serves users in the EEA.
Price of `gemini-3.8-flash` (per 1M tokens, paid): $0.75 input / $3.75 output until 2026-12-31, then $1.50 / $7.50.
Output includes thinking tokens. On 2026-11-02 the model returned `503 high demand`, and one call hung for more than 90 s.

## Decision
- **Billing gate point:** ADR 0007 names "slice S1 on the user's real Gmail". It is now slice S1b on the user's Interia mail.
- **Pilot (the user's own Interia mail):** Gemini Developer API, paid tier. The user accepts the 55-day abuse logging
  and no EU location (user, 2026-11-02). Cloud Billing must be on before real mail (ADR 0007 gate stays).
- **Before the first external customer:** `platform/llm.ts` moves to Vertex AI with the EU endpoint and its zero-data-retention setup.
  `@google/genai` supports it (`vertexai: true`, `project`, `location`). Nothing else changes.
- Never use Grounding with Google Search or Maps on mail (Google stores it for 30 days, with no opt-out).
- **Cost:**
  - `classify` uses the lowest thinking setting. The info summary comes in the same structured output (one call per mail).
  - The S1b eval compares a Flash-Lite model for the `classifier` role. Pick the cheapest model that passes the go/no-go bar.
  - A Cloud Billing budget alert. A daily cap of LLM calls per mailbox (default 300). Mail older than 7 days is not sent to the LLM.
  - `triage_results` stores tokens in/out and latency. A one-page cost model comes before S6.
- **Failures:** each call has a timeout (default 30 s). 429, 503 and timeouts are soft errors: the item waits and retries later,
  and these errors do not count toward the 3 tries. A rate limiter in `platform/llm.ts` keeps calls under the tier limit.

## Consequences
- The privacy text in the brief and the privacy policy say what really happens to mail at each stage.
- Moving to Vertex AI needs a Google Cloud project with billing and a service account (S6).
- Overload of a new model does not push mail into `AI/Manual`; it only delays it.
