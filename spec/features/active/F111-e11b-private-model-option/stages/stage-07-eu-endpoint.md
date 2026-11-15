# F111 stage 07 — The EU endpoint is verified, or the fallback is recorded

**Parked (owner, 2026-11-15: "I don't want to complicate it").** The install keeps the default US API (ADR 0035 decision 1). Stage 07 does not run; F111 closes after stages 05 and 06. Run it later only if the owner asks for the EU option.

Part of [`../plan.md`](../plan.md). `[risky]`: privacy claim and a real paid endpoint. Gate: owner step O1 (PD-111, the EU project request) is answered and O3 (the PD-110 second pass) is done. The coordinator writes the owner's answer and its date into the spawn text: "branch A" (approved) or "branch B" (refused). Without an answer this stage does not start (P6). Needs stages 02, 03 and 06.

Release-note rule for both branches: this stage changes no VPS env and no deploy (P1, P5).

## Branch A — OpenAI approved the EU project

### Step A1 — Check the endpoint

**Goal.** The EU project answers with the production model (Not verified, plan).

**Setup.** The owner wrote `~/.config/email-assistant/openai-eu.env` with `OPENAI_API_KEY` (a key of the EU project) and `OPENAI_BASE_URL=https://eu.api.openai.com/v1` (D11). If the file is missing, stop and report "O3 file missing". Load it in the run shell only: `set -a; . ~/.config/email-assistant/openai-eu.env; set +a`. Never `cat`, `echo` or log it; never copy it into the worktree.

**Test.**
1. `bun run llm:check` (with the file loaded) prints `endpoint=eu host=eu.api.openai.com` and an ok answer for the classifier role. A config error (401, 403, 404) is a stop: report the code and the model; do not retry with another model.

**Done when.** Case 1 holds.

### Step A2 — The EU holdout run and the price

**Goal.** EU evidence for the production model (PD-110: every new endpoint passes the gate; D8).

**Command** (file loaded, as in A1): `bun run eval --sim lab-01 --part holdout --provider openai --model gpt-6-luna --reasoning-effort none --out evals/results/<date>-sim-lab-01-holdout-gpt-6-luna-eu-<prompt>.md` (`<prompt>` and no prompt flags as in stage 05; defaults: concurrency 8, rpm 240, cap $1; expected about $0.30). Long run: `nohup`, poll, resume the same way.

**Price.** Read OpenAI's pricing page for regional processing. Replace the D7 EU row of `gpt-6-luna` with the page's numbers, the page URL as `source` and today as `checked`. If the page shows no regional price, keep the 1.10× row and say so. Update the cost tests of stage 03 to the new numbers. If the run line does not print `endpoint=eu`, stop: the env file did not load.

**Test.**
1. Gate file `classifier-<production promptVersion>-gpt-6-luna-none-lab-01-v1-eu.json` exists (v2 now), parses, `endpoint` `eu`, `promptParts` as production.
2. The report has `endpoint=eu host=eu.api.openai.com` and no case id (the grep of stage 05).
3. In the final message: per category go or no-go next to the standard-endpoint gate file of the same prompt version. A difference larger than 2 points of precision in any category is named (same model, other region).

**Done when.** Cases 1–3 hold; the run cost is in the final message.

### Step A3 — Docs

**Files.** ADR 0035 (decision 6 resolved: "OpenAI approved on <date>; EU endpoint verified, gate file <name>"; status accepted for all decisions; decision 1 keeps the stage 06 wording, P1); `docs/capabilities/triage.md` and `measurement.md` (EU rows); `docs/architecture.md` §6.3 (EU processing is an endpoint option, verified; this install still runs the US API for the owner's pilot, PD-101); `.env.example` (EU line, "needs a key of the EU project"); `docs/own-model.md` (link). If `packages/core/src/legal/subprocessors.ts` exists (F107 landed): the `openai` row's location says the region follows `OPENAI_BASE_URL` (D14).

**Done when.** No page says "EU endpoint planned" any more; no page says this install processes in the EU.

## Branch B — OpenAI refused, or approved only without ZDR or MAM

### Step B1 — Record the fallback

**Goal.** The privacy story stays true (PD-110 fallback; ADR 0035 decision 6).

**Files.** ADR 0035: a dated amendment ("<date>: OpenAI refused the EU approval: <reason as the owner gave it>. Fallback: Vertex AI EU, F076. The EU code path of F111 stays; it is unused."); `docs/architecture.md` §6.3 and `docs/capabilities/triage.md`: EU processing is "planned through Vertex AI EU (F076)"; `.env.example`: the EU line says "needs an approved OpenAI EU project".

**Done when.** No page claims EU processing. The final message asks the coordinator to unpark F076 on the board (an edit outside this ticket).

## Proof

Branch A: the Proof of `plan.md` with `NN` = `07` (the price row changes code). Branch B (docs only):

```
mkdir -p /tmp/f111-s07 && bun run lint > /tmp/f111-s07/lint.log 2>&1 && echo PROOF_OK
```
