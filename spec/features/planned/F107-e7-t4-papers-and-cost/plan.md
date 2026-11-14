# F107 plan — Papers and cost

> **Status 2026-11-14 — planned.** Plan base: 69473f4e. Eight stages; cold review 1 applied (§ Cold review).

**A gap or a deviation is a question in the final message, not a choice.**

## Input

Owner (scope change, 2026-11-12): "You can prepare by yourself the drafts so it will be just the placeholder in the application as there is no need to contact lawyer." P21: "the agent writes the privacy policy, terms and DPA as in-app pages marked "DRAFT, not legal advice", describing the real setup (home VPS, OpenAI, Telegram, Backblaze, Tailscale); the cost model uses real data; the price is a placeholder." Also PD-049 (DPIA, records, breach procedure; cost v1), PD-059 ($25 placeholder price), PD-101 (one typed sub-processor file) in `docs/product/stage-2/decisions.md`.

### Product

- **P1** Six static pages `/legal/<pl|en>/<privacy|terms|dpa>` (stubs exist), each starting with the draft line: en "DRAFT, not legal advice. This service runs on a private server for its owner only."; pl "WERSJA ROBOCZA, nie jest poradą prawną. Ta usługa działa na prywatnym serwerze wyłącznie dla jej właściciela." (Q2). The line stays.
- **P2** The texts state the real setup at the build commit, nothing more. A fact without a source becomes `<to confirm: …>`; never invent a legal fact, a company or a number.
- **P3** No person is named: `<provider name>`, `<address>`, `<contact>` (Q1: public repo).
- **P4** Links (panel language) on `/login`, `/setup` (exists), the Account card, the terms dialog (exists).
- **P5** A legal text or registry change needs a new `TERMS_VERSION`; members then see the existing dialog (D18, Q7).
- **P6** `docs/legal/`, English (Q4): DPIA draft, records of processing, breach procedure, claims list; the breach register stays outside the repo (Q5).
- **P7** Cost model v1: pilot LLM cost, hosting reference of PD-059 (CX23 ÷ 20; home VPS `<home VPS cost>`, Q8), backup share, $25 placeholder price.
- **P8** ADR 0020 "Accounts: invite, plan state, consent by mode, deletion", accepted. ADR 0018 and 0019 stay reserved.

### Design

