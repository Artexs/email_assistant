# F121 stage 07 — Shots from the demo seed

Needs: nothing new; it reads the shot run, `importDemo` and the e2e seed at HEAD. May run next to 01 and 08 (01 also edits `astro.config.mjs`: merge, re-prove). Playwright: lock rule until F136 lands.

Part of [`../plan.md`](../plan.md). `[risky]` public data: a wrong import or a missed scan puts data on a public site. Decisions D5, D6. Extra proof link: `flock /tmp/email-assistant-shared-tests.lock bun run docs:shots > /tmp/f121-s07/shots.log 2>&1` before `echo PROOF_OK`.

Carry-over reads: `apps/web/e2e/docs-shots/` (global setup, spec), `apps/docs/src/shots.ts`, `notes/2026-11-18-f112-s11-shot-run.md`, `docs/capabilities/live-lab.md` rule 24 (export and import guards), `apps/server/src/modules/lab/demo-seed/`, `apps/server/test/integration/lab-demo-seed.test.ts` (how tests make a seed).

## Step 1 — Seed source

**Goal.** The shot run uses the demo organization when its seed file is there.

**Files.** `apps/web/e2e/docs-shots/` (global setup, a new `source.ts`), tests.

**Decisions.**
- `shotSource()` (stage 10 calls it too, D5): `DEMO_SEED_FILE` if set, else the default path; `demo` when the file exists, else `e2e` (today's run). An env path that does not exist is an error (`demo_seed_missing`), not a silent fallback.
- Demo import: `importDemo` (no new import code) with `SEND_SCOPE` unset and `replace: true`, so a rerun on the same DB works (the shot path never connects a mailbox, so the paused placeholder stays and `--replace` is allowed; review 1 N9). Owner address `demo-owner@demo.test`, a constant that is not an e2e seed user (the e2e wipe deletes those).
- Sign-in (review 1 N10): the import makes the owner without a password. The setup gives the owner a password and accepts the current terms through the same product paths the e2e seed uses for its users (the Better Auth sign-up or reset path, then `POST /api/me/terms`); no SQL. The worker names the path it used.
- Flags: the import org keeps every flag off; the existing `shotFeaturesProblem` check runs on it. Data that a flagged feature made in the demo week stays hidden, because the panel hides it while the flag is off. Only the five pages of today's shot list are shot.
- The run logs `shots_source demo` or `shots_source e2e` once.
- The imported mailbox is paused (rule 24.7): the alt texts of the shots say what the picture shows; update them when the source is `demo` (alt text per source in `shots.ts`).

**Test.**
1. `shotSource` with no env and no file → `e2e`; with the default file present → `demo`; with env set to a missing path → throws `demo_seed_missing`.
2. Integration (own DB): a seed made the way `lab-demo-seed.test.ts` makes one, imported by the shot setup → the owner sees the org "Kordelan demo (import)", one mailbox, ≥ 1 activity row.
3. A seed whose one email body holds `boss@example.com` makes the shot setup fail with `non_test_address` and imports nothing (proves the shot path uses the guarded `importDemo`). Mutation: call the insert step without the scan → test 3 fails.

## Step 2 — Image-path check

**Goal.** A page cannot show an image added by hand (notes §4.4).

**Files.** A new rule in the docs build integrations (next to `linkCheck`) and its test.

**Decisions.** Every image source in the built HTML and CSS points into the shots folder, Starlight's own assets, `favicon.svg`, or `public/brand/`: `<img src>`, each `srcset` entry, `<source src|srcset>`, `<video poster>`, and CSS `url()` of an image type (review 1 N11). Anything else fails the build with `image_outside <src>`. The demo video files (stage 11) are media, not images; this check ignores `.mp4` and `.vtt`.

**Test.**
4. A built page with `<img src="/email_assistant/shots/x.png">` passes; `<img src="/email_assistant/other.png">` fails `image_outside`.
5. `srcset="/email_assistant/shots/a.png 1x, /email_assistant/x.png 2x"` fails on the second entry; `poster="/email_assistant/x.jpg"` fails; CSS `url(/email_assistant/x.png)` fails.
6. Two shot setups in a row on the same DB with the same seed both succeed (the `replace` path); the org count named "Kordelan demo (import)" is 1.
7. The import org has no flag on (`shotFeaturesProblem` returns null).

**Check.** `bun test apps/web/e2e/docs-shots apps/docs/integrations`, the integration test file, `bun run docs:build`, the shots run under the lock (with no seed file: source `e2e`; with a test seed in `DEMO_SEED_FILE`: source `demo`).

**Done when.** Tests 1–7 pass; both shot runs succeed and the logs show both sources; Proof prints `PROOF_OK`.

**Out of scope.** Committing a seed (G2); new shot pages; the video.
