# F173 stage 02 — DPIA, record B, public security page, ADR, capability pages, release note

Needs stage 01: row id `deepseek` in `subprocessors.ts` and its ledger rows (C-numbers). May run next to 03.
Part of [`../plan.md`](../plan.md). Review: `claude-opus-5-5` (DPIA, new Polish text on the docs site).

## Step 1 — internal papers

- **Goal:** the DPIA and the records of processing name DeepSeek as a possible LLM provider in China.
- **Decisions:** P3, P4, P5, D5.
- DPIA: "Recipients" names `openai`, `deepseek` or `gemini`. R1 title and text say "OpenAI or Gemini". New R11 (P5) in the risk, measures and residual tables. Measures of R11: the operator picks the provider (`LLM_PROVIDER`), shadow mode is the default, `TRIAGE_LLM_SCOPE` is a switch, the same input limits as R1. Residual: the EU has no adequacy decision for China (source: the EU Commission adequacy page, read on the build day), the mechanism is `\<to confirm: transfer mechanism>`, API data use is the P4 placeholder.
- Record B: "Recipients" adds `deepseek` (when `LLM_PROVIDER` uses it); "Transfers outside the EEA" adds `deepseek`: People's Republic of China.
- Ledger: new rows for R11 and its residual; changed C182, C184, C209.
- **Test:** 1. `legal-papers.test.ts` passes (the records name every sub-processor with personal data, so it fails before record B names `deepseek`; see it fail once). 2. A tie in `legal-outside-calls.test.ts` `describe("deepseek")`: the DPIA holds `| R11 ` and `China`.
- **Out of scope:** new risks for other providers.

## Step 2 — public docs site, security page en and pl

- **Goal:** the public security page does not imply that OpenAI terms cover every install.
- **Decisions:** P6.
- "Facts that come only from the AI provider" gets two groups: "OpenAI" (the two current bullets) and "DeepSeek": "The provider states that it collects, processes and stores personal data in the People's Republic of China ([its privacy policy](F1 URL), read <build day>)." and "This project has not checked whether DeepSeek uses or keeps API data." Polish: the same facts.
- "No EU-only AI processing by default" stays.
- The generated sub-processor table follows the registry: check that the docs build shows the `deepseek` row.
- **Test:** 3. `apps/docs/src/security/claims.test.ts` and `polish.test.ts` pass. 4. `bun run docs:build` prints `claim_check ok`.
- **Out of scope:** the look of the docs site (the Pebble docs ticket F171 owns it; a text conflict is a merge).

## Step 3 — ADR, capability pages, operator docs, release note

- **Goal:** every doc says production may use DeepSeek.
- **Decisions:** P1, P7, P9, D2, D7.
- ADR 0015: a new amendment "2026-11-26, DeepSeek for production": the owner decision, the row, the flag, the papers, the gate summary path (D7). It replaces the "dev, tests and evals" sentence of the 2026-11-20 amendment.
- `docs/capabilities/triage.md` rules 6 and 16, `drafts-and-send.md` (preview: DeepSeek now gets a preview), `papers.md` § Seams: the new behaviour. Code comments in `deepseek.ts`, `endpoint.ts` and `outside-services.ts` that say "no sub-processor row" for DeepSeek change (D2 reason).
- `deploy/README.md` provider line and the sim section; `.env.example` and `deploy/sim.env.example` comments: `deepseek` is allowed in production.
- Release note in `deploy/README.md` (the place the latest release notes use): "The privacy page lists DeepSeek as a possible AI provider, located in China. Every member accepts the terms again at the next sign-in. The install switches only when the operator sets `LLM_PROVIDER=deepseek`. Gate results per role: `evals/results/deepseek-gate-lab-01.md`."
- **Test:** 5. `bun run docs:stale` exits 0. 6. `grep -rn "dev, tests and evals" docs deploy apps/server/src .env.example` finds nothing about DeepSeek (this check must find nothing: it is the acceptance).
- **Out of scope:** the VPS `.env` (O2), `spec/build.md`.

## Done when

Tests 1–6 pass; the Proof of `plan.md` exits 0.
