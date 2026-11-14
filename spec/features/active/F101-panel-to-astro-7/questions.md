# F101 · Open questions (small: the stages do not change with the answer)

Each has a default that the plan uses now. Answer only to change one.

1. **Exact versions for Astro.** `astro` 7.4.12 and `@astrojs/react` 7.1.9 are exact pins; Tailwind keeps a caret range. A later Astro bump is a deliberate change with the same checks (build check, typecheck, full e2e). Default: exact pins. (plan.md D1)
2. **Own VPS deploy right after the docs stage.** The coordinator deploys and checks the panel at once, then closes the ticket, so E4-A (F102) and the docs site (F112) can start. The other choice is to wait for the next normal deploy; the ticket would stay open and block both. Default: own deploy, stage 04. (D9)
3. **Markdown syntax highlight off in the panel.** The panel has no Markdown; Astro 7 warns on every build that Shiki and the CSP do not fit. Default: off; a later page with code blocks decides its highlighter then. (D3)
4. **Node 24 in the CI `ci` job.** The Astro 7 CLI needs Node 22.23.4 or later; the runner image has exactly 22.23.4 and changes to Ubuntu 26.04 this month. Default: pin Node 24, the same as the `e2e` job. (D5)
5. **"PD-098 area" in the planning instruction.** The Astro 7 decision is PD-097; PD-098 is the public docs site. Default: the plan cites PD-097. (plan.md § Input)
