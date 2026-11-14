# F107 plan — Papers and cost

> **Status 2026-11-14 — planned.** Plan base: 69473f4e. Eight stages; cold review 1 (§ Cold review).

Workers read `ticket.md`, this file and their one stage file. **A gap or a deviation is a question in the final message, not a choice.**

## Input

Owner (scope change, 2026-11-12): "You can prepare by yourself the drafts so it will be just the placeholder in the application as there is no need to contact lawyer." P21: "the agent writes the privacy policy, terms and DPA as in-app pages marked "DRAFT, not legal advice", describing the real setup (home VPS, OpenAI, Telegram, Backblaze, Tailscale); the cost model uses real data; the price is a placeholder." PD-049: "Papers (S6e) also hold a DPIA draft, records of processing (Art. 30) and a breach procedure (moved from E8). Cost model v1 from pilot `triage:cost` now; E3 updates it with M7." PD-101: "sub-processors from one typed file in `packages/core` that the S6e legal pages also render". PD-059: "$25 placeholder price … M7 feeds `docs/cost-model.md`".

### Product

- **P1** Six static pages `/legal/<pl|en>/<privacy|terms|dpa>` (the routes and stubs exist). Each starts with the draft line: en "DRAFT, not legal advice. This service runs on a private server for its owner only."; pl "WERSJA ROBOCZA, nie jest poradą prawną. Ta usługa działa na prywatnym serwerze wyłącznie dla jej właściciela." (pl wording: default, owner to confirm, `questions.md` Q2). The line stays for good (P21).
- **P2** The texts state the real setup at the build commit, nothing more. A fact without a source in code or docs becomes `<to confirm: …>`; a worker never invents a legal fact, a company or a number.
- **P3** No person is named: placeholders `<provider name>`, `<address>`, `<contact>` (default, Q1: the repo is public).
- **P4** Links to the three documents (panel language) on `/login`, `/setup` (exists), in the Account card and in the terms dialog (exists).
- **P5** Every change of a legal text or of a registry row changes `TERMS_VERSION`; a member with an older version sees the existing blocking dialog (D18).
- **P6** Internal papers in `docs/legal/`, English only (default, Q4): DPIA draft, records of processing, breach procedure, claims list. The breach register lives outside the public repo (Q5).
- **P7** Cost model v1: measured pilot LLM cost (four finished weeks of M7 and `triage:cost`), the hosting reference of PD-059 (Hetzner CX23 ÷ 20 mailboxes; the home VPS power cost is `<home VPS cost>`; Q8), the backup share, the $25 placeholder price.
- **P8** ADR 0020 "Accounts: invite, plan state, consent by mode, deletion", accepted, for the local production shape. ADR 0018 and 0019 stay reserved.

### Design

