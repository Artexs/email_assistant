# F101 stage 03 — Docs

Part of [`../plan.md`](../plan.md). Read its D4, D7, D8, D12, facts F1–F12, N4 and § Rules for every stage first. Needs stage 02 landed.

Docs only: no code, no `package.json`, no `bun.lock`. Three steps, about 70 changed lines. Write in the style of the file you edit (short sentences, active voice, about ASD-STE100). No real name, tailnet name or address.

## Step 1 — ADR 0016 amendment and architecture §7

- **Goal:** the accepted web-panel ADR and the architecture page describe the CSP as it is on Astro 7.
- **Files:** `docs/decisions/0016-web-panel-static-build-and-better-auth.md`, `docs/architecture.md`.
- **Interfaces:** none.
- **Decisions:** D2, D4, D8. ADR status stays `accepted`; earlier text is not rewritten (an amendment adds, like the existing "Amendment (S6b, 2026-11-13)").
  - ADR 0016: add at the end `## Amendment (Astro 7, <land date of stage 02, YYYY-MM-DD>)` with these points, in this order:
    1. The panel builds on Astro 7.4.12 (`astro` and `@astrojs/react` are exact pins). Facts and decisions: `spec/features/<lane>/F101-panel-to-astro-7/plan.md` (use the lane folder the ticket is in when you write).
    2. The meta CSP comes from the stable option `security.csp` (Astro 6 made it stable). This replaces the consequence "The hashed CSP depends on the Astro `experimental.csp` flag."
    3. The integration `apps/web/integrations/csp-style-src.ts` relaxes `style-src` and then checks every built page. The build fails when a page has not exactly one CSP meta, lacks `default-src 'self'` or `script-src`, has `'unsafe-inline'` in `script-src`, or has another `style-src`; and when the build has no page.
    4. Markdown syntax highlighting is off in the panel, because Shiki writes inline styles that the CSP does not allow.
  - `docs/architecture.md` §7, the bullet that starts `**CSP (D5):**`: after its last sentence ("…the integration `apps/web/integrations/csp-style-src.ts` sets that after the build."), add: "The same integration fails the build when a page loses its CSP meta or gets `'unsafe-inline'` in `script-src` (ADR 0016, amendment Astro 7)."
- **Test:**
  1. `grep -c '^## Amendment (Astro 7' docs/decisions/0016-web-panel-static-build-and-better-auth.md` prints `1`.
  2. `grep -c 'security.csp' docs/decisions/0016-web-panel-static-build-and-better-auth.md` prints `1` or more.
  3. `grep -c "ADR 0016, amendment Astro 7" docs/architecture.md` prints `1`.
- **Check:** tests 1–3; `bunx prettier --check` on both files.
- **Done when:** tests 1–3 hold.
- **Out of scope:** ADR 0030 (the docs-site ticket F112 updates it); `docs/decisions/README.md` (the ADR status does not change).

## Step 2 — Capability page and README

- **Goal:** the web-panel capability page (PD-009) and the developer README say what is true after the move.
- **Files:** `docs/capabilities/web-panel.md`, `README.md`.
- **Interfaces:** none.
- **Decisions:** D7, D8.
  - `docs/capabilities/web-panel.md` (written by F095 stage 06): remove the limit item that names the Astro version and this ticket ("Astro version (Panel to Astro 7, F101)" or similar). Where the page describes the static build (`WEB_DIST`), state the version once: "Astro 7.4 static build with React islands". If the page has no such limit item or no static-build text, add the one sentence to its static-build part or, if none exists, to its first section, and say so in the final message. If the page does not exist, stop and ask (F095 must be in `done/` before this ticket builds).
  - `README.md`, the `bun run web:dev` row of the command table: the description becomes "Starts the Astro dev server (in an agent session Astro runs it in the background: `bunx astro dev stop` in `apps/web` ends it)". Keep the table aligned the way `prettier` formats it.
- **Test:**
  4. `grep -c 'F101' docs/capabilities/web-panel.md` prints `0`.
  5. `grep -c 'Astro 7' docs/capabilities/web-panel.md` prints `1` or more.
  6. `grep -c 'astro dev stop' README.md` prints `1`.
- **Check:** tests 4–6; `bunx prettier --check` on both files.
- **Done when:** tests 4–6 hold.
- **Out of scope:** other capability pages; `deploy/README.md` (the deploy steps do not change).

## Step 3 — The Astro note

- **Goal:** the next agent that touches Astro (E4-A pages, the docs site) finds the facts of this move in one place.
- **Files:** `notes/2026-11-13-astro-starlight-versions.md` (append; same topic, `CLAUDE.md` § Notes).
- **Interfaces:** none.
- **Decisions:** D1, D5, D7, D12; facts F1, F6, F9–F12; N4.
  - Append a section `## Panel on Astro 7 (F101, <land date of stage 02>)` with one bullet each:
    1. Versions: `astro` 7.4.12 and `@astrojs/react` 7.1.9 exact pins, Tailwind `^4.3.5` (4.1 does not accept Vite 8), Vite 8. A bump of `astro` repeats the stage 02 checks of F101 (build check, typecheck, full e2e).
    2. Config: `security.csp` (not `experimental.csp`); `markdown.syntaxHighlight: false` (Shiki and the CSP).
    3. `astro check` needs `@astrojs/astro2tsx` 0.1.4 or later in `bun.lock`: 0.1.3 fails with `this.bridge.setLastError is not a function` when `rolldown` hoists `@emnapi/runtime` 2.0 beta. Fix: `bun update @astrojs/astro2tsx`.
    4. Node: the Astro 7 CLI needs Node 22.23.4 or later; CI pins Node 24 in the `ci` and `e2e` jobs; the server image has no Node and Bun runs the CLI.
    5. `astro dev` runs in the background in an agent session: `bunx astro dev status`, `bunx astro dev stop`, `bunx astro dev logs` in `apps/web`; `--ignore-lock` keeps it in the foreground. Its log is `apps/web/.astro/dev.log`.
    6. The Rust compiler of Astro 7 rejects unclosed tags and keeps invalid nesting as written; whitespace between elements follows JSX rules (`compressHTML: 'jsx'`). `src/fetch.ts` is a reserved file name.
    7. For the docs site: Starlight 0.43.1 (2026-11-14) needs `astro ^7.2.10`; pin `apps/docs` to the same `astro` version as `apps/web`, so Bun installs one copy (F101 D12).
    8. Open: the Vite 8 dev proxy with `timeout: 95_000` was not tested with a long request (F101 N4).
  - Also change the existing line "So a maintained Starlight needs Astro 7. The E10 discovery proposes one ticket that moves the panel to Astro 7 first …" so that it says the move is done (F101) and points to the new section. Do not change the other old lines.
- **Test:**
  7. `grep -c '^## Panel on Astro 7' notes/2026-11-13-astro-starlight-versions.md` prints `1`.
  8. `grep -c 'astro2tsx' notes/2026-11-13-astro-starlight-versions.md` prints `1` or more.
- **Check:** tests 7 and 8; `bunx prettier --check` on the file.
- **Done when:** tests 7 and 8 hold; one commit holds the five files of this stage (`git add` by path).
- **Out of scope:** `docs/known-alerts.md` (no new alert); `spec/build.md`.

## Done when (stage)

- Steps 1–3 hold.
- The stage 03 Proof command of `plan.md` prints `PROOF_OK` (`/tmp/f101-s03`), with `<files>` = `docs/decisions/0016-web-panel-static-build-and-better-auth.md docs/architecture.md docs/capabilities/web-panel.md README.md notes/2026-11-13-astro-starlight-versions.md`.
