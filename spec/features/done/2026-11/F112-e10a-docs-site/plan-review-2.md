# F112 plan review 2 (refresh 1, job 2026-11-15-f112-plan-review-e9815171, claude-opus-5-5, high)

Filed whole from the job result. Fixes: [plan-refresh-1.md](plan-refresh-1.md) § Review 2 fixes.

FAIL cc350b6554e5af7829564d540f60d89afdca72b3

The refreshed F112 plan fails: refresh 1 publishes F114's `0.1.0` changelog text on a public page without a P2 decision (B1), and it leaves stage 07's site-map test with an old id list (B2). The other refresh changes hold against the code at HEAD. HEAD = cc350b6554e5af7829564d540f60d89afdca72b3, the same as the candidate.

## Blocking findings

**B1. The public changelog page holds lines about default-off features, and no decision covers it. Proven by reading the text.**
- Files: `stages/stage-13-changelog.md:15` and `:42`, `plan.md:16` (P2), `stages/stage-15-panel-ui.md:15`.
- Before refresh 1, stage 13 made a new `CHANGELOG.md` with only `Unreleased` and one docs-site item. That page fit P2.
- Now stage 13 says "Keep F114's text and `0.1.0` unchanged". It renders the whole file as the page `changelog`. The transform changes only the "For users" items, so the `Added` / `Changed` / `Fixed` text is published too.
- `CHANGELOG.md:9-21` at HEAD describes features that default-off flags gate (`packages/core/src/features.ts`):
  - `approvals_page`, `delegation_pages`: "Act from the panel: approve, reject…".
  - `sent_sync`: "Read the Sent folder … (off until the owner turns it on)".
  - `weekly_report`, `security_log`, `sso_sign_in` ("SSO required"), `org_delete`.
  - `mail_oauth_*`, `suspicious_mail`, `attachment_line`, `degraded_notice`.
- P2 says: "No page, sentence, button or line about anything a default-off flag gates". It rejects "ask your operator" asides, and "off until the owner turns it on" is that kind of aside.
- The stage 15 card links each member to this page (`whats_new_all` → `docsUrl("/changelog/", "en")`).
- The refresh argues only about the card ("the card never shows it", P9). It does not say whether P2 covers the changelog page. `USER_SECTIONS` (stage 04:13) leaves `changelog` out, so this is a decision gap, not a clear exemption.
- What to decide, for example:
  - (a) The page renders only `For users` items, plus the operator groups behind a stated exemption; or
  - (b) P2 states that the changelog and the `operate/*` pages are operator text and out of P2, and the card link text says so; or
  - (c) a new question Q9 for the owner.

**B2. The site-map test of stage 07 lists an old set of ids. Proven by reading the text.**
- Files: `stages/stage-07-tutorial-faq.md:32` and `:14`, `stages/stage-03-in-place-links.md:12`.
- Stage 07:14 says the test reads the ids of `IN_PLACE_PAGES` and "fails on a missing or extra id".
- After refresh 1, stage 03 makes `IN_PLACE_PAGES` hold `operate/release-checklist` too.
- Stage 07 T2 still says the test "passes with `index`, `pl/index`, `start`, `operate/install-and-run`". As written, T2 cannot hold after stage 03.
- The refresh did not list stage 07 as changed. A worker must guess, and § Rules says "A gap or deviation is a question, not a choice".
- Fix: add `operate/release-checklist` to T2 (stage 16 C2 can also curl `…/operate/release-checklist/`).

## Unverified checks

- None that the verdict depends on. I did not build any stage, because this is a plan review.

## Notes

**N1 (plausible). Stage 13 T8 can break at the next release.** File: `stages/stage-13-changelog.md:33`.
- T8 fixes the real file's content: "`Unreleased`, then `0.1.0` (`2026-11-15`, `forUsers: []`)".
- The next `release:prepare` moves the docs-site "For users" item into a new release, so the list becomes `Unreleased, 0.x.y, 0.1.0`. An exact-list assertion then fails on the release commit.
- The checklist (`docs/release-checklist.md:5`) forbids a tag on red CI, so this blocks the release.
- Stage 15 T7 was rewritten for exactly this case ("so a later release … does not break it"). T8 should match: parse OK, first entry `Unreleased`, `0.1.0` present with `forUsers: []`.

**N2 (plausible). The scope of `flagged-text.test.ts` has no decision.** Files: `stages/stage-07-tutorial-faq.md:15`, `deploy/README.md:293,338,342,345`, `CHANGELOG.md:13`.
- The test "fails when a doc page holds" a flagged string. It does not say whether in-place pages count.
- The in-place sources already hold "SSO required" (`apps/web/src/i18n/en.ts:691` `op_sso_required`, flag `sso_sign_in`). Stage 03 and stage 13 must not change those sources.
- If the test reads `dist`, stage 07 T2 or stage 13 T10 can fail. Decide: `src/content/docs` only, or in-place pages too. Same question as B1.

**N3 (plausible). Stage 15 can conflict with stage 11.** Files: `stages/stage-15-panel-ui.md:26`, `stages/stage-11-shot-run.md:25`.
- Stage 15 allows "the e2e seed" to turn `docs_links` on "for the seeded organization", which is the main organization.
- Stage 11 asserts that this organization has no flag on before the first shot. A seed row would stop `docs:shots`. With a later "For users" release, every other main-org spec would also show the card.
- Decide: stage 15 turns the flag on and off with `org-flag.ts` in `beforeAll` / `afterAll`, as `apps/web/e2e/tests/mailbox-oauth.spec.ts:19-35` does. Never in the seed.

