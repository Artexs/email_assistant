# F112 · E10a Docs site: plan

> **Status 2026-11-15 — planned.** Plan base: 116efb17. 14 stages; nothing built. Defaults: [questions.md](questions.md). Probe facts F1–F13: [probes/facts.md](probes/facts.md).

## Planning progress

- [x] Decisions; stages 01–14 [written].
- [ ] Cold review 1.

## Input

Job instruction (2026-11-15), word for word: "plan against the landed code … Owner checkpoints and owner steps are not a stop: use plan defaults."

Binding: E10 decisions 1–18 (PD-096–PD-103, owner "Go with defaults.", 2026-11-13) on the epic page; ADR 0030 (proposed); discovery notes §4.1, §4.6, §4.7, §7. Repo rule (F10): every new user-visible behaviour ships behind a flag, default off.

### Product decisions

- **P1 Scope.** The docs app, its checks, CI and deploy, operator docs read in place, user docs (tutorial, how-to, reference, explanation, FAQ) for what exists, the changelog page, the panel Help link and "What is new" card, and the first publication. Home and positioning, security, pricing, the demo video and the cold read are F121 (E10b). Source: decision 1, notes §7.
- **P2 Truth.** A user page describes only behaviour that the code at `HEAD` has. A feature behind a default-off flag (`packages/core/src/features.ts`) gets no user page until its flag defaults on; env scopes (`ACTIONS_SCOPE`, `SEND_SCOPE`) are operator setup. Rejected: "ask your operator" asides. Default (Q1).
- **P3** API reference (needs the F102 OpenAPI file) and the autonomy-evidence reference (F110) move to F121. Rejected: a stage that guesses F102's interface. Default (Q2).
- **P4** The panel Help link and the card ship behind one flag `docs_links` (default off, epic E10a). Default (Q7).
- **P5** Screenshots come from the existing e2e seed (synthetic, `x.test`, F9). F121 moves them to the E2b demo fixture. Default (Q3).
- **P6 Languages** (decision 6): English source. Polish for the landing page, tutorial, how-to, FAQ and the explanation "How a mail is sorted". Operator docs and reference: English only (Starlight fallback, F7).
- **P7 Publication.** The first deploy is an owner step (outside publication). After it, each `v*` tag deploys; a manual run deploys a chosen ref (Q4).
- **P8 Names** (decision 15): `PRODUCT_NAME` "Email Assistant"; site `https://artexs.github.io/email_assistant/`.
- **P9 Card states.** No stored version: show the newest release only. Stored version older than the newest: show every newer release. Equal or newer (downgrade): no card. A stored value that is not SemVer: as "no stored version". Storage throws: no card. Dismiss stores the newest version. `Unreleased` never shows. No release in the file: no card (Q5).

### Design decisions

- **D1 Versions.** New workspace `apps/docs` (`@ea/docs`): `@astrojs/starlight` `0.43.1`, `astro` `7.4.12`, exact; one `astro` in `bun.lock`. Only stages 01 and 06 change `bun.lock`, never next to another `bun.lock` change. Rejected: caret ranges.
- **D2 Constants** in `packages/core/src/site.ts`, exported from `@ea/core`: `PRODUCT_NAME`, `DOCS_ORIGIN = "https://artexs.github.io"`, `DOCS_BASE = "/email_assistant"`, `docsUrl(path: string, locale: "en" | "pl"): string`.
- **D3 CSP** (F3, F4): Astro `security.csp` plus the post-build pass `cspFinalize` in `apps/docs/integrations/`: hash every inline script into `script-src`, set `style-src 'self' 'unsafe-inline'`, no `frame-ancestors`. Then every page passes `cspProblem`, moved unchanged to `@ea/core/web` (the panel imports it there) with one new problem `script_hash_missing`. Rejected: hand-kept hashes (break on each Starlight update); no CSP (decision 5). Q6.
- **D4 Public-content check** on every built text file (stage 02 lists rules R1–R7). Allow list `apps/docs/public-content-allow.txt` (exact string, reason); an unused entry fails.
- **D5 In-place pages** (F6): list `IN_PLACE_PAGES` in `apps/docs/src/in-place.ts`; the source file never changes; relative links are rewritten (stage 03).
- **D6 Link check** after the build: every same-site `href`/`src` resolves to a built file; every `#id` link resolves on its page.
- **D7 Front matter**: `capabilities` (user pages), `source` and `sourceHash` (Polish pages); `bun run docs:stale [--strict] [--stamp <file>]` (stage 04).
- **D8 UI labels**: MDX `<UiText k="…" />` renders the panel's text for the page language from `@ea/web` exports `./i18n/en` and `./i18n/pl`. An unknown key fails typecheck. Rejected: labels typed by hand (drift).
- **D9 All checks run inside `bun run docs:build`** (integrations at build end). Log lines: `csp checked in <n> page(s)`, `public content checked in <n> file(s)`, `links checked in <n> page(s)`.
- **D10 CI and deploy** (stage 05): job `docs` in `ci.yml`; `.github/workflows/docs-deploy.yml` on `v*` tags and manual run; on a tag that is not the highest SemVer tag it skips. GitHub token only, no other secret.
- **D11 Browser check** (stage 06): Playwright on the built site, fixed port 8093, under the shared flock.
- **D12 Changelog** (stage 12): `CHANGELOG.md` (Keep a Changelog 1.1) and `parseChangelog` in `@ea/core`; F114 writes releases in this form.
- **D13 Image** (F11): the server image has no `apps/docs` source; the frozen install still passes; the image gets `CHANGELOG.md` for the card (stage 13).

