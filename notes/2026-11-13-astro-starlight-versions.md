# Astro and Starlight versions (checked 2026-11-13)

Found in the E10 discovery (`docs/product/stage-2/epics/E10-discovery-notes.md` §3). Read this before you upgrade `apps/web` or add a docs app.

- `apps/web` pins `astro` 5.13.7. The newest 5.x is 5.18.2 (2026-05-26). Astro 6.0.0 came out 2026-03-10, 7.0.0 on 2026-06-22. The current version is 7.4.11.
- `@astrojs/starlight` peer ranges (`npm view @astrojs/starlight@<v> peerDependencies`):
  - 0.34–0.37: `astro ^5.5.0` (last: 0.37.7, 2026-03-06)
  - 0.38–0.39: `^6.0.0`; 0.40: `^6.4.5`
  - 0.41: `^7.0.2`; 0.42 (0.42.11, 2026-11-12): `^7.2.10` and `@astrojs/markdown-remark ^7.3.0`
- So a maintained Starlight needs Astro 7. The E10 discovery proposes one ticket that moves the panel to Astro 7 first (check the `experimental.csp` option and the `integrations/csp-style-src` integration), so the workspace keeps one Astro major.
- Starlight's `docsLoader()` reads only `src/content/docs`. To read files in place elsewhere (operator docs, `CHANGELOG.md`), use Astro's `glob` loader with `base` and `docsSchema()`.
- Recheck with: `npm view @astrojs/starlight version peerDependencies --json`.
