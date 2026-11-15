# F112 plan refresh 1

- Old base: `116efb17` (2026-11-15 01:08). New base: `17b2a369` (2026-11-15 17:38, `HEAD`).
- Method: refresh job, no scouts. `scripts/plan-drift.sh` reads only paths with an extension under `apps|packages|db|deploy|scripts|tools|evals`. So it misses `CHANGELOG.md`, `deploy/Dockerfile`, `.github/workflows/*`, root `package.json` and `docs/*`. These were checked by hand (below).
- Decisions, owner answers, defaults, stage count and stage order: unchanged. One new small default: Q8 (`questions.md`).

## Drift output

```
plan base: 116efb17 2026-11-15 01:08
HEAD:      17b2a369 2026-11-15 17:38
named paths: 43; changed since base: 11; gone: 0
changed: apps/docs/astro.config.mjs
changed: apps/docs/package.json
changed: apps/docs/src/content.config.ts
changed: apps/server/src/modules/channels/telegram/polling.ts
changed: apps/web/package.json
changed: apps/web/src/i18n/en.ts
changed: apps/web/src/i18n/pl.ts
changed: deploy/backup.sh
changed: deploy/README.md
changed: packages/core/src/features.ts
changed: packages/core/src/site.ts
commits after the base that touch the named paths:
  3733aeed 11-15 15:27 F114 stage 08 review: restore.sh needs exactly one result line of credentials:check; README note on down -v
  1c237860 11-15 15:17 F102 stage 17 review fixes: gone text inside the focused status line, delayed-500 add test, full-list notice, Polish wording
  f7e00a46 11-15 14:56 F114 stage 08: credentials:check, restore.sh reads its result line, VPS lost runbook, capability pages
  97297e78 11-15 14:55 F116 stage 10 step 1: follow-up draft kind, template, message with Cc
  0efbb787 11-15 14:17 F102 stage 17 step 1: the delegates page (list, add, edit, switch) with the shared delegation tabs
  4767333f 11-15 13:49 F114 stage 07: README names the drill set of check-logging
  5d378f85 11-15 13:42 F114 stage 06 step 3: release checklist, README Release section, migrations rules, operations page
  5170c738 11-15 13:13 F103 stage 18 review fixes: pin vlagent mounts, url, network and disk cap; logs.sh level, unbuffered, root
  dd1eef9a 11-15 12:43 F103 stage 18: log store (Compose profile ops), deploy/logs.sh, testmail remote runs in cli
  70efec66 11-15 12:08 F102 stage 14 step 1: delegation_pages flag and updateDelegate
  cb8ced0b 11-15 12:00 F103 stage 17: log drivers split (server json-file, others local), cli Compose service, check-logging drivers and one-off doc check
  1f06d0de 11-15 11:47 F102 s13 review fixes: no poll or follow while the edit dialog is open, focus tests, draft_gone text
  a5b6ddbe 11-15 11:20 F117 stage 16: sign-in buttons and result banner on the mailboxes page
  05f622b2 11-15 11:11 F116 stage 07: privacy registries, flags and tests for the loop tables
  37d9329c 11-15 10:36 F102 s13 step 1: edit dialog for a waiting draft, answer map, focus after an answer
  3069c7d4 11-15 10:18 F102 s12 review: pin state labels, null expiry and Skip; Polish wording
  489ff792 11-15 10:03 F114 stage 04 step 4: docs for status file, ping, disk and backup checks
  10c0ba78 11-15 09:59 F114 stage 04 step 1: backup.sh writes status file and pings
  56515057 11-15 09:11 F102 s12 step 1: approvals page with nav item, badge, list and detail (en, pl)
  93f0adb7 11-15 08:41 F103 s13: docs for the final log rules; capability page logs.md
  c16829b2 11-15 08:39 F109 s15: not_triaged notice during an LLM pause (kind, renderer, flag degraded_notice, detector, pausedSince)
  5922956c 11-15 07:40 F104 stage 10 review: sent switch helper and tests, sent_line text, Polish edits
  3a6f5bf5 11-15 07:19 F103 s12: roots and testmail log events; lint error for root files and testmail; web_on carries no origin
  76a86032 11-15 07:11 F119 stage 14: docs for company sign-in (web-panel, tenancy, account data, ADR 0026 amendment, runbook, alerts, code patterns)
  fde1fb54 11-15 07:10 F104 stage 10: Sent mail card, connect line, status helper, texts, docs
  494edee4 11-15 07:01 F103 s10 review: review-10 notes, stage 13 carry-over, README rescan wording
  6871bb53 11-15 06:58 F119 stage 13 review: pl op_sso_linked with osoba, plural tests 22 and 12, axe carry-over, review-13 notes
  ed467192 11-15 06:19 F119 stage 13: Account card for a member without a password, operator SSO block, Wymagane SSO text (review-11 N9)
  88f70ae4 11-15 06:18 F109 stage 06 review fixes: attachment_line in the lab flags, stored-name test, consent text names file types, consent-gate rule, review-6 notes
  d07955b4 11-15 06:17 F103 s10: mail folder log events; MailHostLookupError; lint error for modules/mail; canary tests per line
  5041e18e 11-15 06:10 F119 stage 12 review: tests for next path, callback error and open form; Back focus; pageshow reset; Polish text alignment; review-12 notes
  5ecce6ee 11-15 06:10 F103 s09: apply, drafts and send log events; lint error for the actions folder; log-event tests per line
  1d39bc51 11-15 05:34 F109 stage 06: attachment line in the urgent notice and the digest (flag attachment_line), consent text and version bump for attachment names
  dffb76d4 11-15 05:31 F119 stage 12: company sign-in on the login page
  62bf7cd7 11-15 04:38 F119 stage 11: public sign-in options, me and operator SSO fields, security-log kinds
  6f1ced02 11-15 04:19 F111 stage 02: own endpoint gets no OpenAI credentials; fixed Gemini URL and OpenAI log level; URL, --gap and null baseUrl tests
  50250896 11-15 03:52 F117 stage 06: provider registry, OAuth config keys, flags, token client, fake token server
  88e041f2 11-15 03:46 F109 s03: suspicious reasons in triage, known-sender context, flagged delegation mail plans nothing
  50f6389b 11-15 03:40 F103 s06: Telegram bot and polling log events; one run_id per update; lint error for telegram/
  43412864 11-15 03:38 F111 stage 02: docs for OPENAI_BASE_URL, endpoint kinds, env example
  e9564a0e 11-15 03:25 F102 s07: axe check helper, Stats e2e spec, zero violations on the customer pages
  803afd40 11-15 02:00 F112 s01: image skips the docs workspace; docsUrl rejects odd paths
  dff11778 11-15 01:43 F112 s01: apps/docs on Starlight 0.43.1, docs:build, bun.lock
  b2b49ee0 11-15 01:42 F112 s01: site constants (PRODUCT_NAME, DOCS_ORIGIN, docsUrl)
  d90ecd89 11-15 01:06 F128: turn off and new backup codes need a code from the app or an unused backup code
```

