# F151 stage 04 — Demo command and server env `[risky]`

Landed: `1377e28f9`.

Needs stage 01: `buildReplayTable`, `startReplayServer`. Needs stage 02: `planDemoRun`, `demoGateCopy`. May run next to 03.

Part of [`../plan.md`](../plan.md). Decisions P3, P4, D3, D4, D7, D11. Risk: a wrong env sends demo mail to a paid model.

## Goal

On the demo source, `demo:record` checks the seed, writes the gate copy, starts the replay server, and starts the servers with an env that can reach no model but the replay. The setup off camera is stage 05; the eight steps are stage 06.

## Interfaces (stages 05 and 06 use these)

In `apps/web/e2e/lib/demo/`:
- `demoServerEnv(base, opts: { replayPort: number; model: string; gateDir: string; sendTestAddress: string }): Record<string, string>` (pure): on top of `e2eEnv()`: `TRIAGE_LLM_SCOPE=synthetic`, `LLM_PROVIDER=openai`, `OPENAI_BASE_URL=http://127.0.0.1:<port>/v1`, `OPENAI_OWN_MODEL=<model>`, `OPENAI_OWN_API_KEY=""`, `GATE_EVIDENCE_DIR=<gateDir>`, `SEND_TEST_ADDRESSES=<address>`, `MAIL_SYNC_EVERY_MIN=2`.
- `assertLoopbackLlm(env)`: builds the role table the server builds (`loadConfig`, `llmRoleTable`) and throws `demo_llm_not_loopback` unless `TRIAGE_LLM_SCOPE` is `synthetic` and every role row is provider `openai`, endpoint `own`, host `127.0.0.1`, `::1` or `localhost`.
- `DEMO_WAIT_LIMITS_MS` (D7): `firstSync` 3 min, `shadowTriaged` 3 min, `historyDone` 8 min, `afterTap` 4 min, `delegationSent` 2 min.
- `demoTestTimeoutMs()`: the sum of `DEMO_WAIT_LIMITS_MS`, the planned step seconds and 5 min.
- Work folder files: `demo-plan.json` (the `DemoRunPlan`), `gate/<fileName>`. Env to the Playwright child: `DEMO_PLAN_FILE`, `DEMO_REPLAY_PORT`, `DEMO_GATE_DIR`.

## Step 1 — the command (`record.ts`), before Playwright

Demo source, each refusal exit 1 before the demo DB changes: the existing preflight; parse the seed; `planDemoRun` with the production classifier prompt from the registry (print the refusal code); write the gate copy; `startReplayServer` (port 0); write `demo-plan.json`. Then the existing reset, migrate and Playwright run. After Playwright, also on failure: print `demo_replay hits=<n> misses=<n>` and `demo_gate final|provisional`, stop the server. Exit 1 `demo_replay_miss <n>` when misses > 0, and exit 1 `demo_replay_unused` when hits is 0. Stage 06 prints its upload line before these exits.

## Step 2 — the server env (`demo.config.ts`)

Demo source only: `demoServerEnv` over `e2eEnv()`, then `assertLoopbackLlm` right before the servers start. `SEND_TEST_ADDRESSES` is the plan's delegation address: the step-6 send goes to the dev GreenMail. The test timeout is `demoTestTimeoutMs()` (D7 budget; the e2e source keeps 10 min). The e2e source env does not change.

## Decisions

- The replay server lives in the `record.ts` process: its port must exist before the server env, and its stats are read after Playwright.
- The developer `.env` reaches the server through `runEnv()`; `assertLoopbackLlm` is the guard against any key in it.
- The longer timeout is part of the D7 budget, not a fix for a slow test.

## Test (`apps/web/e2e/lib/demo/*.test.ts`)

1. `demoServerEnv` over a base with `TRIAGE_LLM_SCOPE: "off"` and `MAIL_SYNC_EVERY_MIN: "5"`, port 41234, model `gpt-6-luna` → the eight keys above with these values (one `toEqual` on them).
2. `assertLoopbackLlm` (`test.each`): the env of test 1 → ok; base URL `https://api.openai.com/v1` → throws; `http://10.0.0.5:1/v1` → throws; scope `all` → throws; `LLM_PROVIDER: "deepseek"` → throws.
3. Gate match: write `demoGateCopy` of a v2-shaped provisional file (`info` go at 0.95) to a temp folder; `globalEvidenceFor(loadGateEvidence(dir), runningEvidenceKey(<role table of the env of test 1>))` gives `go` for `info` and a non-provisional file. With the copy's host changed to `127.0.0.2` → `no_global`.
4. `demoTestTimeoutMs()` → 1,616,000 (20 min of waits, 116 s of steps, 5 min).

Break check: drop the provider check from `assertLoopbackLlm`; test 2 (deepseek) fails.

## Done when

- Tests 1–4 pass.
- On the e2e source the command starts no replay server and writes no plan file.
- Proof: last line of `bun run check:job`.

## Out of scope

- The setup off camera and mail delivery (stage 05). The eight steps (stage 06). Product code.
