# F101 · Panel to Astro 7: plan

> **Status 2026-11-14 — planned.** 4 stages written; cold review pending. Builds after F095 is in `done/`. Nothing is built yet.

Ticket: [ticket.md](ticket.md). Small defaults for the owner: [questions.md](questions.md). Probe script: [probes/hydrate-check.ts.txt](probes/hydrate-check.ts.txt).

## Planning progress

- [x] Collect: ticket; E10 epic page and discovery notes §3, §5, §7; `05-execution-plan.md` §2; PD-096, PD-097; ADR 0016, ADR 0030; `notes/2026-11-13-astro-starlight-versions.md`, `notes/2026-11-08-s5a-probes/README.md`, `notes/2026-11-10-web-foundation-build.md`; `spec/build.md`; F095 stage 06 (writes `docs/capabilities/web-panel.md`); F096 and F099 plans (shape, VPS runbook); the code of `apps/web` (config, integration, layouts, pages, e2e helpers and specs), `apps/server/src/platform/http.ts` (`PUBLIC_PAGE_PATHS`), `deploy/Dockerfile`, `deploy/README.md` § Update, `.github/workflows/ci.yml`, `scripts/limen-prepare.sh`.
- [x] Facts checked: probe P1 (full copy of HEAD `a72b214` on Astro 7.4.12), probe P2 (same copy on Astro 5.13.7, for the compare), sources read.
- [x] Decisions P1–P2, D1–D12.
- [x] stage-01-csp-build-check [written]
- [x] stage-02-astro-7 [written]
- [x] stage-03-docs [written]
- [x] stage-04-vps-deploy [written]
- [ ] Cold review (`plan-review-1.md`), fixes logged in "Cold review".

## Input

### Job instruction of 2026-11-14, word for word

"Plan F101: write stages/ for spec/features/planned/F101-*/ (Panel to Astro 7; E10, PD-098 area, notes section 5). Follow docs/product/stage-2/05-execution-plan.md §2.3 but do NOT edit spec/build.md, the §2.1 table or other epics' pages (the coordinator does; report each outside edit in your final message). Use F-numbers from the §2.1 table in Sequenced. Built already: F086-F091, F093, F094, F096 (see spec/features/done/); planned: F095, F097, F098, F099, F100. Owner rules: no owner checkpoints for confirmation; an owner step only for what needs the owner's hands (real secrets, real money, a phone); small questions get a default in questions.md."

Note: the instruction says "PD-098 area". The Astro 7 decision is PD-097 (`docs/product/stage-2/decisions.md`); PD-098 is the public docs site on GitHub Pages. This plan uses PD-097.

### Owner decisions that bind this plan

- E10 discovery decision 3 (owner: "Go with defaults.", 2026-11-13; PD-097): "Move the panel to Astro 7 in its own small ticket before E4-A builds new pages, so the workspace has one Astro. [yes]"
- E10 discovery notes §5, row "New small ticket (wave 1)": "'Panel to Astro 7': `apps/web` from Astro 5.13.7 to 7.x, the CSP integration, e2e green. Before E4-A builds new pages."
- E10 epic page, risks: "The Astro 7 move breaks the panel (CSP integration, islands) (added) → own ticket, e2e and the CSP check green before E10a."
- ADR 0016 (accepted): "`script-src` never has [`'unsafe-inline'`]"; the meta CSP holds `default-src 'self'` and the fixed directives, with hashes for the inline island scripts.
- `spec/build.md` NEXT (owner decision 2026-11-13): "VPS, ssh and deploy steps are pre-approved; the coordinator does them (backup first, name the rollback target, verify after)."

### Product decisions

- **P1** One Astro major in the workspace: the panel moves to Astro 7 now, before E4-A (F102) adds pages and before E10a (F112) adds `apps/docs` with Starlight. Reason: PD-097. Rejected: two Astro majors in one workspace (two Vite majors, two compilers, one lockfile).
- **P2** No visible change: the same 16 pages, the same texts, the same CSP directives (ADR 0016). A user sees no difference. Reason: the ticket is a platform move; new behaviour belongs to F102 and F112.

### Design decisions