## Changes

- **Stage 01**: marked built (landed `b2b49ee0`, `dff11778`, `803afd40`). Why: the stage landed after the base; its review fixes (image install `--filter "!@ea/docs"`, stricter `docsUrl`) are now facts for later stages.
- **Stage 03**: `IN_PLACE_PAGES` gets a second entry `operate/release-checklist` → `docs/release-checklist.md`; T6 names both `<h1>` texts (`Pilot host runbook`, `Release checklist`). Why: the plan said "E8b adds its runbooks here", but F114 landed (stages 01–08) before the loader exists and added no entry. Its runbooks are `deploy/README.md` § Release and § VPS lost (already in place) plus the checklist. Default Q8 [minor].
- **Stage 04**: `docs:stale --strict` "E8b release checklist runs it" → stage 13 adds it to `docs/release-checklist.md`. Why: F114 wrote the checklist without that step (review 1 N6 had left it to F114).
- **Stage 06**: pin `@playwright/test` `1.65.0` and `@axe-core/playwright` `4.14.0` as `apps/web` does (F102 stage 07 added axe there); report axe violations as `apps/web/e2e/a11y.ts` does, in a docs-local copy. T7: the image skips `@ea/docs`, so the docs dev dependencies add nothing to the image. Why: landed versions and the stage 01 image filter.
- **Stage 11**: the shot run signs in as the main organization owner (`E2E_OWNER_EMAIL`, no flag row) and asserts that `/api/me` `features` has no flag on before the first shot. Why: the e2e seed now holds organizations with default-off flags on (F102, F106); a shot from one of them breaks P2.
- **Stage 13**: `CHANGELOG.md` is not new: F114 stage 06 created it (release `0.1.0`, groups `Added`, `Changed`, `Fixed`, no "For users"), and tag `v0.1.0` exists. The stage keeps F114's text, adds the comment and one "For users" item under `Unreleased`. The comment must hold no line that is `## [Unreleased]` after trim (`prepareRelease` finds the heading by `line.trim()`). New: `docs/release-checklist.md` gets the optional `For users` group and a `docs:stale --strict` check (decision 6). New tests: T8 names the real content; T8b proves `release:prepare` keeps a "For users" pair that `parseChangelog` reads. `isGreaterVersion` of F114 stays.
- **Stage 15**: T7 no longer assumes "only `Unreleased`": it computes the card state from `whatsNew(<real changelog>, null)`. Why: `0.1.0` exists, and a later release with "For users" lines must not break the e2e.
- **Stage 16**: check output folder `/tmp/f112-s14/` → `/tmp/f112-s16/` (old typo). Rollback: only a tag that holds `docs-deploy.yml` can be a manual rollback target; `v0.1.0` cannot. Why: `v0.1.0` now exists (VPS release, F114).
- **plan.md**: status and base; D12 and D13 name the landed facts; N3 and N5 closed by stage 01; log line. The word-for-word job quote in § Input was removed to stay under 1,500 words (it held no decision).
- **questions.md**: Q4 fact ("no tag exists yet" → `v0.1.0` exists without the workflow); Q8 added.
- **ticket.md** § Sequenced: `Plan after` names the landed F114 files; `Refresh:` line with the new base.
- **probes/facts.md**: section "Refresh 1" updates F8, F11, F12, F13 and adds F15.

