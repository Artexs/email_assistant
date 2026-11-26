PASS de5e8decb4f473cba66788847d9cd57d828350ce

I reviewed the stage 01 candidate of F173 at `de5e8decb4f473cba66788847d9cd57d828350ce`. `git rev-parse HEAD` returns that commit. Stage 01 makes DeepSeek a production AI provider: it adds the sub-processor row, lets config accept the provider, names it on the privacy page and in record B, and adds the claims, the ledger rows and a new terms version. The reviewed product commits are `d3c9ea5e8` (stage 01), `b97819271` (merge of master `20dea562b`) and `de5e8decb` (the demo test fix). I found no blocking finding.

**Blocking findings:** none.

**Unverified:**
- `/tmp/f173/legal.log` and `/tmp/f173/docs.log` do not name the commit they ran at. Their file times (01:11) are after the candidate commit (01:04), and `check.log` names `tip=de5e8decb4`. That makes it likely they ran at the candidate, but the logs do not prove it.

**Prosecuted claims:**
- **Config accepts deepseek in production.** Proven by reading the code. `deepseekProvider.realMail` is now `true`, and `checkRealMail` (`apps/server/src/platform/config-llm.ts:146`) returns early for it. No other config path refuses deepseek. I grepped `deploy/`, `scripts/` and `apps/server/src` and found no other refusal. `grep "realMail: false" apps/server/src/platform/llm/providers` finds nothing. `outside-services.test.ts` case 1 ties the row to the flag in both directions. The tests in `config-deepseek.test.ts` cover stage tests 1–4: scope `all` with no `LAB_STACK`, with `ea-prod` and with an empty value; the injected-lookup refusal with the new message and no key value; `OPENAI_BASE_URL` set to `api.deepseek.com` and to a subdomain with `LLM_PROVIDER=openai` and scope `all`.
- **OPENAI_BASE_URL cannot reach the DeepSeek host.** Proven by reading the code. `parseLlmBaseUrl` (`apps/server/src/platform/llm/providers/endpoint.ts:58`) refuses `api.deepseek.com` and every `*.api.deepseek.com` before any endpoint-kind branch, also with `OPENAI_ENDPOINT_KIND=own`. The URL parser lower-cases the host and strips a trailing dot first.
- **Papers are true and agree.** Proven by reading the files and by a live fetch of the two DeepSeek sources.
  - F1 (privacy policy) says verbatim: "we directly collect, process and store your Personal Data in People's Republic of China".
  - F2 (open platform terms) §3.3 says verbatim: "inform and disclose to end users your personal information processing rules".
  - The en and pl privacy pages, record B (Recipients and Transfers), the registry row, and ledger rows C030, C033–C038, C042, C043, C182, C184 and C277–C282 state the same facts.
  - Every OpenAI-only fact (no training, `store: false`, abuse logs, no EU region) now opens with "When the install uses OpenAI" and does not apply to other providers. No OpenAI claim carries over to DeepSeek; the open question stays as the placeholder `<to confirm: DeepSeek API data use and retention>`.
  - The ledger count table adds 6 rows and 1 unverified row, for a total of 282, and the pin test was updated to match.
- **TERMS_HISTORY and locales.** Proven by reading the files and the saved log. The new entry `2026-11-25` is last, and its comment is "papers: DeepSeek as an AI provider". `/tmp/f173/legal.log` shows "2. the last TERMS_HISTORY digest equals the digest of the current texts" passing. Both `en` and `pl` privacy pages changed. The `deepseek` describe block in `legal-outside-calls.test.ts` checks both languages.
- **Polish reader gender.** Proven by reading. The new Polish sentences ("Gdy instalacja używa DeepSeek…", "Warunki otwartej platformy DeepSeek wymagają, aby klient informował…", "Instalacja zachowuje domyślnego dostawcę AI") have no gendered form for the reader. "klient" is the customer noun, not the reader.
- **Public conditions have no plan wording.** Proven by reading. The three `ai-provider-*` claims say "The default setup uses OpenAI as the AI model". Their conditions say "The install keeps the default AI provider." (pl: "Instalacja zachowuje domyślnego dostawcę AI"). No plan code, ticket number or "P11" reaches public text. The only hit in `/tmp/f173/plancodes.txt` is the existing `F111` in the ledger row C036, which is an internal file and an old row. `DEFAULT_LLM_PROVIDER` and `defaultLlmProviderId` are both `"openai"`, so the claim is true. `docs.log` shows `claim_check ok 15`.
- **demo-org-setup.test.ts change is safe.** Proven by reading the test and the export code.
  - The old test failed after its fixed date. `dayCut(run, 3)` with the fixed start date 2026-11-23 puts the export cut at 2026-11-25T23:00Z. The mailbox gets the real clock time as its creation time, so after that instant the export drops the mailbox and the test fails. Master has the same failure.
  - The fix uses today's UTC date as the start date. The cut becomes start + 2 days 23:00Z, which is always after the mailbox creation time and after the triaged mails (start + 0..2 days, 10:00Z).
  - The change is test-only. `exportDemo` and the import do not check the run id or `endsAt` against the start date. The test passed in `check.log` (line 4895 onwards).

**Notes** (none blocking):
1. **Stale code comment** (proven, `endpoint.ts:56-57`). It still says the DeepSeek host is refused because "real mail would go to a provider that has no sub-processor row". That is now false. Stage 02 already lists this comment (stage-02 line 30).
2. **Docs drift until stage 02 lands** (proven). These places still say DeepSeek is dev-only and refused:
   - `docs/capabilities/triage.md` rule 6
   - ADR 0015 line 50
   - `.env.example` lines 29–30
   - `deploy/README.md`

   Stage 02 owns all of them. If the coordinator lands stage 01 alone, the docs contradict the code until stage 02 lands. Land 01 and 02 close together.
