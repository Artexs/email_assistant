# F090 · LLM roles: plan

> **Status 2026-11-13 — planned.** Six stages written; cold review 1 (FAIL: 2 blocking, 8 notes) filed as `plan-review-1.md`; both blocking findings and the notes are fixed or answered (§ "Cold review"). Builds after F086 is in `done/`. Nothing is built yet. Ticket: [ticket.md](ticket.md). Open defaults for the owner: [questions.md](questions.md).

## Planning progress

- [x] Collect: ticket, plan input, review §3.6, `07-foundation-plan.md`, ADR 0015, ADR 0033, PD-025/026/059, the F086 and F087 plans, the code of `platform/llm`, `platform/config.ts`, `modules/triage`, `modules/audit`, the scripts and every test that fakes the LLM client.
- [x] Facts checked (probes P1–P4 in `.probe-f090/`, deleted before the commit).
- [x] Decisions D8–D28 (D11 and D17 changed after cold review 1).
- [x] stage-01-role-table [written]
- [x] stage-02-role-client [written]
- [x] stage-03-callers [written]
- [x] stage-04-audit-and-registry [written]
- [x] stage-05-tools [written]
- [x] stage-06-standards [written]
- [x] Cold review 1 (`plan-review-1.md`), findings handled in § "Cold review".

## Input

### Plan input of 2026-11-13, word for word (source: architecture review §3.6)

> Written 2026-11-13 from the architecture review §3.6. Input of the `plan-task` session. Ticket: [ticket.md](ticket.md). Runs after F086; no migration; safe next to any job except one that edits `platform/config.ts` at the same time (F087, F089 touch it: serialize the config stage).

Facts (2026-11-13), as written:

- `platform/llm/client.ts`: `LlmClient { classifierModel; classify<T>({ schema, system, prompt, model? }) }`; one rate limiter per client; `withTimeout`; `parseOutput` with Zod; errors through `provider.classifyError`.
- `platform/llm/providers/index.ts`: `llmProviders = { gemini, openai }` with `createGenerate({ apiKey, reasoningEffort })` and `classifyError`. ESLint keeps each SDK in its file.
- `platform/config.ts`: `LLM_PROVIDER`, per provider `*_API_KEY`, `*_MODEL`, `*_MODEL_CLASSIFIER`, `*_TIMEOUT_MS`, `*_RPM`, `OPENAI_REASONING_EFFORT`; `llmSettings(config)` picks one.
- `main.ts` builds one client and passes it to `createTriageJob`; `triage/classifier.ts` calls `llm.classify` and returns `promptVersion` from `prompts/classifier-v2.ts`.
- The `llm.call` audit row holds `reason_code` (outcome) and `data` (model, tokens, latency); `triage_results` holds `model`, `prompt_version`, tokens, latency.
- The daily cap counts `llm.call` rows per mailbox per quota day (`countLlmCallsSince`).

Design decisions, as written:

