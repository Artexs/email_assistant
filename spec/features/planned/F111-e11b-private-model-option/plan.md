# F111 · E11b Private model option — plan

> **Status 2026-11-15 — planned.** Plan base: 2e2451be. Stages 01–06 build without the owner's EU answer; stage 07 waits for PD-111 and the PD-110 second pass. A refresh job runs before stage 01 if the code drifted.

## Input

Owner (2026-11-13): "Okay, go with defaults." → PD-104–PD-114. The rows, word for word:
- PD-110: "Privacy story (ADR 0035): first EU processing by `OPENAI_BASE_URL` with an OpenAI Europe project (zero data retention, +10% price) as a Must-tier item, because `03` §2 promises "in the EU"; then an own OpenAI-compatible model endpoint (for example Ollama) with published E2a holdout numbers; no PII sanitizer. Every new endpoint or model passes the holdout gate (PD-025); a failing model unlocks no `auto` (ADR 0028). Fallback if OpenAI refuses: Vertex AI EU (F076). Second pass after OpenAI answers the EU approval request."
- PD-111: "Owner step when E11b is planned: create an OpenAI project with region Europe and ask for the ZDR or Modified Abuse Monitoring approval."
- PD-112: "Own-model proof: Bielik 11B v3.1 and one general open model of similar size run the E2a holdout once on a rented GPU hour, synthetic data only (about $1–2), unless the owner's PC has a GPU with at least 12 GB memory. The home VPS does not host a model."
- PD-101 (E10): "EU-only processing an endpoint option (ADR 0035 draft), not the default of this install."

**Product**
- **P1 One endpoint per deployment** (operator env). Reason: ADR 0035 §4, PD-101; no outside organization exists. Rejected: a per-org column (a migration and a route per call). The VPS pilot keeps the US API until the owner switches. Default, owner to confirm (Q1).
- **P2** `OPENAI_BASE_URL` default `https://api.openai.com/v1`.
- **P3 Hardware:** PD-112's rule picks the owner's PC (16 GB GPU, F5); owner step O2 installs `ollama-rocm`. Fallback: a rented GPU, at most $5. Default (Q2).
- **P4 Candidates:** Bielik 11B v3.1 (Q4_K_M) and `gemma3:12b`. Default (Q3).
- **P5** No stage touches the VPS.
- **P6** No OpenAI answer: stage 07 waits; the coordinator asks again 30 days after O1 (Q4).

**Design**
- **D1 Explicit base URL.** The adapter always passes `baseURL` from config: the SDK reads `OPENAI_BASE_URL` from the env on its own (F2). Rejected: the SDK option `dataResidency` (no own server).
- **D2 URL check at start.** Host lower-cased, one trailing dot removed. `https`, or `http` only to loopback (`127.0.0.0/8`, `::1`, `localhost`) or a one-label host (a container on the same host). No user info, query or fragment. A bad value stops the start; the error names the key, never the value. Default (Q5).
- **D3 Endpoint kind** `LlmEndpointKind = "standard" | "eu" | "own"`: `api.openai.com` → `standard`; `eu.api.openai.com` → `eu`; other `*.openai.com` (also `us.`) → refused (no price rows). Another host is `own` only when loopback or one-label, or with `OPENAI_ENDPOINT_KIND=own` ("a server I run"); else refused: a hosted compatible API (Azure, OpenRouter) has unknown cost and sub-processor. Gemini: `standard`.
- **D4 Own endpoint.** The `openai` rows get `reasoningEffort: null` (no `reasoning` field; names show `default`). `store: false` stays.
- **D5 Logs.** `llm_settings` and `llm:check` add `endpoint` and `host` (hostname only). No URL in an error text, log line or audit row.
- **D6 Audit row.** `llm.call` data gains `endpoint`, taken at call time from `LlmClient.endpointOf(role)` (also on the error branch). A row without it is `standard`.
- **D7 Prices.** `LlmPrice.endpoint?: "eu"`; `costPerMail(…, endpoint = "standard")`: `own` → 0; `eu` → only `eu` rows (none → `null`, unpriced); `standard` → rows without `endpoint`. EU row `gpt-6-luna` 0.11 / 0.55 (1.10×; E11 discovery notes §6, opsware 2026-10-16, read 2026-11-13); stage 07 A replaces it.
- **D8 Gate evidence.** Gate file gains `endpoint` (default `standard`) and `host`. `gateFileName` and `evalStateFileName` add `-<endpoint>` when not `standard` (old names stay; a resume never mixes endpoints). A gate file proves one model on one endpoint and host. `gate-evidence.test.ts` needs a `standard` file for the current prompt version.
- **D9 Spike rule.** Stage 01 passes the Responses path when the parse cases pass; then stage 04 is skipped. Else stage 04 adds `OPENAI_API_STYLE=responses|chat` (`chat` only for `own`).
- **D10 Own-model run.** Holdout only, no judge, no DB mail. The worker runs `ollama serve` on `127.0.0.1:11500` with `OLLAMA_CONTEXT_LENGTH=8192` (models in `${XDG_CACHE_HOME:-~/.cache}/email-assistant/ollama`) and stops it by its PID.
- **D11 EU secrets.** The owner writes `~/.config/email-assistant/openai-eu.env`; the worker sources it into the run shell (F4) and never prints it.
- **D12 Budget for `own`.** An `own` run has no USD cap and needs no price row; its ledger line is $0. The "estimate above zero" guard stays for `standard` and `eu`.
- **D13 `auto` truth.** No code ties `auto` to the model at HEAD (review B4). The guide tells the operator: set each `auto` category back to `assist` before an endpoint or model switch, until F110 re-gates on (model, endpoint).
- **D14 Sub-processor seam (F107 D3).** The later of F107 and F111 maps `OPENAI_BASE_URL` in `OUTSIDE_SERVICE_KEYS`; F107's `ActiveWhen` needs an endpoint condition so `own` shows no LLM sub-processor (outside edit).
- **D15 Docs (PD-009).** Each stage updates its capability page, `.env.example` and `docs/architecture.md` §6.3. Stage 06 accepts ADR 0035 with decision 1 and Consequence 1 rewritten to P1 and PD-101, and D2, D3 as amendments; stage 07 settles decision 6.

