# F121 stage 07 — Shots from the demo seed

Part of [`../plan.md`](../plan.md). `[risky]` public data: a wrong import or a missed scan puts data on a public site. Decisions D5, D6. Needs stage 01. Extra proof link: `flock /tmp/email-assistant-shared-tests.lock bun run docs:shots > /tmp/f121-s07/shots.log 2>&1` before `echo PROOF_OK`.

Carry-over reads: `apps/web/e2e/docs-shots/` (global setup, spec), `apps/docs/src/shots.ts`, `notes/2026-11-18-f112-s11-shot-run.md`, `docs/capabilities/live-lab.md` rule 24 (export and import guards), `apps/server/src/modules/lab/demo-seed/`, `apps/server/test/integration/lab-demo-seed.test.ts` (how tests make a seed).

## Step 1 — Seed source

**Goal.** The shot run uses the demo organization when its seed file is there.

**Files.** `apps/web/e2e/docs-shots/` (global setup, a new `source.ts`), tests.

**Decisions.**
- `shotSource()`: `DEMO_SEED_FILE` if set, else the default path; `demo` when the file exists, else `e2e` (today's run). An env path that does not exist is an error (`demo_seed_missing`), not a silent fallback.
- Demo import: `importDemo` (no new import code) into the shot run's own database with `SEND_SCOPE` unset, `--email` = a fixed `.test` owner address; then sign in as that owner. The import guards run as they do for the CLI.
- Flags for the shown pages: only the pages the shot list has today (onboarding, mailboxes, settings, rules, activity); no flagged page is shot (owner rule).
- The run logs `shots_source demo` or `shots_source e2e` once.
- The imported mailbox is paused (rule 24.7): the alt texts of the shots say what the picture shows; update them when the source is `demo` (alt text per source in `shots.ts`).

**Test.**
1. `shotSource` with no env and no file → `e2e`; with the default file present → `demo`; with env set to a missing path → throws `demo_seed_missing`.
2. Integration (own DB): a seed made the way `lab-demo-seed.test.ts` makes one, imported by the shot setup → the owner sees the org "Kordelan demo (import)", one mailbox, ≥ 1 activity row.
3. Mutation: skip the import's address scan in a local edit → test of rule 24.4 in `demo-seed.test.ts` fails (prove the shot path calls the guarded import, not a copy).

## Step 2 — Image-path check

**Goal.** A page cannot show an image added by hand (notes §4.4).

**Files.** A new rule in the docs build integrations (next to `linkCheck`) and its test.

**Decisions.** Every `<img src>` in the built HTML points into the shots folder, Starlight's own assets, `favicon.svg`, or `public/brand/`. Anything else fails the build with `image_outside <src>`.

**Test.**
4. A built page with `<img src="/email_assistant/shots/x.png">` passes; `<img src="/email_assistant/other.png">` fails `image_outside`.

**Check.** `bun test apps/web/e2e/docs-shots apps/docs/integrations`, the integration test file, `bun run docs:build`, the shots run under the lock (with no seed file: source `e2e`; with a test seed in `DEMO_SEED_FILE`: source `demo`).

**Done when.** Tests 1–4 pass; both shot runs succeed and the logs show both sources; Proof prints `PROOF_OK`.

**Out of scope.** Committing a seed (G2); new shot pages; the video.