## Checked, no change needed

- `apps/docs/astro.config.mjs`, `package.json`, `src/content.config.ts`: the stage 01 output; stages 02, 03, 04 edit them as planned (`security.csp` still off; `docsSchema()` without `extend`; no `exports` in `apps/web/package.json` yet, stage 04 adds them).
- `packages/core/src/site.ts`: D2 names and `docsUrl(path, locale)` signature hold; stage 15 calls (`"/"`, `"/changelog/"`) pass the stricter checks; stage 12 uses `DOCS_BASE` directly.
- `packages/core/src/features.ts`: 20 flags, all `default: false`; shape `{ default, description, epic, removeBy }` fits stage 14 `docs_links`; no `docs_links` yet. The stage 07 examples (`mistake_capture`, `handled_share`, `llm_pause_line`, `answered_check`) exist. New flags (F102, F104, F109, F116, F117) fall under P2 and the `FLAGGED_TEXT` test as written.
- `apps/web/src/i18n/en.ts`, `pl.ts`: `en`, `pl`, `TextKey` exports hold; `nav_settings` = `Settings`; `trial_ends_on` holds `{date}` (stage 04 T8, T9).
- `polling.ts`: only log events changed (F103); `BOT_COMMANDS` still exported (stage 09 T1).
- `deploy/backup.sh`: used only as a link example in stage 03 T2.
- `deploy/README.md`: the public-content rules R1–R3 still meet only the two F8 allow entries (`a@b.com`, `100.100.100.100`); new IPv4 `172.29.0.0` is RFC 1918; new URLs are text, not `src`. `docs/release-checklist.md` holds no address, IP or Markdown link.
- `.github/workflows/ci.yml`: jobs `ci e2e image` (stage 05 T1 still expects `ci e2e image docs`); `permissions: contents: read`; Node 24 in `ci`, `e2e`. F114's `db:check-migrations` step and F113's sim checks do not touch the docs job.
- `deploy/Dockerfile`: no `CHANGELOG.md` copy yet (stage 15); F114's `ARG EA_RELEASE` comes after the web build, so a `COPY CHANGELOG.md` before `web:build` fits.
- Ports: 8093 is still free in the repo (stage 06); e2e ports 8081, 8092 hold.
- ADR 0030 still "proposed"; `docs/code-patterns.md` has no "Docs site" section; `apps/server/src/capability-map.test.ts` exists (stage 05).
- F103 (log drivers, `cli` service, log store), F104, F113, F116, F117, F119: no F112 interface; their user-visible parts are flagged (P2). CI lesson "compose tests must not pin Compose-version renderings": F112 adds no Compose test.
- No landed ticket built a step of stages 02–16.

