# F107 plan — Papers and cost

> **Status 2026-11-14 — planned.** Plan base: 69473f4e. Eight stages; cold review 1 (§ Cold review).

**A gap or a deviation is a question in the final message, not a choice.**

## Input

Owner (scope change, 2026-11-12): "You can prepare by yourself the drafts so it will be just the placeholder in the application as there is no need to contact lawyer." P21: "the agent writes the privacy policy, terms and DPA as in-app pages marked "DRAFT, not legal advice", describing the real setup (home VPS, OpenAI, Telegram, Backblaze, Tailscale); the cost model uses real data; the price is a placeholder." PD-049: "Papers (S6e) also hold a DPIA draft, records of processing (Art. 30) and a breach procedure (moved from E8). Cost model v1 from pilot `triage:cost` now; E3 updates it with M7." PD-101: "sub-processors from one typed file in `packages/core` that the S6e legal pages also render". PD-059: "$25 placeholder price".

### Product

- **P1** Six static pages `/legal/<pl|en>/<privacy|terms|dpa>` (stubs exist). Each starts with the draft line: en "DRAFT, not legal advice. This service runs on a private server for its owner only."; pl "WERSJA ROBOCZA, nie jest poradą prawną. Ta usługa działa na prywatnym serwerze wyłącznie dla jej właściciela." (pl: default, owner to confirm, Q2). The line stays (P21).
- **P2** The texts state the real setup at the build commit, nothing more. A fact without a source becomes `<to confirm: …>`; never invent a legal fact, a company or a number.
- **P3** No person is named: placeholders `<provider name>`, `<address>`, `<contact>` (default, Q1: the repo is public).
- **P4** Links (panel language) on `/login`, `/setup` (exists), the Account card, the terms dialog (exists).
- **P5** A change of a legal text or a registry row changes `TERMS_VERSION`; members then see the existing dialog (D18, Q7).
- **P6** `docs/legal/`, English (Q4): DPIA draft, records of processing, breach procedure, claims list; the breach register stays outside the repo (Q5).
- **P7** Cost model v1: pilot LLM cost (four weeks of M7 and `triage:cost`), hosting reference of PD-059 (CX23 ÷ 20; home VPS `<home VPS cost>`, Q8), backup share, $25 placeholder price.
- **P8** ADR 0020 "Accounts: invite, plan state, consent by mode, deletion", accepted, for the local production shape. ADR 0018 and 0019 stay reserved.

### Design

