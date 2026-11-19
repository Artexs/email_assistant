# F121 interfaces (names that cross stages)

Part of [`plan.md`](plan.md). A stage that creates a name below keeps it. A worker that must change one stops and asks.

## Docs app (`apps/docs`)

- Stage 01, `apps/docs/src/publish-gate.ts`: `OWNER_REVIEW_PENDING: readonly string[]` (English page ids; initial `index`, `security`, `pricing`, `reference/api`, `reference/autonomy-evidence`). `publishHoldReason(pending): string | null` → `"owner_review_pending <ids>"` or null. `deployDecision` gains inputs `pending: readonly string[]` and `publishHeld: boolean` (the dispatch input `publish_held_pages`, default false); held → `{ deploy: false, reason: "skip: owner_review_pending <ids>" }`, no `error`. `main(…, pending = OWNER_REVIEW_PENDING)`: a parameter, never env.
- Stage 01, `apps/docs/src/security/claims.ts`:
  - `Texts = { en: string; pl: string }` (reuse the core type if one exists).
  - `PublicClaim = { id: string; text: Texts; ledger: readonly string[]; proofs: readonly string[]; condition: Texts | null }`. `ledger` = row ids of `docs/legal/claims.md` (`C018`); `proofs` = repo paths, relative to the repo root.
  - `publicClaims: readonly PublicClaim[]` (stage 01: empty array; stage 02 fills it).
  - `claimProblems(claims, root, ledgerText): string[]`, each `claim <id> <reason>`; reasons: `proof_missing <path>`, `proof_not_in_ledger <path>`, `ledger_missing <C…>`, `ledger_weak <C…>` (source cell holds the word `gap` or `unverified` anywhere), `condition_missing`, `no_proof`, `duplicate_id`.
  - `proofUrl(path, ref = docsGitRef()): string` → `${REPO_URL}/blob/${ref}/${path}`.
- Stage 01, build integration `claimCheck` (in `astro.config.mjs` next to `linkCheck`): runs `claimProblems`; any problem fails the build with the list; logs one line `claim_check ok <n>`.
- Stage 02, component `ClaimsTable.astro` (`lang: "en" | "pl"`), `Subprocessors.astro` (`lang`), both read data. `subprocessorView(row, lang)` in `apps/docs/src/security/subprocessor-view.ts`: a placeholder field (`<…>`) → "Not confirmed yet" / "Jeszcze nie potwierdzone"; a placeholder `termsUrl` → null.
- Stage 03, component `CostTable.astro` (`lang`); `costRows(compute = costToRun): { mailsPerDay: 50 | 100 | 200; llmUsd; hostingUsd; backupUsd; totalUsd; marginUsd }[]` in `apps/docs/src/pricing.ts`, built with `roundedCostRow`; `basis` from `costToRun`.
- Stage 05: `POLISH_SET` gains `security`, `pricing`; the strict set of `scripts/stale.ts` = `index`, `start*`, `security`, `pricing`.
- Stage 11, component `DemoVideo.astro` (`lang`): renders a `<video>` with two `<track>` only when the three files exist in `apps/docs/public/demo/` at build; else nothing. `DEMO_VIDEO_SHA256: string | null` in `apps/docs/src/demo-video.ts` (null = no download); `scripts/demo-fetch.ts` downloads and checks it.

## Core (`packages/core/src/site.ts`)

- Stage 03: `PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH = 25`.
- Stage 03, `packages/core/src/metrics/cost-model.ts`: `roundedCostRow(cost: CostToRun, priceUsd: number): { llmUsd; hostingUsd; backupUsd; totalUsd; marginUsd }`: each value rounded half up to the cent (`Math.round((v + 1e-9) * 100) / 100`, the doc test's rule); `marginUsd = round(price − round(totalUsd))`. The pricing page and `cost-model-doc.test.ts` both use it.
- Read only: `PRODUCT_NAME`, `DOCS_ORIGIN`, `DOCS_BASE`; from `@ea/core`: `costToRun(mailsPerDay, { mailboxesPerHost?, pilot? })`, `pilotCost`, `costModel`; from `@ea/core/web`: `subprocessors` (10 rows after F138 stage 02).

## Server

- Stage 07: `apps/server/src/scripts/demo-org-setup.ts`, `setupDemoOrg(db, { seedFile, ownerPassword }): Promise<{ orgId: string; ownerEmail: string }>`: `importDemo` with `replace: true`, then the owner's password and terms by the paths of `e2e-seed.ts`; no SQL. Runs as a command from the shot setup (stage 07) and the record setup (stage 10).

- Stage 06: script `apps/server/src/scripts/api-spec.ts`, `bun run api:spec [--check]`; writes `docs/api/openapi.json` (2-space JSON, keys in build order, newline at end). `--check` exits 1 with `openapi_drift` when the file differs. `buildPublicSpec(): Promise<object>` is the one function both the script and the drift test call.

## Shots and demo (`apps/web/e2e`)

- Stage 07: `DEMO_SEED_FILE` env, default `apps/web/e2e/demo/demo-seed.json`. `shotSource(): { kind: "demo"; file: string } | { kind: "e2e" }` in `apps/web/e2e/lib/shot-source.ts`; stage 10 calls it too. `apps/web/e2e/lib/` holds the pure modules and their bun tests and is in `test:unit` (D11); Playwright folders hold specs only. The run logs `shots_source demo|e2e`. Demo owner `demo-owner@demo.test`; import with `replace: true`.
- Stage 09, `apps/web/e2e/lib/demo/`: `DEMO_STEPS: readonly { id: string; seconds: number; caption: Texts; live: boolean }[]` (`steps.ts`); `toVtt(cues: readonly { stepId: string; startMs: number; endMs: number }[], lang): string` (cue times already shifted by the trim); `ffmpegArgs({ input, output, trimStartMs }): string[]` (`encode.ts`); `demoDbProblem(url, others): string | null` (`db-guard.ts`; name must end `_demo`).
- Stage 10: `bun run demo:record [--seed <file>] [--out <dir>]` (default `tmp/demo/`, git-ignored), env `DEMO_DATABASE_URL` and `DEMO_MIGRATOR_DATABASE_URL` (coordinator step C3; in `.env.example`, empty); parser `apps/web/e2e/lib/demo/record-args.ts`; spec and config in `apps/web/e2e/demo/`; no `--seed` → `shotSource()` decides (e2e seed until G2, D10); logs `demo_source e2e|demo`. Output `demo.mp4`, `demo.en.vtt`, `demo.pl.vtt`; prints duration, size, sha256.

## Fake Telegram (`tools/fake-telegram`)

- Stage 08: `GET /_fake/view` (HTML; loopback only like the other `/_fake/*` routes), `GET /_fake/view?chat=<id>`. `renderChatView(state, chatId | null): string` in `src/view.ts` (pure; escapes every text). Title "Test Telegram — not real". Buttons are shown as labels, never as forms.
