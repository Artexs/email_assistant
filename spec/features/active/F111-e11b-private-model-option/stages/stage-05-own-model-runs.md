# F111 stage 05 — Holdout numbers for two own models

Part of [`../plan.md`](../plan.md). Review before the land (published LLM numbers). Owner step O2 comes first (plan § Owner steps): `ollama-rocm` is installed on this PC (P3), or the owner said "rent a GPU". Needs stages 02, 03 and, if built, 04. Stage 06 landed first (owner, 2026-11-15): at the end, fill `docs/own-model.md` content 3 and 6 and the ADR 0035 amendment with the numbers of this stage (stage 06 rules and tests). Long job: if time runs short after model one, commit its files and report; the coordinator continues for model two.

## Step 1 — Serve the models

**Goal.** A local OpenAI-compatible server with the two candidates (P3, P4, D10).

**Setup.**
- Check the GPU path first: `ollama serve` on `127.0.0.1:11500` (D10 env, as in stage 01), then its log must name a ROCm GPU. If it names only CPU, stop and report "O2 not done" (a CPU run takes many hours).
- Rented GPU (only when the owner chose it): the owner gives a tunnel to its Ollama on `127.0.0.1:11500`; this stage runs nothing on the rented host itself. Spend cap $5 (Q2).
- Models: Bielik 11B v3.1 at Q4_K_M — first the Ollama library name, else `hf.co/<SpeakLeash GGUF repo>:Q4_K_M`; if neither has v3.1, take the newest Bielik 11B and write the gap in the final message. Second: `gemma3:12b`. Disk need about 16 GB (`df` first).
- Long commands: `nohup`, poll the log, tool calls under 120 s. Stop the server by its PID at the end.

**Decisions.** P3, P4, D10. Start the server with `OLLAMA_CONTEXT_LENGTH=8192` (D10).

**Done when.** `curl -s http://127.0.0.1:11500/api/tags` lists both models (record the tags).

## Step 2 — The holdout runs

**Goal.** One holdout report and one gate file per model (PD-110, PD-112, D8).

**Command per model** (shell variables, plan F4; the key value is a placeholder, Ollama ignores it):

```
OPENAI_BASE_URL=http://127.0.0.1:11500/v1 OPENAI_API_KEY=ollama OPENAI_TIMEOUT_MS=120000 \
  bun run eval --sim lab-01 --part holdout --provider openai --model <tag> --concurrency 4 --rpm 600 \
  --out evals/results/<date>-sim-lab-01-holdout-<safe tag>-own-<prompt>.md
```

- `<prompt>`: the safe `promptLabel` of production (`classifier-v2` now; F109 stage 11 may move it to v3). No prompt flags: the gate file proves the production prompt. Before model two, compare its label with model one's run; a change (F109 stage 11 landed between) is a stop and a question, not a mixed comparison.
- If stage 04 was built: add `OPENAI_API_STYLE=chat`.
- A stop resumes with the same command (the state name holds prompt label and endpoint, D8); report resumes and total time.
- Never `--judge`, `--limit` (no gate file), `--suspicious` or another part. Nothing reads DB mail.
- Record per model: total time, mean seconds per case, failed cases, the GPU name, the Ollama version, the tags.

**Decisions.** D8, D10; PD-025 bar unchanged (the gate decides, no threshold change).

**Test.**
1. Two gate files exist with names ending `-own.json`; each parses with `gateFileSchema`, has `endpoint` `own`, `host` `127.0.0.1`, and `promptVersion` and `promptParts` equal to the production choice (`promptParts` absent for `classifier-v2`).
2. Each report has the line `endpoint=own host=127.0.0.1`.
3. `grep -cE '\b[bhw]-[a-z]{2,4}-[0-9]{2,4}\b' <report>` prints 0 for both reports (no case id).

**Done when.** Both runs are complete, or a run that cannot complete is reported with its count and cause (a question, not a retry loop).

## Step 3 — Run record for stage 06

**Goal.** Stage 06 writes the guide from facts, not memory.

**Files.** `evals/results/<date>-own-model-runs.md` (new): per model the tag, the Ollama version, the GPU, `OLLAMA_CONTEXT_LENGTH`, the total time, seconds per case, resumes, failed cases, the largest `tokensIn` of a case, and the go/no-go per category next to the `standard` gate file of the same prompt version (`gpt-6-luna`; for `classifier-v2` the F097 stage 21 file). No such file: stop and report it. No case id, no mail text.

**Test.** The largest `tokensIn` stays below 8192 − 1024; else stop and report it (Ollama would cut the prompt, D10).

**Done when.** The record exists and its numbers match the two reports.

## Proof

```
mkdir -p /tmp/f111-s05 && bun run lint > /tmp/f111-s05/lint.log 2>&1 && bun run typecheck > /tmp/f111-s05/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f111-s05/unit.log 2>&1 && echo PROOF_OK
```

Only result files and docs change: no `test:int:ci`. The final message lists the run times, the go/no-go per category for both models, and the stopped server PID.
