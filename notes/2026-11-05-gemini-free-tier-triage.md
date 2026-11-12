# Gemini free tier for triage (S1b)

Facts for later agents. Sources: ADR 0013, `spec/features/done/2026-11/F018-s1b-shadow-triage/plan.md` (step 0.2, stage 18 and stage 34 logs).
VPS facts (stages 37–40) are not here yet. Append them later.

## Models tried

- 2026-11-04 free-tier check (key from `.env`):
  - `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-flash-lite-latest`: answer in about 1 s (`gemini-3.5-flash-lite` 837 ms).
  - `gemini-3.8-flash`, `gemini-3.7-flash`: `503 high demand` after 20–55 s.
  - `gemini-2.5-flash-lite`: 404 (gone).
- Provisional classifier model: `gemini-3.5-flash-lite`. Stage 36 makes the choice final. The choice line is in `docs/architecture.md` §6.3.

## Latency and errors seen

- Stage 18 smoke run (3 injection cases, `gemini-3.5-flash-lite`): 3 of 3 passed, 0 errors, p50 2394 ms, average 671 tokens in and 86 out.
- Stage 34 run (`bun run eval --set all`, `gemini-3.5-flash-lite`, prompt `classifier-v1`, 92 cases):
  - Latency p50 1010 ms, p95 8614 ms. Average 698 tokens in and 88 out.
  - Many 503 retries on Flash-Lite. About 190 requests for 92 cases.
  - 91 cases finished. One case ended as `http_503` after 4 retries.
  - The whole run took longer than 30 min. A tool timeout stopped it once. It resumed from the state file in `evals/.runs/`.
- Plan for long runs: do not start a full run late in a Pacific day. Spent quota and 4 retries per case make it slow.

## Limits (step 0.2)

Source: AI Studio "Gemini API Rate Limit" view, project "Gemini Project", free tier. Screenshots from the user, 2026-11-04.

| Model                   | RPM | TPM         | RPD         |
| ----------------------- | --- | ----------- | ----------- |
| `gemini-3.5-flash-lite` | 15  | 250K        | not visible |
| `gemini-3.1-flash-lite` | 15  | 250K        | not visible |
| `gemini-3.8-flash`      | 5   | 250K        | not visible |
| `gemini-3.6-flash`      | 5   | not visible | 20          |

- [not verified] Third-party sources (2026-10) say about 500 RPD for the Flash-Lite models and about 20 RPD for `gemini-3.8-flash`. Google's page does not confirm this.
- Defaults from these numbers: `GEMINI_RPM` 12 (15 × 0.8), `LLM_DAILY_CAP` 300 (right only if the RPD is 400 or more).
- The quota is per project. The worker and the eval runner share it.

## Free-tier terms

- Source: https://ai.google.dev/gemini-api/terms ("Gemini API Additional Terms of Service", effective 2026-03-23). Read 2026-11-04.
- Unpaid Services: Google may use the mail text and the answers to improve its products. Human reviewers may read them.
- The terms say: "Do not submit sensitive, confidential, or personal information to the Unpaid Services."
  The user accepted this for the temporary pilot mailbox only (ADR 0013, answer Q26).
- EEA rule: "If you're in the European Economic Area, Switzerland, or the United Kingdom", the paid-tier data terms apply to the unpaid quota too
  (no use to improve products; Data Processing Addendum). [not verified: how Google decides that "you're in" the EEA.] ADR 0013 does not rely on it.
  Source: the same terms page, read 2026-11-04.
- Other persons or mailboxes need a paid tier (Cloud Billing) or Vertex AI first (ADR 0013).

## Quota-day rule

- The RPD resets at midnight Pacific time (Google rate-limits page). The code uses the `America/Los_Angeles` day (`QUOTA_TIMEZONE`).
- `LLM_DAILY_CAP` counts every LLM call attempt (`audit_log` event `llm.call`) per mailbox since the start of this day.
  A failed call counts too.
- At the cap, mail waits until the next quota day. The worker logs one warning per mailbox and day, per process (a restart logs it again).
- The "3 different quota days" rule for `gemini-3.8-flash` (stage 36) uses the same Pacific day.

## How to read `llm.call` rows

- Table `audit_log`, `event` = `llm.call`. One row for each call attempt, also for a failed call.
- `reason_code` is the outcome: `ok`, or the error code: `http_429`, `http_503`, `timeout`, `http_400_key`, `http_400`, `unknown`, and so on.
- `data` holds `mailbox_id`, `model`, `prompt_version`, `tokens_in`, `tokens_out`, `latency_ms`. For a failed call the tokens are `null`.
- Soft errors (`timeout`, `network`, `http_429`, `http_500`, `http_502`, `http_503`, `http_504`) pause the LLM client. The mail gets no try count.
- Config errors (`http_401`, `http_402`, `http_403`, `http_404`, `http_400_key`, `http_400_precondition`) also pause the client.
- Hard errors (for example `http_400`, `unknown`) wait 5 minutes and count one try. Three tries end as `unsure` / `triage_error`.
- A safety block (`llm_blocked`) ends as `unsure` at once.
- A network error has no HTTP status. It is a soft error `network` when the error has a socket or DNS code (for example `ECONNREFUSED`, `ENOTFOUND`) on itself or on `cause`. It pauses the client and counts no try.
  An error without such a code (for example a plain `TypeError`) stays a hard error `unknown`, so a bug in our code does not loop.
  Architecture §4.1 rule 7 says the same.
- Count calls for one day: `select count(*) from audit_log where event = 'llm.call' and data->>'mailbox_id' = '<id>' and created_at >= '<quota day start>'`.
