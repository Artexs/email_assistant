# F138 · Plan refresh 1

Old base: 6aecc639. New base: f21809c4 (`HEAD`, 2026-11-19). No scouts. Ticket `ticket.md` not edited.

## Drift output

`scripts/plan-drift.sh <folder> 6aecc639`, run after the plan edits (so it also lists the paths that the refresh named):

```
plan base: 6aecc639 2026-11-19 18:54
HEAD:      f21809c4 2026-11-19 22:42
named paths: 20; changed since base: 10; gone: 0
changed: apps/server/src/modules/triage/eval-results.ts
changed: apps/server/src/platform/config-llm.ts
changed: apps/server/src/scripts/eval-judge-setup.ts
changed: apps/web/src/legal/en/privacy.md
changed: deploy/README.md
changed: evals/README.md
changed: evals/results/2026-11-19-sim-lab-01-holdout-gpt-6-luna-drafter-v1-reply-judge-terra.md
changed: packages/core/src/legal/subprocessors.ts
changed: packages/core/src/metrics/cost-model.ts
changed: packages/core/src/web/terms.ts
commits after the base that touch the named paths:
  e48770fa 11-19 21:24 F115 stage 02: dev tuning table, drafter-v2 dev reports and the PD-083 owner check
  c3a92d3a 11-19 21:13 F107 stage 08: cost-model comment without a bare ticket code
  b48ccb7a 11-19 21:09 F107 stage 08: costToRun, pilotCost and the shared hosting share
  7c2dabaa 11-19 21:05 F115 stage 02: judge-v2 scores a gap as the manager's answer; drafter-v2 prompt; eval picks both prompt versions
  e0e5a098 11-19 21:05 F115 stage 17: gate state after the OpenAI runs (G1 not passed) in the docs, response note
  9c3888ff 11-19 20:53 F115 stage 02: holdout and injection on an OpenAI judge
  77fa2d84 11-19 20:46 F115 stage 17: rollback SQL fails urgent views with draftable, block outside the list and copyable, in-flight rows named (N3, N4, N5)
  d683b631 11-19 20:46 F115 stage 17: consent text names the Reply-To addresses that the review card shows, Polish style fixes, one consent version (N1, N6)
  d276d063 11-19 20:45 F115 stage 17: the Confirm block shows for reply_drafts too, neutral title, docs agree with the code (B2)
  334de262 11-19 20:13 F138 stage 01: no ticket codes in comments
  0d9edf6e 11-19 20:09 F138 stage 01: judge on OpenAI: model rule, default judge gpt-6.1-terra, judge in the state name, judge-only rate
  23d10e09 11-19 20:08 F115 stage 17: deploy guide for reply drafts with tested rollback SQL, ADR 0033 accepted, architecture and module docs, capability page updates
  602e7261 11-19 20:03 F115 stage 17: capability page for reply drafts, legal text batch (reply consent version 2026-11-19, privacy text, row openai), capability map fixes
  4495e7e0 11-19 19:33 F114 stage 09 Part C: restore drill record (restore 173 s, counts equal, live untouched)
  36c1a440 11-19 19:31 backup.sh: retry the B2 copy with backoff and lock against concurrent runs
  301cd7a5 11-19 10:46 F115 stage 02: reply drafter eval harness (--drafter), reply injection set, reply judge with expected points
```

## Changes

