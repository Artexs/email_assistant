# F091 · Open questions (small: the stages do not change with the answer)

Each has a default that the plan uses now. Answer only to change one.

1. **How to keep `git log --follow` for every new file?** Default: the history merge (plan.md D7): per new file one commit that renames the old file to it, one merge commit, then the trim commit. Every new file's `--follow` reaches the first commit of the old file (probed). Cost: one merge commit in `master` history that does not build (bisect skips it), and each new file's log lists the copy commits. Alternative: one plain commit; then only `git blame -C` follows the lines, and `--follow` works for no new file. (stages 01, 02)
2. **File names.** Default: `actions/repo/{shared,planned,reads,filters,claims,lifecycle,expiry,undo,sends,drafts,notify,approvals,retention}.ts` and `mail/repo/{shared,mailboxes,folders,credentials,copies,emails,targets,claims,lookup,retention}.ts` (D9, D10). Changing a name changes only the map in `tools.md`.
3. **Does the committer also read the handler table?** Default: yes (D13). Its four type checks (IMAP, SMTP, tenant texts, sort folders) become `needs` fields of each handler, with the same result for every type today. The input D3 named only `applyAction`.
4. **One list of draft kinds (`draftKinds`) and its own stage?** Default: yes (D16, D19). It also edits two F088 files and `triage/service.ts` (`payloadOf` without `default`). The plan has 5 stages, not the 4 of `07-foundation-plan.md`.
5. **No new integration test file for the CHECK list.** Default: none (D15): `actions-transitions.test.ts:68–79` already compares `actionTypes` with `actions_type_check`.
6. **Files over 400 lines that stay:** `actions/send.ts` (516), `mail/sync.ts` (609), `actions/transitions.ts` (632, data). Default: out of scope (D20); a follow-up ticket if the owner wants them split.