- **D1 Roles.** `LlmRole = "classifier" | "judge" | "drafter" | "extractor" | "escalation"` in `packages/core/src/llm-roles.ts` (names only, no I/O). Unknown roles are a type error.
- **D2 Role table in config.** For each role, optional env keys `LLM_<ROLE>_PROVIDER`, `LLM_<ROLE>_MODEL`, `LLM_<ROLE>_TIMEOUT_MS`, `LLM_<ROLE>_RPM`, `LLM_<ROLE>_REASONING`; a missing key falls back to the classifier's (today's `LLM_PROVIDER` and `*_MODEL_CLASSIFIER`, which keep their names so the VPS `.env` does not change). `llmSettings(config)` returns `Record<LlmRole, RoleSettings>`. The key of the provider comes from the provider's own `*_API_KEY`.
- **D3 One client, many roles.** `createLlmClient({ roles })` builds one `generate` function and one rate limiter per provider (not per role: the provider's rate limit is shared), and exposes `generate<T>({ role, schema, system, prompt })` and `modelOf(role)`. `classify` becomes `generate` with `role: "classifier"`; keep a deprecated alias for one stage, then remove.
- **D4 Usage and audit.** `LlmUsage` gains `role` and `promptVersion`; the triage service writes both into the `llm.call` audit data; `triage_results.prompt_version` stays. The cap query stays per mailbox; a per-role count helper (`countLlmCallsSince(…, { role })`) exists for E6a's 80 % rule.
- **D5 Prompt registry.** `modules/triage/prompts/index.ts` (later `platform/llm/prompts/` when a second module has prompts): `prompts = { classifier: { version: "classifier-v2", buildSystem, buildUser } }`; a unit test checks that every role in use has an entry and that `PROMPT_VERSION` equals the file name.
- **D6 Tools.** `llm:check --role` (default `classifier`); `eval` passes the role and writes it in the report header.
- **D7 Standard.** `docs/code-patterns.md` § Side effects: "An LLM call names a role; the role table decides provider and model; the audit row carries role and prompt version; a prompt or model change of any role runs the eval gate of PD-025."

Stages and done-when of the input, as written:

> 1. **Roles and the client.** Files: `packages/core/src/llm-roles.ts`, `platform/llm/client.ts` (+ test), `platform/llm/index.ts`, `platform/config.ts` (`llmSettings` by role, `.env.example`), `main.ts`, `scripts/job-run.ts`. Tests: same request for the classifier; a second role on another provider with fakes.
> 2. **Usage, audit, tools.** Files: `triage/classifier.ts`, `triage/service.ts`, `audit` data shape, `scripts/llm-check.ts`, `triage/eval.ts`, `eval-report.ts`; integration test for the audit row fields.
> 3. **Prompt registry and docs.** Files: `triage/prompts/index.ts` (+ test), `docs/code-patterns.md`, `.agents/limen/styleguide.md`, `docs/architecture.md` §6.3, ADR 0015 (amended: roles).
>
> Parallel: stage 1 first; stages 2 and 3 at once after it.
>
> - The five acceptance lines hold.
> - `bun run eval --provider openai --model gpt-6-luna --per-category 3` (or the cheapest smoke the owner allows) runs through the new path and reports the role.

Owner decisions that bind this plan: ADR 0015 (provider switch, no automatic fallback), PD-025 (eval gate for every prompt or model change), PD-026 (the judge is another model family than the drafter: two providers at once), PD-059 (M7 counts all LLM calls). The owner answered the product questions before this job; this plan does not reopen them.

### Design decisions of this plan (D8–D28)

D1–D7 stay. These decisions make them exact after the fact checks. "Default, owner to confirm" marks a small question that is also in [questions.md](questions.md); the stages do not change with its answer.

- **D8 The table holds roles and providers.** `llmRoleTable(config, overrides?)` in `platform/config.ts` returns `LlmRoleTable = { roles: Record<LlmRole, LlmRoleSettings>; providers: Record<LlmProviderId, LlmProviderSettings> }`. A role row is `{ provider, model, timeoutMs, rpm: number | null, reasoningEffort: string | null }`; a provider row is `{ apiKeyName, apiKey, rpm }`. The types live in `platform/llm/settings.ts`, so the client does not import the config. Reason: D3's shared provider limiter and D2's provider key need the provider rows. Rejected: `Record<LlmRole, RoleSettings>` alone (each role row would copy the key and the provider rpm). The old `llmSettings` stays until stage 5 (D16).
- **D9 The classifier keeps the provider keys.** The classifier row reads only today's keys: `LLM_PROVIDER`, that provider's `*_MODEL_CLASSIFIER`, `*_TIMEOUT_MS` and effort (`OPENAI_REASONING_EFFORT`; Gemini has none). It has no `LLM_CLASSIFIER_*` keys and no own rpm. The other four roles get the five D2 keys each (20 keys). Reason: one key per setting, and the VPS `.env` does not change. Default, owner to confirm (Q1).
- **D10 Fallback rule.** A missing key of a role takes the classifier row's value when the role uses the classifier's provider, else the value of its own provider's keys (`*_MODEL_CLASSIFIER`, `*_TIMEOUT_MS`, the effort default). A missing `LLM_<ROLE>_RPM` means no role limiter. Reason: a model id of one provider is not valid on the other one. An empty value counts as missing (the repo's `emptyAsUndefined` rule).
- **D11 Start checks.** `loadConfig` refuses: a set `LLM_<ROLE>_PROVIDER` whose provider key is empty (`ConfigError` names the key, for example `GEMINI_API_KEY`); `LLM_<ROLE>_REASONING` when the role's provider takes no effort (Gemini); a bad value of any role key. Also refused: a set `LLM_<ROLE>_MODEL` without `LLM_<ROLE>_PROVIDER` (`ConfigError` names `LLM_<ROLE>_PROVIDER`), because a model id belongs to one provider and would otherwise follow a later `LLM_PROVIDER` switch (cold review N3). The classifier key rule stays as today (needed when `TRIAGE_LLM_SCOPE` is not `off`). Reason: a role that points at a provider without a key, or a model at the wrong provider, fails loud at start, not on the first call of a later epic. Default, owner to confirm (Q2).
- **D12 Two limiter levels.** One limiter per provider at its `*_RPM` (D3: the provider's limit is shared by all roles), plus one limiter per role when `LLM_<ROLE>_RPM` is set (D2). A call waits for its role limiter first, then for the provider limiter. Reason: D2 and D3 both hold; the role rpm caps the share of one role.
- **D13 One generate per provider and effort, built at the first call.** The client keeps one `GenerateFn` per `(provider, reasoningEffort)` pair; the provider interface `createGenerate({ apiKey, reasoningEffort })` does not change. A role whose provider has no key fails at call time with `LlmConfigError("missing_key")` (a new `ConfigCode`), so the triage pause handles it like a bad key. Rejected: the effort in each `GenerateRequest` (it changes both adapters and the OpenAI snapshot test, for no behaviour gain). Note: today the SDK client is built at start; after this stage it is built at the first call of the provider.
- **D14 The call names its prompt version.** `generate<T, R extends LlmRole>({ role: R, promptVersion: PromptVersion<NoInfer<R>>, schema, system, prompt, model? })` with `PromptVersion<R> = \`${R}-v${number}\`` (core). A version of another role, or an unknown role, is a type error (probe P2). Reason: `LlmUsage` must carry the version (D4), and `platform/llm` cannot import a module's registry (F086 layer rule: platform imports no module). `model?` stays for `bun run eval --model` only.
- **D15 Usage.** `LlmUsage = { role, promptVersion, model, tokensIn, tokensOut, latencyMs }`. The client's two debug log lines add `role=<role>`; they never hold the prompt, the answer or the key (the existing marker tests stay).
- **D16 Expand, then contract.** Stage 2 adds `createRoleLlmClient` beside the old `createLlmClient`; the old function becomes a thin wrapper over the new one (the deprecated alias of D3). At stage 2 every old test, the OpenAI snapshot and every caller run unchanged through the new code: that is the proof of "the same request". Stage 3 moves every caller to `generate`, removes the wrapper, and renames `createRoleLlmClient` → `createLlmClient`, `RoleLlmClient` → `LlmClient`, `LlmCallUsage` → `LlmUsage`. Stage 5 removes the old `llmSettings`.
- **D17 "Pass unchanged" means the cases and assertions.** The interface changes, so each test file's fake LLM client and its usage fixtures change shape (`modelOf`, `generate`, usage with `role` and `promptVersion`). The test names, inputs and assertions stay. A shared usage constant in a test file is test data: it gains `role: "classifier", promptVersion: "classifier-v2"`, and the fake returns it unchanged, so `classifier.test.ts:185` (`expect(result.usage).toEqual(usage)`) passes as it is (cold review B2). One intended assertion change: stage 4 adds `role: "classifier"` to the expected `llm.call` data in `triage-service.test.ts`. Default, owner to confirm (Q3).
- **D18 A test helper for a fixed client.** `createFixedLlmClient(generate, opts)` in `platform/llm/testing.ts` (stage 3) builds a client whose every role calls one `GenerateFn` with the provider's error rules. Tests use it instead of copying a role table. Production code never imports it.
- **D19 Every role has a schema.** `generate` always takes a Zod schema (vision: "A Zod schema checks every LLM answer"). A free-text role (the drafter) puts its text into a schema field; ADR 0033 already has `no_draft` with a reason code. No `generate` without a schema.
- **D20 One writer of `llm.call` rows.** `recordLlmCall(db, ctx, record)` in `modules/audit` writes every `llm.call` row with data `{ mailbox_id, role, model, prompt_version, tokens_in, tokens_out, latency_ms }` and `reason_code` = `ok` or the LLM error code. The triage service uses it for the success row and the error row. In the error row, role and version come from the classifier's registry entry and the model from `modelOf("classifier")`, as today.
- **D21 Count per role.** `countLlmCallsSince(db, ctx, mailboxId, since, opts?: { role?: LlmRole })`. Without a role it counts all rows (the triage cap, unchanged, D4). With `classifier` it also counts rows that have no `role` key: every row before F090 is a classifier call. With another role it counts `data->>'role' = role`.
- **D22 Registry shape and test.** `modules/triage/prompts/index.ts` exports `prompts` (a typed record `{ [R in LlmRole]?: PromptEntry<R> }`; `classifier` → `classifier-v2` with `buildSystem`, `buildUser`) and `rolesWithoutPrompt = { judge: "E2a", drafter: "E6a", extractor: "E5b", escalation: "E3b" }` (the epic that adds each prompt, review §3.6). The unit test fails when a role is in both or in neither; when an entry's key, role and version prefix differ; when its `<version>.ts` file does not exist or its `PROMPT_VERSION` differs from the file name; when any `<role>-v<n>.ts` file in `prompts/` has another `PROMPT_VERSION`; and when module code outside `prompts/` (no tests) holds a `promptVersion: "…"` literal or a `role: "<role>"` literal of a role without an entry. `classifier.ts` and `service.ts` take role, version and builders from `prompts.classifier`. `classifier-v1.ts` stays as history, outside the registry. This is the review's "registries over if-chains" standard (F086 stage 5).
- **D23 `llm:check --role <role>`** (default `classifier`). For every role: one small greeting call on the role's row (its provider, model, effort), with the version `<role>-v0` (a check prompt; `llm:check` writes no DB row). For `classifier` also the triage check and `--delegates` as today. `--delegates` with another role is a usage error. `--provider` changes the chosen role's provider (D8 override). "That role's schema" (acceptance) is the greeting schema until the role has a prompt; the epic that adds the prompt adds its sample check. Default, owner to confirm (Q4).
- **D24 Eval records the role.** Both reports (cases and `--real`) get `role` and the header line `- role: classifier`. `eval` gets no `--role` flag: only the classifier has an eval set; E2a adds role sets. The state file name stays (the version already names the role). `CaseResult.usage` keeps only model, tokens and latency, so state files of earlier runs still load. Default, owner to confirm (Q5).
- **D25 The unused writer keys go.** `GEMINI_MODEL`, `OPENAI_MODEL` and `writerModel` are read by no code (ADR 0015's writer role was never built; S4 drafts are templates). The drafter is the writer now (`LLM_DRAFTER_MODEL`). Stage 5 removes them from the schema, `.env.example` and the docs. A `.env` that still sets them loads (Zod drops unknown keys). Default, owner to confirm (Q6).
- **D26 Log form.** New and changed log lines keep the `createLog` form of today. If F089 (structured logs) has landed when a stage starts, follow `docs/code-patterns.md` § Style as it stands then, and say so in the final message.
- **D27 Six stages, not three.** The expand-contract order (D16) and the stage size of about 300 lines need six. Stage 3 is about 350 lines, most of them a mechanical change of test fakes.
- **D28 No eval gate run is needed for F090 itself.** The classifier prompt text, the model and the request do not change (acceptance 1, probes P2 and P3); PD-025 applies to a prompt or model change. The owner smoke (U2) proves the new path on the real provider.

A gap or a deviation that a worker finds is a question in its final message, not a choice. The coordinator decides from this "Input" or asks the owner.

## Differences found at collect (2026-11-13)

- The `llm.call` row already holds `prompt_version` (`triage/service.ts:508`, `:530`). Only `role` is new in the row.
- `triage-service.test.ts:331` asserts the whole `llm.call` data with `toEqual`; adding `role` changes that one expectation (D17).
- `classifier.test.ts:190` asserts that `classifyEmail` passes a request model; `eval` uses it. `model?` stays on `generate` (D14).
- `LlmSettings.writerModel` and `classifierModel(config)` are used only in `config.test.ts` (D25).
- The plan input put stages 2 and 3 in parallel. They both change `triage/classifier.ts` and `triage/service.ts`, so this plan runs all stages in order.

## Facts checked (2026-11-13, at commit `c554497`)

- **P1 (stage 1 code).** In a copy of the repo with the main checkout's `node_modules`: the role keys of D9 built from `llmRoles` keep their static types (`config.LLM_JUDGE_PROVIDER` is `"gemini" | "openai" | undefined`; `config.LLM_CLASSIFIER_MODEL` is a type error). The ten `llmRoleTable` cases of stage 1 (case 10, the model-without-provider check, added after cold review 1) and the three core cases pass; `tsc --noEmit` passes; ESLint reports only Prettier fixes.
- **P2 (stage 2 code).** With `createRoleLlmClient` and the old `createLlmClient` as a wrapper: the 96 existing tests of `platform/llm` (client, Gemini, OpenAI with its snapshot) pass with no change; the ten new cases of stage 2 pass. Without `NoInfer` the "version of another role" case compiles (TypeScript infers `R` from both fields), so `NoInfer` is required. TypeScript 5.9.3, Zod 4.6.7 (main checkout `node_modules`).
- **P3 (stage 3 shape).** After the rename: the port of `client.test.ts` changes 79 lines, `openai.test.ts` 44. The callers to move: `main.ts`, `scripts/eval.ts`, `scripts/llm-check.ts`, `triage/classifier.ts`, `triage/service.ts`, `triage/eval.ts` (`CaseResult.usage`), and the fakes in `classifier.test.ts`, `eval.test.ts`, `eval-report.test.ts`, `actions-send.test.ts`, `scope-two-orgs.test.ts`, `triage-job.test.ts`, `triage-logs.test.ts`, `triage-service.test.ts` (also its `decision()` usage fixture) and `tools/fake-telegram/test/setup.ts`. Source: a repo-wide grep for `classifierModel`, `.classify(`, `LlmClient`, `createLlmClient`, `LlmUsage` (the probe's `tsc` covered only `apps/server`; cold review B1 found the `tools/` fake). `tsc` does not report `actions-send.test.ts` (its fake is cast `as unknown as LlmClient`).
- **P4 (types).** `` `${role}-v0` `` with `role: LlmRole` fits `PromptVersion<NoInfer<R>>`, also through a generic helper `checkVersion<R>(role: R): PromptVersion<R>`.
- Old `llm.call` rows have no `role` key (`triage/service.ts:497–533`); `countLlmCallsSince` filters by org, event, `data->>'mailbox_id'` and time (`audit/repo.ts:131`).
- `deploy/compose.yaml` loads the app env with `env_file: ../.env`: new keys need no compose change.
- No code maps an LLM error code to a text (`grep` for `http_400_key`, `schema_not_strict` outside `platform/llm`): a new `missing_key` code needs no text.
- `bunfig.toml` preloads `apps/server/test/preload.ts` for every `bun test`; it does not touch LLM settings.
- `scripts/triage-cost.ts` reads `triage_results`, not `llm.call` data; it needs no change.

## Not verified

- The new path against the real OpenAI and Gemini APIs. Owner steps U1 and U2 at checkpoint 1 check it.
- Whether F089 stage 2 converts the two log calls of `platform/llm/client.ts`. The coordinator keeps F089 stage 2 and F090 stages 2–3 apart (ticket § Sequenced); D26 covers the order.
- The F086 border lint (not landed) on the new files `platform/llm/settings.ts`, `platform/llm/testing.ts` and `modules/triage/prompts/index.ts`. They add no cross-module edge (`audit` → `@ea/core` only; triage already imports `audit`). Each stage's `bun run lint` proves it; a lint error there is a question for the coordinator, not a reason to move code.

## Done when

1. `generate` for `classifier` sends the same request and writes the same `triage_results` rows as `classify` did. Shown by: stage 2 (the old `platform/llm` tests and the OpenAI snapshot pass unchanged through the new client), stage 1 test 1 (the classifier row equals the old settings), and stage 3 (`classifier.test.ts`, `triage-service.test.ts`, `triage-job.test.ts` pass with their assertions unchanged, D17); `classify` is removed at stage 3.
2. A second role on another provider uses that provider's `createGenerate`, its key, its own limiter and its timeout. Shown by: `platform/llm/client-roles.test.ts` cases 2–6 (stage 2).
3. Every `llm.call` row and every `LlmUsage` carries `role` and `prompt_version`. Shown by: `client-roles.test.ts` case 1 (stage 2), `triage-service.test.ts` and `rules-audit-repo.test.ts` (stage 4).
4. `bun run llm:check --role <role>` calls that role's provider and model; `bun run eval` writes the role and the prompt version in its report. Shown by: `scripts/llm-check-args.test.ts` case 5 and `eval-report.test.ts` (stage 5); owner steps U1, U2.
5. The SDK-import lint still holds; `docs/code-patterns.md` has the role rule and the registry rule. Shown by: `bun run lint` at each stage; stage 6 diff.

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, the ticket, this file and your stage file first. Build only your stage.
- The classifier request must not change: same model, system text, user text, JSON schema, timeout, effort and rate. Never edit `prompts/classifier-v2.ts` text or a provider adapter's request code. A change there needs the eval gate (PD-025).
- A stage that changes a type fixes every caller and every test in the same stage, so lint, typecheck and all tests pass at its commit.
- Format only the files of your stage: `bunx prettier --write <files>`. Never the whole repo (S2 incident: a builder ran the repo-wide formatter).
- No temporary file inside the worktree: `bun run lint` lints every `.ts` file. Use `/tmp/f090-sNN/`.
- Logs, errors, test names and commit messages hold role names, model ids, codes, counts and ids only. Never a prompt, an answer, an API key or a mail text. Errors go through `describeError`. The marker tests (`MARKER-PROMPT`, `MARKER-KEY`, `MARKER-BODY`) stay green.
- Never read or print `.env`. Tests build config from literal env objects.
- Comments in new or changed lines state the rule in one sentence and may name an ADR or a ticket folder path. No bare codes (`D14`, `F090`) in code comments.
- Template literals for strings with variables; `const` / `let` only.
- No migration, no `bun.lock` change, no new dependency. Commit by explicit path (`git add <paths>`), never `git add -A`.
- `bun run test:int` runs in your own DB (the prepare script makes it); no lock. Do not run `bun run test:e2e`.
- Do not edit `spec/build.md`, `docs/product/stage-2/*` or another ticket.
- A gap or a deviation is a question in your final message, not a choice.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message list as proven only what a saved log shows.

Stages 1–5 (`NN` = the stage number):

```
mkdir -p /tmp/f090-sNN && bun run lint > /tmp/f090-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f090-sNN/typecheck.log 2>&1 && bun run test:unit > /tmp/f090-sNN/unit.log 2>&1 && bun run test:int > /tmp/f090-sNN/int.log 2>&1 && echo PROOF_OK
```

Stage 6 (docs only; `<files>` = the files the stage changed):

```
mkdir -p /tmp/f090-s06 && bunx prettier --check <files> > /tmp/f090-s06/prettier.log 2>&1 && bun run lint > /tmp/f090-s06/lint.log 2>&1 && bun run test:unit > /tmp/f090-s06/unit.log 2>&1 && echo PROOF_OK
```

While it works, a worker runs only the tests of the code it changed; the full chain runs once, as the proof.

## Owner checkpoints

- **Checkpoint 1 (after stage 5 lands, before stage 6):** the coordinator stops and sends the owner the review results of stages 2–4 and the owner steps U1 and U2. Reason: the new path has run only against fakes; the owner sees it answer from the real provider before the docs call it the standard. Stage 6 starts after the owner's go.

## Owner steps

| #   | Step | When |
| --- | --- | --- |
| U1  | In the main checkout (it reads the dev `.env`): `bun run llm:check` and `bun run llm:check --role judge`. Each prints one line per check with `role=`, `provider=`, `model=`, tokens and latency; exit 0. With no `LLM_JUDGE_*` keys the judge line shows the classifier's provider and model (D10). Cost: under $0.01. | checkpoint 1 |
| U2  | In the main checkout: `bun run eval --provider openai --model gpt-6-luna --per-category 3` (or a smaller run you allow). The report header has `- role: classifier` and `- prompt version: classifier-v2`. Cost: a few cents (about 40 calls of `gpt-6-luna`). | checkpoint 1 |
| U3  | VPS: nothing in this ticket. The next normal deploy carries F090; the VPS `.env` needs no change (D9, D25). | — |

## Review

- A review job before the land for stage 2 (the new client: request, limiter, timeout, errors), stage 3 (every caller moves; the production triage path) and stage 4 (the `llm.call` rows that the daily cap counts; the classifier's prompt wiring). Model: the board's reviewer (`spec/build.md` § TRACK: `claude-sonnet-5-5`, high). The reviewer may run `bun run test:int` at the candidate commit.
- Stages 1, 5 and 6 land on the worker's proof.

## Stages

| #   | Stage | Size | Mark |
| --- | --- | --- | --- |
| 01  | [Role names and the role table](stages/stage-01-role-table.md) — `llm-roles.ts` in core, `settings.ts` types, 20 role keys, `llmRoleTable`, `.env.example` | ~330 lines (half tests) | |
| 02  | [The role client beside the old one](stages/stage-02-role-client.md) — `createRoleLlmClient`, two limiter levels, `missing_key`, old client as a wrapper | ~330 lines (half tests) | `[risky]` LLM request |
| 03  | [Every caller on `generate`; the old client goes](stages/stage-03-callers.md) — rename, `testing.ts`, triage, `main.ts`, scripts, test fakes | ~350 lines (mostly mechanical) | `[risky]` production triage path |
| 04  | [Role in every `llm.call` row; the prompt registry](stages/stage-04-audit-and-registry.md) — `recordLlmCall`, count per role, `prompts/index.ts` | ~280 lines | `[risky]` cap data, prompt wiring |
| 05  | [Tools and cleanup](stages/stage-05-tools.md) — `llm:check --role`, eval role, old `llmSettings` and writer keys removed | ~250 lines | |
| 06  | [Standards and docs](stages/stage-06-standards.md) — code patterns, styleguide, architecture §6.3, ADR 0015 | ~80 lines | |

Order: 1 → 2 → 3 → 4 → 5 → checkpoint 1 → 6. No parallel stages: each stage needs the one before it (2 reads the table types of 1; 3 renames what 2 adds; 4 and 5 change files that 3 changes).

## How to run (coordinator)

1. Before the first spawn: F086 is in `spec/features/done/` and the owner gave the go for the foundation group (ticket § Sequenced). Move the ticket: `git mv spec/features/planned/F090-llm-roles spec/features/active/`, commit (the worktrees see only committed files).
2. Before stages 1 and 5 (they edit `platform/config.ts` and `.env.example`): no F087 stage 1 or 4 and no F089 stage that edits `platform/config.ts` is in build. Before stages 2 and 3: no F089 stage that converts `platform/` log calls is in build (F089 has no `stages/` yet; read its stage files for the content, not the number). Also not at the same time (shared files, cold review N4): F090 stage 3 and F087 stage 2 (`main.ts`); F090 stage 4 and F087 stage 3 (`modules/audit/repo.ts`); F090 stage 6 and F087 stage 6 or F086 stage 5 (`docs/code-patterns.md` § Side effects and the styleguide § Prefer). When one of them lands first, the other rebases before its proof.
3. Spawn one stage (`NN` = two digits, `<slug>` from the stage list):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "F090-sNN <slug> · F090" \
     "Implement F090 stage NN. Read spec/features/active/F090-llm-roles/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f090-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

4. When the job finishes: read its final message and `/tmp/f090-sNN/*.log`. For stages 2, 3 and 4, spawn the review job and wait for it; a finding → `limen continue <job-id> "<fix>"` with the same engine flags, then review again (at most 2 rounds, then the owner decides):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --review --detached --branch <B> --label "review s<NN> · F090" \
     "Review F090 stage NN on <B> against spec/features/active/F090-llm-roles/plan.md and stages/stage-NN-<slug>.md. Check that every numbered test exists and asserts what the stage says, that the classifier request (model, system, prompt, JSON schema, timeout, effort, rate) did not change, that no log line or error holds a prompt, an answer or a key, and every decision the stage cites. Quote file and line for each finding."
   ```

5. Land: `limen land <job-id> --yes --keep-open` (stage 6: without `--keep-open`; it closes the ticket). Drop the job DB from the main checkout: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop`.
6. Land stage N before you spawn stage N+1. After stage 5 lands, stop at checkpoint 1 (U1, U2); spawn stage 6 after the owner's go.
7. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass. A check with no proof at all → `limen continue`.

## Cold review

Review 1 ([plan-review-1.md](plan-review-1.md), job `2026-11-13-f090-plan-review-564c16e4`, Opus 5.5 high, candidate `f46f709`): FAIL, 2 blocking findings, 8 notes. It applied stages 1 and 2 in a scratch copy: stage 1 and 2 code compiles; the 211 old unit tests of `platform/llm` and triage pass unchanged through the stage 2 wrapper; the classifier request does not change (N7). Not run: `test:int` (no DB). What changed:

- B1 (stage 3 misses the fake in `tools/fake-telegram/test/setup.ts`): fixed. Stage 3 step 4 lists it, its check runs `bun test tools/fake-telegram/test` and greps `apps tools`; P3 now names its source (a repo-wide grep) and says that `tsc` does not report `actions-send.test.ts`.
- B2 (the stage 3 fake rule breaks `classifier.test.ts:185`): fixed. A shared usage constant gains `role` and `promptVersion` as test data and the fake returns it unchanged (stage 3 step 4, D17, Q3). No assertion changes.
- N1 (status contradiction): fixed in the status line, "Planning progress" and this section.
- N2 (stage 4 test 3 "has no `calls` variable"): rejected; the case already has `const calls = await llmRows(trx, emailId)` at `triage-service.test.ts:471`. Stage 4 now names those lines.
- N3 (a role model without its provider follows a later `LLM_PROVIDER` switch): fixed. D11 refuses `LLM_<ROLE>_MODEL` without `LLM_<ROLE>_PROVIDER`; stage 1 has the check, case 10, and the `.env.example` comment; cases 4 and 9 set the provider (probe: 10 pass).
- N4 (shared files with F087 that the gate does not cover): fixed in § How to run step 2 (no parallel run of those stage pairs; rebase before the proof).
- N5 (F089 stage numbers can change): fixed; the gate in `ticket.md` and § How to run names the F089 stage by its content.
- N6 (the `--real` report has no prompt version): answered. The acceptance line is met by the case run (`bun run eval`), whose report has both lines; the `--real` report gets `role`. A prompt-version count for `--real` needs a new query field and is left to E2a (D24). `ticket.md` Notes says so.
- N7 (request unchanged): no change needed.
- N8 (stage 3 has about 19 files): accepted; most edits are the same mechanical change.

## Log

- 2026-11-13: planned by a planner job (Opus 5.5) from the plan input; probes P1–P4.
- 2026-11-13: cold review 1 FAIL (B1, B2); both fixed, N3 adopted as a start check, N4/N5 gate wording, N2 rejected with a line reference.