## Facts checked (2026-11-15, base 2e2451be)

- F1 No `baseURL` in the adapter or config; prices by model only; cost from `llm.call` rows (`scouts.md`, code read).
- F2 Probe, openai 7.53.0, Bun 1.4.4: with no `baseURL` the client takes `process.env.OPENAI_BASE_URL`; an explicit `baseURL` wins; the call goes to `<base>/responses`; `dataResidency: "eu"` → `https://eu.api.openai.com/v1`.
- F3 `eval --sim` has `--provider`, `--model`, no endpoint flag; the pool refuses a zero estimate (`eval-pool.ts`).
- F4 Probe: Bun 1.4.4 keeps a shell variable over the same `.env` key.
- F5 This PC: AMD RX 6950 XT (`lspci`); `ollama` and `ollama-cuda` 0.40.7, no `ollama-rocm`; service off.

## Not verified

- Ollama's Responses path → stage 01. Bielik 11B v3.1 in Ollama or as GGUF, ROCm speed → stage 05.
- `gpt-6-luna` on the EU endpoint and its EU price → stage 07.

## Done when

1. `OPENAI_BASE_URL` selects the endpoint; a bad or hosted third-party URL stops the start (stage 02).
2. Every `llm.call` row carries its endpoint and is priced by it (stage 03).
3. Two own-model gate files and reports exist (stage 05); the guide states them and the `auto` rule (stage 06).
4. Stage 07 A: an EU gate file and true docs; or B: the ADR 0035 amendment.

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, the ticket, this file and your stage file. Build only your stage; format only your files.
- Never print, log or commit a key, `.env` or the EU env file. Never open `evals/sim/*/holdout/`.
- Bun 1.4.4 `toMatchObject` does not compare `Date` values. The logger drops id fields that are not UUIDs.
- No migration and no `bun.lock` change.
- A gap or a deviation from a decision is a question in the final message, not a choice.

## Proof

```
mkdir -p /tmp/f111-sNN && bun run lint > /tmp/f111-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f111-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f111-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f111-sNN/int.log 2>&1 && echo PROOF_OK
```

Run it after the last commit; read logs separately.

## Owner checkpoints and steps

- O1 (PD-111, now): an OpenAI project with region Europe; ask for ZDR or MAM approval. Stages 01–06 do not wait.
- O2 (before 05): `sudo pacman -S ollama-rocm`, or "rent a GPU" (Q2).
- O3 (before 07): the PD-110 second pass; on approval, the EU env file (D11).

## Review

Opus review before the land: 01, 02, 03, 05, 06, 07. Stage 04 lands on its proof.

## Stages

1. [stage-01-ollama-spike.md](stages/stage-01-ollama-spike.md) `[risky]`
2. [stage-02-endpoint-setting.md](stages/stage-02-endpoint-setting.md)
3. [stage-03-endpoint-cost-and-gate.md](stages/stage-03-endpoint-cost-and-gate.md)
4. [stage-04-chat-path.md](stages/stage-04-chat-path.md) (only if 01 fails)
5. [stage-05-own-model-runs.md](stages/stage-05-own-model-runs.md) (O2)
6. [stage-06-own-model-guide.md](stages/stage-06-own-model-guide.md)
7. [stage-07-eu-endpoint.md](stages/stage-07-eu-endpoint.md) `[risky]` (O1, O3)

## How to run (coordinator)

1. Move the ticket to `active/` and commit (F097 is in `done/`).
2. Order 01 → … → 07; 01 may run next to 02. Land each stage before the next.
3. Spawn with the board's worker flags and `--prepare 'bash scripts/limen-prepare.sh'`: "Implement F111 stage NN. Read spec/features/active/F111-e11b-private-model-option/ticket.md, plan.md and stages/stage-NN-<slug>.md. Final proof: the Proof of your stage file. List as proven only what a saved log shows." Drop the job DB after the land. Stop before 05 (O2) and 07 (O3).

## Planning progress

- Scouts: 3. Stages 01–07 [written]. Words: plan 1497; stages 657, 685, 665, 368, 646, 618, 689.

## Cold review

Opus 5.5, high: the plan has `[risky]` stages and touches privacy and LLM spend. Job `2026-11-15-f111-plan-review-93ab9dbc`, candidate `9452974`: FAIL, 5 blocking, 17 notes ([plan-review-1.md](plan-review-1.md)). All 22 fixed, none rejected: B1 D3, B2 D12, B3 D8, B4 D13, B5 D15; N1 D6; N2–N3 stage 03; N4, N15 D8; N5 D10; N6–N8 stage 01; N9 D3, D7; N10 Q1; N11 D4; N12 new stage 06; N13 D2; N14 stage 07; N16 D14; N17 D15.

## Log
