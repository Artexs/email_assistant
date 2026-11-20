# F151 stage 04 — Demo setup and server env `[risky]`

Needs stage 01: `buildReplayTable`, `startReplayServer`. Needs stage 02: `planDemoRun`, `demoGateCopy`, `DemoRunPlan`.

Part of [`../plan.md`](../plan.md). Decisions P1, P3, P4, D1, D3–D6. Risk: a wrong env sends demo mail to a paid model.

## Goal

On the demo source, `demo:record` checks the seed, starts the replay server and the servers with the replay env, and prepares the demo organization off camera. The eight steps are stage 05; until then the spec still throws `demo_source_recording_not_built`.

## Interfaces (stage 05 uses these)

- `demoServerEnv(base: Record<string, string>, opts: { replayPort: number; model: string; gateDir: string; sendTestAddress: string }): Record<string, string>` (pure, `apps/web/e2e/lib/demo/`): the D3 keys on top of `e2eEnv()`.
- `assertLoopbackLlm(env)`: throws `demo_llm_not_loopback` unless `OPENAI_BASE_URL` has host `127.0.0.1`, `::1` or `localhost`, and `TRIAGE_LLM_SCOPE` is `synthetic`.
- `demoMessage(mail: DemoMail, opts: { to: string; seq: number; runTag: string; date: Date }): string` (pure): the RFC 5322 text that the delivery sends.
- `shiftedDates(seedDates: Date[], now: Date): Date[]` (pure): D5.
- Files in the work folder: `demo-plan.json` (the `DemoRunPlan`), `gate/<copy>.json`. Env to the Playwright child: `DEMO_PLAN_FILE`, `DEMO_REPLAY_PORT`, `DEMO_GATE_DIR`.

## Step 1 — the command (`record.ts`), before Playwright

Order on the demo source, each refusal exit 1 before the demo DB changes: the existing preflight; parse the seed; `planDemoRun` with the production classifier prompt from the prompt registry (a refusal prints its code); `demoGateCopy` of the gate file for the plan's key into `<work>/gate/`; `startReplayServer` (port 0); write `demo-plan.json`. Then the existing DB reset, migrate and Playwright run. After Playwright, also on failure: read `stats()`, print `demo_replay hits=<n> misses=<n>`, stop the server. Misses above 0 is exit 1 `demo_replay_miss <n>`. Print `demo_gate final|provisional` from `sourceProvisional`.

## Step 2 — the server env (`demo.config.ts`)

On the demo source only: `demoServerEnv` over `e2eEnv()`, then `assertLoopbackLlm` right before the web servers start. `SEND_TEST_ADDRESSES` is the plan's delegation address, so the step-6 send goes to the dev GreenMail. The e2e source env does not change.

## Step 3 — the setup off camera (`global-setup.ts`, demo branch)

After the existing import (`demo-org-setup.ts`) and flags, in this order:

1. Flag `user_quiet_hours` on (the same `org-flag.ts` path as the other flags).
2. Link the owner to the fake Telegram chat `9_200_001` through the product link path (`telegram:link`, as the lab seed does). No chat message from the recording.
3. Sign in as the owner (API, off camera) and set quiet hours none: `PATCH /api/me/notify` with equal start and end.
4. Empty the GreenMail mailbox of B (INBOX and every other folder) through IMAP. A failure is `demo_mailbox_purge_failed`.
5. Deliver the history set to B by SMTP to GreenMail: `demoMessage` with `shiftedDates`, `seq` 1…n, `runTag` 4 hex per run.
6. Log `demo_setup_done history=<n>`.

No SQL; a step with no product path is a question.

## Decisions

- The replay server runs in the `record.ts` process: its port must exist before the server env, and its stats are read after Playwright.
- Mailbox A stays `paused`. The setup never changes its password or status.
- `create_draft` after "Turn on recommended": if the default switches leave it off, stage 05 turns it on off camera through the settings route. This stage only reports it in the final message.

## Test (`apps/web/e2e/lib/demo/*.test.ts`)

1. `demoServerEnv` over a base with `TRIAGE_LLM_SCOPE: "off"`, port 41234, model `gpt-6-luna` → `TRIAGE_LLM_SCOPE` `synthetic`, `OPENAI_BASE_URL` `http://127.0.0.1:41234/v1`, `OPENAI_OWN_MODEL` `gpt-6-luna`, `OPENAI_OWN_API_KEY` `""`, `LLM_PROVIDER` `openai`, `GATE_EVIDENCE_DIR` and `SEND_TEST_ADDRESSES` as given (one `toEqual` on these keys).
2. `assertLoopbackLlm` (`test.each`): `http://127.0.0.1:1/v1` ok; `http://localhost:1/v1` ok; `https://api.openai.com/v1` throws; `http://10.0.0.5:1/v1` throws; loopback with scope `all` throws.
3. `demoMessage` with seq 7, run tag `ab12`, date `2026-12-09T12:00:00Z` → headers `Message-ID: <demo-7.ab12@ea-seed.test>`, the seed From and Subject, `To: office@kordelan.test`, the RFC 5322 date; text null → empty body.
4. `shiftedDates([2026-11-23T08:00Z, 2026-11-27T09:00Z], 2026-12-10T12:00Z)` → `[2026-12-05T11:00Z, 2026-12-09T12:00Z]`.
5. The synthetic test: `demoMessage` output passes the product's synthetic Message-ID check (`mail/seed.ts`).

Break check: drop the scope check from `assertLoopbackLlm`; test 2 must fail.

## Done when

- Tests 1–5 pass.
- On the e2e source, `demo:record` behaves as before (no replay server, no plan file).
- Proof: last line of `bun run check:job`.

## Out of scope

- The eight steps and the waits (stage 05). Any change to the import or to product code.