## Word counts after refresh 1

     1490 plan.md
      655 stages/stage-01-docs-app-frame.md
      691 stages/stage-02-csp-public-check.md
      545 stages/stage-03-in-place-links.md
      635 stages/stage-04-front-matter-stale.md
      700 stages/stage-05-ci-deploy.md
      586 stages/stage-06-browser-check.md
      695 stages/stage-07-tutorial-faq.md
      535 stages/stage-08-how-to.md
      519 stages/stage-09-reference-explanation.md
      433 stages/stage-10-polish.md
      561 stages/stage-11-shot-run.md
      386 stages/stage-12-shots-pages-deploy.md
      700 stages/stage-13-changelog.md
      310 stages/stage-14-card-logic.md
      558 stages/stage-15-panel-ui.md
      468 stages/stage-16-publication.md
    10467 total

## Review 2 fixes (2026-11-15)

Review: [plan-review-2.md](plan-review-2.md) (Opus 5.5, high): FAIL, B1, B2, N1–N6. Fixed as the coordinator decided; no new review.

- **B1** (coordinator decision): the public changelog page renders only the version and date headings and the "For users" items (en). `Unreleased`, the header, comments and the `Added`/`Changed`/`Fixed`/… groups are not published. Stage 13 transform, T9 and T10 (T10: no `Offline quality lab`, no `FLAGGED_TEXT` string in `dist/changelog/index.html`). plan.md P2 states it. Stage 15 link `whats_new_all` text: "All changes for users".
- **B2**: stage 07 names `operate/release-checklist` in the `IN_PLACE_PAGES` ids and in T2; stage 16 C2 curls `…/operate/release-checklist/`.
- **N1**: stage 13 T8: parse OK, first entry `Unreleased`, `0.1.0` present with `forUsers: []`; no exact list.
- **N2**: stage 07: `flagged-text.test.ts` scans `src/content/docs` only; in-place sources stay unchanged.
- **N3**: stage 15 e2e turns `docs_links` on and off with `org-flag.ts` in `beforeAll` / `afterAll` (as `mailbox-oauth.spec.ts`); never in the e2e seed.
- **N4**: stage 11: the enabled list of `/api/me` `features` is empty (no `docs_links`); other specs may write `off` rows.
- **N5**: no change (confirms the comment rule of stage 13).
- **N6**: word counts now in plan.md § Planning progress. To fit 1,500 words, plan.md lost the review 1 fix list (it is in plan-review-1.md) and two short phrases.

Word counts after the fixes: plan 1494; 07 700, 11 576, 13 654, 15 589, 16 469 (03 545, 04 635, 06 586 unchanged).
