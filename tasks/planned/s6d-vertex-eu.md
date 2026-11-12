> **Status 2026-11-12 — planned.** Left: user step U3 (Google Cloud project), the detailed stage plan (an own `plan-task` session), then the build with `run-task`.

# S6d Vertex AI EU

Scope: the S6 master plan `tasks/active/s6-pre-sale.md` (P7, findings 7 and 9, facts V1–V3, D15–D17, "Rules for every step"); ADR 0015. Also replaces `tasks/planned/gemini-billing-budget-alert.md` for the Vertex project. Needs: S5. No migration, so it can run beside S6b or S6c.
Git mode: worktree (`task/s6d-vertex-eu`). Run mode: pipeline. Review model: Sonnet, high.

## Goal

The classifier and the writer call Gemini on Vertex AI in an EU region, with caching off, and the accuracy is not worse than the pilot model.

## Done when

- `bun run llm:check --provider vertex` answers from `europe-west3` (or the region that the spike picks) on the user's project.
- The config check refuses `VERTEX_LOCATION=global` and any region outside the EU list (`eu` and the EU single regions of V1); it needs `VERTEX_PROJECT` and the key file, and no API key, when `LLM_PROVIDER=vertex` (a key-file branch in the config schema, `LlmSettings` and `createLlmClient`).
- The provider errors map to the existing soft, config and hard codes (unit tests, as for `gemini.ts`); no key file content and no prompt text in any log line or error text.
- The `GET cacheConfig` answer shows `disableCache: true` (user step U3; the answer is in the log of this task, without the project id).
- `eval --real --reclassify --provider <id> --model <id>` exists: it classifies again the labeled mails that still have `body_text` and scores them against the labels, beside the stored `gpt-6-luna` results of the same mails (unit tests with a fake provider).
- The eval gate of D16 passes or the user decides at checkpoint 3: injection 16/16; the synthetic rule (categories with at least 10 cases); the reclassify rule on the home VPS (categories with at least 10 labels; fewer = "too few"); the result files are in `evals/results/`.
- `triage:cost` has the Vertex price rows; a Cloud Billing budget alert exists (user step).
- ADR 0018 (accepted), `docs/architecture.md` §6.3 and §7 "Privacy by stage", `docs/roadmap.md` §5, `.env.example` describe the provider.

## Owns (from the master plan)

- Decisions D15 (provider, config, auth, ESLint rule), D16 (eval gate), D17 (one provider on production, budget alert, ADR 0018).
- Files (expected): `apps/server/src/platform/llm/providers/{index,vertex or gemini}.ts`, `platform/config.ts`, `scripts/llm-check.ts`, the eval runner provider list, the price table of `triage:cost`, `eslint.config.js`, `.env.example`, `deploy/compose.yaml` (the key file mount, read-only), `docs/decisions/0018-*.md`.

## Stage sketch

0. **Spike (user step U3 first)**: `@google/genai` with `vertexai: true` and a key file under Bun; which model ids answer in `europe-west3` and `eu`; the error shapes of a wrong project, a missing role and a quota; the `cacheConfig` `GET`. Facts to `notes/`.
1. **Provider and config**: the registry row, `createGenerate`, `classifyError`, `configHint`, the EU region list, the key-file branch in the config and the client, the ESLint rule; unit tests.
2. **Check, prices, mount**: `llm:check`, the price rows, the read-only mount in Compose and the runbook lines.
3. **Reclassify mode**: `eval --real --reclassify` (reads `body_text`, never logs it; ids and scores only in the output).
4. **Eval gate** (checkpoint 3): the synthetic eval and the reclassify run on the home VPS (before the retention job clears the bodies that it needs); the comparison table; the user accepts the model or stops.
5. **Docs**: ADR 0018, architecture, roadmap, `.env.example`, notes; budget alert user step.

## Questions for the plan session

- The model pair (classifier, writer) after the spike, with price and region.
- Whether the staging keeps `openai` (default) or also uses `vertex` with test data.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-12: Created by the S6 master plan session (`tasks/active/s6-pre-sale.md`).
