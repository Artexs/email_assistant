# F121 scouts

Four Sonnet scouts (`--thinking medium`), started 2026-11-18 at base `c68ce51e`. Each packet is copied whole from the job log. A packet is a lead; the planner checked the facts that decisions depend on (plan.md § Facts checked).

## Scout 1 · `2026-11-18-f121-scout-1-d7672a9a`

**Question.**
Docs site (apps/docs, ticket F112 landed): which pages exist now (home /, security, pricing, start tutorial, how-to, reference, explanation, FAQ, changelog, operate) in en and pl, and which are placeholders? How do locales, the stale-translation check, the public-content CI check, any proof-link check, the screenshot pipeline (docs-shots, demo fixture) and the GitHub Pages deploy workflow (trigger, what it downloads) work, and which product-name/site constants exist? What did F112 leave explicitly for E10b (grep F112 plan/stages and F121)? Context: spec/features/planned/F121-e10b-public-pages-and-demo/ticket.md and docs/product/stage-2/epics/E10-discovery-notes.md §4. Answer for the code at HEAD.

**Packet.**

Packet: Which docs pages and checks exist at HEAD, and what F112 left for E10b (F121)
Base: c68ce51e
Verified: `find apps/docs/src/content -type f | sort` -> 34 files, none named security, pricing or changelog under `content/docs/`. `git status --short | wc -l` -> 0.
Unknowns:
- I ran no build, test or deploy. All findings come from reading files.
- No proof-link check exists. `grep -rniE "proof.?link|release asset|gh release|download"` over `apps/docs` (ts, yml, mjs) and the workflows found no such code, and `docs-deploy.yml` has no `download` step. Observed.
- No check fails on a docs image outside the generated folder or `public/brand/`. `apps/docs/src/shots.ts` and `components/*.astro` have no `brand` or `outside` rule. Notes §4.4 asks for this check. Observed.
- I did not read `public-content.ts` in `@ea/core/web` (rules R1–R7), nor the `Shot.astro` body.

1. Pages. Observed.
   - en, all real content: home `/` (`index.mdx`, 12 lines, a short placeholder-like landing for F121 to replace per stage-01), `start/index.mdx` (163 lines), `faq` (103 lines), 10 how-to pages, 4 reference pages (categories, telegram, settings, limits), 3 explanation pages (how-a-mail-is-sorted, never-sends-alone, shadow-and-assist).
   - pl: index, start, faq, 10 how-to pages, explanation/how-a-mail-is-sorted. That is the `POLISH_SET` in `apps/docs/src/front-matter.ts`. Reference and the other two explanation pages are en only (Starlight fallback).
   - In place, not under content: `operate/install-and-run` (`deploy/README.md`), `operate/release-checklist` (`docs/release-checklist.md`), and `changelog` (`CHANGELOG.md`, `changelogPage` transform, own sidebar link). They are listed in `apps/docs/src/in-place.ts` `IN_PLACE_PAGES`.
   - Absent: security, pricing, and operate pages for update/rollback, backups, alerts and keys. The sidebar in `apps/docs/astro.config.mjs` has no security or pricing entry.
2. Locales and constants. Observed.
   - `astro.config.mjs`: Starlight `defaultLocale: "root"` (en), plus `pl`. Integrations run in this order: `cspFinalize`, `publicContent`, `inPlaceCheck`, `linkCheck`, `shots`.
   - `packages/core/src/site.ts`: `PRODUCT_NAME = "Email Assistant"`, `DOCS_ORIGIN = "https://artexs.github.io"`, `DOCS_BASE = "/email_assistant"`. `in-place.ts` also has `REPO_URL` (GitHub `Artexs/email_assistant`), `docsGitRef()` (env `DOCS_GIT_REF`, default `master`) and `IN_PLACE_SECTION = "Operate"`.
3. Stale-translation check. Observed. `apps/docs/scripts/stale.ts`, run as `bun run docs:stale [--strict] [--stamp <pl file>]`.
   - A pl page has front matter `source` and `sourceHash`. The hash is the first 16 hex of the sha256 of the en body. `<Shot />` lines and the `Shot` import are ignored.
   - `--strict` fails when the source is `index` or starts with `start`. Stage-04 says "F121 adds security and pricing" to that set.
   - CI job `docs` runs it without `--strict`. The deploy `build` job runs it with `--strict`.
