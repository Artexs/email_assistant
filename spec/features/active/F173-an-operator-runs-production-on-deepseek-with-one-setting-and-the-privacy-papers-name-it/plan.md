# F173 plan — production may run on DeepSeek, and the papers name it

> **Status 2026-11-26 — planned.** Plan base: 13277b2d1. Three stages; no migration, no `bun.lock`. Cold review not run (see § Cold review).

## Input

Ticket (owner, 2026-11-26): "The owner decided (2026-11-26) that DeepSeek may serve production mail." "the two-owner steps are the DeepSeek terms check and the region answer, default "as listed by the provider"."

Coordinator task (2026-11-25): "the owner states DeepSeek is fine for production; do not plan a refusal or a legal block, plan the papers and the gate."

### Decisions

- **P1 DeepSeek is a production provider.** No refusal, no legal block, no extra consent. Its row is a normal sub-processor row like `openai`.
- **P2 The pages name the possible providers, not one.** The privacy "AI model" part opens with: this install uses one AI provider for every AI call, OpenAI, DeepSeek or Google Gemini; the column "Used when" shows the condition. The OpenAI facts stay, each marked "when the install uses OpenAI". Rejected: "This install uses DeepSeek" (false until the VPS switch, and false if the classifier fails its gate); a runtime marker on the page (new feature). Default, owner to confirm.
- **P3 Location = as listed by the provider** (ticket default): "People's Republic of China", source the DeepSeek privacy policy, part "Where We Store Your Personal Data" (fact F1). The transfer mechanism stays the existing placeholder.
- **P4 No OpenAI claim carries over.** The papers do not say that DeepSeek does not train on API data, keeps no logs or obeys `store: false`. They hold `\<to confirm: DeepSeek API data use and retention>` until owner step O1. They state the one sourced term: the customer must inform its users (F2).
- **P5 DPIA.** A new risk R11 "Mail text goes to an LLM provider in China (when the install uses DeepSeek)", likelihood medium, severity high (as R1), residual: no EU adequacy decision for China, the mechanism is a placeholder. R1 says "OpenAI or Gemini". Rejected: widen R1 (it would hide the different transfer). Default, owner to confirm.
- **P6 Public docs site.** The security page part "Facts that come only from the AI provider" splits per provider: the OpenAI facts keep their links; DeepSeek adds F1 and "this project has not checked whether DeepSeek trains on or keeps API data". Polish says the same facts.
- **P7 One legal version.** Stage 01 appends one `TERMS_HISTORY` entry (`nextLegalVersion`, build day). Every member accepts the terms again at the next sign-in on the release that carries stage 01. The release note says so.
- **P8 Gate roles.** Classifier, drafter, extractor and stylist get a sim gate run on DeepSeek. The judge gets none: it is the measuring tool. The drafter run uses the tool default judge (DeepSeek `strong` tier, current judge prompt). Rejected: the OpenAI judge (the dev `.env` has no OpenAI key, F141 notes). Default, owner to confirm.
- **P9 A failed gate is a record, not code.** Classifier fails → the VPS stays on `openai` (O2 does not happen). Drafter fails → `reply_drafts` off for every organization on a DeepSeek install. Extractor fails → `open_loops` off. Stylist → `style_from_sent` stays off (its style gate already failed on OpenAI). Rejected: code that blocks a flag by gate result (scope).
- **P10 Spend cap.** Each gate run `--budget-usd 2`; at most $8 for stage 03. A run stopped by the cap is no result: one rerun at `--budget-usd 4`, else the role is "not run". Default, owner to confirm.
- **D1 Keep `realMail` and its guard.** `deepseekProvider.realMail` becomes `true` in the commit that adds the row; `outside-services.test.ts` case 1 ties row ⇔ flag. `checkRealMail` stays for a future provider with no row; its test gets the flag through an injected lookup, because no real provider has `false` any more. Rejected: remove the flag (a new provider could ship without a row).
- **D2 `OPENAI_BASE_URL` still refuses the DeepSeek host.** New reason in code comment and capability page: the `deepseek` row owns the fixed host, its own key and its price rows; OpenAI identity headers must not reach it. The error text stays.
- **D3** `OUTSIDE_SERVICE_KEYS.DEEPSEEK_API_KEY` maps to `"deepseek"`.
- **D4 Row `deepseek`.** `name: "DeepSeek"`, `purpose` and `dataReceived` equal to the `openai` row (same calls), `location` per P3, `termsUrl` the privacy policy URL of F1, `personalData: true`, `activeWhen: { kind: "llmProvider", provider: "deepseek" }`. A test pins `purpose` and `dataReceived` equal to `openai`.
- **D5 Ledger.** New rows after the last C-number at `HEAD` (C276 at plan base). Changed: C030, C038, C042, C043, C182, C184, C209 and the rows of every changed sentence. The pin in `apps/docs/src/security/claims.test.ts` follows.
- **D6 Version entry.** The first commit that changes a digest input appends the entry; later commits of stage 01 re-digest that unlanded entry. If master gains a newer entry, move this one after it with a fresh version. Never edit a landed entry.
- **D7 Gate summary file.** `evals/results/deepseek-gate-lab-01.md`: one row per role: command, gate file or failing number, flag decision (P9). Stage 02's release note links it; stage 03 writes it.

