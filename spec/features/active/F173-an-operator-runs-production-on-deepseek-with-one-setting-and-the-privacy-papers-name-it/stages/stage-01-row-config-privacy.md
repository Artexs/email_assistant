# F173 stage 01 — the DeepSeek row, the config accepts it, the privacy page and record B name it

Needs: nothing from another stage. May run next to 03.
Part of [`../plan.md`](../plan.md). `[risky]` (privacy text, config, new Polish user text).

Steps 1–3 land together: the row fails `legal-papers.test.ts` and the digest until record B and the version entry follow.

## Step 1 — row, flag, key map, config message

- **Interfaces:** row `deepseek` (D4); `realMail` = `true` (D1); key map (D3). `checkRealMail` gets the flag through a lookup parameter (default: the registry); message per D1.
- **Decisions:** P1, P3, D1–D4.
- **Test:**
  1. `config-deepseek.test.ts` (replaces old case 2): `LLM_PROVIDER=deepseek`, `DEEPSEEK_API_KEY=k`, `TRIAGE_LLM_SCOPE=all`, no `LAB_STACK` → loads; `roles.classifier.provider` = `deepseek`.
  2. Same with `LAB_STACK=ea-prod` and `LAB_STACK=""` → loads (replaces old case 2b).
  3. `checkRealMail` with a lookup that answers `false`: scope `all`, no lab → one issue, path `["LLM_PROVIDER"]`, message contains `has no sub-processor row` and no key value; `LAB_STACK=ea-sim` → no issue; scope `synthetic` → no issue.
  4. `LLM_PROVIDER=openai`, `OPENAI_BASE_URL=https://api.deepseek.com`, scope `all` → fails, keys `["OPENAI_BASE_URL"]` (D2). Same for `https://x.api.deepseek.com`.
  5. `outside-services.test.ts` case 1 passes unchanged; `realMail: false` again makes it fail.
  6. Row `deepseek`: `purpose` and `dataReceived` `toEqual` row `openai`; `location.en` contains `People's Republic of China`; `activeWhen` = `{ kind: "llmProvider", provider: "deepseek" }`; `personalData` = `true`.
- **Done when:** tests 1–6 pass; `grep -rn "realMail: false" apps/server/src/platform/llm/providers` finds nothing.

## Step 2 — privacy page en and pl, record B, the legal version

- **Decisions:** P2, P3, P4, P7, D6.
- **Privacy text (en; pl says the same facts):**
  - "AI model" opens: "This install uses one AI provider for every AI call: OpenAI, DeepSeek or Google Gemini. The column "Used when" shows the condition." The sentences "This install uses OpenAI" and "An install can use Google Gemini instead" go. Each OpenAI-only fact (no training, `store: false`, abuse logs, no EU region, checked date) starts "When the install uses OpenAI," and is not generalised.
  - New: "When the install uses DeepSeek, the same data goes to DeepSeek. DeepSeek collects, processes and stores personal data in the People's Republic of China (its privacy policy, read <build day>). Whether DeepSeek uses or keeps API data: \<to confirm: DeepSeek API data use and retention>."
  - "Transfers outside the EEA": add DeepSeek, China; the mechanism placeholder stays.
- **Record B:** "Recipients" adds `deepseek` (when `LLM_PROVIDER` uses it); "Transfers outside the EEA" adds `deepseek`: People's Republic of China.
- Read F1/F2 again on the build day (curl); write that date. A changed location sentence: stop and ask.
- Append the version entry (D6): comment "papers: DeepSeek as an AI provider".
- **Test:**
  7. The `TERMS_HISTORY` digest test passes with the new last entry.
  8. `legal-papers.test.ts` passes; see tests 2 and 2b fail once with the row and without the record B lines.
  9. `legal-outside-calls.test.ts`: add `deepseek` to the `test.each` lists of the body and style caps; new `describe("deepseek")`: the en page holds `People's Republic of China` and `DeepSeek`, the pl page `Chińskiej Republice Ludowej` and `DeepSeek`, both the P4 placeholder.
- **Out of scope:** the terms page, the DPA body (Annex 2 comes from the registry).

## Step 3 — public claims and ledger rows

- **Decisions:** P11, D5.
- Claims `ai-provider-receives`, `ai-provider-reply-drafts`, `ai-provider-style-suggestion` (`apps/docs/src/security/claims.ts`): text "The default setup uses OpenAI as the AI model", condition "the default setup (`LLM_PROVIDER=openai`)", cite the new P11 row. `subprocessor-view.ts` does not change.
- Ledger new rows: the P11 row (source `DEFAULT_LLM_PROVIDER`, ADR 0015; no Gemini); row `deepseek` fields (location: F1, read date); the step 2 sentences; the P4 placeholder as "unverified". Changed: C030 (multi-provider), C038, C042, C043, C182, C184 (record B), each rewritten OpenAI sentence.
- **Test:**
  10. `claims.test.ts`: the row-count pin and per-paper count table follow.
  11. New: the ledger row that the three claims cite contains no `Gemini`; each of the three claim texts contains `OpenAI` only inside `The default setup uses OpenAI`.
  12. `subprocessor-view.test.ts` passes unchanged (no `deepseek` row on the public page).
- **Out of scope:** DPIA, public page bullets (stage 02).

## Check

`bun test apps/server/src/platform/config-deepseek.test.ts apps/server/src/platform/outside-services.test.ts apps/server/src/legal-outside-calls.test.ts apps/server/src/legal-papers.test.ts apps/docs/src/security`

## Done when

Tests 1–12 pass; the version entry is last and its digest matches; the Proof of `plan.md` exits 0.