4. Public-content check. Observed. `apps/docs/integrations/public-content.ts` scans the built text files (not `pagefind/`) with `publicContentScan` from `@ea/core/web`. It throws on the first problem, on an unused allow entry, or when no file was checked. The allow list is `apps/docs/public-content-allow.txt`, holding Pagefind translator emails. `linkCheck` checks same-site `href` and `src` and `#id` targets. `inPlaceCheck` checks the in-place pages.
5. Screenshots. Observed.
   - `bun run docs:shots` runs `apps/web/e2e/docs-shots.config.ts`, with `docs-shots/global-setup.ts` and `shots.spec.ts`. The shots are PNGs in `apps/docs/public/shots`, not in git.
   - The "demo fixture" is the e2e seed (`../seed`), not the E2b `demo-seed` module. The run signs in as the owner of the seed's main organization.
   - `src/shots.ts` lists 5 pages (onboarding, mailboxes, settings, rules, activity), 2 locales and 2 viewports (desktop 1280x800, phone). `SHOT_MIN_BYTES` is 10 KB.
   - Pages use `<Shot page="..." />`. Env `DOCS_SHOTS=on` switches the shots on in the build.
   - `apps/server/src/modules/lab/demo-seed/` (export and import) exists, but the shot run does not use it.
6. Deploy. Observed. `.github/workflows/docs-deploy.yml` triggers on a pushed tag `v*` and on `workflow_dispatch`.
   - `gate` runs `deploy-gate.ts`. A tag deploys only when it is the newest plain `vX.Y.Z` tag. A tag with no `CHANGELOG.md` release is a red run. A manual run deploys any ref.
   - `checks` runs `ci.yml`. `build` starts Postgres and GreenMail, then runs `docs:stale --strict`, `db:migrate`, `web:build`, `playwright install`, `docs:shots`, `docs:build` (with `DOCS_SHOTS=on` and `DOCS_GIT_REF`) and `docs:test`. It then runs `upload-pages-artifact` on `apps/docs/dist`. `deploy` runs `deploy-pages`.
   - It downloads no release asset, so the demo video download in notes §4.5 does not exist yet. Pages setup (owner step O1) may still be open.
7. Left for F121. Observed.
   - F112 `plan.md` P1: "Home, security, pricing, demo video and cold read are F121 (E10b)".
   - F112 `ticket.md` line 22 adds "Home and positioning, security, pricing pages, demo video, cold read, API reference".
   - F112 `questions.md` Q2 moves the API reference and the autonomy-evidence reference to F121.
   - Stage-01: "F121 replaces it [the landing page] with the home page".
   - Stage-04: F121 adds security and pricing to the strict stale set.
   - Stage-09: no data-location, training or provider claims; those go on the F121 security page.
   - F121's own `ticket.md` is a stub with no stages yet.

Checks: `apps/docs/scripts/*.test.ts` (stale, deploy-gate, workflows, shot-run), `integrations/*.test.ts` and `src/*.test.ts` (polish, reference, how-to, shots) cover the mechanisms above. They also run in `bun run test:unit`. Not run; they miss any security or pricing page, the proof links and the demo video.

## Scout 2 · `2026-11-18-f121-scout-2-650dd242`

**Question.**
Sub-processors, legal pages and cost: does a typed sub-processor registry exist (e.g. packages/core/src/legal/subprocessors.ts, ticket F107 stage 01), what are its row fields and who renders it? Which F107 stages are landed on master (git log), does docs/cost-model.md exist with an M7 data block at 50/100/200 mails a day, and what does F100 (E3a) provide for M7 and triage:cost? Where is the claims table data for a security page (ADR 0003, 0011, 0015, 0017, 0024, 0028) and which tests prove each claim of E10-discovery-notes §4.2? Context: spec/features/planned/F121-e10b-public-pages-and-demo/ticket.md and docs/product/stage-2/epics/E10-discovery-notes.md §4. Answer for the code at HEAD.

**Packet.**

Packet: Sub-processor registry, F107 landing state, cost-model and M7, and claims data with tests for the E10b security page
Base: c68ce51e
Verified: `ls docs/cost-model.md` -> `ls: cannot access 'docs/cost-model.md': No such file or directory`
Unknowns:
- Test-to-claim mapping is by filename and by claims.md source cells. I did not run the tests.
- `docs/legal/claims.md` rows C136–C163 are the sub-processor rows (28 rows, 9 unverified). I did not read them in full.
- Three §4.2 claims have no single named test. They are: "Healthchecks.io timing pings only", "Retention periods per data kind", and "Automatic moves are earned per category".
- I did not find the `costToRun` function that F107 stage 08 plans.

