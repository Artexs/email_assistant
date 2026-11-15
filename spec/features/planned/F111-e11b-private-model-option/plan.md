# F111 · E11b Private model option — plan

> **Status 2026-11-15 — planned.** Plan base: 2e2451be. Stages 01–05 build without the owner's EU answer; stage 06 waits for PD-111 and the PD-110 second pass. A refresh job runs before stage 01 if the code drifted.

## Input

Owner words (E11 discovery, 2026-11-13): "Okay, go with defaults." → PD-104–PD-114. The rows that set this ticket, word for word:
- PD-110: "Privacy story (ADR 0035): first EU processing by `OPENAI_BASE_URL` with an OpenAI Europe project (zero data retention, +10% price) as a Must-tier item, because `03` §2 promises "in the EU"; then an own OpenAI-compatible model endpoint (for example Ollama) with published E2a holdout numbers; no PII sanitizer. Every new endpoint or model passes the holdout gate (PD-025); a failing model unlocks no `auto` (ADR 0028). Fallback if OpenAI refuses: Vertex AI EU (F076). Second pass after OpenAI answers the EU approval request."
- PD-111: "Owner step when E11b is planned: create an OpenAI project with region Europe and ask for the ZDR or Modified Abuse Monitoring approval."
- PD-112: "Own-model proof: Bielik 11B v3.1 and one general open model of similar size run the E2a holdout once on a rented GPU hour, synthetic data only (about $1–2), unless the owner's PC has a GPU with at least 12 GB memory. The home VPS does not host a model."
- PD-101 (E10): "EU-only processing an endpoint option (ADR 0035 draft), not the default of this install."

Design source: ADR 0035, E11 discovery notes §3.

**Product**
- **P1 One endpoint per deployment** (operator env). Reason: ADR 0035 §4, PD-101; no outside organization exists. Rejected: a per-org column (a migration and a route per call). The pilot on the VPS keeps the US API until the owner switches (PD-110). Default, owner to confirm (Q1).
- **P2** `OPENAI_BASE_URL` default `https://api.openai.com/v1` (ADR 0035 §1).
- **P3 Own-model hardware:** PD-112's rule picks the owner's PC: it has an AMD RX 6950 XT, 16 GB (fact F5). Owner step O2 installs `ollama-rocm`. Fallback: a rented GPU, at most $5. Default, owner to confirm (Q2).
- **P4 Candidates:** Bielik 11B v3.1 (Q4_K_M) and `gemma3:12b`. Default (Q3).
- **P5** Stage 06 changes no VPS env (P1).
- **P6** No OpenAI answer: stage 06 waits; the coordinator asks again 30 days after O1 (Q4).

**Design**
- **D1 Explicit base URL.** The adapter always passes `baseURL` from config. Reason: the SDK reads `OPENAI_BASE_URL` from the env on its own (F2) and so skips the config check. Rejected: the SDK option `dataResidency` (cannot name an own server).
- **D2 URL check at start.** `https`, or `http` only to a loopback or one-label host (a container name); no user info, query or fragment; a trailing `/` goes. A bad value stops the start; the error names the key, never the value. Default, owner to confirm (Q5).
- **D3 Endpoint kind** `LlmEndpointKind = "standard" | "eu" | "own"`: host `api.openai.com` or `us.api.openai.com` → `standard`; `eu.api.openai.com` → `eu`; any other `*.openai.com` host → start refused (no price rows); any other host → `own`. Gemini rows are `standard`. All roles on the `openai` provider share the endpoint.
- **D4 Own endpoint request.** No `reasoning` field (the start log says the effort is ignored); `store: false` stays. Stage 01 decides the API path (D9).
- **D5 Logs.** `llm_settings` and `llm:check` add `endpoint` (kind) and `host` (hostname only); `configHint` names `OPENAI_BASE_URL`. Error classification stays (it reads no message). No URL in an error text, log line or audit row.
- **D6 Audit row.** `llm.call` data gains `endpoint`, from `LlmUsage.endpoint` at call time (a restart with a new URL prices each row right). A row without it is `standard` (all earlier calls went to the US API).
- **D7 Prices.** `LlmPrice.endpoint?: "eu"`. `costPerMail(model, tokensIn, tokensOut, at, endpoint = "standard")`: `own` → 0; `eu` → only rows with `endpoint: "eu"` (none → `null`, counted as unpriced); `standard` → rows without `endpoint`. EU row for `gpt-6-luna`: 0.11 in, 0.55 out (1.10×; secondary source, opsware 2026-10-16); stage 06 A replaces it with OpenAI's own price.
- **D8 Gate evidence.** The gate file gains `endpoint` (schema default `standard`, so old files parse). `gateFileName` adds `-<endpoint>` before `.json` when not `standard`; old names stay. Reports print the kind and host. A gate file proves one (model, endpoint) pair; a reader (F110) matches both.
- **D9 Spike rule.** If all stage 01 cases pass on the Responses path, stage 04 is skipped. Else stage 04 adds `OPENAI_API_STYLE=responses|chat` (default `responses`; `chat` allowed only for `own`).
- **D10 Own-model run.** Holdout only, no judge, no DB mail. The worker runs `ollama serve` on `127.0.0.1:11500` (models in `${XDG_CACHE_HOME:-~/.cache}/email-assistant/ollama`) and stops it by its PID.
- **D11 EU run secrets.** The owner writes `~/.config/email-assistant/openai-eu.env` (`OPENAI_API_KEY`, `OPENAI_BASE_URL`). The worker sources it into the shell of the run (shell env wins over `.env`, fact F4) and never prints it.
- **D12 Sub-processor seam (F107 D3).** The later of F107 and F111 maps `OPENAI_BASE_URL` in `OUTSIDE_SERVICE_KEYS` to the `openai` row. `own` = no LLM sub-processor.
- **D13 Docs (PD-009).** Each stage updates its capability page, `.env.example` and `docs/architecture.md` §6.3. ADR 0035: stage 05 accepts parts 1–5; stage 06 adds the EU result or a dated amendment.