- **D1 Versions.** `astro` `7.4.12` and `@astrojs/react` `7.1.9` as exact pins; `tailwindcss` and `@tailwindcss/vite` `^4.3.5`; `@astrojs/check` stays `^0.9.4` (resolves 0.9.12, the newest). The transitive `@astrojs/astro2tsx` goes from 0.1.3 to 0.1.4 with `bun update @astrojs/astro2tsx` (fact F6). No other dependency changes. Reason: the CSP hashes and the island runtime come from `astro` and `@astrojs/react`, and the probe proved these two versions; a caret range lets a later `bun install` take a newer 7.x that nobody probed. Tailwind 4.1.13 does not accept Vite 8 (fact F1); its output is CSS only, so a caret range is enough. Rejected: caret for `astro` (see above); Astro 6 as a stop between (Starlight needs 7.2.10; two moves for nothing); a newer Astro than 7.4.12 at build time (not probed; a later ticket may bump it with the same checks).
- **D2 CSP option.** In `apps/web/astro.config.mjs`, the key `experimental` becomes `security`; the `csp` object inside stays the same (the 7 directives). Reason: Astro 7 rejects `experimental.csp` ("Invalid or outdated experimental feature") and reads `security.csp` with the same shape (fact F2). Rejected: `security: { csp: true }` (it drops the 7 directives).
- **D3 Markdown highlight off.** Add `markdown: { syntaxHighlight: false }` to the config, with a comment: the panel renders no Markdown; Shiki writes inline styles that the CSP does not allow. Reason: with CSP on, Astro 7 prints a Shiki warning on every build (fact F9); a clean build log keeps real warnings visible. Rejected: Prism (the panel has no code blocks); ignoring the warning.
- **D4 CSP build check (stage 01).** The integration `apps/web/integrations/csp-style-src.ts` keeps its relax step and adds a check of every built HTML page after the relax. The build fails (an `Error` from `astro:build:done`) when a page has not exactly one CSP meta, has no `default-src 'self'`, has no `script-src`, has `'unsafe-inline'` in `script-src`, or has a `style-src` that is not `style-src 'self' 'unsafe-inline'`; and when the build has no HTML page. It logs `csp checked in <n> page(s)`. Reason: today a lost CSP passes in silence: the integration throws only when a meta exists without `style-src`, and the e2e helper `cspErrors` sees no violation when no policy exists. The Astro 7 move changes exactly the option that writes the meta. Stage 01 lands on Astro 5 first, so the check is proven on the old output and guards stage 02. Rejected: a separate CI script (one more step to forget; the integration runs in every build: the `ci`, `e2e` and `image` jobs and the server image); an e2e test of the meta (it covers only the visited pages).
- **D5 Node in CI.** The `ci` job of `.github/workflows/ci.yml` gets `actions/setup-node@v4` with `node-version: 24` before `bun install`, the same as the `e2e` job. Reason: the Astro 7 CLI refuses a Node that does not satisfy `>=22.23.4` (fact F10). `bun run web:build` starts the CLI with the `node` on `PATH`; the Ubuntu 24.04 runner image has exactly Node 22.23.4, and `ubuntu-latest` moves to Ubuntu 26.04 in November 2026. The server image has no Node: Bun runs the CLI and reports Node 26.3.0, so the image build needs no change (fact F10). Rejected: `bun --bun` in the `web:build` script (it changes the local dev loop too; the image already works).
- **D6 No page or island change.** The build output is the same as on Astro 5 after normalization (fact F4), so stage 02 changes no file under `apps/web/src/`. One exception: when the Rust compiler of Astro 7 rejects an `.astro` file of a page that landed after this plan (an unclosed tag or invalid nesting, fact F12), the worker fixes that markup only and lists it in the final message. Any other source change is a question.
- **D7 `astro dev` in agent sessions.** Astro 7 runs `astro dev` in the background when it detects an agent (fact F11). No stage runs `astro dev` or `bun run web:dev`. Stage 03 records the fact in `README.md` and the Astro note, with the stop command.
- **D8 Docs (stage 03).** ADR 0016 gets an amendment (the CSP option is `security.csp`; the build check of D4); `docs/architecture.md` §7 gets one sentence for D4; `docs/capabilities/web-panel.md` drops its "Astro version" limit and names Astro 7 (PD-009: a landed change updates its capability page); `README.md` gets the D7 line; `notes/2026-11-13-astro-starlight-versions.md` gets a section with the facts of this plan that a later agent needs. Reason: ADR 0016 says "The hashed CSP depends on the Astro `experimental.csp` flag", which stage 02 makes false.
- **D9 Own VPS deploy (stage 04).** The coordinator deploys `master` to the VPS right after stage 03 lands and checks the served panel; then it closes the ticket. Reason: the change ships in the server image (the web dist); a check right after the deploy ties any panel fault to this change. F102 and F112 wait for this ticket in `done/`, so the ticket must close soon, not at "the next deploy". Rejected: ride the next normal deploy (F096 shape): the ticket would stay open and block F102 and F112, or close with no proof on the VPS.
- **D10 Rollback.** Code: `git revert` of the stage 02 land commit on `master` (never a force push). VPS: the image tag `ea-server:pre-f101` of stage 04. No migration exists, so no DB step.
- **D11 One lockfile change at a time.** Only stage 02 changes `bun.lock` and a `package.json`. The coordinator starts stage 02 only when no other job of any ticket changes `bun.lock` (`CLAUDE.md`: "Only one at a time adds a DB migration or changes `bun.lock`").
- **D12 Seams.** F112 (`apps/docs`) pins the same `astro` version as `apps/web` (7.4.12, or both move together), so Bun installs one copy; Starlight 0.43.1 (the newest, 2026-11-14) accepts `astro ^7.2.10`. Web stages of other tickets that land after stage 02 build on Astro 7 with no extra step (F099 stages 10, 11, 13; F098; F102).