1. `packages/core/src/legal/subprocessors.ts` — the typed registry exists, exported from `packages/core/src/legal/index.ts`. Row type `Subprocessor`: `id, name, purpose, dataReceived, location, termsUrl, personalData, activeWhen`. `purpose`, `dataReceived` and `location` are `Texts` (en and pl). `activeWhen` is a union: `always`, `llmProvider`, `env{key,unless?}`, `host{part:"backup"}`. The rows are `openai`, `gemini`, `telegram` and others. The registry has no `Healthchecks` mention in the part I read. A sibling `data-categories.ts` also exists. Observed.
2. Renderers (observed): `apps/web/src/components/legal/SubprocessorsTables.astro`, `apps/web/src/lib/legal-tables.ts` (`usedWhenText`), and `apps/web/src/pages/legal/[lang]/[doc].astro`. Tests: `packages/core/src/legal/subprocessors.test.ts`, `apps/web/src/lib/legal-tables.test.ts`, `apps/server/src/platform/outside-services.ts` and its test. `OUTSIDE_SERVICE_KEYS` ties the registry to config. No `apps/docs` renderer exists; the discovery notes §4.3 expected one, and the registry comment names "the security page of the web site". Observed.
3. F107 state: the ticket is still in `spec/features/active/`. Observed in git log: stages 01–06 are on master (`1ac0551c` stage 01 registries, `7a8ead86` stage 02 page frame, `ea0587b3` stage 03, `1c4a9e0e` stage 04, `033e3c2c` stage 05, `403ae7cf` stage 06 claims list). Stages 07 (VPS) and 08 (cost model) have no commit. `docs/cost-model.md` is absent, so there is no M7 data block at 50/100/200 mails a day. Stage 08 plans that table, plus a `costToRun` function that checks it. Observed.
4. F100 (landed, `b10f0ee8`) provides M7 in `packages/core/src/metrics/m7.ts` (`unitCost(rows,{mailboxes})`) and the reference constants in `packages/core/src/metrics/cost-model.ts`. The constants are `hostingUsdPerMonth` 7.1, `mailboxesPerHost` 20, `backupUsdPerMailboxMonth` 0.05, `targetUsdPerMailboxMonth` 5. The export is `costModel`, not `costToRun`. It also provides `bun run stats:week` and `GET /api/stats`. `package.json:44` has `"triage:cost": "bun apps/server/src/scripts/triage-cost.ts"` with `--org-id --mailbox-id [--days 7] [--mail real|synthetic]`; it prices per model by endpoint (`docs/capabilities/measurement.md` rule 8). It gives no per-mails-per-day table. Observed.
5. Claims data lives in `docs/legal/claims.md` (242 rows C001–C242). Each row has Claim, Source and Condition. It is the claims table for ADR 0003, 0011, 0015, 0017, 0024 and 0028, and it also holds gap and unverified marks. Source-cell tests, observed in claims.md: never sends without approval — `actions-approvals.test.ts` (C018), `actions-expiry.test.ts` (C048). Logs hold no mail text — `log-canary.test.ts` (C014). Retention clears text — `retention-job.test.ts` (C023). OpenAI `store:false` — `llm/providers/openai.test.ts` (C034). Related files by name only (guessed): the send path `actions-send.test.ts`; Undo `actions-undo.test.ts`; export, delete and data request `privacy-export.test.ts`, `privacy-delete.test.ts`, `privacy-dsr-erase.test.ts`, `account-data-delete.test.ts`; autonomy evidence `modules/triage/evidence.test.ts` and `gate-evidence.test.ts`; backup encryption `deploy/test/backup.test.ts`. Claims row C019 is a known gap: the `telegram:link` CLI links with no consent.
Checks: `apps/server/src/legal-papers.test.ts` covers the shape of `claims.md`. `subprocessors.test.ts` and `legal-tables.test.ts` cover the registry and its tables. They miss a check that each §4.2 claim names a passing test, and a check on the cost table (it does not exist yet).

## Scout 3 · `2026-11-18-f121-scout-3-42eeffa4`

**Question.**
Demo for a recorded video: what exists at HEAD for the E2b demo organization (ticket F113: sim stack, org reset, demo export/import stage 15, lab CLI), for the E4-B what-I-would-have-done report page and Turn on recommended (ticket F110 stage 14, 13), for the fake Telegram (tools/fake-telegram; any read-only viewer page), and for Playwright e2e (apps/web/e2e config, seeds, ports 8081/8092, flock rule). Which of these F113/F110 stages are landed (git log, spec/features), which are only planned? Is ffmpeg available in CI/locally? Context: spec/features/planned/F121-e10b-public-pages-and-demo/ticket.md and docs/product/stage-2/epics/E10-discovery-notes.md §4. Answer for the code at HEAD.

**Packet.**

