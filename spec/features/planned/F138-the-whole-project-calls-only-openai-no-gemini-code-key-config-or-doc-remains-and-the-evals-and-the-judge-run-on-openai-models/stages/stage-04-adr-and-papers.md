# F138 stage 04 — ADR 0037, decision notes and internal papers

Part of [`../plan.md`](../plan.md). Needs stage 02 landed.

May run next to stages 03 and 05 (no shared files: this stage owns `docs/decisions/`, `docs/product/`, `docs/product-brief.md` and `docs/legal/`).

## Step 1 — ADR 0037

- **Goal:** one ADR holds the decision and the judge choice. Use the next free number at `HEAD` (0037 at the plan base); if it is taken, use the next one and replace "0037" in the code constant `JUDGE_SAME_MODEL` and the README in the same commit.
- **File:** `docs/decisions/0037-llm-openai-only.md`, status "accepted (owner, 2026-11-19)".
- **Content (decisions, not code detail):**
  1. Every LLM call goes to the `openai` provider. Reason: the owner's words (plan Input) and the free-tier stop of F115 stage 02 (171 of 260 cases).
  2. The registry keeps its shape with one row; a new provider = adapter, registry row, config block, price rows, eval gate (as ADR 0015 said).
  3. The judge: another model than the model under test, same provider allowed (replaces "another model family" of PD-026). Default judge `gpt-6.1-terra`, effort `none`, with the reasons of plan D4 and the rejected options. Known limit: one vendor grades its own vendor's text; the owner check of 20 drafts (PD-083, F115 stage 18) is the control.
  4. Data: no Google service receives mail text for an LLM. The sub-processor row went in stage 02 with a `TERMS_HISTORY` entry.
  5. EU path: the OpenAI Europe project (ADR 0035 decision 1); if OpenAI refuses it, an own model endpoint in the EU (F111). Vertex AI EU is no longer a fallback.
  6. Old data: Gemini model values in stored rows stay; their calls count as unpriced (plan D7).
  7. Supersedes 0007 and 0013; amends 0012 (the Gemini data rules and the Vertex path are history), 0015 (the switch has one value) and 0035 (decision 6).
- **Done when:** the ADR has Context, Decision, Consequences and the "Supersedes / Amends" lines; under 120 lines.

## Step 2 — Status lines and dated decisions

- **Files and decisions:**
  - ADR 0007 and 0013: status line gets "superseded by 0037 (2026-11-19)". ADR 0012, 0015, 0035: status line gets "amended by 0037". ADR 0035 gets a dated amendment section: decision 6 reads as in step 1 point 5. Do not edit any other line of an old ADR (history).
  - `docs/decisions/README.md`: the rows 0007, 0012, 0013, 0015, 0035 and a new row 0037.
  - `docs/product/stage-2/decisions.md`: below PD-026 and PD-110, or in their row as the file's own pattern allows, one line "Changed by ADR 0037 (2026-11-19): …" with the new rule (judge = another OpenAI model; no Vertex fallback). Never rewrite the owner's words.
  - `docs/product-brief.md`: Q8 and Q11 get the same "Changed by ADR 0037" line.
- **Test:** none (docs). Check that every relative link you add resolves (`ls` the target).

## Step 3 — Internal legal papers

- **Goal:** the papers name only providers that receive data.
- **Files and decisions:**
  - `docs/legal/claims.md`: delete the claim rows of the `gemini` row and of the deleted privacy sentence (at base C038, C139–C141); remove `gemini` from the recipient and transfer claims (at base C182, C184, C196). Never reuse a deleted id. If a test ties claims to the pages, it must pass.
  - `docs/legal/dpia.md` and `docs/legal/records-of-processing.md`: the LLM provider is `openai` only.
  - Rows and claims of `google-oauth` and `web-push` (Google FCM) stay.
- **Test:** the existing tests that read `docs/legal/` pass (find them with a grep for `docs/legal` in test files).

## Check

`bun test apps/web/src/lib packages/core/src/legal`

## Done when

- `git grep -niE "gemini" -- docs/decisions docs/legal docs/product docs/product-brief.md` finds only: ADR 0007, 0012, 0013, 0015 and 0035 text that this stage did not write, ADR 0037, the README rows, and dated owner text in `docs/product/` and `docs/product-brief.md`.
- The Proof (`sNN` = `s04`) prints `PROOF_OK`.

## Out of scope

`docs/architecture.md`, `docs/capabilities/`, other current docs (stage 05); the web legal pages (stage 02).
