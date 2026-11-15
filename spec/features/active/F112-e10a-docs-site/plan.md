# F112 · E10a Docs site: plan

> **Status 2026-11-15 — active.** Plan base: 17b2a369, refreshed 2026-11-15 ([plan-refresh-1.md](plan-refresh-1.md)). 16 stages; stage 01 landed; cold review 1 fixed. Defaults: [questions.md](questions.md). Probe facts F1–F13: [probes/facts.md](probes/facts.md).

## Planning progress

- [x] Decisions; stages 01–16 [written]; review 1 [fixed]; refresh 1 [done]; review 2 [fixed].
- `wc -w` after review 2 fixes: plan 1494; 01 655, 02 691, 03 545, 04 635, 05 700, 06 586, 07 700, 08 535, 09 519, 10 433, 11 576, 12 386, 13 654, 14 310, 15 589, 16 469.

## Input

Binding: E10 decisions 1–18 (PD-096–PD-103, owner "Go with defaults.", 2026-11-13); ADR 0030 (proposed); discovery notes §4.1, §4.6, §4.7, §7. Repo rule (F10): new user-visible behaviour ships behind a default-off flag.

### Product decisions

- **P1 Scope.** The docs app, checks, CI, deploy, operator docs in place, user docs for what exists, the changelog, the panel Help link and card, the first publication. Home, security, pricing, demo video and cold read are F121 (E10b). Source: decision 1, notes §7.
- **P2 Truth.** A user page describes only behaviour that the code at `HEAD` has. No page, sentence, button or line about anything a default-off flag (`packages/core/src/features.ts`) gates, also inside an unflagged feature, until the flag defaults on. When a capability page and the code disagree, the code wins and the conflict is a question. Env scopes (`ACTIONS_SCOPE`, `SEND_SCOPE`) are operator setup. The changelog page shows only the "For users" items with version and date headings; operator groups are not published (stage 13). Rejected: "ask your operator" asides. Default (Q1).
- **P3** API reference (F102 OpenAPI file) and autonomy-evidence reference (F110) move to F121. Rejected: guessing F102's interface. Default (Q2).
- **P4** Help link and card behind one flag `docs_links` (default off). Default (Q7).
- **P5** Screenshots from the e2e seed (synthetic, F9); F121 moves them to the E2b fixture. Default (Q3).
- **P6 Languages** (decision 6): English source. Polish for the landing page, tutorial, how-to, FAQ and the explanation "How a mail is sorted". Operator docs and reference: English only (Starlight fallback, F7).
- **P7 Publication.** The first deploy is an owner step. After it, the newest pushed `v<x.y.z>` tag deploys; a manual run deploys any branch or tag (rollback) (Q4).
- **P8 Names** (decision 15): `PRODUCT_NAME` "Email Assistant"; site `https://artexs.github.io/email_assistant/`.
- **P9 Card states.** No stored version: show the newest release only. Stored version older than the newest: show every newer release. Equal or newer (downgrade): no card. A stored value that is not SemVer: as "no stored version". Storage throws: no card. Dismiss stores the newest version, per member (`ea.whatsNewSeen:<user id>`). `Unreleased` and releases without "For users" lines never show; at most 5 releases. No release: no card (Q5).

### Design decisions

