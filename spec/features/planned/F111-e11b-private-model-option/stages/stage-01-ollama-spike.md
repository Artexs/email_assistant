# F111 stage 01 — Spike: Ollama's Responses path with the adapter's request

Part of [`../plan.md`](../plan.md). `[risky]`: the first contact with a real own-model server. No product code: probe scripts live in a temp folder inside the worktree and are not committed.

## Step 1 — Run the adapter's real request against a real Ollama

**Goal.** Know whether the current OpenAI adapter request works on Ollama's `/v1/responses` (ADR 0035 Consequences, last line; plan D9).

**Files.** Probe: `.tmp-f111-s01/` in the worktree (delete it before the commit). Result: `notes/2026-11-15-ollama-responses-path.md` (new; append if it exists). Use the date of the run in the name if it differs.

**Setup.**
- Ollama 0.40.7 is installed on this PC (plan F5); the service is off. Start your own server: `OLLAMA_HOST=127.0.0.1:11500 OLLAMA_MODELS=${XDG_CACHE_HOME:-$HOME/.cache}/email-assistant/ollama nohup ollama serve > /tmp/f111-s01/ollama.log 2>&1 &`, save `$!` and stop only that PID at the end (`kill <pid>`; never `pkill`). CPU is enough for this stage.
- Pull one small model: `qwen3:0.6b` (about 0.5 GB). If it is not in the library, take `gemma3:1b` and say so.
- Tool calls stay under 120 s: start long commands with `nohup` and poll the log.

**Probe.** A Bun script that imports the repo code (link the job's `node_modules`) and sends, through the real SDK client with `baseURL: "http://127.0.0.1:11500/v1"` and `apiKey: "ollama"`, the exact params of `toResponseParams` for:
- S1 the current classifier prompt and its JSON schema (`prompts.classifier`), one synthetic mail text that you write (no corpus file, no real mail);
- S2 the same with the `reasoning` field removed (plan D4);
- S3 the same with `reasoning: { effort: "none" }` kept;
- S4 a model name that is not pulled (`no-such-model`);
- S5 the server stopped (connection refused).

**Record for each case** (in the note, a table): HTTP status, the error class that `classifyOpenAiError` gives, whether `output_text` parses with the classifier's Zod schema, `usage.input_tokens` and `usage.output_tokens` (present or 0), the wall time, and whether `strict: true`, `instructions` and `store: false` were accepted or ignored. Never paste a response body that holds the prompt; field names and short values only.

**Decision rule (plan D9).** The Responses path passes when S1 or S2 returns a text that parses with the Zod schema, with token counts, and S4 and S5 map to a config error and a soft error. Then write "Stage 04: skip" at the top of the note. Else write "Stage 04: build", with the failing case and the error.

**Also record:** whether S3 fails where S2 passes (then D4 is needed, not only safe), and the Ollama version that `ollama --version` prints for the server.

**Decisions.** D4, D9, D10.

**Test.** The probe cases S1–S5 above are the test. Run S1 and S2 three times each; report the pass count (a grammar path should pass 3 of 3).

**Check.** `test -f notes/2026-11-15-ollama-responses-path.md && grep -c "Stage 04:" notes/2026-11-15-ollama-responses-path.md` prints 1.

**Done when.** The note holds the table for S1–S5, the decision line, and the stop of the server (PID gone in `ps -p <pid>`).

**Out of scope.** Any change under `apps/` or `packages/`; a large model; the holdout corpus.

## Step 2 — Capability note link

**Goal.** A later agent finds the result.

**Files.** `docs/capabilities/triage.md`: one line under its LLM provider rule that points to the note ("own-model server path: see notes/…"). No rule change.

**Done when.** The link resolves.

## Proof

This stage changes no code. Proof:

```
mkdir -p /tmp/f111-s01 && test -f notes/2026-11-15-ollama-responses-path.md && test ! -e .tmp-f111-s01 && bun run lint > /tmp/f111-s01/lint.log 2>&1 && echo PROOF_OK
```

The final message gives the decision line, the S1–S5 table, and the server PID that was stopped.
