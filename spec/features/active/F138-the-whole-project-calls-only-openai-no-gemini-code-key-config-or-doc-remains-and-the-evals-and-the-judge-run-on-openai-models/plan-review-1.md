FAIL 5175a70f2d9b6f42dd25e06c77c32b0f6f8434c1

HEAD is `5175a70f2d9b6f42dd25e06c77c32b0f6f8434c1`, the same as the candidate. The tree is clean. Every scratch edit was restored with `git checkout`.

## BLOCKING

B1. Stage 04 cannot pass its Proof: the claim-id rule conflicts with a test. Proven by a test run.
- `stages/stage-04-adr-and-papers.md:34`: "delete the claim rows … (at base C038, C139–C141) … Never reuse a deleted id."
- `apps/server/src/legal-papers.test.ts` test "5. … ids are C001, C002, … in order, with no gap" requires ids with no gap.
- Deleted rows leave a gap and the test fails. Renumbering reuses every later id, which the stage forbids.
- Reproduction: `sed -i -E '/^\| C(038|139|140|141) \|/d' docs/legal/claims.md && bun test apps/server/src/legal-papers.test.ts`. Result: `(fail) … ids are C001, C002, … in order, with no gap`. The other failures came from the registry, which stage 02 changes first.
- Renumbering also breaks references in other files, for example `spec/features/active/F115-e6a-reply-drafts/stages/stage-17-docs.md:22` (C139).
- Missing decision: keep the rows and mark their text as removed by ADR 0037. Then the stage 04 Done-when grep (`stage-04…:45`) must accept those lines in `docs/legal`. Today it allows no hit there.

B2. Stage 05 cannot pass its Proof when it runs in parallel with stage 04. Proven by a test run with a one-line stand-in.
- `stage-05-current-docs.md:5`: "Link to ADR 0037 by its file name; if stage 04 took another number, the land of the later stage fixes the link."
- `stage-05…:13` adds the judge rule to `measurement.md` or `live-lab.md`.
- `apps/server/src/capability-map.test.ts:157-170` fails for "ADR 0037" until `docs/decisions/0037-*.md` exists. Stage 04 creates that file in another worktree.
- Reproduction: `echo "The judge rule is in ADR 0037." >> docs/capabilities/triage.md && bun test apps/server/src/capability-map.test.ts`. Result: `(fail) … "adr": "0037"`.
- The parallel claim (`plan.md:92`, `stage-05…:5`) looks only at shared files, not at tests that read across files.
- Fix: run 05 after 04, or forbid the token "ADR 0037" in capability pages until 04 lands.

## TEST GAP

T1. No stage proves "with no Gemini key in the env" (`ticket.md:27`).
- The main `.env` still holds `GEMINI_API_KEY=` and `GEMINI_MODEL=` lines (key names only were printed). `limen-prepare.sh` copies that file into the stage 06 worktree.
- C1 (`plan.md:73`) runs before the first deploy of stage 02, not before stage 06.
- `stage-06-runs.md:16-17` runs both checks with no env check, for example `grep -c '^GEMINI_' .env` = 0.

T2. The stage 04 Check misses the tests that read its files.
- `stage-04…:41` runs only `bun test apps/web/src/lib packages/core/src/legal`. It omits `apps/server/src/legal-papers.test.ts` and `apps/server/src/own-model-docs.test.ts`.
- Proven trap: `stage-04…:24-25` adds "amended by 0037" to the 0035 README row. `own-model-docs.test.ts:116` requires the cell to end in `decision 6 waits\s*\|`.
- Reproduction: `; amended by 0037` appended to the cell, then `bun test apps/server/src/own-model-docs.test.ts`. Result: `(fail) … the index says the same`.
- The Proof catches both. The Check line does not.

T3. Coverage of the provider-generic mechanism. Plausible.
- D1 (`plan.md:18`) keeps the per-provider rate limiter, role provider override and `providerBlocks`. After stage 02 they have one provider.
- `client-roles.test.ts:124` and `config-roles.test.ts:80` lose their subject.
- `stage-02…:11` decides a fake provider row only for the null-effort rule. Stage 03 (`stage-03…:12`) deletes tests with no subject.
- No stage decides whether these tests move to a fake provider row or are deleted. "Keep the registry shape" then has no test.

## NOTES

N1. The exit code 1 of the holdout and injection runs is not handled. Proven by code reading.
- `drafterExitCode` returns 1 for errors > 10%, a failed gate bar and an injection set under 100% (`drafter-eval-scores.ts:254-257`, F115 branch).
- F115 note line 31: the dev numbers already fail two bars (send as is 64% against 80%, invented commitment 1 against 0). The holdout run will very likely exit 1.
- `stage-06…:21` names exit 1 only as judge errors over 10%. The worker cannot tell from the stage whether to continue to step 5 after a failed bar.

N2. C1 can leave a start failure on the VPS. Plausible; the VPS env was not visible.
- C1 (`plan.md:73`) does not delete `LLM_<ROLE>_MODEL=gemini-*` lines.
- `config-llm.ts:142-147` rejects `LLM_<ROLE>_MODEL` without `LLM_<ROLE>_PROVIDER` at server start.
- C1 runs `llm:check` on the VPS, but it does not say whether the old image or the new image runs it.

