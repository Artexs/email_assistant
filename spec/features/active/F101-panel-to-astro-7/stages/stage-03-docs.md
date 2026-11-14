# F101 stage 03 — Docs

Part of [`../plan.md`](../plan.md). Read its D-list, N4, § Rules and [`../probes/facts.md`](../probes/facts.md). Needs stage 02 landed.

Docs only. Three steps, about 70 lines, in each file's style (about ASD-STE100). No real name, tailnet name or address.

## Step 1 — ADR 0016 amendment and architecture §7

- **Goal:** the ADR and architecture describe the CSP on Astro 7.
- **Files:** `docs/decisions/0016-web-panel-static-build-and-better-auth.md`, `docs/architecture.md`.
- **Decisions:** D2, D4, D8. Status stays `accepted`; old text is not rewritten (an amendment adds, like "Amendment (S6b, 2026-11-13)").
  - ADR 0016 ends with `## Amendment (Astro 7, <land date of stage 02>)`, these points in order:
    1. Astro 7.4.12 (`astro`, `@astrojs/react` exact pins). Source: ticket F101 by id only (the folder moves).
    2. The meta CSP comes from the stable `security.csp`; this replaces the `experimental.csp` consequence.
    3. The integration relaxes `style-src`, then checks every page; the build fails on the D4 cases.
    4. Markdown highlighting is off: Shiki inline styles break the CSP.
  - Architecture §7, the `**CSP (D5):**` bullet, after its last sentence: "The same integration fails the build when a page loses its CSP meta or gets `'unsafe-inline'` in `script-src` (ADR 0016, amendment Astro 7)."
- **Test:**
  - T1: the ADR has exactly one line that starts `## Amendment (Astro 7`.
  - T2: the ADR names `security.csp` at least once.
  - T3: `docs/architecture.md` holds `ADR 0016, amendment Astro 7` exactly once.
- **Done when:** T1–T3 hold; prettier passes on both files.
- **Out of scope:** ADR 0030 (F112); `docs/decisions/README.md`.

## Step 2 — Capability page and README

- **Goal:** capability page (PD-009) and README are true.
- **Files:** `docs/capabilities/web-panel.md`, `README.md`.
- **Decisions:** D7, D8.
  - Capability page: remove the limit item about Astro 5 and F101. The static-build item (`WEB_DIST`) names "Astro 7.4 static build with React islands" once; if a text is missing, use the first section and say so.
  - `README.md`, the `bun run web:dev` row: "Starts the Astro dev server (in an agent session Astro runs it in the background: `bunx astro dev stop` in `apps/web` ends it)". Keep the table as prettier formats it.
- **Test:**
  - T4: the capability page names `F101` 0 times.
  - T5: the capability page names `Astro 7` at least once.
  - T6: `README.md` holds `astro dev stop` exactly once.
- **Done when:** T4–T6 hold; prettier passes on both files.
- **Out of scope:** other capability pages; `deploy/README.md`.

## Step 3 — The Astro note

- **Goal:** the next agent that touches Astro finds this move's facts in one place.
- **Files:** `notes/2026-11-13-astro-starlight-versions.md` (append; `CLAUDE.md` § Notes).
  - Append `## Panel on Astro 7 (F101, <land date of stage 02>)`, one bullet each, from the facts named:
    1. Versions and pins (D1, F1); the Tailwind 4.3 font change and the `global.css` block (D6, F13); a later Tailwind bump compares CSS custom properties as stage 02 T8; an `astro` bump repeats the stage 02 checks.
    2. Config: `security.csp`, not `experimental.csp`; highlight off (D2, D3).
    3. `astro check` needs `@astrojs/astro2tsx` 0.1.4 or later; quote the 0.1.3 error and the fix (F6).
    4. Node 22.23.4 or later; CI pins Node 24 in `ci` and `e2e`; the image runs the CLI with Bun (D5, F10).
    5. `astro dev` in the background in agent sessions; `bunx astro dev status|stop|logs`; `--ignore-lock`; its log file (F11).
    6. Rust compiler rules, `compressHTML: 'jsx'`, reserved `src/fetch.ts` (F12).
    7. Docs site: same `astro` pin in `apps/docs` (D12).
    8. Open: N4.
  - Also change two old lines: the pin line ("`apps/web` pins `astro` 5.13.7 …") starts "`apps/web` pins `astro` 7.4.12 since F101 (was 5.13.7)." and keeps its dates; the line "So a maintained Starlight needs Astro 7. …" says the move is done (F101) and points to the new section. No other old line changes.
- **Test:**
  - T7: exactly one line starts `## Panel on Astro 7`.
  - T8: the note names `astro2tsx` at least once.
  - T9: the note holds `7.4.12 since F101` exactly once.
- **Done when:** T7–T9 hold; one commit with the five files.
- **Out of scope:** `docs/known-alerts.md`.

## Done when (stage)

- Steps 1–3 hold.
- The stage 03 Proof of `plan.md` prints `PROOF_OK` (`/tmp/f101-s03`), with `<files>` = `docs/decisions/0016-web-panel-static-build-and-better-auth.md docs/architecture.md docs/capabilities/web-panel.md README.md notes/2026-11-13-astro-starlight-versions.md`.
