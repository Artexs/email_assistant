---
opened: 2026-11-13
---

# F101 · Panel to Astro 7

## Outcome

The web panel builds on Astro 7 with the same pages, texts and Content Security Policy as on Astro 5. The workspace then has one Astro major, which the docs site (Starlight needs Astro 7.2.10 or later) and the new panel pages of E4-A use. A build that loses the CSP of a page now fails instead of shipping. Source: E10 discovery decision 3 (PD-097), `docs/product/stage-2/epics/E10-discovery-notes.md` §5 and §7.

## Scope

- The web app's Astro, React integration and Tailwind versions, and the lockfile.
- The Astro config: the CSP option moved out of `experimental` in Astro 6.
- The post-build CSP integration (`apps/web/integrations/`): it also checks every page.
- The CI job that builds the web app: the Astro 7 CLI needs a newer Node.
- The docs that name the Astro version or the CSP flag, and one VPS deploy.

## Out of scope

- The docs app, Starlight and ADR 0030: the E10a Docs site ticket (F112).
- New pages, Polish texts, visual changes: E4-A (F102) and E7-T1 (F098).
- Other dependency upgrades (React, better-auth, Playwright, ESLint plugins).

## Acceptance

- `bun run web:build` on Astro 7.4.12 builds every page and logs `csp checked in <n> page(s)`, with `<n>` the number of built `.html` files (16 at plan time; [plan.md](plan.md) § Proof, page count).
- The panel CSS keeps its font and theme values: the custom properties differ from the Astro 5 build only by the same-value lines of `probes/css-vars-expected.diff`.
- A built page without the CSP meta, or with `'unsafe-inline'` in `script-src`, fails the build (unit tests of stage 01).
- The full e2e suite passes on the desktop and mobile projects with no CSP violation.
- The `ci`, `e2e` and `image` jobs of the first `master` CI run after the Astro 7 land are green.
- On the VPS, `/login` carries the CSP meta of ADR 0016 and its `/_astro/` script answers 200.
- All checks: [plan.md](plan.md) § Done when (8 items).

## Slices

Four stages in order ([plan.md](plan.md) § Stages): 01 CSP build check; 02 `[risky]` Astro 7 move, the only `bun.lock` change (never next to another `bun.lock` change of any ticket); 03 docs; 04 VPS deploy, run by the coordinator. No migration, no owner checkpoint, no owner step. Commands: [plan.md](plan.md) § "How to run (coordinator)".

## Sequenced

- Plan after: none.
- Build after: F095 (E1 Close the MVP) in `spec/features/done/` (§2.1 row 7 of `docs/product/stage-2/05-execution-plan.md`: needs E1; stage 03 edits the web-panel capability page that F095 writes).
- Gate: —. Stage 02 waits while another `bun.lock` change is in build.
- Refresh: before stage 01 builds, a `--role planner` job `Refresh F101` (`.agents/limen/planner.md` § Refresh job) checks the plan against `master`, unless `plan-refresh-1.md` exists in this folder. Plan base `a72b214`; F098 and F099 add and change panel pages that the Astro 7 move must cover.

## Notes

These wait for this ticket: E4-A Act from the panel (F102) and E10a Docs site (F112). Small defaults: [questions.md](questions.md).
