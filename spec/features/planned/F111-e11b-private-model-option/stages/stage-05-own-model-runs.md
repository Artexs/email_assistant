# F111 stage 05 — Holdout numbers for two own models, and the install guide

Part of [`../plan.md`](../plan.md). Review before the land (published LLM numbers). Owner step O2 comes first: `ollama-rocm` is installed on this PC (P3), or the owner said "rent a GPU". Needs stages 02, 03 and, if built, 04.

## Step 1 — Serve the models

**Goal.** A local OpenAI-compatible server with the two candidates (P3, P4, D10).

**Setup.**
- Check the GPU path first: `ollama serve` on `127.0.0.1:11500` (D10 env, as in stage 01), then its log must name a ROCm GPU. If it names only CPU, stop and report "O2 not done" (a CPU run of the holdout takes many hours).
- Rented GPU (only when the owner chose it): the owner gives a tunnel to its Ollama on `127.0.0.1:11500`; this stage runs nothing on the rented host itself. Spend cap $5 (Q2).
- Models: Bielik 11B v3.1 at Q4_K_M — first the Ollama library name, else `hf.co/<SpeakLeash GGUF repo>:Q4_K_M`; if neither has v3.1, take the newest Bielik 11B and write the gap in the final message. Second: `gemma3:12b`. Disk need about 16 GB (`df` first).
- Long commands: `nohup`, poll the log, tool calls under 120 s. Stop the server by its PID at the end.

**Decisions.** P3, P4, D10.

**Done when.** `curl -s http://127.0.0.1:11500/api/tags` lists both models (record the exact tags).

## Step 2 — The holdout runs

**Goal.** One holdout report and one gate file per model (PD-110, PD-112, D8).

**Command per model** (shell variables, plan F4; the key value is a placeholder, Ollama ignores it):

```
OPENAI_BASE_URL=http://127.0.0.1:11500/v1 OPENAI_API_KEY=ollama OPENAI_TIMEOUT_MS=120000 \
  bun run eval --sim lab-01 --part holdout --provider openai --model <tag> --concurrency 4 --rpm 600 \
  --out evals/results/<date>-sim-lab-01-holdout-<safe tag>-own-classifier-v2.md
```

- If stage 04 was built: add `OPENAI_API_STYLE=chat`.
- A stop (timeouts, soft errors) resumes with the same command; report every resume and the total time.
- Never `--judge`, never `--limit` (no gate file with it), never another part. Nothing reads DB mail.
- Record per model: total time, mean seconds per case, failed cases, the GPU name, the Ollama version, the tags.

**Decisions.** D8, D10; PD-025 bar unchanged (the gate decides, no threshold change).

**Test.**
1. Two gate files exist with names ending `-own.json`; each parses with `gateFileSchema` and has `endpoint` `own`.
2. Each report has the line `endpoint=own host=127.0.0.1`.
3. `grep -cE '\b[bhw]-[a-z]{2,4}-[0-9]{2,4}\b' <report>` prints 0 for both reports (no case id leaks).

**Done when.** Both runs are complete, or a run that cannot complete is reported with its count and cause (then the gap is a question, not a retry loop).

## Step 3 — Install guide and docs

**Goal.** An operator can run the product on an own model and knows what it costs in quality and hardware (ADR 0035 Consequences).

**Files.**
- `docs/own-model.md` (new, English): what an own endpoint changes (D3, D4, D12: no LLM sub-processor); hardware (the VPS cannot host a model; measured GPU, memory and seconds per mail from step 2; 200 mails a day ≈ 600k prompt tokens a day); Ollama setup with the env lines (`OPENAI_BASE_URL`, `OPENAI_API_KEY` placeholder, `OPENAI_TIMEOUT_MS`, and `OPENAI_API_STYLE` if built); the http rule (D2); the gate rule: a model without a passing gate file unlocks no `auto` category (ADR 0028); the results table (per category: go or no-go, precision, recall; links to both reports and to the OpenAI baseline report of F097 stage 21).
- `docs/decisions/0035-llm-endpoint-eu-and-own-model.md`: status "accepted 2026-MM-DD for decisions 1–5; decision 6 waits for the EU answer"; a dated line with the two results.
- `docs/capabilities/triage.md`: link to the guide; `docs/architecture.md` §6.3: "own model: no LLM sub-processor".

**Decisions.** D13.

**Done when.** The guide's numbers match the two reports; every link resolves.

## Proof

```
mkdir -p /tmp/f111-s05 && bun run lint > /tmp/f111-s05/lint.log 2>&1 && bun run typecheck > /tmp/f111-s05/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f111-s05/unit.log 2>&1 && echo PROOF_OK
```

No code changes here except result files and docs, so `test:int:ci` is not part of this proof. The final message lists the run times, the go/no-go per category for both models, and the server PID that was stopped.