- **D1** Markdown in `apps/web/src/legal/<lang>/<doc>.md`, rendered by `[lang]/[doc].astro` through `import.meta.glob` (eager). Rejected: `src/content/` (Astro's collection folder, different in Astro 5 and 7; F101 moves to 7) and MDX (new dependency).
- **D2** Page order: draft line, version line, Markdown body, generated tables (privacy: data categories, sub-processors; DPA: sub-processors as Annex 2). No island, no script.
- **D3** `packages/core/src/legal/subprocessors.ts` (via `@ea/core/web`; E10b reads it): `subprocessors: readonly Subprocessor[]`; `Subprocessor = { id, name, purpose, dataReceived, location: Texts; termsUrl; personalData: boolean; activeWhen: ActiveWhen }`; `Texts = { en; pl }`; `ActiveWhen = always | llmProvider(provider) | env(key, unless?) | host("backup")` as a `kind` union. `llmProvider` = any LLM role uses it (`LLM_PROVIDER` or `LLM_<ROLE>_PROVIDER`). Server map `OUTSIDE_SERVICE_KEYS`: each endpoint or credential config key → a row id or an exempt reason.
- **D4** `packages/core/src/legal/data-categories.ts`: `dataCategories: readonly DataCategory[]`; `DataCategory = { id; columns ("table.column" | "table.*"); label, purpose: Texts; subjects: ("users" | "others")[]; kept: Kept }`; `Kept = orgSetting(defaultDays) | days(days) | daysAfterClose(days) | afterExpiry(days) | untilDelete`; `NO_PERSONAL_DATA_TABLES`. One period per category; a table may span categories (retention is per column).
- **D5** Version guard (stage 06): append-only `TERMS_HISTORY: readonly { version; sha256: string | null }[]` in `packages/core/src/web/terms.ts`; first entry `2026-11-12` / `null` (stub era); `TERMS_VERSION` = last version. A unit test hashes the Markdown, both registries and the `legal_*` and `tg_consent_text` values; the last entry must match; versions and digests are unique. Stages 02–05 do not bump; stage 06 adds the one entry for the deploy. Form `YYYY-MM-DD`, `-2` on a second change that day (Q6).
- **D6** Only listed placeholders (`legalPlaceholders`) or `<to confirm: …>`, escaped in the source (`\<provider name>`); raw HTML is an error.
- **D7** Each pl/en pair has the same `##` heading count. **D8** The records of processing name every category and personal-data sub-processor id.
- **D9** `docs/legal/claims.md`: `| # | Claim | Source | Condition |` (E10 §4.2 shape; E10b reuses it).
- **D10** `costToRun(mailsPerDay, opts?: { mailboxesPerHost }): { llmUsd; hostingUsd; backupUsd; totalUsd; basis: "measured" | "estimate" }` per mailbox per month, `packages/core/src/metrics/cost-model.ts` (`@ea/core` root; F121 reads it). Input `pilotCost`: four `stats:week` weeks of the organization (LLM cost, triaged mails: one window); hosting and backup formula shared with `unitCost`; `estimate` below 100 mails or above 5% unpriced calls.
- **D11** The measurement is read-only on the VPS (stage 07); `pilot-cost.md` holds counts, dollar sums, model names and dates only.
- **D12** Seams: F104 (Sent), F117/F118 (OAuth, push, Telegram detail), F111/F120 (EU endpoint, profiles), F112 (GitHub row, `personalData: false`) update registries and texts; D5 forces the bump; D3 and D4 tests catch a new key or table.
- **D13** Docs: new `docs/capabilities/papers.md`; `web-panel.md`, `docs/architecture.md` §7, product brief, roadmap point to the papers.
- **D14** Interim deploys: between the land of stage 02 and stage 06, `master` has unfinished drafts under the old version. Another ticket's VPS deploy then is allowed: the pages carry the draft line; nobody accepts twice (Q10).

### Edge cases

- **E1** A member who never accepted, or accepted another version, gets the dialog; a suspended organization may accept (existing rules).
- **E2** Static pages do not follow a provider switch: each row shows "used when"; "this install uses OpenAI" has its condition in `claims.md`.
- **E3** No env value, secret or person goes into a page at build time.
- **E4** No state, job or write: nothing repeats after a crash; every tenant sees the same pages.

## Facts checked (2026-11-14, `69473f4e`)

- Stubs, `legalPath`, public-path regex, `TERMS_VERSION = "2026-11-12"`, accepted = equal version; links only in `/setup` and the dialog.
- `llmProviders` `gemini`, `openai`; role keys `LLM_<ROLE>_PROVIDER`; `store: false`.
- Retention 30 (DB default), 90, 7, 1 (`docs/capabilities/retention.md`); Healthchecks.io, HIBP, auth mail off (`docs/architecture.md` §7–§8).
- `unitCost`, `costModel` (CX23 $7.1 ÷ 20, backup $0.05); `stats:week` prints `llm_usd_week`, `unpriced_calls`, triaged count.

## Not verified

- Astro 7 keeps `.md` imports with `Content` → stage 02 build.
- Provider URLs, OpenAI and Telegram locations, transfer mechanisms, GDPR articles 12(3), 28(3), 30, 33, 34, 35(7) → stage 06 (web, else `<to confirm>`).
- B2 bucket region → owner (Q3).

## Done when

1. Six pages open without a session, start with the draft line and show the version [02–04].
2. Login, setup, Account card and dialog link the three documents [02].
3. Registry and coverage tests pass; a probe table and an unmapped config key fail [01].
4. Placeholder, parity [02], records [05] and version guard [06] tests pass.
5. `claims.md` covers every claim [06].
6. VPS serves the new pages; no member has the new version accepted yet (the dialog shows); `pilot-cost.md` exists [07].
7. `docs/cost-model.md` matches `costToRun`; ADR 0020 accepted; capability map test passes [08].

## Rules for every stage

- Read `CLAUDE.md`, the styleguide, `docs/code-patterns.md`. Build only your stage; format only your files (`bunx prettier --write <files>`). `git add <paths>`, never `-A`.
- Visible strings in components are i18n keys (en, pl). No `<script>`; no `<style>` in components.
- A text stage writes from sources it opened, not from memory. Pl and en say the same.
- No migration; no `bun.lock` change.

## Proof

```
mkdir -p /tmp/f107-sNN && bun run lint > /tmp/f107-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f107-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f107-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f107-sNN/int.log 2>&1 && bun run web:build > /tmp/f107-sNN/web.log 2>&1 && echo PROOF_OK
```

Stages 02 and 06 add `&& flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f107-sNN/e2e.log 2>&1` before `&& echo PROOF_OK`. Stage 07: its own checks.

## Owner steps

No checkpoint stops the build. U1 (stage 07): accept the new terms in the panel. U2 (optional, after 04): read the Polish texts. U3 (optional): the B2 region (Q3).

## Review

Before the land: 01–06 and 08, `claude-opus-5-5` (Polish text, privacy claims, coverage tests). 07: the runbook.

## Stages

`stages/`: 01 registries; 02 frame, links, checks; 03 privacy; 04 terms, DPA; 05 internal papers; 06 cross-check, version guard; 07 VPS, measurement `[risky]` (coordinator); 08 cost model, ADR 0020, docs.

## How to run (coordinator)

Move the folder to `active/` and commit before the first spawn. Order 01 → 08; land each stage before the next spawn. Spawn:

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F107" \
  'Implement F107 stage NN. Read spec/features/active/F107-e7-t4-papers-and-cost/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for this stage. In the final message, list as proven only what a saved log shows.'
```

Drop the job DB after a land.

## Planning progress

- [written] ticket, plan, questions, stages 01–08; counts in § Cold review.

## Cold review

Model `claude-opus-5-5` (stage 07 `[risky]`, privacy claims, Polish text). Review 1 ([plan-review-1.md](plan-review-1.md), candidate `4acbd7e4`): FAIL, 8 blocking, 12 notes; answers in [plan-review-1-response.md](plan-review-1-response.md). Words after the fixes: see the response file.

## Log

- 2026-11-14: planned at `69473f4e`.