- **D1 Versions.** New workspace `apps/docs` (`@ea/docs`): `@astrojs/starlight` `0.43.1`, `astro` `7.4.12`, exact; one `astro` in `bun.lock`. Only stages 01 and 06 change `bun.lock`, never next to another `bun.lock` change. Rejected: caret ranges.
- **D2 Constants** in `packages/core/src/site.ts`, exported from `@ea/core`: `PRODUCT_NAME`, `DOCS_ORIGIN = "https://artexs.github.io"`, `DOCS_BASE = "/email_assistant"`, `docsUrl(path: string, locale: "en" | "pl"): string`.
- **D3 CSP** (F3, F4): Astro `security.csp` plus the post-build pass `cspFinalize` in `apps/docs/integrations/`: hash every inline script into `script-src`, set `style-src 'self' 'unsafe-inline'`, no `frame-ancestors`. Then every page passes `docsCspProblem` (`@ea/core/web`: the panel's `cspProblem` moved, plus `script_hash_missing` and the docs directives). Content sources may hold no script or event attribute (`content_script`), so the pass hashes only Starlight's scripts. Rejected: hand-kept hashes (break per Starlight update). Q6.
- **D4 Public-content check** `publicContentProblems` in `@ea/core/web` (stages 02, 11), on every built text file (rules R1–R7). Allow list `apps/docs/public-content-allow.txt` (exact string, reason); an unused entry fails.
- **D5 In-place pages** (F6): `IN_PLACE_PAGES` (`apps/docs/src/in-place.ts`); sources never change; links rewritten (stage 03).
- **D6 Link check**: every same-site `href`, `src` and `#id` resolves.
- **D7 Front matter**: `capabilities` (user pages), `source` and `sourceHash` (Polish pages); `bun run docs:stale [--strict] [--stamp <file>]` (stage 04).
- **D8 UI labels**: MDX `<UiText k="…" />` renders the panel's text for the page language from `@ea/web` exports `./i18n/en` and `./i18n/pl`. An unknown key fails the build.
- **D9 All checks run inside `bun run docs:build`**. Log lines: `csp checked in <n> page(s)`, `public content checked in <n> file(s)`, `links checked in <n> page(s)`.
- **D10 CI and deploy** (stage 05): job `docs` in `ci.yml`; `.github/workflows/docs-deploy.yml` (P7): the gate `deployDecision` skips a pushed tag that is not the newest, fails a tag without its changelog release; Pages permissions only on the `deploy` job; `docs:stale --strict` and (stage 12) the browser check before the upload. No secret.
- **D11 Browser check** (stage 06): Playwright, port 8093, flock.
- **D12 Changelog** (stage 13): F114's `CHANGELOG.md` (Keep a Changelog 1.1, `release:prepare`) gains the "For users" form; `parseChangelog` in `@ea/core`.
- **D13 Image**: no `apps/docs` source; install `--filter "!@ea/docs"`; `CHANGELOG.md` for the card (stage 15).

### Edge cases (answered)

- States: P9, D10. Crash: a failed deploy changes nothing live; a re-run is safe; no DB. Private data: D4, P5.

## Not verified

- **N1** The `github-pages` environment accepts a tag deploy → stage 16 (owner).
- **N2** Search in Firefox, Safari → open.
- **N3** Closed by stage 01: filtered frozen install.
- **N4** axe WCAG 2.2 AA on Starlight's own markup → stage 06; a violation there is a question.
- **N5** Closed by stage 01: the peer is optional; not added.

## Done when

1. `bun run docs:build` logs the three D9 lines; each stage 02–03 failure case fails it.
2. `bun run docs:stale --strict` exits 0; every Polish page of P6 has a current `sourceHash`.
3. The browser check: 0 CSP violations, search works, axe 0 violations.
4. CI job `docs` green on `master`; `image` green.
5. With `docs_links` on, the panel shows Help (e2e) and the card per P9 (component test).
6. The site is live at the P8 URL (stage 16).

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, the ticket, this file and your stage. Build only your stage.
- Format only your files; commit by explicit path after `git diff --staged`.
- Never read, print or copy `.env` or a secret. No real name, address, host or mail text in a doc page or a test.
- No `astro dev` (F101 D7).
- A doc page states only what the code at `HEAD` does (P2). A gap is a question in the final message.
- Do not edit `spec/build.md`, `docs/product/stage-2/*` or another ticket. A gap or deviation is a question, not a choice.

## Proof

One call after the last commit; claim only saved logs.

```
mkdir -p /tmp/f112-sNN && bun run lint > /tmp/f112-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f112-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f112-sNN/unit.log 2>&1 && bun run docs:build > /tmp/f112-sNN/docs.log 2>&1 && echo PROOF_OK
```

Stages 01, 06, 11, 15 give their own chain.

## Owner steps

- **O1** (stage 16): Pages source "GitHub Actions"; allow `v*` tags in `github-pages`; run the deploy on `master`.

## Review

Review job before the land (`claude-opus-5-5`, high): stages 01, 02, 05, 10, 12, 15. Text: "Review F112 stage NN on <branch> against plan.md and the stage file: each decision and numbered test. Quote file and line."

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
- 11 [Shot component and run](stages/stage-11-shot-run.md).
- 12 [Shots on pages and in the deploy](stages/stage-12-shots-pages-deploy.md).
- 13 [Changelog](stages/stage-13-changelog.md).
- 14 [Flag and card logic](stages/stage-14-card-logic.md).
- 15 [Panel Help link and card](stages/stage-15-panel-ui.md).
- 16 [First publication](stages/stage-16-publication.md) `[risky]` outside publication; owner O1.

Order: 01 → 07; 08 and 09 after 07 (parallel); 10 after 08, 09; 11 and 13 after 06 (next to 07–10); 12 after 10, 11; 14 after 13; 15 after 14; 16 last. 06 waits while another `bun.lock` change builds.

## How to run (coordinator)

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "F112-sNN <slug> · F112" \
  "Implement F112 stage NN. Read spec/features/active/F112-e10a-docs-site/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step. Final proof: the Proof of your stage, after the last commit. Claim only what a saved log shows."
```

Land each with `limen land <id> --yes --keep-open`; drop the job DB. Stage 16 is the coordinator's after O1.

## Cold review

Model: `claude-opus-5-5`: `[risky]` stages; deploy and Polish text are TRACK risk areas.

Review 1 ([plan-review-1.md](plan-review-1.md)): FAIL, 4 blocking, 14 notes; all fixed.

Review 2 of refresh 1 ([plan-review-2.md](plan-review-2.md)): FAIL, 2 blocking, 6 notes; fixed per the coordinator ([plan-refresh-1.md](plan-refresh-1.md) § Review 2 fixes).

## Log

- 2026-11-15: planned; review 1 fixed.
- 2026-11-15: stage 01 landed. Refresh 1 to `17b2a369`: stages 03, 04, 06, 11, 13, 15, 16 ([plan-refresh-1.md](plan-refresh-1.md)).