- plan.md status: `Plan base: f21809c4, refreshed 2026-11-19`; stage 01 marked landed (0d9edf6e, 334de262).
- plan.md D3–D6: marked landed in stage 01; D5, D6 text cut to the rule (the detail is in the code and in stage 01).
- plan.md D9: the new `TERMS_HISTORY` entry follows the newest one (`2026-11-19-2`, F115 stage 17 legal batch, 602e7261 and d683b631).
- plan.md D11: overtaken. F115 stage 02 ran the drafter holdout and injection on judge `gpt-6.1-terra` (9c3888ff) and runs `drafter-v2` in its own job. F138 runs no drafter; stage 06 points to the F115 reports.
- plan.md D12: F076, F072, F023 are in `dropped/2026-11/`; F111 is in `done/2026-11/`; its stage 07 text is in parked F140, which already names ADR 0037 and no Vertex fallback. C2 has no edit left.
- plan.md D14: was "judge prompt stays `judge-v1`". The default is `judge-v2` since 7c2dabaa (F115). F138 changes no judge prompt; stage 06 runs no judge.
- plan.md D15: `twoProviderTable()` exists as a local function of `client-roles.test.ts`; stage 02 moves and exports it from `platform/llm/testing.ts`.
- plan.md D16 (new, default, questions.md item 8): `pilotCost.models` in `packages/core/src/metrics/cost-model.ts` (F107 stage 08, b48ccb7a, after the base) and the Models row of `docs/cost-model.md` keep `gemini-3.5-flash-lite`: a measured record. Allowed hit.
- plan.md Facts: F2 (stage 01 landed), F8 (legal-papers test 2b orders stage 04 after stage 02), F11 (F115 report and gate files); F5 ledger and N2 judge cost replaced (F115 spent after the base; measured cost in questions item 6).
- plan.md Done when: the drafter line points to the F115 files.
- plan.md Review: stage 01 left the Opus list (landed).
- plan.md How to run: Needs-based order; "land the F115 stage 02 branch first" removed (landed: 301cd7a5).
- stage 01: "Landed, a record" line; Needs line removed.
- stage 02: Needs line (stage 01 interfaces, the board `bun.lock` slot, F115 stage 17 `TERMS_HISTORY`); `twoProviderTable()` move; `bun remove @google/genai` in `apps/server` (the only `package.json` that holds it); `TERMS_HISTORY` entry after the newest.
- stage 03: Needs stage 02 (provider ids, deleted adapter, `twoProviderTable`), may run next to 04; 68 files at refresh (new: `drafter-eval.test.ts` with a Gemini judge fixture, `cost-model.ts`); the `pilotCost.models` exception in the goal and the Done-when grep.
- stage 04: Needs stage 02 (registry row gone; `legal-papers.test.ts` 2b); C196 removed from the claim list (it names "the LLM provider", no Gemini, also at the base).
- stage 05: Needs stage 04 (ADR file) and stage 02 (keys and `gemini:test` gone); may run next to 03 unless the ADR number changed; allowed hits 10 (`pilotCost.models`, `docs/cost-model.md`) and 11 (`docs/owner-decisions.md`, coordinator-only dated log, new hit since the base).
- stage 06: rewritten as "Acceptance checks on OpenAI", a coordinator run: acceptance grep, `llm:check` for the classifier and the judge, the classifier smoke run (D13, Q4), and a pointer to the F115 reports and gate files with their `passed` values. No drafter or judge runs, no note append, no committed report. Expected spend under $0.10, cap $2.50 kept.
- questions.md: item 1 (the F115 batch option is gone), 3 (done), 5 (spend), 6 (measured judge cost), new item 8 (D16).

## Facts checked, no change needed

- `apps/server/src/platform/llm/providers/gemini.ts` and its test exist; `providerBlocks`, `defaultGeminiRpm`, the `GEMINI_*` keys are in `config-llm.ts`.
- `PRICING_URL` and the two Gemini price rows are in `packages/core/src/triage/cost.ts`.
- The `@google/genai` rule is in `eslint.config.js`; `gemini:test` is in root `package.json`; `@google/genai` is in `apps/server/package.json`.
- `GEMINI_*` lines are in `.env.example`, `deploy/sim.env.example`, `deploy/compose.drill.yaml`; `deploy/test/compose-drill.test.ts`, `restore.test.ts` exist.
- `outside-services.ts` holds `GEMINI_API_KEY`; `llm-check-args.ts` has `--role` and `--provider`.
- Row `gemini` is in `subprocessors.ts`; the privacy sentence is in `en/privacy.md` and `pl/privacy.md` § AI model.
- `deploy/README.md` sim env step still copies `GEMINI_` (stage 03).
- `evals/README.md` still lists `--provider gemini|openai`, § "Quota (Gemini)" and `--judge-provider gemini|openai` (stage 03). Its new `--drafter-prompt`, `--judge-prompt` text needs no F138 change.
- Claim rows C038, C139–C141, C182, C184 name Gemini, as at the base.
- ADR 0036 is the last; 0037 is free.
- `--limit` is valid with `--sim`; `llm:check --role judge` exists.

## Words (`wc -w`)

 1475 plan.md
  693 stages/stage-01-judge-on-openai.md
  699 stages/stage-02-remove-provider.md
  473 stages/stage-03-test-names-and-tool-text.md
  698 stages/stage-04-adr-and-papers.md
  671 stages/stage-05-current-docs.md
  569 stages/stage-06-runs.md
 5278 total

## Review

Stage 06 lost its run steps and got a new pointer step, and stage 05 may now run next to stage 03: a substance change. Cold review on `claude-opus-5-5` (stages 02 and 06 are `[risky]`): [plan-review-2.md](plan-review-2.md).
