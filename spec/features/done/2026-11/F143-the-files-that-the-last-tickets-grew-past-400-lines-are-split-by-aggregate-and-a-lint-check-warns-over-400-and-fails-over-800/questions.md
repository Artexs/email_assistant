# F143 questions (defaults taken; owner to confirm)

1. [important: scope] **Test files are outside the size rule** (plan D2). Default: the rule skips `*.test.*`, `*.spec.ts`, test helpers, `apps/server/test/**`, `apps/*/e2e/**`, `tools/*/test/**`. Reason: 40 test files are over 800 lines, and the test audit (F125) owns test files. Undo: drop the `ignores` of the size block after F125; split what fails.
2. [important: rule-exception] **One limit for all files** (plan D3). Default: the old `file-size.test.ts` hard cap of 400 lines on eight F131 groups goes; those files now warn over 400 and fail over 800, like every file. Reason: one rule in one place, no list entry per split. Undo: add a second `size/max-lines-hard` block at 400 for those globs.
3. [minor] **Text tables split by locale, not by group** (stage 05, D15). Default: `<table>-en.ts` and `<table>-pl.ts`; a group split only for a locale file over 400. Undo: split a locale file by group later.
4. [minor] **The other files between 400 and 800 lines stay** (plan D14). About 28 files keep a lint warning. The coordinator writes a follow-up ticket for them.
