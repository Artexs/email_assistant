# F173 stage 01 — the DeepSeek row, the config accepts it, the privacy page names it

Needs: nothing from another stage. May run next to 03.
Part of [`../plan.md`](../plan.md). `[risky]` (privacy text, config, new Polish user text).

## Step 1 — row, flag and key map (one commit with step 2: the version digest covers the registry)

- **Goal:** `LLM_PROVIDER=deepseek` with `TRIAGE_LLM_SCOPE=all` loads in production, because DeepSeek now has a sub-processor row.
- **Interfaces:** `subprocessors` gains row `deepseek` (D4). `deepseekProvider.realMail` = `true` (D1). `OUTSIDE_SERVICE_KEYS.DEEPSEEK_API_KEY` = `"deepseek"` (D3). `checkRealMail` keeps its rule; it gets the flag through a lookup parameter with the registry as default, so a test can pass a provider with `realMail: false`.
- **Decisions:** P1, P3, D1–D4.
- **Test:**
  1. `config-deepseek.test.ts`: `LLM_PROVIDER=deepseek`, `DEEPSEEK_API_KEY=k`, `TRIAGE_LLM_SCOPE=all`, no `LAB_STACK` → loads; `roles.classifier.provider` = `deepseek`. Replaces old case 2.
  2. Same with `LAB_STACK=ea-prod` and with `LAB_STACK=""` → loads. Replaces old case 2b.
  3. `checkRealMail` with a lookup that answers `false` for `deepseek`: scope `all`, no lab → one issue, path `["LLM_PROVIDER"]`, message holds no key value; with `LAB_STACK=ea-sim` → no issue; scope `synthetic` → no issue.
  4. `LLM_PROVIDER=openai`, `OPENAI_API_KEY=o`, `OPENAI_BASE_URL=https://api.deepseek.com`, scope `all` → fails, keys `["OPENAI_BASE_URL"]` (D2). Same for `https://x.api.deepseek.com`.
  5. `outside-services.test.ts` case 1 passes unchanged (row ⇔ flag); break check: set `realMail: false` again and see it fail.
  6. New: row `deepseek` has `purpose` and `dataReceived` equal to row `openai` (`toEqual`), `location.en` contains `People's Republic of China`, `activeWhen` = `{ kind: "llmProvider", provider: "deepseek" }`, `personalData` = `true`.
- **Done when:** tests 1–6 pass; `grep -rn "realMail: false" apps/server/src/platform/llm/providers` finds nothing.
- **Out of scope:** the `OPENAI_BASE_URL` refusal itself (stays), per-role providers.

## Step 2 — privacy page en and pl, the legal version

- **Goal:** the privacy page names DeepSeek wherever it lists AI providers.
- **Decisions:** P2, P3, P4, P7, D6.
- **Text (en; pl says the same facts):**
  - "AI model" opens: "This install uses one AI provider for every AI call: OpenAI, DeepSeek or Google Gemini. The column "Used when" shows the condition." The old "This install uses OpenAI" and "An install can use Google Gemini instead" sentences go. Each OpenAI-only fact (no training, `store: false`, abuse logs, no EU region, page checked date) starts with "When the install uses OpenAI,".
  - New sentences: "When the install uses DeepSeek, the same data goes to DeepSeek. DeepSeek collects, processes and stores personal data in the People's Republic of China (its privacy policy, read <build day>). Whether DeepSeek uses or keeps API data: \<to confirm: DeepSeek API data use and retention>."
  - "Transfers outside the EEA": add DeepSeek, China. The mechanism stays `\<to confirm: transfer mechanism>`.
- The worker reads the two DeepSeek pages of plan F1/F2 again on the build day (curl, public URL) and writes that date. If the location sentence changed, stop and ask.
- Append the version entry (D6): comment "papers: DeepSeek as an AI provider".
- **Test:** 7. The digest test of `TERMS_HISTORY` passes with the new last entry. 8. `legal-papers.test.ts` passes (placeholders, pairs, paths). 9. A new tie in `apps/server/src/legal-outside-calls.test.ts`, `describe("deepseek")`: the en page holds `People's Republic of China` and `DeepSeek`; the pl page holds `Chińskiej Republice Ludowej` and `DeepSeek`; both hold the P4 placeholder.
- **Out of scope:** the terms page (no sentence there lists AI providers), the DPA body (Annex 2 is drawn from the registry).

## Step 3 — ledger rows for steps 1–2

- **Goal:** every new or changed sentence has its claim row.
- **Decisions:** D5.
- New rows: row `deepseek` purpose and data (source: `subprocessors.ts`, ADR 0015), location (F1 URL, read date), terms URL; the page sentences of step 2; the P4 placeholder as "unverified". Changed: C030, C038, C042, C043 and the rows of each rewritten OpenAI sentence (wording "when the install uses OpenAI").
- **Test:** 10. `apps/docs/src/security/claims.test.ts` pin moves to the new last C-number.
- **Out of scope:** DPIA, record B, public docs site (stage 02).

## Check

`bun test apps/server/src/platform/config-deepseek.test.ts apps/server/src/platform/outside-services.test.ts apps/server/src/legal-outside-calls.test.ts`

## Done when

Tests 1–10 pass; the version entry is the last entry and its digest matches; the Proof of `plan.md` exits 0.