### Edge cases (answered)

- **States × events, crash and repeat, tenants, clocks:** not relevant. No table, status, job or stored state changes.
- **Two runs at once:** `bun.lock` (D11). `test:e2e` uses the fixed ports 8081 and 8092: it runs under `flock /tmp/email-assistant-shared-tests.lock` with the job's own e2e database (§ Rules).
- **A page that lands between the plan and the build:** D6 (compiler fix only) and D4 (the check covers every page, also new ones).
- **A future page without the CSP meta on purpose:** none exists; D4 fails the build. A later ticket that needs one changes the check in its own plan.
- **Dev loop:** D7. The Vite 8 proxy with `timeout: 95_000` is not probed for a long poll (N4).
- **Rollback:** D10. **Image without Node:** D5, fact F10.
- **Secrets and private data:** no stage reads or prints `.env`. Stage 02 appends the e2e DB lines to the job's `.env` through a pipe and prints nothing. The VPS runbook prints no `.env` value, tailnet name or address.

## Facts checked (2026-11-14)

Probe P1: `git archive HEAD` (`a72b214`) into `.probe-f101/full/` inside the planning worktree (deleted after the plan), `apps/web/package.json` changed as D1, the config changed as D2 and D3, `bun install`. Probe P2: the same copy at Astro 5.13.7 with `bun install --frozen-lockfile`, for the compare. Bun 1.4.4, Node 26.13.1, system Chromium, Playwright 1.65.0.

