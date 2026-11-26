# F173 plan — production may run on DeepSeek, and the papers name it

> **Status 2026-11-26 — planned, review 1 fixed.** Plan base: 13277b2d1. Three stages; no migration, no `bun.lock`.

## Input

Ticket (owner, 2026-11-26): "The owner decided (2026-11-26) that DeepSeek may serve production mail." "the two-owner steps are the DeepSeek terms check and the region answer, default "as listed by the provider"."

Coordinator task (2026-11-25): "plan the papers and the gate", no refusal, no legal block.

### Decisions

- **P1 DeepSeek is a production provider.** No refusal, no legal block, no extra consent. Its row is a normal sub-processor row like `openai`.
- **P2 The privacy page names the possible providers, not one.** "AI model" opens: this install uses one AI provider for every AI call, OpenAI, DeepSeek or Google Gemini; the column "Used when" shows the condition. Each OpenAI fact is marked "when the install uses OpenAI". Rejected: "This install uses DeepSeek" (false until O2, false if O2 does not happen); a runtime marker (new feature). Default, owner to confirm.
- **P3 Location = as listed by the provider:** "People's Republic of China", source the DeepSeek privacy policy (F1). The transfer mechanism stays the existing placeholder.
- **P4 No OpenAI claim carries over.** The papers do not say that DeepSeek does not train on API data, keeps no logs or obeys `store: false` (the shared adapter sends it; no claim). They hold `\<to confirm: DeepSeek API data use and retention>` until O1. They state the sourced term: the customer must inform its users (F2).
- **P5 DPIA.** New risk R11 "Mail text goes to an LLM provider in China (when the install uses DeepSeek)", medium, high; residual: no EU adequacy decision, mechanism placeholder. R1 says "OpenAI or Gemini". Rejected: widen R1 (hides the other transfer). Default, owner to confirm.
- **P6 Public docs site.** DeepSeek facts go to the "does not promise" section, next to "An install can use another AI provider": F1 and "this project has not checked whether DeepSeek trains on or keeps API data". Polish says the same.
- **P11 The public security page describes the default setup** (review 1 B1; keeps the owner rule of 2026-11-20). `DEFAULT_LLM_PROVIDER` and the row filter of `subprocessor-view.ts` stay, so the page shows no `deepseek` row. The claims `ai-provider-receives`, `ai-provider-reply-drafts`, `ai-provider-style-suggestion` say "The default setup uses OpenAI as the AI model" and cite a new ledger row (not the rewritten C030). Lands in stage 01 with C030. Rejected: list DeepSeek on the public page (re-opens the 2026-11-20 rule). Default, owner to confirm.
- **P7 One legal version.** Stage 01 appends one `TERMS_HISTORY` entry. Every member accepts the terms again at the next sign-in on the release that carries stage 01.
- **P8 Gate roles.** Classifier, drafter (holdout and reply injection set) and extractor get a sim gate run on DeepSeek. No judge run (it measures). No stylist run: P9 keeps `style_from_sent` off whatever the result (review note 2). The drafter runs use the tool default judge (DeepSeek `strong`, current judge prompt); the summary names judge model and prompt version. Rejected: the OpenAI judge (no OpenAI key in the dev `.env`). Default, owner to confirm.
- **P9 A gate result is a record, not code.** Classifier: see P9a. Drafter passes only with all three: holdout gate file `passed: true`; the injection set passes all cases; at most 2 holdout drafts hold a leaning sentence (switch rule, `reply-drafts.md` § Limits). Else `reply_drafts` stays off on a DeepSeek install. Extractor fails → `open_loops` off. `style_from_sent` stays off. Rejected: code that blocks a flag by gate result (scope).
- **P9a Classifier pass rule for O2** (review 1 B2). O2 happens only when the DeepSeek classifier gate file has 0 errors and its `go` set contains the `go` set of the running OpenAI file (`notification`, `spam`). Else the VPS stays on `openai`. Reason: the trust ladder reads the gate file of the running key; a smaller `go` set takes `auto` evidence away. Default, owner to confirm.
- **P10 Spend cap.** Classifier, drafter holdout, extractor: `--budget-usd 2` each; injection set `--budget-usd 1`. A run that stops at the cap (exit 4) is resumed once: the same command, no `--fresh`, same cap, so a role spends at most twice its cap. A second stop: "not run". Total at most $14; the spend ledger month cap ($20) also holds. Default, owner to confirm.
- **D1 Keep `realMail` and its guard.** `deepseekProvider.realMail` = `true` with the row; `outside-services.test.ts` case 1 ties row ⇔ flag. `checkRealMail` stays for a future provider with no row; its test injects the flag. Its message drops "is for dev, tests and evals" and says "has no sub-processor row, so TRIAGE_LLM_SCOPE=all is refused outside the sim stack" (review note 1). Rejected: remove the flag.
- **D2 `OPENAI_BASE_URL` still refuses the DeepSeek host.** New reason: the `deepseek` row owns the host, key and price rows; OpenAI identity headers must not reach it. The error text stays.
- **D3** `OUTSIDE_SERVICE_KEYS.DEEPSEEK_API_KEY` maps to `"deepseek"`.
- **D4 Row `deepseek`.** `name: "DeepSeek"`, `purpose` and `dataReceived` equal to `openai`, `location` per P3, `termsUrl` the F1 URL, `personalData: true`, `activeWhen: { kind: "llmProvider", provider: "deepseek" }`.
- **D5 Ledger.** New rows after the last C-number at `HEAD`. Stage 01 changes C030, C038, C042, C043, C182, C184 and adds the P11 row; stage 02 changes C209. Row-count pin and per-paper count table follow.
- **D6 Version entry.** The first commit that changes a digest input appends the entry; later commits re-digest that unlanded entry. If master gains a newer entry, move this one after it. Never edit a landed entry.
- **D7 Gate summary file.** `evals/results/deepseek-gate-lab-01.md`: one row per run: command, gate file or failing number, judge model and prompt version (drafter), flag decision. Classifier row: "go set: …; OpenAI go set: notification, spam; O2 yes/no".