N3. The default-judge trigger (D4) is ambiguous.
- `stage-01…:15` applies the default only when no `LLM_JUDGE_*` key is set. `LLM_JUDGE_RPM` or `LLM_JUDGE_REASONING` alone then changes the judge model back to the classifier model, and the run gets `JUDGE_SAME_MODEL`.
- `--judge-provider openai` alone does the same (`config-llm.ts:211-222`).
- Both fail loudly, but the worker must guess which behaviour is intended.

N4. Two rules conflict. `stage-02…:42` asks for the comment `// sub-processor gemini removed` in `packages/core/src/web/terms.ts`. `stage-03…:32` requires no `gemini` hit in `packages`. The allowed hits (`stage-05…:30-39`) have no group for `packages/`.

N5. A stale usage text that no stage covers. `eval-args.ts:52` on the F115 branch says "the judge needs another provider than the drafter". The comments at `eval-drafter.ts:233` and `eval-sim.ts:208` say the same. They hold no "gemini", so neither the acceptance grep nor stage 01 or 03 catches them.

N6. A wrong stage reference. `stage-01…:46` says "ADR 0037 comes in stage 05". It comes in stage 04.

N7. Stage 04 can change files that stage 03 owns. `stage-04…:9` may edit `JUDGE_SAME_MODEL` (`apps/`) and `evals/README.md`. Stage 03 owns both and runs in parallel (`stage-03…:5`).

N8. Other tickets keep Gemini or Vertex text, and C2 (`plan.md:74`) does not name them.
- F111 `stage-07-eu-endpoint.md:49` still says "Fallback: Vertex AI EU, F076". That contradicts D10/Q2.
- F115 `stage-17-docs.md:22` edits the `gemini` row that stage 02 removes.
- F115 `stage-02-prototype-run.md:10,27` still says "judge on Gemini" and "provider must differ (PD-026)".

N9. Shared rate on the production key. Plausible.
- Stage 06 sets no `--rpm` or `--concurrency`. The defaults are 240 rpm and 8 (`eval-args.ts:24-25`).
- With D6, the drafter and judge share that rate on the production project, on the same model family as production triage.
- D13 stops only on `http_429_quota`. A rate-type 429 that slows production triage has no rule.

N10. A model alias passes the judge rule. Plausible, and unlikely. D3 compares model ids as exact strings. A price row must exist first, which limits the risk.

N11. The ticket names a key the code does not read. `ticket.md:14` names `GEMINI_MODEL`. The code reads only `GEMINI_MODEL_CLASSIFIER` (`config.test.ts:223`). The F115 note line 9 shows the judge was `gemini-3.5-flash-lite`. The plan does not repeat the error.

## F115 stage 02 move (D11)

The move is correct apart from N1 and N8.
- The branch exists at `81ec8fd1` with the harness, the injection set (14 cases), the dev report, the partial injection report and the note.
- "Second pass input" is generated by code (`drafter-eval-report.ts:158,228`). The judge header prints `openai gpt-6.1-terra`.
- The gate file name and `--reasoning-effort low` in `stage-06…:18-20` match the note (lines 9, 36).
- The old state file name has no judge part. D5 keeps a judged run from reusing it.
- `loadGateEvidence` reads only `classifier-*` files (`evidence.ts:90`), so a drafter gate file does not reach the server.

## Pre-mortem: which stage lets each bug through

| Bug | Stage | Status |
| --- | --- | --- |
| VPS start failure | C1 | N2 gap |
| Judge grades its own model | Stage 01 D3 | Closed; N10 is the only residue |
| Mixed judge grades | Stage 01 step 2 | Closed |
| False privacy page | Stage 02 | Closed; N8 is open in other tickets |
| Production quota hit | O1 | Closed for quota; N9 is open for rate |
| Stage that cannot pass its Proof | Stage 04, stage 05 | B1, B2 |

Stage sizes are acceptable. Removing the provider breaks typecheck in 13 server files at base, so stage 02 is the largest job.

## Facts checked

F3, F4 and F7 hold. F5: the November ledger sum is $2.7665. The D4 source is F109 stage 13 line 10. D7 holds: `trust/key.ts:9` is `z.string()`. Plan N3: `--limit` is valid with `--sim`, and a `--limit` run writes no gate file (`eval-sim-report.ts:328`).

## Checks run

- `bun install --frozen-lockfile`: OK.
- `bun test apps/server/src/legal-papers.test.ts` with the claim rows deleted: 19 pass, 4 fail (B1).
- Stage 02 legal change simulated: 952 pass, 3 fail. All three failures are expected (provider tests and the TERMS digest).
- `bun test apps/server/src/own-model-docs.test.ts` with the README cell edited: 1 fail (T2).
- `bun test apps/server/src/capability-map.test.ts` with "ADR 0037" in a page: 1 fail (B2).
- `bunx tsc --noEmit -p apps/server` with `gemini` removed: errors in 13 files.
- The full Proof was not run.