- **F1 Versions** (`npm view`, 2026-11-14): `astro` 7.4.12 is the newest; it needs `node >=22.23.4`, depends on `vite ^8.3.6`, `rolldown`, `@astrojs/compiler-rs` (the Rust compiler) and `zod ^4.6.7`; its peer `@astrojs/markdown-remark` is optional. `@astrojs/react` 7.1.9 is the newest (peer `oxc-transform-react` optional). `@tailwindcss/vite` 4.1.13 accepts `vite ^5.2.0 || ^6 || ^7`; 4.3.5 accepts `|| ^8`. `@astrojs/check` 0.9.12 and `@astrojs/language-server` 2.17.3 are the newest. `@astrojs/astro2tsx` 0.1.4 depends on `@emnapi/runtime 1.11.3` (0.1.3 does not). `@astrojs/starlight` 0.43.1 needs `astro ^7.2.10`.
- **F2 CSP option:** Astro 7.4.12 `dist/core/config/schemas/base.js` lines 255–276: `security.csp` is `boolean` or `{ algorithm, directives, styleDirective, scriptDirective }`; `experimental` is a strict object without `csp`. `dist/core/csp/config.js`: `script-src` and `style-src` are not allowed in `directives`. P1 with `experimental.csp`: the build stops with "Invalid or outdated experimental feature".
- **F3 Build (P1):** 16 pages in about 0.8 s. Every page has one CSP meta: `default-src 'self';img-src 'self' data:;connect-src 'self';font-src 'self';form-action 'self';base-uri 'self';object-src 'none'; script-src 'self' <7 sha256 hashes>; style-src 'self' 'unsafe-inline';` (the same form and hash count as Astro 5). The integration logs `style-src relaxed in 16 page(s)`; the `astro:build:done` hook keeps its `({ dir, logger })` shape. The pages are the same 16 paths; the hashed `/_astro/` file names differ (the CSS chunk is `en.<hash>.css`, was `activity.<hash>.css`).
- **F4 Same markup (P1 against P2):** after removing `<script>` and `<style>` bodies, the CSP meta, the island `uid`, `prefix`, `component-url` and `renderer-url` values, the hashed file names and the whitespace between tags, 0 of 16 pages differ. The `<title>` text is the same (`Sign in · Email Assistant`). The new island runtime retries a failed import with `?astro-retry=<time>`; that path still matches `PUBLIC_PAGE_PATHS` `/^\/_astro\//` in `apps/server/src/platform/http.ts`.
- **F5 Hydration (P1 and P2):** [probes/hydrate-check.ts.txt](probes/hydrate-check.ts.txt) serves the dist with the header `frame-ancestors 'none'` and opens `/login/`, `/setup/`, `/settings/`, `/legal/pl/terms/` in headless Chromium: every island hydrates (no `ssr` attribute left), 0 CSP violations, 0 page errors, on both versions. Radix overlays were not opened (the e2e test "the pages keep the CSP and show the 404 page" in `auth.spec.ts` opens one: N2).
- **F6 Typecheck:** in P1, `astro check` with `@astrojs/astro2tsx` 0.1.3 stops with `this.bridge.setLastError is not a function` (`@emnapi/runtime` 2.0.0-beta.2, hoisted from the `rolldown` wasm binding, does not fit `@emnapi/core` 1.11.3). `bun update @astrojs/astro2tsx` takes 0.1.4, changes only `bun.lock` (no `package.json`), and `astro check` then reports 143 files, 0 errors, 0 warnings, 0 hints. The same result with D3 in the config.
- **F7 Lint and unit (P1):** `bunx eslint apps/web` exits 0 (`eslint-plugin-astro` 1.3.1 and `prettier-plugin-astro` 0.14.1 keep their own compiler). `bun test apps/web/src/lib apps/web/src/i18n apps/web/integrations`: 134 pass, 0 fail.
- **F8 Lockfile (P1):** `bun install --frozen-lockfile` passes after the change. Unchanged: `better-auth` 1.7.18, `react` and `react-dom` 19.1.1, `zod` 4.6.7, `hono` 4.13.16, `typescript` 5.9.3, `@playwright/test` 1.65.0, `eslint` 9.23.0, `prettier` 3.6.2, `radix-ui` 1.8.1. Changed: `vite` 6.3.6 → 8.3.8, `tailwindcss` and `@tailwindcss/vite` 4.1.13 → 4.3.5, `astro`, `@astrojs/react`, `@astrojs/astro2tsx`. `bun.lock`: +316 −472 lines. Only `apps/web/package.json` changes.
- **F9 Shiki warning:** with CSP on, every Astro 7 build logs `[WARN] [config] Shiki syntax highlighting uses inline styles that are not compatible with Content Security Policy (CSP)…`. With `markdown: { syntaxHighlight: false }` the warning is gone and the build and `astro check` pass.
- **F10 Node:** `node_modules/astro/bin/astro.mjs` checks `process.versions.node` against `>=22.23.4` when the major is 23 or lower, and stops with an "unsupported Node" error if it fails. Bun 1.4.4 reports `process.versions.node` 26.3.0. `bun --bun run x` runs a `#!/usr/bin/env node` bin under Bun (`bun=1.4.4 node=26.3.0`); plain `bun run x` uses the system Node. A build with `PATH` holding only `bun`, `sh` and `env` (no Node, as in `oven/bun:1.4.4`) passes, and so does `bun --bun run --cwd apps/web build`. GitHub runner image Ubuntu 24.04 `20261111.370.1`: Node.js 22.23.4; the readme announces "`ubuntu-latest` label will use Ubuntu 26.04 in November 2026" (`actions/runner-images` `images/ubuntu/Ubuntu2404-Readme.md`, read 2026-11-14).
- **F11 Dev server:** `astro dev` in an agent session answers "Dev server running at http://localhost:<port> (pid …) Stop: astro dev stop" and keeps running in the background (`dist/cli/dev/index.js`: `wantsBackground = flags.background || supportsAgentAutoBackgrounding(…) && agentDetected && !ignoreLock`). `astro dev status`, `astro dev stop` and `astro dev logs` exist; `--ignore-lock` keeps it in the foreground. It writes `apps/web/.astro/dev.log` (git ignores `.astro/`). The `/api` proxy answered 502 with no server behind it (the proxy is active).
- **F12 Upgrade guides** (docs.astro.build `/en/guides/upgrade-to/v6/` and `/v7/`, read 2026-11-14): v6: Node 22, Vite 7, Zod 4, experimental flags made stable, `<script>` and `<style>` in source order, `getStaticPaths` params cannot be numbers (the legal page uses strings). v7: Vite 8; the Rust compiler is the only compiler and is stricter (an unclosed tag is an error; invalid nesting is not corrected); `compressHTML` default `'jsx'` (whitespace by JSX rules); `src/fetch.ts` is reserved (the panel has none); Markdown through Sätteri. None of these changes the panel output (F4).