## Facts checked (2026-11-26, at 13277b2d1)

- F1 `https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html`: "we directly collect, process and store your Personal Data in People's Republic of China". No sentence on API input training or retention.
- F2 `https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html` (effective 2026-04-29): PRC law; the customer must "inform and disclose to end users your personal information processing rules".
- The refusal is `checkRealMail` in `platform/config-llm.ts`; `start/triage.ts` passes `realMail` to the reply preview and the style suggestion.
- `legal-papers.test.ts` tests 2 and 2b fail once a `personalData: true` row is missing from record B (review 1 B4).
- `subprocessor-view.ts` shows only the default provider row (review 1 B1).
- `bun run eval` exit 4: "stopped at the budget cap or the error limit; run the same command again".

## Not verified

- Whether DeepSeek honours `store: false` or keeps API data: O1.

## Rules for every stage

- Plain technical English; the Polish text says the same facts. No new claim without a ledger row. No host, name or address beyond provider names and policy URLs (public repository).
- Never `bun run format` repo-wide.
- A gap or a deviation is a question in the final message.

## Proof

`mkdir -p /tmp/f173 && bun test apps/web/src/lib packages/core/src/legal packages/core/src/web apps/server/src/legal-papers.test.ts apps/server/src/legal-outside-calls.test.ts apps/server/src/trust-docs.test.ts apps/server/src/platform apps/docs/src > /tmp/f173/legal.log 2>&1 && bun run docs:build > /tmp/f173/docs.log 2>&1 && grep -q "claim_check ok" /tmp/f173/docs.log && bun run check:job`

Stage 03 has its own Done when.

## User checkpoints and user steps

- O1 (owner, record): read the DeepSeek terms for API data use and retention; a follow-up ticket replaces the P4 placeholder with a new legal version.
- O2 (coordinator, after the release that carries stages 01–02, record): set `LLM_PROVIDER=deepseek` and `DEEPSEEK_API_KEY` on the VPS only when P9a holds; apply P9 to the flags; run `bash deploy/check-server-env.sh` and read the start log.
- The release asks every member to accept the terms again (P7).

## Review

Stage 01 `[risky]` (privacy, config, Polish text): `claude-opus-5-5`. Stage 02 (DPIA, Polish docs text): `claude-opus-5-5`. Stage 03: none.

## Stages

- [ ] 01 `[risky]` row, config, privacy page, record B, claims, version, ledger — [stage-01](stages/stage-01-row-config-privacy.md)
- [ ] 02 DPIA, public page, ADR, capabilities, release note — [stage-02](stages/stage-02-papers-and-docs.md)
- [ ] 03 coordinator-only: DeepSeek gate runs and summary — [stage-03](stages/stage-03-gate-runs.md)

## How to run (coordinator)

01, then 02. Stage 03 runs next to both. Workers: board model, `--prepare 'bash scripts/limen-prepare.sh'`. `questions.md` lists the defaults.

## Planning progress

- Scouts: 0 (task forbade `limen wait`).
- Stages 01–03 [written]. Words: plan 1414; stages 700, 626, 552.

## Cold review

`plan-review-1.md` (`claude-opus-5-5`, stage 01 `[risky]`): FAIL, four blocking findings. All fixed (`review-fixes-1.md`). No second round.

## Log

- 2026-11-26 plan at `13277b2d1`; review 1 fixes.