## Facts checked (2026-11-15, base 2e2451be)

- F1 The adapter has no `baseURL`; config has no `OPENAI_BASE_URL`; prices are keyed by model only; cost is computed at read time from `llm.call` rows (`scouts.md`, code read).
- F2 Probe, openai 7.53.0 under Bun 1.4.4: with no `baseURL` the client takes `process.env.OPENAI_BASE_URL`; an explicit `baseURL` wins and the call goes to `<base>/responses`; `output_text` and `usage` come back from a fake server; `dataResidency: "eu"` gives `https://eu.api.openai.com/v1` and refuses a `baseURL` next to it.
- F3 `eval --sim` takes `--provider` and `--model`, has no endpoint flag, and refuses a model without a price row (`scouts.md` 2).
- F4 Probe: Bun 1.4.4 keeps a shell variable over the same key in `.env`.
- F5 This PC: AMD RX 6950 XT (`lspci`); `ollama` and `ollama-cuda` 0.40.7, no `ollama-rocm`; service off.

## Not verified

- Ollama's Responses path with the strict schema → stage 01.
- `gpt-6-luna` on the EU endpoint, the EU price, and the key's region rule → stage 06 (`llm:check`).
- Bielik 11B v3.1 in Ollama or as GGUF, and the ROCm speed of this GPU → stage 05.

## Done when

1. `OPENAI_BASE_URL` selects the endpoint; a bad URL stops the start (stage 02 tests).
2. Every `llm.call` row has an endpoint kind and is priced by it (stage 03 tests).
3. Holdout reports and gate files for two own models are in `evals/results/`, and the install guide exists (stage 05).
4. Stage 06 A: an EU gate file and docs that say "EU endpoint verified"; or B: the ADR 0035 amendment.

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, the ticket, this file and your stage file. Build only your stage. Format only your files.
- Never print, log or commit a key, `.env` or the EU env file. Never open `evals/sim/*/holdout/` (the runner reads it).
- Bun 1.4.4 `toMatchObject` does not compare `Date` values: compare with `getTime()`. The logger drops id fields that are not UUIDs.
- No migration and no `bun.lock` change in this ticket.
- A gap or a deviation from a decision is a question in the final message, not a choice.

## Proof

```
mkdir -p /tmp/f111-sNN && bun run lint > /tmp/f111-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f111-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f111-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f111-sNN/int.log 2>&1 && echo PROOF_OK
```

Run it after the last commit; read the logs in a separate call.

## Owner checkpoints and steps

- O1 (PD-111, now): an OpenAI project with region Europe; ask for ZDR or MAM approval. Stages 01–05 do not wait.
- O2 (before stage 05): `sudo pacman -S ollama-rocm`, or say "rent a GPU" (Q2).
- O3 (before stage 06): the PD-110 second pass with OpenAI's answer; on approval, write the EU env file (D11).

## Review

Opus review before the land: 01 (real system), 02 (security), 03 (money), 05 (published numbers), 06 (privacy). 04 lands on its proof.

## Stages

1. [stage-01-ollama-spike.md](stages/stage-01-ollama-spike.md) `[risky]`
2. [stage-02-endpoint-setting.md](stages/stage-02-endpoint-setting.md)
3. [stage-03-endpoint-cost-and-gate.md](stages/stage-03-endpoint-cost-and-gate.md)
4. [stage-04-chat-path.md](stages/stage-04-chat-path.md) (only if stage 01 fails)
5. [stage-05-own-model-runs.md](stages/stage-05-own-model-runs.md) (O2)
6. [stage-06-eu-endpoint.md](stages/stage-06-eu-endpoint.md) `[risky]` (O1, O3)

## How to run (coordinator)

1. Move the ticket to `active/` and commit (F097 is in `done/`).
2. Order: 01 → 02 → 03 → 04 (if needed) → 05 → 06; 01 may run next to 02. Land each stage before the next.
3. Spawn with the board's worker flags and `--prepare 'bash scripts/limen-prepare.sh'`: "Implement F111 stage NN. Read spec/features/active/F111-e11b-private-model-option/ticket.md, plan.md and stages/stage-NN-<slug>.md. Final proof: the Proof of your stage file. List as proven only what a saved log shows." Drop the job DB after the land. Stop before 05 (O2) and 06 (O3).

## Planning progress

- Scouts: 3 (`scouts.md`). Stages 01–06 [written]. Words: plan 1500; stages 604, 623, 588, 364, 683, 656.

## Cold review

## Log
