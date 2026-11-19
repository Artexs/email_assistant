# F138 stage 04 — ADR 0037, decision notes and internal papers

Part of [`../plan.md`](../plan.md). Needs stage 02 landed.

May run next to stage 03, never next to stage 05 (B2: `capability-map.test.ts` needs the ADR 0037 file before a page names it). This stage owns `docs/decisions/`, `docs/product/`, `docs/product-brief.md` and `docs/legal/`, and nothing else.

## Step 1 — ADR 0037

- **Goal:** one ADR holds the decision and the judge choice. Use the next free number at `HEAD` (0037 at the plan base); if it is taken, use the next one and name it in the final message. Do not edit `apps/` or `evals/` (stage 03 owns them, N7): stage 05 fixes the number in `JUDGE_SAME_MODEL` and `evals/README.md`.
- **File:** `docs/decisions/0037-llm-openai-only.md`, status "accepted (owner, 2026-11-19)".
- **Content (decisions, not code detail):**
  1. Every LLM call goes to `openai`. Reason: the owner's words (plan Input); the free-tier stop of F115 stage 02 (171 of 260 cases).
  2. The registry keeps its shape with one row (a new provider: as ADR 0015 said).
  3. The judge: another model than the model under test, same provider allowed (replaces "another model family" of PD-026). Default judge `gpt-6.1-terra`, effort `none`, with the reasons of plan D4. Known limits: one vendor grades its own text, and a dated alias of the model under test passes the exact-id rule (plan D3); the owner check of 20 drafts (PD-083, F115 stage 18) is the control.
  4. Data: no Google service receives mail text for an LLM.
  5. EU path: the OpenAI Europe project (ADR 0035 decision 1); if OpenAI refuses it, an own model endpoint in the EU (F111). Vertex AI EU is no longer a fallback.
  6. Old data: Gemini model values in stored rows stay; their calls count as unpriced (plan D7).
  7. Supersedes 0007 and 0013; amends 0012, 0015 (one value) and 0035 (decision 6).
- **Done when:** Context, Decision, Consequences, Supersedes / Amends; under 120 lines.

## Step 2 — Status lines and dated decisions

- **Files and decisions:**
  - ADR 0007 and 0013: status line gets "superseded by 0037 (2026-11-19)". ADR 0012, 0015, 0035: the end of the status line gets "; amended by 0037" (0035 keeps its whole status text, a test reads it). ADR 0035 gets a dated amendment section: decision 6 reads as in step 1 point 5. Do not edit any other line of an old ADR (history).
  - `docs/decisions/README.md`: rows 0007, 0012, 0013, 0015 and a new row 0037. The 0035 cell stays as is: `own-model-docs.test.ts` needs it to end in `decision 6 waits` (T2); the 0037 row says it amends 0035.
  - `docs/product/stage-2/decisions.md`: below PD-026 and PD-110, or in their row as the file's own pattern allows, one line "Changed by ADR 0037 (2026-11-19): …" with the new rule (judge = another OpenAI model; no Vertex fallback). Never rewrite the owner's words.
  - `docs/product-brief.md`: Q8 and Q11 get the same "Changed by ADR 0037" line.
- **Test:** none (docs). Every link you add resolves.

## Step 3 — Internal legal papers

- **Files and decisions:**
  - `docs/legal/claims.md` (B1): ids run with no gap (`legal-papers.test.ts`), so no row is deleted or renumbered (other tickets cite ids). The claim rows of the removed registry row and the removed privacy sentence (at base C038, C139–C141) keep their ids; their claim text becomes `Removed by ADR 0037 (2026-11-19): <the old claim>` and their source cell `ADR 0037`. The counts table at the top stays true. Remove `gemini` from the recipient and transfer claims (at base C182, C184, C196).
  - `docs/legal/dpia.md` and `docs/legal/records-of-processing.md`: the LLM provider is `openai` only.
  - `google-oauth` and `web-push` (Google FCM) stay.

## Check

`bun test apps/web/src/lib packages/core/src/legal apps/server/src/legal-papers.test.ts apps/server/src/own-model-docs.test.ts apps/server/src/capability-map.test.ts` (T2)

## Done when

- `git grep -niE "gemini" -- docs/decisions docs/legal docs/product docs/product-brief.md` finds only: ADR 0007, 0012, 0013, 0015 and 0035 text that this stage did not write, ADR 0037, the README rows, dated owner text in `docs/product/` and `docs/product-brief.md`, and `docs/legal/claims.md` rows whose claim starts `Removed by ADR 0037`.
- The Proof (`sNN` = `s04`) prints `PROOF_OK`.

## Out of scope

`docs/architecture.md`, `docs/capabilities/`, other current docs (stage 05); the web legal pages (stage 02).
