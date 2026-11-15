# F109 stage 12 — Escalation: trigger, prompt and eval path

Part of [`../plan.md`](../plan.md). Decisions P5, D15. Needs stage 11 (its ship decision fixes the base prompt). No real LLM run (a fake LLM in tests).

## Step 1 — Trigger and combine (core, pure)

**Interfaces (stage 14 uses them; keep them).** In `packages/core/src/triage/escalation.ts`:

```ts
export interface EscalationSignals { finalCategory: Category; reasonCode: string | null;
  noreply: boolean; isList: boolean; autoSubmitted: string | null; precedence: string | null; }
export function shouldEscalate(s: EscalationSignals): boolean;
export function escalationRecord(first: { category: Category; confidence: number; model: string; promptVersion: string }):
  { fromCategory: Category; fromConfidence: number; fromModel: string; fromPromptVersion: string };
```

**Decisions (D15).**

- Escalate when the final category of the first answer is `info`, `notification` or `spam` and the sender is a person: not `noreply`, not list mail, `autoSubmitted` null or `no`, `precedence` not `bulk`, `list` or `junk`.
- Escalate also on `unsure` from the model or from the threshold (`below_threshold`); never on `triage_error`, `llm_blocked` or a hard-rule result (`blocklist`).
- The mode (`shadow`, `assist`) and the `auto` switch do not matter: shadow results are the evidence of ADR 0028 and must equal what assist would do.
- The second call is an independent classification: the same input and schema, no word about the first answer (rejected: showing the first answer; it anchors the second model). Its category passes `decideCategory` with the same thresholds and wins.

**Test (unit).** 1. Table: `spam` + person → true; `spam` + `isList` → false; `notification` + `autoSubmitted: "auto-generated"` → false; `urgent` → false; `needs_reply` → false; `unsure` via `below_threshold` + list mail → true; `reasonCode: "triage_error"` → false; `reasonCode: "blocklist"` → false; `precedence: "bulk"` → false. 2. `escalationRecord` keeps all four fields.

## Step 2 — Prompt `escalation-v1` and the price

**Decisions.**

- `escalation-v1` uses the builders and the text of the production classifier prompt (after stage 11: `classifier-v3` with `CLASSIFIER_V3_PARTS`, or `classifier-v2`) with no text change. The registry entry names its base version. A change of the classifier pointer needs `escalation-v2` and its own gate. Register it in `prompts/index.ts`; remove `escalation` from `rolesWithoutPrompt`.
- Add `gpt-6.1-terra` to `llmPrices` (input, cached input, output per 1M tokens, source URL, checked date). Read the OpenAI pricing page; if it cannot be read, use $1.00 / $0.05 / $5.00 with `checked: "2026-11-13"` and say so in the final message (N2).

**Test.** 3. `escalation-v1` user prompt equals the base classifier prompt for a fixture (hash). 4. `llmPrices["gpt-6.1-terra"]` exists with a source and a date.

## Step 3 — `--escalate` in the sim eval

**Decisions.**

- `bun run eval --sim … --escalate [--escalation-model <id>] [--escalation-reasoning-effort <level>]` (review N13: without the flag the role row's effort applies, which falls back to the classifier's): after each first answer, `shouldEscalate` with the sim signals (`noreply` from the case, `isList`, `Auto-Submitted`, `Precedence` from `sim.headers`); a triggered case gets one call with the role `escalation` (provider and model from the role row, or `--escalation-model`); that answer is the case's final answer.
- Both calls count in the run cap and the month ledger; an escalation error stops the run like a classifier error; a resumed run keeps both answers in the state.
- Report section `## Escalation`: triggered count and share, changed answers (from → to counts), cost split (classifier, escalation), `K` (stage 09 definition) and `H` = truth `urgent`, `needs_reply` or `delegation` with a final `info`, `notification` or `spam`, each for the first answers alone and for the cascade. The main tables show the cascade.
- `--escalate` with a model without a price refuses to start.

**Test.** 5. Fake LLM, three cases (a person mail answered `spam` then `needs_reply`; a list mail answered `notification`; an `urgent`) → one escalation call, the first case final `needs_reply`, `H` first 1, cascade 0. 6. Args: `--escalation-model` or `--escalation-reasoning-effort` without `--escalate` → usage error. 7. A resumed state does not repeat a stored escalation call.

**Check.** The new unit tests, then the Proof.

**Done when.** Tests 1–7 pass; Proof `PROOF_OK`.

**Out of scope.** Real runs (stage 13), triage wiring (stage 14).