## Facts checked (2026-11-26, at 13277b2d1)

- F1 `https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html` (curl, read 2026-11-26): "we directly collect, process and store your Personal Data in People's Republic of China". No sentence on API input training or retention found.
- F2 `https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html` (release 2026-04-22, effective 2026-04-29): PRC law; the customer must "inform and disclose to end users your personal information processing rules" and have a legal basis.
- The refusal is `checkRealMail` in `apps/server/src/platform/config-llm.ts`, keyed on `realMail` of the registry row; `start/triage.ts` passes the same flag to the reply preview and the style suggestion.
- `deploy/check-server-env.sh` checks only database keys; no LLM check there. The VPS start fails in config, not there.
- Gate evidence of the trust ladder keys on the running classifier (`runningEvidenceKey`): a DeepSeek install without a DeepSeek classifier gate file has a closed evidence gate.
- `TERMS_HISTORY` ends at `2026-11-20.3`, in tag v0.5.0.

## Not verified

- Whether DeepSeek honours `store: false` or keeps API data: owner step O1.
- That the sim gate tools write a valid gate file for `provider: deepseek`: stage 03 runs them; a schema refusal is a stop and a question.

## Done when

The ticket Acceptance; each stage's Done when.

## Rules for every stage

- Plain technical English; the Polish text says the same facts. No new claim without a ledger row. No real host, name or address beyond provider names and policy URLs (public repository).
- Never `bun run format` repo-wide; format only the stage's files.
- A gap or a deviation is a question in the final message, not a choice.

## Proof

`mkdir -p /tmp/f173 && bun test apps/web/src/lib packages/core/src/legal packages/core/src/web apps/server/src/legal-papers.test.ts apps/server/src/legal-outside-calls.test.ts apps/server/src/trust-docs.test.ts apps/server/src/platform apps/docs/src > /tmp/f173/legal.log 2>&1 && bun run docs:build > /tmp/f173/docs.log 2>&1 && grep -q "claim_check ok" /tmp/f173/docs.log && bun run check:job`

Stage 03 has its own Done when (no product code).

## User checkpoints and user steps

- O1 (owner, record): read the DeepSeek terms for API data use and retention. The answer replaces the P4 placeholder in a follow-up ticket with a new legal version.
- O2 (coordinator, after the release that carries stages 01–02, record): set `LLM_PROVIDER=deepseek` and `DEEPSEEK_API_KEY` on the VPS only when the classifier gate passed; apply P9 to the flags; run `bash deploy/check-server-env.sh` and read the start log.
- The release asks every member to accept the terms again (P7).

## Review

Stage 01 `[risky]` (privacy, config, new Polish text): `claude-opus-5-5` review before the land. Stage 02 (new Polish text on the docs site, DPIA): `claude-opus-5-5`. Stage 03: no review (data files and a summary).

## Stages

- [ ] 01 `[risky]` row, config, privacy page, version, ledger — [stage-01](stages/stage-01-row-config-privacy.md)
- [ ] 02 DPIA, record B, public page, ADR, capabilities, release note — [stage-02](stages/stage-02-papers-and-docs.md)
- [ ] 03 coordinator-only: DeepSeek gate runs and summary — [stage-03](stages/stage-03-gate-runs.md)

## How to run (coordinator)

01, then 02. Stage 03 runs next to 01 and 02 (no shared interface; a text conflict is "merge master, re-prove"). Workers: board model, `--prepare 'bash scripts/limen-prepare.sh'`. `questions.md` lists the defaults.

## Planning progress

- Scouts: 0. The task forbids `limen wait` and job polling, so no scout ran; the planner read the code itself.
- Stages 01–03 [written]. Words: plan 1460; stages 681, 612, 438.

## Cold review

Not run. Model choice: `claude-opus-5-5` (stage 01 `[risky]`, privacy). The task forbids `limen wait` and polling, so this job cannot collect a review. The coordinator starts it before stage 01, with the §7 pre-mortem text and the line "The plan follows `.agents/limen/planner.md` § Plan size. Missing code detail is not a finding; a missing decision, edge case, test or interface is.", and files it as `plan-review-1.md`.

## Log

- 2026-11-26 plan at `13277b2d1`.