## Not verified

- **N1 The server image build on Astro 7.** No Docker access in planning. F10 proves the Bun-only build. Checked by: the `image` job of the first `master` CI run after the land of stage 02 (stage 02 § After the land, coordinator).
- **N2 The full e2e suite and the Radix scroll-lock style on Astro 7.** Planning runs no e2e (job rule). Checked by: the stage 02 Proof (full suite, both projects, under the shared lock).
- **N3 The CI `ci` job with Node 24.** Checked by: the same first `master` CI run (N1).
- **N4 The Vite 8 dev proxy `timeout: 95_000` for a long request.** Dev loop only. Checked by: nobody in this ticket; the owner's next `bun run web:dev` session shows it. Stage 03 writes it into the note as open.
- **N5 The panel on the VPS.** Checked by: stage 04 checks.
- **N6 Firefox and Safari.** Not probed (as in S5a). Not checked in this ticket.

## Done when

1. `apps/web` builds on `astro` 7.4.12 and `@astrojs/react` 7.1.9, and `bun.lock` holds one `astro` entry. Shown by: `grep -c '\["astro@' bun.lock` prints `1` and `grep -o '\["astro@[^"]*' bun.lock` prints `["astro@7.4.12`; `bun install --frozen-lockfile` passes (stage 02 log).
2. Every built page has one CSP meta with the ADR 0016 directives, and a broken meta fails the build. Shown by: stage 01 tests 1–10; the stage 02 build log line `csp checked in 16 page(s)`.
3. `bun run lint`, `bun run typecheck`, `bun run test:unit:ci`, `bun run test:int:ci` pass at each stage commit. Shown by: the Proof logs of stages 01–03.
4. The full e2e suite passes on Astro 7 on the desktop and mobile projects, with no CSP violation. Shown by: the stage 02 e2e log.
5. The `ci`, `e2e` and `image` jobs of the first `master` CI run after the stage 02 land are green. Shown by: `gh run list --branch master --workflow CI --limit 3` and `gh run view <id>`, written into § Log.
6. ADR 0016, `docs/architecture.md` §7, `docs/capabilities/web-panel.md`, `README.md` and the Astro note say Astro 7, `security.csp` and the build check. Shown by: the stage 03 diff and its Proof.
7. The VPS serves the Astro 7 panel with the CSP meta. Shown by: stage 04 checks 1–6, written into § Log.

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, the ticket, this file and your stage file first. Build only your stage.
- Format only the files of your stage: `bunx prettier --write <files>`. Never `bun run format` or `prettier --write .` (an S2 builder ran the repo-wide formatter). `bun.lock` is never formatted by hand.
- Commit by explicit path (`git add <paths>`), never `git add -A`. Review `git diff --staged` before each commit.
- Never read, print or copy `.env` or a secret. Template literals for strings with variables; `const` / `let` only. Comments name a rule or an ADR, not a bare code.
- Only stage 02 changes `bun.lock` or a `package.json` (D1, D11). No other stage adds or bumps a dependency. If you think you need one, stop and ask.
- No file under `apps/web/src/` changes, except the narrow compiler fix of D6 in stage 02.
- Do not run `astro dev` or `bun run web:dev` (D7). If you started one, stop it with `bunx astro dev stop` in `apps/web` before you finish.
- e2e (stage 02 only): this machine has no Playwright browser; use `CHROMIUM_PATH=/usr/bin/chromium`. Before the first e2e run, give the job its own e2e database: first `sed -i -E '/^E2E_(MIGRATOR_)?DATABASE_URL=/d' .env`, then `bun run db:worktree f101_s02_e2e | grep -E '^(DATABASE_URL|MIGRATOR_DATABASE_URL)=' | sed 's/^/E2E_/' >> .env` (the name must end in `_e2e`). Never point e2e at the shared `email_assistant_e2e`. Run every `test:e2e` under `flock /tmp/email-assistant-shared-tests.lock` (fixed ports 8081 and 8092).
- While you work, run only the checks of your step. The full Proof runs once, after the last commit.
- Do not edit `spec/build.md`, `docs/product/stage-2/*` or another ticket.
- A gap or a deviation is a question in your final message, not a choice.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message list as proven only what a saved log shows. `test:int:ci` needs no lock (each job has its own DB, `CLAUDE.md`).

