# F112 questions (defaults taken)

The plan uses each default. None blocks a stage.

1. **Q1 [important: user-visible] Flagged features in the user docs (P2).** Every new feature ships behind a default-off flag, so a stranger cannot see whether a flagged feature is on. Default: a feature behind a default-off flag gets no user page; its page comes when its flag defaults on. Other option: document it with an aside "your operator turns this on".
2. **Q2 [important: scope] API reference and autonomy-evidence reference (P3).** Their sources (the F102 OpenAPI file, the F110 numbers) do not exist, and F102 has no stages. Default: both move to F121 (E10b). Other option: one more F112 stage that builds after F102. Edit for the coordinator: F121 scope gains both.
3. **Q3 [minor] Screenshot data (P5).** The E2b demo fixture does not exist. Default: shots from the e2e seed (synthetic, `x.test`); F121 moves them to the E2b fixture.
4. **Q4 [important: production] Manual deploy (P7, D10).** Default: the deploy workflow also runs by hand on any branch or tag (the first deploy uses `master`, as no tag exists yet; a run on an old tag is the rollback). A pushed tag deploys only when it is the newest plain `v<x.y.z>` tag and `CHANGELOG.md` has its release. Other option: tags only (no site until E8b makes the first tag).
5. **Q5 [minor] "What is new" with no stored version (P9).** Default: show the newest release only; the seen version is stored per member in the browser. Other option: store the newest version and show nothing.
6. **Q6 [important: security] Docs site CSP (D3).** Starlight sets `style` attributes, so `style-src` needs `'unsafe-inline'` (as the panel, ADR 0016 amendment). A meta CSP cannot set `frame-ancestors`, and GitHub Pages sets no headers, so another site can frame the docs. Default: accept both for a static site with no login and no form.
7. **Q7 [minor] One flag (P4).** Default: one flag `docs_links` for the Help link and the card. Other option: two flags.
