# F122 stage 02 — Suggestion service `[risky]`

Part of [`../plan.md`](../plan.md). Needs stage 01: `buildStyleSamples`, `checkStyleSuggestion`, `prompts.stylist`. C1 review after 02b.

The service behind the owner route: read the sent texts, one `stylist` call, answer the text. Real Sent text reaches the model here. The route is stage 02b.

## Step 1 — Flag and reader

- **Goal:** flag `style_from_sent`; `listStyleSources` in module `mail` (`interfaces.md`).
- **Decisions:** D3. `since` = `now − 14 days` on `internal_date`; `limit` = `STYLE_MAX_SOURCES`; newest first by `internal_date`, then id. `testOnly`: under the `synthetic` scope a row counts only when the test-mail rule of the open-loop analysis (`loops/analysis-repo.ts`: the synthetic message-id marker, or a `from_address` in the test senders) says it is test mail; reuse that rule, do not write a recipient rule. Filter by `org_id` and `mailbox_id`.
- **Test (integration):**
  1. Rows `origin = system`, `headers_only`, 15 days old, `auto_submitted = auto-replied`, with `list_id`, `origin = user` with an `action_id` (a system draft the user sent), and one good → 1 source.
  2. 120 good rows → 100, the newest first.
  3. With the context of org A: a row of org B → absent; a row of another mailbox of org A → absent.
  4. `testOnly` set: a row in the form that the open-loop rule accepts → present; the same row without it → absent.

## Step 2 — Service

- **Goal:** `createStyleSuggestion` in module `replies`, wired in the composition root next to `createStylePreview`. `realMail` = the sub-processor flag of the provider of the `stylist` role (not the drafter's); `scope` = the replies LLM scope that the samples get (`ReplyLlmScope`).
- **Decisions:** D2, D5, D7–D11, in this order: mailbox of the org (else `not_found`); `oauth_provider` set → `blocked`; flag `sent_sync` off or the switch off → `sent_off`; the day limit (3 `mailbox.style_suggested` rows of the mailbox in the quota day, the day of `LLM_DAILY_CAP`, whose `outcome` shows a model call: `suggestion`, `checks`, `output`, `provider`) → `limit`; the per-mailbox in-memory lock → `busy`; `realMail` false or no model client → `failed` / `llm_off`; read sources and build samples, fewer than `STYLE_MIN_SAMPLES` → `too_few` (no call); `capVerdict` trigger `tap` → `failed` / `llm_cap`; the call (`llm.generate`, role `stylist`), the schema (`output`), the checks with one retry that names the failure codes (`checks`), a provider error (`provider`); read the switch again (D10); write the `llm.call` rows of every attempt (`recordLlmCall`, role `stylist`, `email_id` null) and the audit row (`outcome` = the answer kind or failure reason, `interfaces.md`); release the lock in `finally`. The `language` input is the panel language of the user (null reads as `pl`, as the preview does). Any owner of the organization may ask for any of its mailboxes, as with the profile (`questions.md` 14). The profile signature for the cut is the stored one (`mailboxProfileOf`), with the D13 fallbacks of today.
- **Test (integration, fake LLM):**
  1. 6 good sources, fake answers a clean style → `suggestion`, `count` 6; 1 `llm.call` row with role `stylist` and no `email_id`; 1 audit row with `outcome: "suggestion"`, `count: 6` and no text.
  2. 4 sources → `too_few` with `count` 4; no `llm.call` row.
  3. Fake answers a text with a recipient first name, then a clean one → `suggestion`; 2 `llm.call` rows.
  4. Fake answers a phone twice → `failed` / `checks`; 2 rows.
  5. Fake answers `{}` → `failed` / `output`.
  6. The fake turns the switch off during the call → `sent_off`; audit `outcome: "sent_off"`.
  7. Three runs, then a fourth → `limit`; two at once → one `busy`; three `too_few` answers, then a run with enough mail → a call (no-call outcomes do not count).
  8. `LLM_DAILY_CAP` used up → `failed` / `llm_cap`; no call.
  9. `realMail` false → `failed` / `llm_off`; no source read (a spy on the reader).
  10. The prompt the fake receives holds no subject and no address of the sources.

- **Check / Done when:** the touched tests pass; the guards (flag, org scope, switch) each fail their test when removed; the Proof line is PASS.
- **Out of scope:** the route (02b); the web card (03); eval (06–09).