- **D1** Markdown sources in `apps/web/src/legal/<lang>/<doc>.md`, rendered by the existing `[lang]/[doc].astro` through `import.meta.glob` (eager). Rejected: `src/content/` (Astro's collection folder, different in Astro 5 and 7; F101 moves to 7) and MDX (a new dependency).
- **D2** Page order: draft line (`legal_draft_line`), version line (`TERMS_VERSION`), Markdown body, generated tables (privacy: data categories and sub-processors; DPA: sub-processors as Annex 2). Wider layout; no island, no script.
- **D3** Sub-processor registry `packages/core/src/legal/subprocessors.ts` (E10b reads it): `subprocessors: readonly Subprocessor[]`, `Subprocessor = { id, name, purpose: Texts, dataReceived: Texts, location: Texts, termsUrl, personalData: boolean, activeWhen: ActiveWhen }`, `Texts = { en: string; pl: string }`, `ActiveWhen = { kind: "always" } | { kind: "llmProvider"; provider: string } | { kind: "env"; key: string } | { kind: "host"; what: "backup" }`. Rows: stage 01.
- **D4** Data-category registry `packages/core/src/legal/data-categories.ts`: `dataCategories: readonly DataCategory[]`, `DataCategory = { id, tables: readonly string[], label: Texts, purpose: Texts, subjects: readonly ("users" | "others")[], kept: Kept }`, `Kept = { kind: "orgSetting"; defaultDays: number } | { kind: "days"; days: number } | { kind: "untilDelete" } | { kind: "afterExpiry"; days: number }`, plus `NO_PERSONAL_DATA_TABLES`. Coverage tests: stage 01.
- **D5** Text guard: `LEGAL_TEXTS_SHA256` next to `TERMS_VERSION` in `packages/core/src/web/terms.ts`. A unit test hashes the six Markdown files (LF), both registries (`JSON.stringify`) and the `legal_*` keys of `en.ts` and `pl.ts`; a mismatch fails with "change TERMS_VERSION and LEGAL_TEXTS_SHA256". Version form `YYYY-MM-DD` (UTC date of the commit), `-2`, `-3` for a second change that day.
- **D6** Only listed placeholders (`legalPlaceholders`) or `<to confirm: …>` may appear; the page shows them as text.
- **D7** Each pl/en pair has the same `##` heading count.
- **D8** The records of processing name every data-category id.
- **D9** `docs/legal/claims.md`: one table `| # | Claim | Source | Condition |` (E10 §4.2 shape; E10b reuses it).
- **D10** `costToRun(mailsPerDay: number, opts?: { mailboxesPerHost?: number }): { llmUsd; hostingUsd; backupUsd; totalUsd; basis: "measured" | "estimate" }` per mailbox per month, in `packages/core/src/metrics/cost-model.ts`, from the `pilotCost` block; one hosting and backup formula with `unitCost`; `estimate` below 100 measured mails. F121 reads it.
- **D11** The measurement is read-only on the VPS (stage 07); `pilot-cost.md` holds counts, dollar sums, model names and dates only.
- **D12** Seams: F104 (Sent), F117/F118 (OAuth, push, Telegram detail), F111/F120 (EU endpoint, profiles), F112 (GitHub row, `personalData: false`) update registries and texts; D5 forces the bump, D4 catches a new table.
- **D13** Docs: new `docs/capabilities/papers.md`; `web-panel.md`, `docs/architecture.md` §7, product brief and roadmap point to the papers.

### Edge cases

- **E1** A member who never accepted, or accepted another version, gets the dialog; a suspended organization may still accept (existing rules).
- **E2** Pages are static: an `LLM_PROVIDER` switch does not change them, so each row shows its "used when" text; "this install uses OpenAI" carries its condition in `claims.md`.
- **E3** No env value, secret or person goes into a page at build time.
- **E4** No state, job or write: nothing repeats after a crash; two tenants see the same public pages.

## Facts checked (2026-11-14, at `69473f4e`)

- Stub pages, `legalDocs`, `legalPath`, public-path regex, `TERMS_VERSION = "2026-11-12"` (accepted = equal version); links in `/setup` and the dialog, none on `/login` or the Account card (`apps/web`, `platform/http.ts`, `modules/tenancy/routes.ts`).
- `llmProviders` = `gemini`, `openai`, default `openai`, `store: false` (`platform/llm/providers/`, `platform/config.ts`).
- Retention 30 (DB default), 90 (`RETENTION_TEXT_DAYS`), 7, 1 (`docs/capabilities/retention.md`); Healthchecks.io, HIBP, auth mail off (`docs/architecture.md` §7–§8).
- `unitCost`, `costModel` (CX23 $7.1 ÷ 20, backup $0.05); `EXPORT_MAP`, `DSR_ADDRESS_MAP` (`modules/privacy/`).

## Not verified

- Astro 7 keeps `.md` imports with `Content` → stage 02 build (F101 may land first).
- Provider terms URLs, OpenAI and Telegram data locations, transfer mechanisms → stage 06 (web, else `<to confirm>`).
- GDPR articles 12(3), 28(3), 30, 33, 34, 35(7): not fetched here → stage 06 (EUR-Lex).
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
- Visible strings in components are i18n keys (en, pl). No `<script>`; no `<style>` in components.
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

Before the land: 01–06 and 08 (Polish text, privacy claims, the coverage test), `claude-opus-5-5`. 07: the runbook.

## Stages

`stages/`: 01 registries; 02 page frame, links, guards; 03 privacy; 04 terms and DPA; 05 internal papers; 06 cross-check; 07 VPS and measurement `[risky]` (coordinator); 08 cost model, ADR 0020, docs.

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

- [written] ticket, plan, questions, stages 01–08. Words: plan ≤1500; stages 695, 677, 649, 691, 571, 560, 606, 636.

## Cold review

Model `claude-opus-5-5`: stage 07 is `[risky]`; privacy claims; new Polish text.

## Log

- 2026-11-14: planned at `69473f4e`.
