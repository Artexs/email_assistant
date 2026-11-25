# F173 stage 02 — DPIA, public security page, ADR, capability pages, release note

Needs stage 01: row id `deepseek` in `subprocessors.ts`, the P11 claim texts and the ledger rows it adds (C-numbers). May run next to 03.
Part of [`../plan.md`](../plan.md). Review: `claude-opus-5-5` (DPIA, new Polish text on the docs site).

## Step 1 — DPIA

- **Goal:** the DPIA names DeepSeek as a possible LLM provider in China.
- **Decisions:** P3, P4, P5, D5.
- "Recipients" names `openai`, `deepseek` or `gemini`. R1 title and text say "OpenAI or Gemini". New R11 (P5) in the risk, measures and residual tables. Measures of R11: the operator picks the provider (`LLM_PROVIDER`), shadow mode is the default, `TRIAGE_LLM_SCOPE` is a switch, the same input limits as R1. Residual: the EU has no adequacy decision for China (source: the EU Commission adequacy page, read on the build day), the mechanism is `\<to confirm: transfer mechanism>`, API data use is the P4 placeholder.
- Ledger: new rows for R11 and its residual; changed C209.
- **Test:** 1. `legal-papers.test.ts` passes (test 6 needs R1–R8; R11 is free). 2. In `legal-outside-calls.test.ts` `describe("deepseek")`: the DPIA holds `| R11 ` and `China`.
- **Out of scope:** record B (stage 01), new risks for other providers.

## Step 2 — public docs site, security page en and pl

- **Goal:** the public page describes the default setup (P11) and says what this project did not check for DeepSeek.
- **Decisions:** P6, P11.
- In the "does not promise" section, next to "An install can use another AI provider": "When an install uses DeepSeek, the provider states that it collects, processes and stores personal data in the People's Republic of China ([its privacy policy](F1 URL), read <build day>)." and "This project has not checked whether DeepSeek uses or keeps API data." Polish: the same facts. Each sentence gets a ledger row; its condition says "optional, not the default setup".
- "Facts that come only from the AI provider" and "No EU-only AI processing by default" stay (they describe the default setup).
- The generated sub-processor table keeps the default rows only; no `deepseek` row (P11).
- **Test:** 3. `apps/docs/src/security/claims.test.ts`, `subprocessor-view.test.ts` and `polish.test.ts` pass. 4. `bun run docs:build` prints `claim_check ok`.
- **Out of scope:** the look of the docs site (the Pebble docs ticket F171 owns it; a text conflict is a merge).

## Step 3 — ADR, capability pages, operator docs, release note

- **Goal:** every doc says production may use DeepSeek.
- **Decisions:** P1, P7, P9, P9a, D2, D7.
- ADR 0015: a new amendment "2026-11-26, DeepSeek for production": the owner decision, the row, the flag, the papers, P11, the gate summary path (D7). It replaces the "dev, tests and evals" sentence of the 2026-11-20 amendment.
- Capability pages: `triage.md` rules 6 and 16; `drafts-and-send.md` (DeepSeek now gets the reply preview); `reply-drafts.md` rule 17 (a DeepSeek install now gets the preview and the style suggestion; review note 5); `papers.md` § Seams. Code comments in `deepseek.ts`, `endpoint.ts` and `outside-services.ts` that say "no sub-processor row" for DeepSeek change (D2 reason).
- `deploy/README.md` provider line and sim section; `.env.example` and `deploy/sim.env.example` comments: `deepseek` is allowed in production.
- Release note in `deploy/README.md` (where the latest notes are): "The privacy page lists DeepSeek as a possible AI provider, located in China. Every member accepts the terms again at the next sign-in. The install switches only when the operator sets `LLM_PROVIDER=deepseek`. Gate results per role: `evals/results/deepseek-gate-lab-01.md`."
- **Test:** 5. `bun run docs:stale` exits 0. 6. `grep -rn "dev, tests and evals" docs deploy apps/server/src .env.example` finds nothing about DeepSeek (the acceptance; stage 01 already reworded the config message, D1).
- **Out of scope:** the VPS `.env` (O2), `spec/build.md`.

## Done when

Tests 1–6 pass; the Proof of `plan.md` exits 0.
