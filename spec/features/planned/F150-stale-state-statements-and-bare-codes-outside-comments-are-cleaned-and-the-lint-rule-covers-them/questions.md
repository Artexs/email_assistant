# F150 questions

No blocking question. Defaults taken; the stages do not change with the answers.

1. **Q1 [important: scope] How far does the bare-code scan reach?** Default (plan P1): comments as today, plus strings and JSX text of non-test sources, JSON values under `apps`, `packages`, `scripts`, `tools`, the docs site pages and `docs/modules.md`. `docs/capabilities/` (637 code hits at the plan base), ADRs, `docs/owner-decisions.md`, tool READMEs and `CLAUDE.md` stay out. Other option: include `docs/capabilities/` now (one more large text stage). Undo: a later ticket adds a folder to the scan file set after its clean-up.
2. **Q2 [minor] Styleguide wording.** Default (plan D11): the "Avoid" item of `.agents/limen/styleguide.md` and `docs/code-patterns.md` § Comments grow by one clause that names the new reach. Undo: revert the two sentences.
3. **Q3 [minor] Old segment names in the module map.** Default (plan D10): names such as `S4` or `S6a` in `docs/modules.md` go like ticket numbers, because the scan pattern treats them the same and a stranger cannot resolve them. Undo: add an allow-list for `S\d[a-z]?` in Markdown.
