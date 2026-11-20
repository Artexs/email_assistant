# F122 stage 02 — Suggestion route `[risky]`

Part of [`../plan.md`](../plan.md). Needs stage 01: `buildStyleSamples`, `checkStyleSuggestion`, `prompts.stylist`. C1 review after this stage.

The owner route that reads the sent texts, makes one `stylist` call and answers the text. Real Sent text of the user goes to the model here, so this stage carries the privacy rules.

## Step 1 — Flag and reader

- **Goal:** flag `style_from_sent` (`interfaces.md`); `listStyleSources` in module `mail` (repo of `sent_emails`, exported through `mail/index.ts`).
- **Decisions:** D3. `since` = `now − 14 days` on `internal_date`; `limit` = `STYLE_MAX_SOURCES`; newest first by `internal_date`, then id. `testOnly`: under the `synthetic` scope a row counts only when the test-mail rule that the open-loop analysis applies to a Sent row says it is test mail. Filter by `org_id` and `mailbox_id`.
- **Test (integration):**
  1. 6 rows: one `origin = system`, one `content = headers_only`, one `internal_date` 15 days ago, one `auto_submitted = auto-replied`, one with `list_id`, one good → 1 source.
  2. 120 good rows → 100, the newest first.
  3. With the context of org A: a row of org B → absent; a row of another mailbox of org A → absent.
  4. `testOnly` set: a row to a non-test address → absent; a row to a test address → present.

## Step 2 — Service

- **Goal:** `createStyleSuggestion` in module `replies` (a new file next to `preview.ts`), wired in the composition root like `createStylePreview` (same `realMail` and LLM scope inputs).
- **Decisions:** D2, D5, D7–D11, in this order: mailbox of the org (else `not_found`); `oauth_provider` set → `blocked`; flag `sent_sync` off or the switch off → `sent_off`; the day limit (3 `mailbox.style_suggested` rows of the mailbox in the quota day, the day of `LLM_DAILY_CAP`) → `limit`; the per-mailbox in-memory lock → `busy`; `realMail` false or no model client → `failed` / `llm_off`; read sources and build samples, fewer than `STYLE_MIN_SAMPLES` → `too_few` (no call); `capVerdict` trigger `tap` → `failed` / `llm_cap`; the call (`llm.generate`, role `stylist`), the schema (`output`), the checks with one retry that names the failure codes (`checks`), a provider error (`provider`); read the switch again (D10); write the `llm.call` rows of every attempt (`recordLlmCall`, role `stylist`, `email_id` null) and the audit row; release the lock in `finally`. The `language` input is the panel language of the user (null reads as `pl`, as the preview does). The profile signature for the cut is the stored one (`mailboxProfileOf`), with the D13 fallbacks of today.
- **Test (integration, fake LLM):**
  1. 6 good sources, fake answers a clean style → `suggestion`, `count` 6; 1 `llm.call` row with role `stylist` and no `email_id`; 1 audit row with `outcome: "suggestion"`, `count: 6` and no text.
  2. 4 sources → `too_few` with `count` 4; no `llm.call` row.
  3. Fake answers a text with a recipient first name, then a clean one → `suggestion`; 2 `llm.call` rows.
  4. Fake answers a phone twice → `failed` / `checks`; 2 rows.
  5. Fake answers `{}` → `failed` / `output`.
  6. The fake turns the switch off during the call → `sent_off`; audit `outcome: "sent_off"`.
  7. Three runs, then a fourth → `limit`; two at once → one `busy`.
  8. `LLM_DAILY_CAP` used up → `failed` / `llm_cap`; no call.
  9. `realMail` false → `failed` / `llm_off`; no source read (a spy on the reader).
  10. The prompt the fake receives holds no subject and no address of the sources.

## Step 3 — Route, docs

- **Goal:** the route of `interfaces.md` in `replies/routes.ts`, with `apiDoc` and the core answer schema; the log events of D11 (fields from `platform/log-fields.ts`); capability pages: `reply-drafts.md` (new rule and limits), `sent-mail.md` rule 13 (sent text goes to the LLM for the open-loop analysis and, on the tap, for this suggestion; the switch is the consent), `drafts-and-send.md` (style card line).
- **Decisions:** D8. Flag check first (404 for every role, also a bad id), then `requireOwner`.
- **Test (integration):**
  1. Member → 403; no flag `style_from_sent` → 404; no flag `reply_drafts` → 404.
  2. Mailbox of org B → 404.
  3. The service answers map to 200, 409 and 429 as `interfaces.md` lists (one case each, `test.each`).
  4. A log line of a success holds `mailbox_id` and `count` only.
- **Check:** the touched test files, then the Proof.
- **Done when:** the tests pass; the guards (flag, owner, org scope, switch) each fail their test when removed; the Proof line is PASS.
- **Out of scope:** the web card (03); eval (06–08).
