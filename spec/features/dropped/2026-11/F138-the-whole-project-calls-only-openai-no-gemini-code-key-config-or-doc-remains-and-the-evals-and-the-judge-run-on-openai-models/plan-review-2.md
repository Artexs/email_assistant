FAIL f039427749b8a69f3806c4535dafe0f14ecce1c4

Verdict: FAIL. Two BLOCKING findings, two TEST GAP findings and six NOTEs. HEAD is `f0394277` (the refresh commit), and it matches the candidate. Its parent is the plan base `f21809c4`.

## BLOCKING

**B1. One acceptance-grep hit is not covered: ADR 0017.** Proven by `git grep` at HEAD. `docs/decisions/0017-web-access-tailscale-serve.md:24` says "...the host resolver for IMAP, SMTP, Telegram and Gemini does not change." No stage fixes this line. Stage 05 § Allowed hits group 1 lists only ADRs 0007, 0012, 0013, 0015, 0035, 0037 and the README rows. The stage 04 Done-when grep lists the same set, so stage 04 cannot pass. In stage 06 step 1, the rule "fix it in this stage when it is a one-line text fix" conflicts with the plan rule "dated ADR text are history: never edit them". The result is that stage 06 either edits an old ADR or stops.
- Fix: in `stages/stage-05-current-docs.md` group 1 and in the `stages/stage-04-adr-and-papers.md` Done-when, write "every `docs/decisions/NNNN-*.md` except the lines that stage 04 writes (old text is history)". This form also covers a later ADR that names Gemini.

**B2. The allowed hits go past the ticket acceptance, and the owner has not agreed to this.** The ticket acceptance says the grep "finds only ADR history, old result files and changelog lines". Stage 05 § Allowed hits also allows these groups:
- 3: all of `docs/product/**`
- 4: `known-alerts.md`
- 5: the architecture history section
- 6: roadmap
- 7: diagrams
- 8: `docs/legal/claims.md` rows, a current internal paper
- 10: `packages/core/src/metrics/cost-model.ts` (current code) and `docs/cost-model.md` (a current doc)
- 11: `owner-decisions.md`

Only group 10 (D16) is in `questions.md`, as item 8, and it is tagged `[minor]`. A land reviewer who reads the ticket word for word will fail stage 06 on the hits in groups 8 and 10. D16 itself conflicts with the ticket text: it is a code line, not ADR history, not an old result file and not a changelog line.
- Fix: add a plan decision and a `questions.md` item tagged `[important: rule-exception]`. It must state that "history" in the acceptance bullet means dated text in any doc, and that D16 is an exception for a measured record. Then the coordinator amends the ticket Acceptance line, or the owner confirms.
- Shrink the list where this costs nothing. For example, the group 8 claim text can read `Removed by ADR 0037: the row of the second LLM provider`, with no vendor name.

## TEST GAP

**T1. Allowed groups 3, 4 and 6 need a judgment call, so the stage 06 pass rule is not mechanical.** Group 3 says "dated owner text". But `docs/product/` hits at HEAD also include text that is not owner text:
- `stage-2/02-inventory-and-roadmap.md:27`
- `06-architecture-review.md:61`
- `epics/E02-discovery-notes.md:53,72`
- `E06-discovery-notes.md:12`
- `E09-discovery-notes.md:11`
- `E11-discovery-notes.md:20` ("Provider switch `LLM_PROVIDER` = `gemini` or `openai`")

These are agent inventories and discovery notes. Stage 04 owns `docs/product/` but gives no instruction for them. Group 4 has the same problem: `known-alerts.md:991` ("Cause: ... Gemini codes") and `:1101` ("Source: ... gemini:test") are neither clearly alert text nor clearly an instruction.
- Fix: write group 3 as "every file under `docs/product/` is a dated Stage 2 record; stage 04 adds Changed-by lines only in `decisions.md`".
- Have stages 04 and 05 record the per-file hit count they leave. Stage 06 then compares its `grep.log` counts with that list.