- **D1** Markdown sources in `apps/web/src/legal/<lang>/<doc>.md`, rendered by the existing `[lang]/[doc].astro` through `import.meta.glob` (eager). Not `src/content/` (Astro's collection folder; its rules differ between Astro 5 and 7, and F101 moves the panel to Astro 7). No MDX and no new dependency.
- **D2** Page order: draft line (i18n key `legal_draft_line`), version line (`legal_version`, shows `TERMS_VERSION`), the Markdown body, then the generated tables: privacy gets the data-category table and the sub-processor table; DPA gets the sub-processor table as Annex 2. A wider reading layout than the sign-in pages; no island, no script.
- **D3** Sub-processor registry `packages/core/src/legal/subprocessors.ts` (E10b reads it): `subprocessors: readonly Subprocessor[]`, `Subprocessor = { id, name, purpose: Texts, dataReceived: Texts, location: Texts, termsUrl, personalData: boolean, activeWhen: ActiveWhen }`, `Texts = { en: string; pl: string }`, `ActiveWhen = { kind: "always" } | { kind: "llmProvider"; provider: string } | { kind: "env"; key: string } | { kind: "host"; what: "backup" }`. Rows: stage 01.
- **D4** Data-category registry `packages/core/src/legal/data-categories.ts`: `dataCategories: readonly DataCategory[]`, `DataCategory = { id, tables: readonly string[], label: Texts, purpose: Texts, subjects: readonly ("users" | "others")[], kept: Kept }`, `Kept = { kind: "orgSetting"; defaultDays: number } | { kind: "days"; days: number } | { kind: "untilDelete" } | { kind: "afterExpiry"; days: number }`, plus `NO_PERSONAL_DATA_TABLES`. Coverage tests: stage 01.
- **D5** Text guard: `LEGAL_TEXTS_SHA256` next to `TERMS_VERSION` in `packages/core/src/web/terms.ts`. A unit test hashes the six Markdown files (LF), both registries (`JSON.stringify`) and the `legal_*` keys of `en.ts` and `pl.ts`; a mismatch fails with "change TERMS_VERSION and LEGAL_TEXTS_SHA256". Version form `YYYY-MM-DD` (UTC date of the commit), `-2`, `-3` for a second change that day.
- **D6** Placeholders match `<[a-z][a-z0-9 ]*>` or `<to confirm: …>`; a unit test allows only the list in `apps/web/src/lib/legal.ts` and fails on any other `<…>` in the sources. The page shows them as text, never as an HTML element.
- **D7** Each pl/en pair has the same `##` heading count (unit test).
- **D8** `docs/legal/records-of-processing.md` names every data-category id in backticks (unit test).
- **D9** `docs/legal/claims.md`: one table `| # | Claim | Source | Condition |` (the E10 §4.2 shape, so E10b can reuse it). Source = a repo path, an ADR or a public URL.
- **D10** `costToRun(mailsPerDay: number, opts?: { mailboxesPerHost?: number }): { llmUsd; hostingUsd; backupUsd; totalUsd; basis: "measured" | "estimate" }` per mailbox per month, in `packages/core/src/metrics/cost-model.ts`, with `pilotCost` (measured block). It reuses the hosting and backup share of `unitCost` (one formula). `basis` is `measured` when `pilotCost.mails >= 100`, else it uses the E3 §4 estimate ($0.000143 per classified mail). F121 reads `costToRun`.
- **D11** The measurement is read-only on the VPS (stage 07): only counts, dollar sums, model names and dates go into `pilot-cost.md` in this folder; no id, address or subject.
- **D12** Seams: read Sent (F104), mailbox OAuth and the phone channel (F117, F118), sender profiles and the EU endpoint (F111, F120) and the docs site (F112, a GitHub row with `personalData: false`) change the registries and the texts, which bumps the version by D5; a new table fails D4 coverage.
- **D13** Docs: new capability page `docs/capabilities/papers.md` (index row); `web-panel.md` loses "stubs"; `docs/architecture.md` §7 "Papers" row; `docs/product-brief.md` and `docs/roadmap.md` point to the drafts.

### Edge cases

- **E1** A member who never accepted, or accepted an older version, gets the dialog; a suspended organization may still accept (existing rules, no change).
- **E2** Pages are static: a later `LLM_PROVIDER` switch does not change them, so each sub-processor row shows its "used when" text. The text says "this install uses OpenAI" with the condition in `claims.md`.
- **E3** No env value, secret or person is read at build time into a page (test in stage 02).
- **E4** No state, no job, no write: nothing to repeat after a crash.

## Facts checked (2026-11-14, at `69473f4e`)

- Stub page, `legalDocs`, `legalPath`, `PUBLIC_PAGE_PATHS` regex, `TERMS_VERSION = "2026-11-12"`, links in `/setup` and the terms dialog, none on `/login` or the Account card: `apps/web/src/pages/legal/[lang]/[doc].astro`, `apps/web/src/lib/legal.ts`, `apps/server/src/platform/http.ts`.
- `llmProviders` = `gemini`, `openai`; default `openai`; `store: false`: `platform/llm/providers/`, `platform/config.ts`.
- Retention 30 (DB default), 90 (`RETENTION_TEXT_DAYS`), 7 pending, 1 day tokens: `docs/capabilities/retention.md`.
- Healthchecks.io heartbeat, HIBP 5 hex characters, auth mail off: `docs/architecture.md` §7–§8.
- `unitCost`, `costModel` (CX23 $7.1 ÷ 20, backup $0.05): `packages/core/src/metrics/`.
- `EXPORT_MAP`, `DSR_ADDRESS_MAP`: `apps/server/src/modules/privacy/`.

## Not verified

- Astro 7 keeps `import.meta.glob` of `.md` with `Content` → stage 02 build on `HEAD` (after F101 if landed).
- Provider terms URLs, OpenAI and Telegram data locations, transfer mechanisms → stage 06 (web, else `<to confirm>`).
- GDPR articles used (12(3), 28(3), 30, 33, 34, 35(7)): from Regulation 2016/679, not fetched in this job → stage 06 reads EUR-Lex.
- B2 bucket region → owner (Q3); `<B2 region>` until then.

## Done when

1. Six pages open without a session, start with the draft line and show the version [02, 03, 04].
2. Login, setup, Account card and dialog link the three documents [02].
3. Registry and coverage tests pass; a probe table fails coverage [01].
4. Text guard, placeholder, parity and records tests pass [02, 05].
5. `claims.md` covers every claim; no unsourced claim [06].
6. VPS serves the new pages; the owner accepts the new version; `pilot-cost.md` exists [07].
7. `docs/cost-model.md` matches `costToRun` (unit test); ADR 0020 accepted [08].
8. Capability map test passes with the new page [08].

## Rules for every stage

- Read `CLAUDE.md`, the styleguide, `docs/code-patterns.md`. Build only your stage; format only your files (`bunx prettier --write <files>`). `git add <paths>`, never `-A`.
- Every visible string in components is an i18n key (en and pl). No `<script>`, no hand-written `<style>` in components (global CSS only).
- A text stage writes from sources it opened; it cites none from memory. Pl and en say the same.
- No migration; no `bun.lock` change.

## Proof

```
mkdir -p /tmp/f107-sNN && bun run lint > /tmp/f107-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f107-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f107-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f107-sNN/int.log 2>&1 && bun run web:build > /tmp/f107-sNN/web.log 2>&1 && echo PROOF_OK
```

Stage 02 adds `&& flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f107-s02/e2e.log 2>&1` before `&& echo PROOF_OK`. Stage 07: its own checks.

## Owner steps

No checkpoint stops the build. U1 (stage 07): sign in on the VPS panel and accept the new terms. U2 (any time after 04, optional): read the Polish texts. U3 (optional): state the B2 bucket region (Q3).

## Review

Before the land: 02–06 and 08 (Polish text, privacy claims), model `claude-opus-5-5`. 01 lands on its proof. 07: the coordinator's runbook.

## Stages

Files in `stages/`: 01 `stage-01-registries.md`; 02 `stage-02-page-frame.md`; 03 `stage-03-privacy.md`; 04 `stage-04-terms-dpa.md`; 05 `stage-05-internal-papers.md`; 06 `stage-06-cross-check.md`; 07 `stage-07-vps.md` `[risky]` (coordinator); 08 `stage-08-cost-and-adr.md`.

## How to run (coordinator)

Move the folder to `active/` and commit before the first spawn. Order 01 → 08; land each stage before the next spawn. Spawn:

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F107" \
  'Implement F107 stage NN. Read spec/features/active/F107-e7-t4-papers-and-cost/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for this stage. In the final message, list as proven only what a saved log shows.'
```

Drop the job DB after each land.

## Planning progress

- [written] ticket.md, plan.md, questions.md, stages 01–08.

## Cold review

(filled after review 1)

## Log

- 2026-11-14: planned at `69473f4e`.