3. **Version date** (proven, cosmetic). The new terms version is `2026-11-25`, but the papers say the DeepSeek policy was "read on 2026-11-26". The page shows a version dated one day before a fact it holds. No test checks this. Leave the entry as written, or rename it before it lands; it has not landed yet, so the rename is allowed.
4. **Fuller DeepSeek terms** (plausible, owner topic for the terms check O1). The same F2 §3.3 also says "You shall obtain the consent of end users or have other legal basis for … delegation of personal information processing to us". The papers state only the inform duty. That is not untrue, but plan decision P1 ("no extra consent") rests on the legal-basis placeholder. The owner should read this sentence in the O1 terms check.
5. **Record B role wording** (plausible, existing before this diff). Record B still says `openai` "(when `LLM_PROVIDER` or a role uses it)" and `gemini` "(when a role uses it)". Per-role provider keys are gone (config-deepseek test 2c), and the privacy page now says "one AI provider for every AI call". This is not from this diff, but the two papers now read slightly differently.
6. **Own endpoint on other DeepSeek hosts** (plausible, existing before this diff). With `OPENAI_ENDPOINT_KIND=own`, a DeepSeek host outside `api.deepseek.com` (for example `deepseek.com`) passes as an own server. The operator must state that they run that server. The risk is low, and it is not the D2 host.
7. **Stage text deviation** (proven, harmless). "The public data-controls page of OpenAI was last checked on 2026-11-17." does not open with "When the install uses OpenAI", which the stage text asks for. It is a date of a check, not a claim about the install, and it does not apply to other providers.
8. **Formatting churn** (proven). `records-of-processing.md` has whitespace-only table padding changes in record A. There is no change of content.

**Checks I ran:**
- `git rev-parse HEAD` returned `de5e8decb4f473cba66788847d9cd57d828350ce` (match).
- I read `git show d3c9ea5e8` and `git show de5e8decb`, and the code they touch: `config-llm.ts`, `endpoint.ts`, `deepseek-host.ts`, `outside-services.ts`, the tests, `demo-seed/export.ts` and `legal-tables.ts`.
- I ran greps for leftover refusals and stale wording.
- I fetched F1 and F2 with `curl` into `/tmp/f173rev` and grepped them with `python3 -I`; both quotes matched.
- Saved logs:
  - `/tmp/f173/check.log` ends `check:job PASS master=20dea562b7 tip=de5e8decb4 full=0`; master is still `20dea562b`.
  - `/tmp/f173/legal.log`: 2900 pass, 0 fail.
  - `/tmp/f173/docs.log`: `claim_check ok 15`.
- I ran no test suite, no lint and no typecheck, as the task asked.

## Note check

- **Config accepts deepseek in production; OPENAI_BASE_URL cannot reach the DeepSeek host:** proven. Evidence: `apps/server/src/platform/config-llm.ts` (`checkRealMail`), `apps/server/src/platform/llm/providers/endpoint.ts` (line 58), `apps/server/src/platform/config-deepseek.test.ts`, and `/tmp/f173/check.log` (`check:job PASS … tip=de5e8decb4`).
- **Papers agree and claim nothing untrue:** proven. Evidence: `apps/web/src/legal/en/privacy.md`, `apps/web/src/legal/pl/privacy.md`, `docs/legal/records-of-processing.md`, `docs/legal/claims.md`, `apps/docs/src/security/claims.ts`, `packages/core/src/web/terms.ts`, `/tmp/f173rev/pp.html` and `/tmp/f173rev/tos.html` (the fetched DeepSeek sources), `/tmp/f173/legal.log` (0 fail, version-guard digest pass) and `/tmp/f173/docs.log` (`claim_check ok 15`).
- **Stage 01 acceptance list** (`stages/stage-01-row-config-privacy.md`, tests 1–12), proven from the files and the saved logs:
  - Tests 1–4 proven: `apps/server/src/platform/config-deepseek.test.ts`.
  - Tests 5–6 proven: `apps/server/src/platform/outside-services.test.ts`.
  - Tests 7–8 proven: `/tmp/f173/legal.log` (`legal-version.test.ts` and `legal-papers.test.ts` pass).
  - Test 9 proven: `apps/server/src/legal-outside-calls.test.ts`.
  - Tests 10–11 proven: `apps/docs/src/security/claims.test.ts`.
  - Test 12 proven: `/tmp/f173/legal.log` (`apps/docs/src` ran with 0 fail).
  - The "see tests 2 and 2b fail once" part of test 8 and the "`realMail: false` makes case 1 fail" part of test 5 are not proven: this review did not break the code to see those tests fail.
- **demo-org-setup.test.ts change is safe:** proven. Evidence: `apps/server/test/integration/demo-org-setup.test.ts`, `apps/server/src/modules/lab/demo-seed/export.ts` (`dayCut`, line 16) and `/tmp/f173/check.log` (the test passes, line 4895 onwards).
- **Easy-to-miss rule "Run no test suite":** followed. This session ran only git, grep, sed, awk, curl and python3 text greps. It ran no `bun test`, `test:*`, lint, typecheck or `check:job`.
- **Reminder "tests run once per job; no test:unit, test:int, test:e2e":** followed. None ran.
- **Reminder "a job that commits product code runs check:job last":** not applicable. This review job made no commit.
- **Reminder "a review job runs no test suite, lint or typecheck":** followed. None ran.
- **Reminder "never delete node_modules/.cache":** followed. Nothing was deleted.