**T2. The classifier smoke run can pass with no OpenAI call.**
- The sim state file name has no `--limit` part (`evalStateFileName`, `eval-results.ts:117`, called at `eval-sim.ts:187`).
- When a state file of an earlier holdout run exists in `evals/.runs/`, the run resumes from it (`eval-sim.ts:217-218`).
- So the run can make 0 calls and still meet "exit 0/1, 0 LLM errors, provider openai".

The main checkout has no such file today (`evals/.runs/` holds only `gpt-6-luna-none-classifier-v2-all.jsonl`). A fresh worktree has none. But "How to run" allows a main-checkout run.
- Fix: add to the pass rule that the output shows `state …: 0 earlier results` and that the eval ledger grew by more than $0.
- Or run with `--fresh`, but only in a worktree.

## NOTE

**N1. Gemini fixtures in `tools/` stay (proven by grep).** `tools/fake-telegram/test/e2e.test.ts:48` and `lab-executive.test.ts:157` hold `llm: { provider: "gemini", … }`. The type is `string`, so typecheck and the tests still pass after stage 02. But `tools/` is outside the ticket grep, and stage 03 limits itself to `apps/`, `packages/`, `deploy/` and `evals/README.md`. The ticket title says no Gemini code remains, and D8 asks for neutral names. Fix: add `tools/` to stage 03 step 1.

**N2. D7 and D16 pull against each other (plausible).** `pilotCost` holds `llmUsd: 0.0914` and `unpricedCalls: 0` (`cost-model.ts:39-47`). The record was measured on 2026-11-19 with the Gemini price rows that stage 02 deletes. If the week of 2026-11-02 holds priced Gemini calls, two things follow after stage 02:
- `stats:week` over the same window gives other numbers than the record.
- M7 of past weeks on `/stats` changes.

Fix: add one consequence line to D16 and to ADR 0037 point 6: the pilot record was priced with the removed rows, and a new run now counts those calls as unpriced.

**N3. The plan does not answer the ticket's "judge agreement" item.** The ticket asks to "re-run any gate whose number changes (the drafter holdout, the judge agreement)". No judge-agreement gate exists at HEAD (`scouts.md:94`), but `plan.md` does not say so. Fix: add one clause to D11.

**N4. Board drift.** `spec/build.md:26` says the classifier smoke run costs "about $0.3". Plan D13 and `questions.md` item 4 say under $0.10; the $0.30 is the extra cost of a full run. The coordinator corrects the board line.

**N5. ADR 0035 already has a `## Amendment 2026-11-19` heading.** Stage 04 adds a second dated amendment section, which would give two equal headings. `own-model-docs.test.ts:119` uses `toContain`, so it still passes. Fix: give the new heading a distinct name, for example "Amendment 2026-11-19 (ADR 0037)".

**N6. The env check reads only `.env`.** Stage 06 does not check exported shell variables or the other env files that Bun loads (`.env.local`, `.env.<NODE_ENV>`). After stage 02 the code no longer reads `GEMINI_*`, so the risk is low. Fix: add `env | grep -c '^GEMINI_'` (count only) to `env-check.log`.

## Checked and found to hold
- **D11:** these files exist:
  - `evals/results/2026-11-19-sim-lab-01-holdout-gpt-6-luna-drafter-v{1,2}-reply-judge-terra*.md`
  - the two `reply-injection` reports
  - gate files `drafter-drafter-v{1,2}-gpt-6-luna-low-lab-01-v1.json`, each with provider `openai`, judge `gpt-6.1-terra`, `passed: false`

  Stage 06 step 3 meets the ticket bullet "a drafter holdout report and gate file exist" with no drafter run.