**N4 (proven by reading). The fact "no flag row" in stage 11 is not exact.**
- `mailbox-oauth.spec.ts:35` writes an `off` row for the main organization with `org:flag`.
- The stage 11 assertion reads `/api/me` `features`, the enabled list (`apps/server/src/modules/tenancy/routes.ts:107`), so the test still holds. Only the wording is not exact.

**N5 (proven by reproduction). T8b holds, and the comment rule is needed.**
- I ran `prepareRelease` from HEAD on a fixture (`/tmp/f112-pr/t.ts`, log `/tmp/f112-pr/t.log`). `Unreleased` held one `Added` line and one `- en:` / `  pl:` pair. The output kept the pair under `## [0.2.0] - 2026-12-01` and left an empty `## [Unreleased]`.
- With an indented `  ## [Unreleased]` inside the HTML comment, `prepareRelease` put the new heading inside the comment. This confirms the guard in stage 13:13.

**N6 (proven by reading). `plan.md` has old word counts.** File: `plan.md:127`.
- That line still shows the counts after review 1 (for example stage 13 656, stage 15 523). The counts after refresh 1 are only in `plan-refresh-1.md`.
- `.agents/limen/planner.md:47` asks for the counts in `plan.md` § Planning progress.
- Size limits hold: `plan.md` 1490 words (limit 1,500). Changed stages: 03 545, 04 635, 06 586, 11 561, 13 700, 15 558, 16 468 (limit 700).

**Checked, no finding:**
- Stage 03 `<h1>` texts: `deploy/README.md:1` is `# Pilot host runbook`; `docs/release-checklist.md:1` is `# Release checklist`.
- Stage 06 versions: `apps/web/package.json` pins `@playwright/test` `1.65.0` and `@axe-core/playwright` `4.14.0`.
- `apps/web/e2e/a11y.ts` has the same WCAG tags and line format as stage 06. Port 8093 is free. `workers: 1` in the panel e2e config.
- `deploy/Dockerfile`:
  - It has `--filter "!@ea/docs"` and no `CHANGELOG.md` copy.
  - `ARG EA_RELEASE` comes after `web:build`.
  - `.dockerignore` leaves out `docs` but not `CHANGELOG.md`, so the copy in stage 15 works.
- `ci.yml` jobs are `ci`, `e2e`, `image`. The `image` job has the `apps/docs`, Starlight and pagefind checks.
- `site.ts`: the `docsUrl("/", …)` and `docsUrl("/changelog/", "en")` calls of stage 15 pass its checks.
- Tag `v0.1.0` exists; root `package.json` version is `0.1.0`.
- `/api/me` `features` is the list of enabled flags.

## Checks run

- `git rev-parse HEAD`: cc350b6554e5af7829564d540f60d89afdca72b3.
- `git log 17b2a369..HEAD`: one commit, the refresh. `git diff 17b2a369..HEAD` on the feature folder: read in full.
- `wc -w` on `plan.md` and the changed stage files: counts as in N6.
- `bun /tmp/f112-pr/t.ts > /tmp/f112-pr/t.log 2>&1 && grep -c "## \[0.2.0\] - 2026-12-01" /tmp/f112-pr/t.log`: printed `1`.
- I read or grepped `CHANGELOG.md`, `release-prepare-lib.ts`, `docs/release-checklist.md`, `deploy/Dockerfile`, `.dockerignore`, `ci.yml`, `e2e-seed.ts`, `mailbox-oauth.spec.ts`, the panel `playwright.config.ts`, `a11y.ts`, `site.ts`, `features.ts`, `tenancy/routes.ts`, `deploy/README.md`, `apps/docs/package.json` and `apps/web/package.json`.
- I ran no unit, int or e2e suite; this review did not need one.

## Note check

- Verdict line names sha cc350b6554e5af7829564d540f60d89afdca72b3, which equals HEAD: proven. `git rev-parse HEAD` (printed cc350b6554e5af7829564d540f60d89afdca72b3).
- Each finding names file and line and is checked against the HEAD code: proven. `/tmp/f112-pr/t.log` (T8b repro) and the HEAD files cited per finding (`CHANGELOG.md`, `apps/server/src/scripts/release-prepare-lib.ts`, `docs/release-checklist.md`, `deploy/Dockerfile`, `.github/workflows/ci.yml`, `apps/server/src/scripts/e2e-seed.ts`, `apps/web/e2e/a11y.ts`, `packages/core/src/site.ts`).
- Changed stages 03, 04, 06, 11, 13, 15, 16 are at most 700 words: proven. `wc -w spec/features/active/F112-e10a-docs-site/plan.md spec/features/active/F112-e10a-docs-site/stages/stage-03-in-place-links.md spec/features/active/F112-e10a-docs-site/stages/stage-04-front-matter-stale.md spec/features/active/F112-e10a-docs-site/stages/stage-06-browser-check.md spec/features/active/F112-e10a-docs-site/stages/stage-11-shot-run.md spec/features/active/F112-e10a-docs-site/stages/stage-13-changelog.md spec/features/active/F112-e10a-docs-site/stages/stage-15-panel-ui.md spec/features/active/F112-e10a-docs-site/stages/stage-16-publication.md` (max 700, stage 13).
- Easy-to-miss rule (missing code detail is not a finding): followed. Each of B1, B2 and N1–N3 names a missing decision, test or interface; N4–N6 are labelled facts, not code-detail requests (this message).