Stage 01:

```
mkdir -p /tmp/f101-s01 && bun run lint > /tmp/f101-s01/lint.log 2>&1 && bun run typecheck > /tmp/f101-s01/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f101-s01/unit.log 2>&1 && bun run test:int:ci > /tmp/f101-s01/int.log 2>&1 && bun run web:build > /tmp/f101-s01/web.log 2>&1 && grep -q 'csp checked in 16 page(s)' /tmp/f101-s01/web.log && echo PROOF_OK
```

Stage 02 (the build under Bun mirrors the server image, D5; the e2e uses that dist):

```
mkdir -p /tmp/f101-s02 && bun install --frozen-lockfile > /tmp/f101-s02/install.log 2>&1 && bun run lint > /tmp/f101-s02/lint.log 2>&1 && bun run typecheck > /tmp/f101-s02/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f101-s02/unit.log 2>&1 && bun run test:int:ci > /tmp/f101-s02/int.log 2>&1 && bun run web:build > /tmp/f101-s02/web.log 2>&1 && grep -q 'csp checked in 16 page(s)' /tmp/f101-s02/web.log && bun --bun run --cwd apps/web build > /tmp/f101-s02/web-bun.log 2>&1 && grep -q 'csp checked in 16 page(s)' /tmp/f101-s02/web-bun.log && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f101-s02/e2e.log 2>&1 && echo PROOF_OK
```

If a page landed on `master` after this plan, the count `16` differs: use the number of `.html` files under `apps/web/dist` (`find apps/web/dist -name '*.html' | wc -l`) and say so in the final message.

Stage 03 (`<files>` = the Markdown files the stage changed):

```
mkdir -p /tmp/f101-s03 && bunx prettier --check <files> > /tmp/f101-s03/prettier.log 2>&1 && bun run lint > /tmp/f101-s03/lint.log 2>&1 && bun run test:unit:ci > /tmp/f101-s03/unit.log 2>&1 && echo PROOF_OK
```

Stage 04 has its own checks (stage file).

## User checkpoints

None (owner rule 2026-11-14: no checkpoints for confirmation). The review jobs of § Review replace them.

## User steps

None needs the owner's hands. The coordinator runs:

