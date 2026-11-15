---
opened: 2026-11-13
landed: 2026-11-15
---

# F112 · E10a Docs site

## Outcome

A stranger, a new user and the operator can read the product's docs on a public static site, built from this repository. The site holds a tutorial, how-to guides, a reference, explanations, an FAQ (English, with Polish for the user set), the operator docs read in place from `deploy/`, and the changelog. CI proves that each page keeps a strict CSP, shows no private data and has no broken link. The panel gets a Help link and a "What is new" card behind a flag. Source: E10 decisions 1–18 (`docs/product/stage-2/epics/E10-go-to-market-readiness.md`), ADR 0030.

## Scope

- A new docs app on Starlight, on the same Astro as the panel.
- Build checks: CSP, public content, links, stale Polish pages; a browser check.
- CI job and a GitHub Pages deploy workflow; the first publication.
- User docs for what the code does now; operator docs in place.
- `CHANGELOG.md` format and parser; the panel Help link and card.

## Out of scope

- Home and positioning, security, pricing pages, demo video, cold read, API reference: E10b (F121).
- Behaviour behind a default-off flag (plan P2).
- Release scripts and tags: E8b (F114).

## Acceptance

- `bun run docs:build` passes and logs its three check lines ([plan.md](plan.md) D9).
- A broken CSP, a real tailnet host, a non-example mail address, an external asset or a broken link fails the build.
- `bun run docs:stale` exits 0.
- The browser check shows 0 CSP violations and 0 axe violations.
- CI job `docs` is green on `master`.
- The site answers at `https://artexs.github.io/email_assistant/` after the owner's first deploy.
- All checks: [plan.md](plan.md) § Done when (6 items).

## Slices

16 stages, one worker job each (stage 16: owner and coordinator) ([plan.md](plan.md) § Stages, § How to run). Stages 01 and 06 change `bun.lock`: never next to another `bun.lock` change. No migration. Owner step O1 (Pages settings, first deploy) before stage 16.

## Sequenced

- Plan after: none (F102 is not used: plan P3; F114's `CHANGELOG.md` and release checklist have landed: D12).
- Build after: F095 (E1) and F101 (Astro 7) in `spec/features/done/` (`05-execution-plan.md` §2.1 row 18).
- Gate: —. Stage 16 waits for owner step O1.
- Refresh: plan base 17b2a369 (refresh 1, 2026-11-15, [plan-refresh-1.md](plan-refresh-1.md)); stage 01 landed. Stage 13 uses F114's landed `CHANGELOG.md` and `docs/release-checklist.md`.

## Notes

Source row: §2.1 # 18. Small defaults: [questions.md](questions.md).
