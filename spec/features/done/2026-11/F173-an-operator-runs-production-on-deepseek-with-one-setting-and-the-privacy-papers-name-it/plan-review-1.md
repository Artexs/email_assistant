# F173 plan review 1 — FAIL

Reviewer: cold review job `2026-11-25-f173-plan-review-1-83a50c4a`, model `claude-opus-5-5`, thinking high. Code read at `3a6110028` (plan base `13277b2d1`; the 6 commits between them touch only this ticket folder and its merge). No test, lint or typecheck ran (review job rule). Every finding below names the code that I read to prove it.

The plan follows `.agents/limen/planner.md` § Plan size. Missing code detail is not a finding; a missing decision, edge case, test or interface is.

Verdict: **FAIL**. Four blocking findings. Two make a stage fail its own Proof (B1, B4). Two leave the production switch O2 without a defined pass rule (B2, B3). The config seam, the row shape, the legal version flow and the gate file schema hold (see § Checked, holds).

## Blocking findings

### B1. The public docs site has no decision for its AI-provider claims, and the stage 02 check "the docs build shows the `deepseek` row" cannot hold

Facts:
- `apps/docs/src/security/subprocessor-view.ts` `publicSubprocessors` shows only the `llmProvider` row of `DEFAULT_LLM_PROVIDER = "openai"`. Its comment cites an owner decision of 2026-11-20: "The page names only the services that run by default … another AI provider is an option of the install, and its registry row stays out of the page." `subprocessor-view.test.ts` pins this (`shown.length` = non-LLM rows + 1). So the `deepseek` row never shows, and stage 02 step 2 ("check that the docs build shows the `deepseek` row") is false.
- The claims `ai-provider-receives`, `ai-provider-reply-drafts` and `ai-provider-style-suggestion` in `apps/docs/src/security/claims.ts` cite C030 and say "This install uses OpenAI as the AI model"; their conditions say "The install uses the OpenAI provider". Stage 01 rewrites C030 (P2, D5). The plan gives these claims no new text.
- `claims.test.ts` "a claim that cites a ledger row that names Gemini says so only with the condition: optional, off by default": if the new C030 names Gemini in its source or condition ("OpenAI, DeepSeek or Google Gemini"), every claim that cites C030 fails unless its condition holds "optional, off by default". The same test file forbids "gemini" in any claim text. Stage 01 runs `bun test apps/docs/src` in its Proof, so stage 01 meets this, not stage 02.
- The ledger says "the claims about "this install" hold for the home VPS install" (header of `docs/legal/claims.md`). After O2 the home VPS runs DeepSeek, so "This install uses OpenAI" on the public site becomes false.

Missing decision: what does the public security page say about the AI provider? Proposed default (keeps the owner rule of 2026-11-20): the public page describes the default setup; `DEFAULT_LLM_PROVIDER` and the row filter stay; the three claim texts say "The default setup uses OpenAI as the AI model" with a new ledger row (do not reuse the rewritten C030); P6's DeepSeek bullets stay in the "does not promise" section, next to the existing line "An install can use another AI provider". Drop the "shows the `deepseek` row" check. Record it as an `[important: user-visible]` question. Alternative: list DeepSeek on the public page, which re-opens the 2026-11-20 rule and needs the owner.

Fix in the plan: add the decision (P11), name the claim ids in stage 02 step 2 (or stage 01, because the C030 rewrite lands there), and add a test: the ledger row that the three claims cite names no Gemini, and the claim texts keep "OpenAI" only with the default-setup wording.

### B2. "Classifier fails its gate" has no definition, and O2 depends on it

Facts: the classifier gate file has a decision per category, not a pass flag. The running OpenAI file `evals/results/gate/classifier-classifier-v3-gpt-6-luna-none-lab-01-v1.json` is `go` for `notification` and `spam` and `no-go` for `urgent`, `needs_reply` and `info`. By the plan's wording ("a role that fails its bar"), production OpenAI "fails" too. The trust ladder reads the gate file of the running key (`runningEvidenceKey` in `modules/triage/evidence.ts`; `docs/capabilities/trust.md` rule 2). A switch to DeepSeek moves the key, so an organization with `trust_ladder` on loses its `auto` evidence for every category that is `go` on OpenAI and not `go` on DeepSeek.

Missing decision: the classifier pass rule for O2. Proposed default: O2 happens only when the DeepSeek classifier file has 0 errors and its `go` set contains the `go` set of the running OpenAI file (`notification`, `spam`). Otherwise the VPS stays on `openai`. Write this as P9a, put it in the summary row of D7 ("go set: …; OpenAI go set: …; O2 yes/no"), and add it to `questions.md` as `[important: production]`.

### B3. The drafter gate run omits the reply injection set and the switch rule

Facts: the drafter gate on OpenAI used two runs: the holdout run and the reply injection set (`bun run eval --set reply-injection --drafter --judge`). `docs/capabilities/reply-drafts.md` § Limits says the injection set has its own PD-083 bar, and that production stayed on `drafter-v4` because "two bars of the switch rule failed: 3 holdout drafts hold a leaning sentence (bar: at most 2), and the injection set passed 13 of 14". Stage 03 runs only `--part holdout --drafter --judge`. So a DeepSeek `passed: true` holdout file can turn on `reply_drafts` on a DeepSeek install (P9) with no injection proof.

Fix: stage 03 step 1.2 adds the injection set run with the same provider and judge. P9 "drafter passes" means: holdout gate file `passed: true`, the injection set at its bar (all cases), and the leaning-sentence bar of the switch rule. Give the injection run its own cap in P10.

### B4. Stage 01 cannot pass its own Proof: record B must name `deepseek` in the same stage

