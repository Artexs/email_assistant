# Astro and Starlight versions (checked 2026-11-13)

Found in the E10 discovery (`docs/product/stage-2/epics/E10-discovery-notes.md` §3). Read this before you upgrade `apps/web` or add a docs app.

- `apps/web` pins `astro` 7.4.12 since F101 (was 5.13.7). The newest 5.x is 5.18.2 (2026-05-26). Astro 6.0.0 came out 2026-03-10, 7.0.0 on 2026-06-22. The current version is 7.4.11.
- `@astrojs/starlight` peer ranges (`npm view @astrojs/starlight@<v> peerDependencies`):
  - 0.34–0.37: `astro ^5.5.0` (last: 0.37.7, 2026-03-06)
  - 0.38–0.39: `^6.0.0`; 0.40: `^6.4.5`
  - 0.41: `^7.0.2`; 0.42 (0.42.11, 2026-11-12): `^7.2.10` and `@astrojs/markdown-remark ^7.3.0`
- So a maintained Starlight needs Astro 7. The move is done (F101): see § Panel on Astro 7 below. The workspace keeps one Astro major.
- Starlight's `docsLoader()` reads only `src/content/docs`. To read files in place elsewhere (operator docs, `CHANGELOG.md`), use Astro's `glob` loader with `base` and `docsSchema()`.
- Recheck with: `npm view @astrojs/starlight version peerDependencies --json`.

## Panel on Astro 7 (F101, 2026-11-15)

- **Versions:** `astro` 7.4.12 and `@astrojs/react` 7.1.9, exact pins. Tailwind (`tailwindcss` and `@tailwindcss/vite`) is `^4.3.5`, because 4.1 rejects Vite 8. Tailwind 4.3 changed the default `--font-sans`. A `@theme` block in `apps/web/src/styles/global.css` keeps the 4.1 font stack. After a later Tailwind bump, compare the CSS custom properties of the old and new build (stage 02 test 8 of F101). After an `astro` bump, repeat the stage 02 checks of F101.
- **Config:** `security.csp` in `apps/web/astro.config.mjs`, not `experimental.csp` (Astro 7 stops on that flag). Markdown highlighting is off: Shiki inline styles break the CSP.
- **Typecheck:** `astro check` needs `@astrojs/astro2tsx` 0.1.4 or later. Version 0.1.3 stops with `this.bridge.setLastError is not a function`. The fix is `bun update @astrojs/astro2tsx`: it changes only `bun.lock`.
- **Node:** the Astro 7 CLI needs Node 22.23.4 or later. CI pins Node 24 in the `ci` and `e2e` jobs, and `.nvmrc` says `24` (it said 22.14.0, which the CLI rejects). The server image has no Node: Bun runs the CLI.
- **Dev server:** in an agent session, `astro dev` runs in the background. Use `bunx astro dev status`, `stop` or `logs` in `apps/web`. `--ignore-lock` keeps it in the foreground. The log file is `apps/web/.astro/dev.log`.
- **Compiler:** Astro 7 has only the Rust compiler. It rejects an unclosed tag and does not fix invalid nesting. `compressHTML` defaults to `'jsx'` (whitespace by JSX rules). `src/fetch.ts` is reserved: the panel has none.
- **Docs site:** `apps/docs` (F112) pins the same `astro` version as `apps/web`.
- **Open:** the Vite 8 dev proxy option `timeout: 95_000` in `astro.config.mjs` is not checked on Vite 8. Test a slow `/api` call in `web:dev` before you rely on it.