Packet: What exists at HEAD for the E2b demo org, F110 report page, fake Telegram, Playwright e2e and ffmpeg
Base: c68ce51e
Verified: `which ffmpeg` -> /usr/bin/ffmpeg (local only); `git status --short | wc -l` -> 0
Unknowns:
- The ticket folders still sit in `active/` and the board marks F113 and F110 as ACTIVE and PLANNED. I did not run the code, so "landed" below means commits exist at HEAD, not that tests pass.
- I did not read the F110 stage 14 or 13 code in detail, and I did not check whether the report page or "Turn on recommended" works.
- I did not find the ffmpeg version.
- I did not read E10-discovery-notes §4 beyond one video line (guessed: it says the home page has a "2-minute video").
- A `git log --grep` for F113 stage 01–13 gave no output in the first 20 lines, but the files exist. Stage 03 (sim stack) landing is inferred from `deploy/compose.sim.yaml`.

1. F113 landed — observed
   - Stages 14 (org reset: `lab reset` and `demo-reset`, commits 05e532d3, 580ec261), 15 (demo export/import, 8d1ecae3, 5a97fd5c) and 16 (docs, runbook, ADR 0021 accepted, dfa0d03f) are in git log. Stage 13 (scorer) is too.
   - All 16 stage files are in `spec/features/active/F113-e2b-live-lab/stages/`.
   - Code: `apps/server/src/modules/lab/` has `reset.ts`, `demo-seed/{export,import,scan,transform,files}.ts`, `bots.ts`, `executive.ts`, `injector.ts`, `fake-tg.ts` and `score/`. The CLI is `bun run lab` (`package.json:48`, `apps/server/src/scripts/lab.ts`). `lab:env-check` is at `package.json:99`.
   - The sim stack is `deploy/compose.sim.yaml`. CI checks it at `.github/workflows/ci.yml:132-138`; the CI step copies `deploy/sim.env` from the example.
   - Owner step O1 (VPS volume) and the real week run C4 are not code, so I did not check them.
2. F110 landed — observed
   - Stage 14 (report page) is in git log: e5151a54 (page, onboarding steps, en/pl texts), 003ab2f4 (e2e seed and spec R1–R8), d3e08ae2 (onboarding with `trust_ladder`).
   - Stage 13 (autonomy card) is in git log: 11fb1bc9, 2c5f998c.
   - Stages 12, 15, 23, 24 and 25 (docs, ADRs 0022 and 0028 accepted) are also in git log.
   - Code: `apps/web/src/components/report/ReportContent.tsx`, `lib/report-view.ts`, `lib/trust-api.ts`; the string "Turn on recommended" (or a variant) matches in `apps/web/src/i18n/texts/en-reply.ts`.
   - The board line `spec/build.md` still says F110 is "PLANNED, plan landed, 26 stages". It is stale against git log. The ticket is not in `done/`.
3. Fake Telegram — observed
   - `tools/fake-telegram/` is a workspace package, `@ea/fake-telegram`, with `server.ts`, `control.ts`, `driver.ts`, `state.ts`, `cli.ts` and `scripts/{seed-urgent,check-undo}.ts`.
   - It has no viewer page. `server.ts:166` routes `/_fake/*` to `control.ts`. The routes are `GET /_fake/health`, `GET /_fake/chats`, `POST /_fake/send` and `POST /_fake/press`. It listens on loopback only.
   - A read-only viewer page would be new work.
4. Playwright e2e — observed
   - Config is `apps/web/e2e/playwright.config.ts` (`workers: 1`, `webServer: e2eWebServers(env)`). `env.ts:15` sets web port 8081 and `env.ts:21` sets the fake Telegram port 8092.
   - The seed is `apps/web/e2e/seed.ts` (`readSeed()`; `e2e-seed.ts` builds it). `report.spec.ts` uses `readSeed().trustOrgs[project()]`. The trust org has `trust_ladder` on.
   - Other files: `global-setup.ts`, `helpers.ts`, `servers.ts`, `totp.ts`, `a11y.ts`, `gate-fixture/`, and `docs-shots/` (with its own `docs-shots.config.ts`).
   - There are 34 specs in `tests/`, including `report.spec.ts`, `trust-card.spec.ts`, `review.spec.ts` and `newsletters.spec.ts`.
   - The flock rule (`CLAUDE.md`): run `test:e2e` and `docs:shots` only under `flock /tmp/email-assistant-shared-tests.lock`, because of the fixed ports. `docs:test` uses port 8093.
5. ffmpeg — observed
   - It is installed locally at `/usr/bin/ffmpeg`.
   - `grep -n ffmpeg .github/workflows/ci.yml` found nothing, and a grep of `package.json`, `apps/*/package.json`, `Dockerfile*` and `scripts` found nothing. CI therefore does not install or use ffmpeg (guessed for the runner image).

