# F121 interfaces (names that cross stages)

Part of [`plan.md`](plan.md). A stage that creates a name below keeps it. A worker that must change one stops and asks.

## Docs app (`apps/docs`)

- Stage 01, `apps/docs/src/publish-gate.ts`: `OWNER_REVIEW_PENDING: readonly string[]` (English page ids, for example `"security"`). `publishHoldReason(pending): string | null` → `"owner_review_pending <ids>"` or null. `deployDecision` (in `scripts/deploy-gate.ts`) gains a `pending: readonly string[]` input; a pushed tag that would deploy returns `{ deploy: false, reason: "skip: owner_review_pending <ids>" }` (no `error`). `workflow_dispatch` ignores it.
- Stage 01, `apps/docs/src/security/claims.ts`:
  - `Texts = { en: string; pl: string }` (reuse the core type if one exists).
  - `PublicClaim = { id: string; text: Texts; ledger: readonly string[]; proofs: readonly string[]; condition: Texts | null }`. `ledger` = row ids of `docs/legal/claims.md` (`C018`); `proofs` = repo paths, relative to the repo root.
  - `publicClaims: readonly PublicClaim[]` (stage 01: empty array; stage 02 fills it).
  - `claimProblems(claims, root, ledgerText): string[]`, each `claim <id> <reason>`; reasons: `proof_missing <path>`, `ledger_missing <C…>`, `ledger_weak <C…>` (source starts with `gap` or `unverified`), `no_proof`, `duplicate_id`.
  - `proofUrl(path, ref = docsGitRef()): string` → `${REPO_URL}/blob/${ref}/${path}`.
- Stage 01, build integration `claimCheck` (in `astro.config.mjs` next to `linkCheck`): runs `claimProblems`; any problem fails the build with the list; logs one line `claim_check ok <n>`.
- Stage 02, component `ClaimsTable.astro` (`lang: "en" | "pl"`), `Subprocessors.astro` (`lang`), both read data, no hand text in the page body for rows.
- Stage 03, component `CostTable.astro` (`lang`); `costRows(): { mailsPerDay: 50 | 100 | 200; llmUsd; hostingUsd; backupUsd; totalUsd; marginUsd }[]` in `apps/docs/src/pricing.ts`, rounded to 2 decimals; `basis` from `costToRun`.
- Stage 05: `POLISH_SET` gains `security`, `pricing`; the strict set of `scripts/stale.ts` = `index`, `start*`, `security`, `pricing`.
- Stage 10, component `DemoVideo.astro` (`lang`): renders a `<video>` with two `<track>` only when the three files exist in `apps/docs/public/demo/` at build; else nothing.

## Core (`packages/core/src/site.ts`)

- Stage 03: `PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH = 25`.
- Read only: `PRODUCT_NAME`, `DOCS_ORIGIN`, `DOCS_BASE`; from `@ea/core`: `costToRun`, `pilotCost` (F107 stage 08), `subprocessors` (F107 stage 01).

## Server

- Stage 06: script `apps/server/src/scripts/api-spec.ts`, `bun run api:spec [--check]`; writes `docs/api/openapi.json` (2-space JSON, keys in build order, newline at end). `--check` exits 1 with `openapi_drift` when the file differs. `buildPublicSpec(): Promise<object>` is the one function both the script and the drift test call.

## Shots and demo (`apps/web/e2e`)

- Stage 07: `DEMO_SEED_FILE` env, default `apps/web/e2e/demo/demo-seed.json`. `shotSource(): { kind: "demo"; file: string } | { kind: "e2e" }` in `docs-shots/`. The run logs `shots_source demo|e2e`.
- Stage 09: `bun run demo:record --seed <file> [--out <dir>]` (default out `tmp/demo/`, ignored by git). Script table `DEMO_STEPS: readonly { id: string; seconds: number; caption: Texts; live: boolean }[]` in `apps/web/e2e/demo/steps.ts`. `toVtt(steps, lang): string`. Output files `demo.mp4`, `demo.en.vtt`, `demo.pl.vtt`.

## Fake Telegram (`tools/fake-telegram`)

- Stage 08: `GET /_fake/view` (HTML; loopback only like the other `/_fake/*` routes), `GET /_fake/view?chat=<id>`. `renderChatView(state, chatId | null): string` in `src/view.ts` (pure; escapes every text). Title "Test Telegram — not real". Buttons are shown as labels, never as forms.
