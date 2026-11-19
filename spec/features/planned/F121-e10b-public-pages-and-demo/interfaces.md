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
- Stage 03, component `CostTable.astro` (`lang`); `costRows(): { mailsPerDay: 50 | 100 | 200; llmUsd; hostingUsd; backupUsd; totalUsd; marginUsd }[]` in `apps/docs/src/pricing.ts`, each rounded to 2 decimals; `marginUsd = round2(price − round2(totalUsd))`; `basis` from `costToRun`.
- Stage 05: `POLISH_SET` gains `security`, `pricing`; the strict set of `scripts/stale.ts` = `index`, `start*`, `security`, `pricing`.
- Stage 11, component `DemoVideo.astro` (`lang`): renders a `<video>` with two `<track>` only when the three files exist in `apps/docs/public/demo/` at build; else nothing. `DEMO_VIDEO_SHA256: string | null` in `apps/docs/src/demo-video.ts` (null = no download); `scripts/demo-fetch.ts` downloads and checks it.

## Core (`packages/core/src/site.ts`)

- Stage 03: `PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH = 25`.
- Read only: `PRODUCT_NAME`, `DOCS_ORIGIN`, `DOCS_BASE`; from `@ea/core`: `costToRun`, `pilotCost` (F107 stage 08), `subprocessors` (F107 stage 01).

## Server

- Stage 06: script `apps/server/src/scripts/api-spec.ts`, `bun run api:spec [--check]`; writes `docs/api/openapi.json` (2-space JSON, keys in build order, newline at end). `--check` exits 1 with `openapi_drift` when the file differs. `buildPublicSpec(): Promise<object>` is the one function both the script and the drift test call.

## Shots and demo (`apps/web/e2e`)

- Stage 07: `DEMO_SEED_FILE` env, default `apps/web/e2e/demo/demo-seed.json`. `shotSource(): { kind: "demo"; file: string } | { kind: "e2e" }` in `docs-shots/`. The run logs `shots_source demo|e2e`. Demo owner `demo-owner@demo.test`; import with `replace: true`.
- Stage 09, `apps/web/e2e/demo/`: `DEMO_STEPS: readonly { id: string; seconds: number; caption: Texts; live: boolean }[]` (`steps.ts`); `toVtt(cues: readonly { stepId: string; startMs: number; endMs: number }[], lang): string` (cue times already shifted by the trim); `ffmpegArgs({ input, output, trimStartMs }): string[]` (`encode.ts`); `demoDbProblem(url, others): string | null` (`db-guard.ts`; name must end `_demo`).
- Stage 10: `bun run demo:record --seed <file> [--out <dir>]` (default `tmp/demo/`, git-ignored), env `DEMO_DATABASE_URL`. Output `demo.mp4`, `demo.en.vtt`, `demo.pl.vtt`; prints duration, size, sha256.

## Fake Telegram (`tools/fake-telegram`)

- Stage 08: `GET /_fake/view` (HTML; loopback only like the other `/_fake/*` routes), `GET /_fake/view?chat=<id>`. `renderChatView(state, chatId | null): string` in `src/view.ts` (pure; escapes every text). Title "Test Telegram — not real". Buttons are shown as labels, never as forms.