| #   | Step                                                                                         | When                     |
| --- | -------------------------------------------------------------------------------------------- | ------------------------ |
| C1  | Check the first `master` CI run after the land (all three jobs), write the result in § Log.  | after stage 02 lands     |
| C2  | Stage 04 on the VPS (deploy, checks, close the ticket).                                      | after stage 03 lands     |

Optional for the owner, after stage 04: open the panel and sign in. Nothing waits for it.

## Review

- A review job before the land for stage 01 (security check) and stage 02 (`[risky]`: dependencies, CSP). Model: the board's reviewer (`spec/build.md` § TRACK: `claude-sonnet-5-5`, high). Stage 03 lands on the worker's proof.
- Review spawn (after the worker job is done; `<B>` = the job's branch):

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --review --detached --branch <B> --label "review s<NN> · F101" \
  "Review F101 stage NN on <B> against spec/features/active/F101-panel-to-astro-7/plan.md and stages/stage-NN-<slug>.md. Check that every numbered test exists and asserts what the stage says, and every decision the stage cites. Stage 01: try to build a page that passes the check with no CSP, with 'unsafe-inline' in script-src, or with a hashed style-src. Stage 02: compare the built CSP meta of every page with ADR 0016; check that bun.lock changes only the astro, vite and tailwind trees and @astrojs/astro2tsx, that no other package.json changed, that the e2e log covers both projects with 0 failures, and that no file under apps/web/src changed outside D6. Quote file and line for each finding."
```

## Stages

| #   | Stage                                                                                                          | Size       | Mark                              |
| --- | -------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------- |
| 01  | [CSP build check](stages/stage-01-csp-build-check.md) — the integration checks every built page (Astro 5)      | ~150 lines |                                   |
| 02  | [Astro 7](stages/stage-02-astro-7.md) — versions, lockfile, `security.csp`, CI Node, full e2e                    | ~30 lines + `bun.lock` | `[risky]` dependencies, CSP |
| 03  | [Docs](stages/stage-03-docs.md) — ADR 0016 amendment, architecture, capability page, README, note              | ~70 lines  |                                   |
| 04  | [VPS deploy](stages/stage-04-vps-deploy.md) — coordinator only                                                 | —          | `[risky]` real system             |

Order: 01 → 02 → 03 → 04, each landed before the next starts. No stage runs in parallel with another of this ticket.

## How to run (coordinator)

1. Before the first spawn: F095 is in `spec/features/done/`. Move the ticket: `git mv spec/features/planned/F101-panel-to-astro-7 spec/features/active/`, commit (the worktrees see only committed files).
2. Spawn one stage (`NN` = two digits, `<slug>` from § Stages):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "F101-sNN <slug> · F101" \
     "Implement F101 stage NN. Read spec/features/active/F101-panel-to-astro-7/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for your stage (/tmp/f101-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

3. Before stage 02: no other job of any ticket changes `bun.lock` (D11). While stage 02 runs, start no other job that changes `bun.lock`.
4. When the job finishes: read its final message and `/tmp/f101-sNN/*.log`. For stages 01 and 02, spawn the review job of § Review and wait for it; a finding → `limen continue <job-id> "<fix>"` with the same engine flags, then review again (at most 2 rounds, then the owner decides).
5. Land: `limen land <job-id> --yes --keep-open`. Drop the job DB from the main checkout: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop`; after stage 02 also `bun run db:worktree f101_s02_e2e --drop`.
6. After the stage 02 land: user step C1. A red job → `docs/code-patterns.md` § Tests and D10 (revert the land the same day if the fix is not small).
7. When a land conflicts (another ticket landed a web file or `bun.lock`), run `limen continue <job-id> "Run git merge master in your worktree, fix the conflict, run the Proof again."` with the same engine flags, then land again. A `bun.lock` conflict: take `master`'s `bun.lock`, then run the stage 02 Step 1 commands again.
8. After stage 03 lands: run stage 04 yourself; it closes the ticket.
9. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass. A check with no proof at all → `limen continue`.

## Cold review

Pending.

## Log

- 2026-11-14: planned by a `--role planner` job (Opus 5.5). Probes P1 and P2 in a temp folder of the planning worktree.
