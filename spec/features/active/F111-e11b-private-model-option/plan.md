# F111 · E11b Private model option — plan

> **Status 2026-11-15 — planned.** Plan base: 7f4cd964, refreshed 2026-11-15. Stages 01–06 build without the owner's EU answer; stage 07 waits for PD-111 and the PD-110 second pass.

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
- **D8 Gate evidence.** Gate file gains `endpoint` (default `standard`) and `host`, next to F109's optional `promptParts`. `gateFileName` and `evalStateFileName` add `-<endpoint>` when not `standard` (old names stay; a resume never mixes endpoints). The state name keeps `promptLabel`; the gate name has no parts (F109 stage 11 naming; rejected: parts, which rename its file). A gate file proves one model and prompt on one endpoint and host. `gate-evidence.test.ts` needs a `standard` file for the current prompt version.
- **D9 Spike rule.** Stage 01 passes the Responses path when the parse cases pass; then stage 04 is skipped. Else stage 04 adds `OPENAI_API_STYLE=responses|chat` (`chat` only for `own`).
- **D10 Own-model run.** Holdout only, no judge, no DB mail. The worker runs `ollama serve` on `127.0.0.1:11500` with `OLLAMA_CONTEXT_LENGTH=8192` (models in `${XDG_CACHE_HOME:-~/.cache}/email-assistant/ollama`) and stops it by its PID.
- **D11 EU secrets.** The owner writes `~/.config/email-assistant/openai-eu.env`; the worker sources it into the run shell (F4) and never prints it.
- **D12 Budget for `own`.** An `own` run has no USD cap and needs no price row; its ledger line is $0. The "estimate above zero" guard stays for `standard` and `eu`.
- **D13 `auto` truth.** No code ties `auto` to the model at HEAD (review B4). The guide tells the operator: set each `auto` category back to `assist` before an endpoint or model switch, until F110 re-gates on (model, endpoint).
- **D14 Sub-processor seam (F107 D3).** The later of F107 and F111 maps `OPENAI_BASE_URL` in `OUTSIDE_SERVICE_KEYS`; F107's `ActiveWhen` needs an endpoint condition so `own` shows no LLM sub-processor (outside edit).
- **D15 Docs (PD-009).** Each stage updates its capability page, `.env.example` and `docs/architecture.md` §6.3. Stage 06 accepts ADR 0035 with decision 1 and Consequence 1 rewritten to P1 and PD-101, and D2, D3 as amendments; stage 07 settles decision 6.

## Facts checked (2026-11-15, base 7f4cd964)

- F1 No `baseURL` in the adapter or config; prices by model only; cost from `llm.call` rows (`scouts.md`, code read).
- F2 Probe, openai 7.53.0, Bun 1.4.4: with no `baseURL` the client takes `process.env.OPENAI_BASE_URL`; an explicit `baseURL` wins; the call goes to `<base>/responses`; `dataResidency: "eu"` → `https://eu.api.openai.com/v1`.
- F3 `eval --sim` has prompt flags, no endpoint flag; `--suspicious`, `--gap` load no config; the pool refuses a zero estimate.
- F4 Probe: Bun 1.4.4 keeps a shell variable over the same `.env` key.
- F5 This PC: AMD RX 6950 XT; `ollama`, `ollama-cuda` 0.40.7, no `ollama-rocm`; service off.

## Not verified

- Ollama's Responses path → 01. Bielik 11B v3.1 in Ollama or GGUF, ROCm speed → 05.
- `gpt-6-luna` on the EU endpoint and its EU price → stage 07.

## Done when

1. `OPENAI_BASE_URL` selects the endpoint; a bad or hosted third-party URL stops the start (stage 02).
2. Every `llm.call` row carries and is priced by its endpoint (stage 03).
3. Two own-model gate files and reports exist (stage 05); the guide states them and the `auto` rule (stage 06).
4. Stage 07 A: an EU gate file and true docs; or B: the ADR 0035 amendment.

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, the ticket, this file, your stage. Build only your stage; format only your files.
- Never print, log or commit a key, `.env` or the EU env file. Never open `evals/sim/*/holdout/`.
- Bun 1.4.4 `toMatchObject` does not compare `Date` values; the logger drops non-UUID id fields.
- No migration and no `bun.lock` change.
- A gap or a deviation from a decision is a question in the final message, not a choice.

## Proof

```
mkdir -p /tmp/f111-sNN && bun run lint > /tmp/f111-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f111-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f111-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f111-sNN/int.log 2>&1 && echo PROOF_OK
```

Run it after the last commit.

## Owner checkpoints and steps

- O1 (PD-111, now): an OpenAI project with region Europe; ask for ZDR or MAM approval. 01–06 do not wait.
- O2 (before 05): `sudo pacman -S ollama-rocm`, or "rent a GPU" (Q2). Owner, 2026-11-15: later, not now; the owner's reminder is `notes/owner-later.md`. Stage 06 does not wait: it builds now (see stage 06 § Order change).
- O3 (before 07): the PD-110 second pass; on approval, the EU env file (D11).

## Review

Opus review before the land: all but 04 (it lands on its proof).

## Stages

1. [stage-01-ollama-spike.md](stages/stage-01-ollama-spike.md) `[risky]`
2. [stage-02-endpoint-setting.md](stages/stage-02-endpoint-setting.md)
3. [stage-03-endpoint-cost-and-gate.md](stages/stage-03-endpoint-cost-and-gate.md)
4. [stage-04-chat-path.md](stages/stage-04-chat-path.md) (only if 01 fails)
5. [stage-05-own-model-runs.md](stages/stage-05-own-model-runs.md) (O2)
6. [stage-06-own-model-guide.md](stages/stage-06-own-model-guide.md)
7. [stage-07-eu-endpoint.md](stages/stage-07-eu-endpoint.md) `[risky]` (O1, O3)

## How to run (coordinator)

1. Move the ticket to `active/` and commit.
2. Order 01 → … → 07; 01 may run next to 02. Land each stage before the next.
3. Spawn with the board's worker flags and `--prepare 'bash scripts/limen-prepare.sh'`: "Implement F111 stage NN. Read spec/features/active/F111-e11b-private-model-option/ticket.md, plan.md and stages/stage-NN-<slug>.md. Final proof: the Proof of your stage file. List as proven only what a saved log shows." Drop the job DB after the land. Stop before 05 (O2) and 07 (O3). Order since 2026-11-15: 06 before 05; 05 waits for O2.

## Planning progress

- Scouts: 3. Stages 01–07 [written]. Refresh 1 (plan-refresh-1.md). Words: plan 1480; stages 657, 700, 700, 368, 694, 643, 700.

## Cold review

Opus 5.5, high: the plan has `[risky]` stages and touches privacy and LLM spend. Job `2026-11-15-f111-plan-review-93ab9dbc`, candidate `9452974`: FAIL, 5 blocking, 17 notes ([plan-review-1.md](plan-review-1.md)). All 22 fixed, none rejected (map: commit a3e382a7).

Refresh 1, Opus 5.5, high (a stage interface changed): job `2026-11-15-f111-plan-review-2-refresh-463fee8a`: FAIL, 1 blocking, 4 notes ([plan-review-2.md](plan-review-2.md)). All fixed (plan-refresh-1.md).

## Log