### Edge cases (answered)

- States × events: P9 (card); D10 (old tag, two tags: concurrency group `pages`, no cancel).
- Crash and repeat: a failed deploy changes nothing live; a re-run is safe. No DB, no tenant data.
- Secrets and private data: D4; shots from the e2e seed; no secret in a workflow.

## Not verified

- **N1** The `github-pages` environment accepts a deploy from a tag → stage 14 (owner).
- **N2** Search under the CSP in Firefox and Safari → open.
- **N3** Frozen install in the image with the new workspace → stage 01 (`image` job).
- **N4** axe WCAG 2.2 AA on Starlight's own markup → stage 06; a violation there is a question.
- **N5** Bun resolves the Starlight peer `@astrojs/markdown-remark` → stage 01.

## Done when

1. `bun run docs:build` logs the three D9 lines; each stage 02–03 failure case fails it.
2. `bun run docs:stale` exits 0; every Polish page of P6 exists with a current `sourceHash`.
3. The browser check: 0 CSP violations, search works, axe 0 violations.
4. CI job `docs` green on `master`; `image` green.
5. With `docs_links` on, the panel shows Help and the card per P9 (e2e).
6. The site is live at the P8 URL (stage 14).

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, the ticket, this file and your stage. Build only your stage.
- Format only your files; commit by explicit path after `git diff --staged`.
- Never read, print or copy `.env` or a secret. No real name, address, host or mail text in a doc page or a test.
- Never run `astro dev` (F101 D7).
- A doc page states a fact only when a capability page or the code at `HEAD` shows it (P2). A gap is a question in the final message.
- Do not edit `spec/build.md`, `docs/product/stage-2/*` or another ticket. A gap or deviation is a question, not a choice.

## Proof

One bash call after the last commit; claim only what a saved log shows. `NN` = stage number; stage files add steps.

```
mkdir -p /tmp/f112-sNN && bun run lint > /tmp/f112-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f112-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f112-sNN/unit.log 2>&1 && bun run docs:build > /tmp/f112-sNN/docs.log 2>&1 && echo PROOF_OK
```

Stages 01, 06, 11, 13 give their own chain.

## Owner steps

- **O1** (stage 14): Settings → Pages → Source "GitHub Actions"; allow `v*` tags in the `github-pages` environment; run the deploy on `master`. Publication waits for the owner.

## Review

Review job before the land (`claude-opus-5-5`, high): stages 01, 02, 05, 10, 13 (dependencies, security, deploy, Polish text, panel). Text: "Review F112 stage NN on <branch> against plan.md and the stage file: each decision and numbered test. Quote file and line."

## Stages

- 01 [Docs app frame](stages/stage-01-docs-app-frame.md) `[risky]` dependencies, image.
- 02 [CSP and public-content check](stages/stage-02-csp-public-check.md) `[risky]` security.
- 03 [Operator docs in place, link check](stages/stage-03-in-place-links.md).
- 04 [Front matter, stale check, UI labels](stages/stage-04-front-matter-stale.md).
- 05 [CI job, deploy workflow, ADR](stages/stage-05-ci-deploy.md) `[risky]` publication path.
- 06 [Browser check](stages/stage-06-browser-check.md).
- 07 [Tutorial and FAQ (en)](stages/stage-07-tutorial-faq.md).
- 08 [How-to (en)](stages/stage-08-how-to.md).
- 09 [Reference and explanation (en)](stages/stage-09-reference-explanation.md).
- 10 [Polish set](stages/stage-10-polish.md).
- 11 [Screenshots](stages/stage-11-screenshots.md).
- 12 [Changelog](stages/stage-12-changelog.md).
- 13 [Panel Help link and card](stages/stage-13-panel-card.md).
- 14 [First publication](stages/stage-14-publication.md) `[risky]` outside publication; owner O1.

Order: 01 → 07 in order; 08 and 09 after 07 (in parallel); 10 after 08 and 09; 11 after 10. 12 after 06, next to 07–11; 13 after 12; 14 last. 06 waits while another `bun.lock` change builds.

## How to run (coordinator)

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "F112-sNN <slug> · F112" \
  "Implement F112 stage NN. Read spec/features/active/F112-e10a-docs-site/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step. Final proof: the Proof of your stage, after the last commit. Claim only what a saved log shows."
```

Land each with `limen land <id> --yes --keep-open`; drop the job DB. Stage 14 is the coordinator's after O1.

## Cold review

Model: `claude-opus-5-5`: `[risky]` stages; deploy and Polish text are TRACK risk areas.

Words before review: plan 1481; stages 621, 672, 483, 602, 614, 500, 644, 528, 515, 439, 620, 498, 690, 405.

## Log

- 2026-11-15: planned (Opus 5.5, thinking medium).