- **D12:** F023, F072 and F076 are in `spec/features/dropped/2026-11/`. F111 is in `done/2026-11/`. The F140 `ticket.md:14` names ADR 0037 and no Vertex fallback.
- **D14:** the default judge prompt is `judge-v2` (`prompts/index.ts:147`).
- **Judge default for `llm:check --role judge`:** `llmRoleTable` gives the judge `DEFAULT_JUDGE_MODEL` = `gpt-6.1-terra` when `LLM_JUDGE_MODEL` is not set (`config-llm.ts:219`). The main `.env` sets no `LLM_JUDGE_*` key (count 0).
- **Stage 02 interfaces:**
  - `ConfigError` names keys only, so test 2 is valid.
  - `twoProviderTable` is at `client-roles.test.ts:66`.
  - `outside-services.test.ts:16` already checks both directions of the provider-to-row link, which covers D9.
  - The trust key provider is `z.string()`, so a stored Gemini grant still parses (D7 holds).
  - The two privacy sentences match the text in stage 02 exactly.
  - The newest `TERMS_HISTORY` entry is `2026-11-19-2`.
- **Order and Needs:** the order 02 → {03, 04} → 05 → 06 is consistent. Stage 05 may run next to stage 03 because they own different files. Legal-papers test 2b drops ids that are not in the registry (`legal-papers.test.ts:220`), so a doc that still names `gemini` passes after stage 02, and the order 02 before 04 holds. Each Needs line names a real file or interface.
- **Grep coverage:** apart from B1, every hit outside `evals/results/` is fixed by stage 02, 03, 04 or 05, or is in an allowed group. B2 and T1 are about how the allowed groups are defined.

## Checks run
- `git rev-parse HEAD` → `f039427749b8a69f3806c4535dafe0f14ecce1c4`, the candidate.
- The ticket grep at HEAD → 109 files outside `evals/results/` (list in `/tmp/f138rev-files.txt`): 69 in `apps/` and `packages/`, the rest in `docs`, `deploy`, `evals/README.md`, `.env.example`, `package.json` and `bun.lock`. 6 old result files name Gemini.
- `bun install --frozen-lockfile` → 991 packages installed.
- `bun test` on `eval-args.test.ts`, `outside-services.test.ts`, `legal-papers.test.ts`, `capability-map.test.ts` and `cost-model-doc.test.ts` → 79 pass, 0 fail (the baseline at HEAD).
- Counts only, from the main checkout `.env`:
  - `GEMINI_`: 2 (coordinator step C1 removes these)
  - `LLM_*=gemini`: 0
  - `LLM_JUDGE_MODEL`: 0
- No `.env.local`, `.env.development` or `.env.test` exists.
- The November sum of the eval ledger is about $4.53 of the $20 monthly cap.

Not run: the lint, typecheck and full suites. This is a plan review and the candidate changes no code.

## Note check
- Stages 02–06 checked at HEAD (names, paths, tests, Needs lines, order): proven. Evidence: the stage files and the code they name. These are `stages/stage-02-remove-provider.md` to `stages/stage-06-runs.md`, `apps/server/src/platform/config-llm.ts`, `apps/server/src/platform/llm/client-roles.test.ts`, `apps/server/src/legal-papers.test.ts`, `apps/server/src/platform/outside-services.test.ts` and `apps/server/src/scripts/eval-sim.ts`.
- Stage 06 against the ticket acceptance, and D11, D12, D14, D16 against the code and the ticket: proven. Evidence: `evals/results/gate/drafter-drafter-v1-gpt-6-luna-low-lab-01-v1.json`, `evals/results/gate/drafter-drafter-v2-gpt-6-luna-low-lab-01-v1.json`, `spec/features/dropped/2026-11/F076-vertex-ai-eu`, `apps/server/src/modules/triage/prompts/index.ts` and `packages/core/src/metrics/cost-model.ts`. The result is findings B2, T1 and T2.
- Each acceptance-grep hit sorted into a stage or an allowed group: proven. Evidence: `/tmp/f138rev-files.txt` (the hit file list) and `docs/decisions/0017-web-access-tailscale-serve.md` (the uncovered hit, B1).
- Final message format (first line `FAIL <sha>`, findings tagged with file and fix): proven. Evidence: this message.
- Easy-to-miss rule ("Missing code detail … is not a finding; a missing decision, edge case, test or interface is"): followed. Each finding names a missing decision (B2, N2, N3), a missing edge case (B1, N1, N5, N6) or a test gap (T1, T2). No finding asks only for line numbers or edit text.