Checks: `git log --oneline` covers which stages have commits; it misses whether the stage tests pass. The reads of `control.ts`, `env.ts` and `compose.sim.yaml` cover what exists; they miss runtime behavior. I ran no tests.

## Scout 4 · `2026-11-18-f121-scout-4-c9eaf483`

**Question.**
Changelog and What is new: does CHANGELOG.md exist with Keep a Changelog sections and per-release For users lines in en and pl (ticket F114 E8b stage 05 release scripts)? Does the docs site render it at /changelog/ and does the panel have a What is new card (F112)? What release checklist and release tag workflow exist (deploy/, docs/, .github/workflows), and which F114 stages are landed on master? Context: spec/features/planned/F121-e10b-public-pages-and-demo/ticket.md and docs/product/stage-2/epics/E10-discovery-notes.md §4. Answer for the code at HEAD.

**Packet.**

Packet: Do CHANGELOG.md, the docs /changelog/ page, the panel What is new card, the release workflow and F114 stages 01–08 exist at HEAD? Yes to all.
Base: c68ce51e
Verified: `grep -n "changelog" apps/docs/src/in-place.ts` -> `27:  { id: "changelog", path: "CHANGELOG.md", transform: changelogPage, ownLink: true },`
Unknowns:
- I did not build the docs site, so I did not see the `/changelog/` page rendered. The e2e test `apps/docs/e2e/site.spec.ts:109` (T10) covers it, and I did not run it.
- I did not run the tests for the What is new card.
- I did not check that F114 stage 09 (VPS release and drill) is absent from master. Its stage file exists, no `F114 stage 09` commit is in `git log`, and `deploy/README.md` says the drill is postponed.
- F114 stage 05 (release scripts) has no commit named "stage 05" that I inspected. `git log` shows the label, and `deploy/release.sh`, `rollback.sh`, `release-lib.sh` and the `release:prepare` script exist.

1. `CHANGELOG.md:1-45` — Keep a Changelog format with `[Unreleased]`, `[0.2.1]`, `[0.2.0]` and `[0.1.0]`, and groups Added, Changed, Fixed. Only 0.2.0 and 0.2.1 have `### For users`, with 3 items in total. Each item is `- en:` plus an indented `pl:` line. Tags v0.1.0, v0.2.0 and v0.2.1 exist. — observed
2. `apps/docs/src/in-place.ts:27` and `apps/docs/src/changelog-page.ts` — the `changelog` entry builds the `/changelog/` page from `parseChangelog`. It skips `[Unreleased]` and operator groups. It shows only the `en` For-users lines. No Polish changelog page exists in this code (it uses `item.en` only). — observed
3. `apps/web/src/components/shell/WhatsNew.tsx` (`WhatsNewSlot`, mounted at `AppShell.tsx:113`), `apps/web/src/lib/whats-new.ts`, `apps/web/integrations/changelog-releases.ts` — the What is new card exists. It reads releases from the changelog at build time, with seen-state in localStorage. Tests: `whats-new.test.ts`, `whats-new-card.test.tsx`. — observed
4. `docs/release-checklist.md` (11 steps: CI green, changelog entry, evals, sim, capability pages, `db:check-migrations`, `docs:stale --strict`, `bun run release:prepare <x.y.z>` then commit, tag and push, `deploy/release.sh v<x.y.z>`, 30-minute watch, `deploy/rollback.sh`). `.github/workflows/docs-deploy.yml` runs on push of tag `v*` and on manual dispatch. `apps/docs/scripts/deploy-gate.ts` deploys only the newest tag and fails with `changelog_missing` when the tag has no changelog entry. The Pages deploy job fails until owner step O1 is done. — observed
5. F114 stages 01–08 have commits at HEAD (`git log` shows "F114 stage 01" to "F114 stage 08"). `git merge-base --is-ancestor f7e00a46 HEAD` (stage 08) printed `s08-in-HEAD`. Stage 09 is not landed. The F114 ticket is in `spec/features/active/`, and the drill is postponed by the owner. `deploy/` has `release.sh`, `rollback.sh`, `release-lib.sh`, `release-state`, `restore.sh` and `compose.drill.yaml`. — observed

Checks:
- `apps/docs/src/changelog-page.test.ts`, `apps/server/src/scripts/release-prepare*.test.ts`, `apps/docs/scripts/deploy-gate.test.ts` and the e2e T10 cover the changelog page, the release scripts and the tag gate. I ran none of them.
- Nothing covers a Polish changelog page or a Polish What is new card source. I did not check how the card picks `pl` text.