Facts: `apps/server/src/legal-papers.test.ts` test 2 ("every sub-processor id with personal data is in backticks in the records of processing") and test 2b (the Recipients row of record B equals every row with `personalData: true`) fail as soon as the `deepseek` row with `personalData: true` exists (D4). Stage 02 step 1 test 1 even says "it fails before record B names `deepseek`". The plan puts record B in stage 02, but the Proof of stage 01 runs `apps/server/src/legal-papers.test.ts`, and `check:job` runs it too. Stage 01 can never be green; a land of stage 01 alone would break master CI.

Fix: move the record B lines (Recipients adds `deepseek`; Transfers outside the EEA adds `deepseek`: People's Republic of China) and their ledger rows (C182, C184) into stage 01. Stage 02 keeps the DPIA, the public page and the docs. Move stage 02 test 1 to stage 01.

## Notes (not blocking)

1. Stage 02 test 6 ("`grep -rn "dev, tests and evals" … apps/server/src` finds nothing") collides with D1. D1 keeps `checkRealMail`, and its message in `platform/config-llm.ts` is `` `${config.LLM_PROVIDER} is for dev, tests and evals: no sub-processor row, …` ``. Either reword the message (for example "has no sub-processor row, so TRIAGE_LLM_SCOPE=all is refused outside the sim stack") in stage 01, or leave `config-llm.ts` out of the grep. Decide which in the plan, because the check is an acceptance check.
2. The stylist run (stage 03 step 1.4) changes no decision: P9 says `style_from_sent` stays off whatever the result. The style gate is several paid runs (the stylist on the sent part, two judged drafter dev runs with and without the style, then `eval:style-gate --smoke`), not one `$2` run. Drop it from stage 03, or say what a pass changes. Remove its share from P10 either way.
3. P10 counts four runs at `$2`. With B3 (injection set) and note 2, recount the runs and the cap. Exit code 4 of `bun run eval` says "run the same command again" (a resume, `--spend-ledger`, `--fresh`). State whether the rerun at `--budget-usd 4` is a fresh run or a resume, so that the cap is not spent twice.
4. The DeepSeek row reuses the OpenAI adapter, so DeepSeek also gets `store: false` (`providers/openai.ts`). P4 is right not to claim that DeepSeek honours it. The privacy text must keep "The assistant asks OpenAI not to store the data" under "When the install uses OpenAI" only. The plan says this; the worker must not generalise it.
5. `realMail: true` also turns on the reply preview (`replies/preview.ts`) and the style suggestion (`replies/style-suggest.ts`) on a DeepSeek install (`start/triage.ts` passes the flag). Stage 02 names the preview in `drafts-and-send.md`. Also update rule 17 of `reply-drafts.md` ("a provider with no sub-processor row `failed` / `llm_off`") with the same fact.
6. `legal-outside-calls.test.ts` has `test.each(["openai", "gemini"])` for the body cap and the style caps. The D4 `toEqual` test covers `deepseek`. Adding `deepseek` to those two lists is cheaper to read than a new test; either is fine.
7. P8: the OpenAI drafter gate files name the judge `gpt-6.1-terra` with `judge-v3`. The default judge of a DeepSeek run is `deepseek-v4-pro` with the current judge prompt. Write the judge prompt version that the run uses into the summary row, so that the owner can compare it with the OpenAI files.
8. D5 "the pin in `claims.test.ts`" is the row count test ("the real ledger has 276 rows"), and `docs/legal/claims.md` also has a count table per paper. The worker finds both; no change needed.

## Checked, holds

- Config refusal seam: `checkRealMail` in `apps/server/src/platform/config-llm.ts` reads `llmProviders[config.LLM_PROVIDER].realMail`; `deepseekProvider.realMail` is `false` in `providers/deepseek.ts`. D1 (flip the flag, keep the guard with an injected lookup) fits. `config-deepseek.test.ts` cases 2 and 2b are the refusal tests that stage 01 tests 1–2 replace.
- D2: `providers/endpoint.ts` refuses the DeepSeek host and its sub-domains for every endpoint kind; the existing test in `config-deepseek.test.ts` covers the bare host. Stage 01 test 4 adds the sub-domain.
- D3: `OUTSIDE_SERVICE_KEYS.DEEPSEEK_API_KEY` is an `exempt` entry now; `outside-services.test.ts` test 3 checks that a string target is a row, so the map change and the row must land together (they do, step 1).
- Row shape D4: `Subprocessor` in `packages/core/src/legal/subprocessors.ts` has every field the plan names; `subprocessors.test.ts` checks the `https` terms URL and the placeholder parity. The privacy page table (`SubprocessorsTables.astro`) shows every row, so the panel shows `deepseek` with no code change.
- Legal version flow: `legalTextParts` (`apps/web/src/lib/legal-checks.ts`) covers the six panel pages, both registries and the `legal_*` keys; the DPIA, record B and the docs site are not inputs. So only stage 01 needs a `TERMS_HISTORY` entry, as P7 and D6 say. `TERMS_HISTORY` ends at `2026-11-20.3`. The terms and DPA pages (en, pl) name no AI provider. The new placeholder matches `<to confirm: …>`, which `isAllowedPlaceholder` accepts.
- Gate tools: `bun run eval` takes `--provider deepseek`, `--budget-usd`, `--judge`, `--part sent-holdout --extractor` (`scripts/eval-args.ts`). The gate file schema has `provider: z.string()` (`modules/triage/eval-sim-report.ts`), so a `deepseek` file parses; the "Not verified" schema item of the plan is answered. The drafter (`light`, `deepseek-flash`) and the default judge (`strong`, `deepseek-v4-pro`) differ, so the "judge model must differ" rule of the tool holds.
- DPIA: R1–R10 exist; R11 is free, and `legal-papers.test.ts` test 6 needs only R1–R8.
