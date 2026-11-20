# core.bare flips to true (2026-11-20)

Seen three times: git then fails with "this operation must be run in a work tree" and `limen land` stops. Fix: `git config core.bare false`.
Lead (a guess, not proven): `deploy/test/restore.test.ts` runs `git init` and `git tag` in a temp repo (line ~309). When the file runs inside a git hook, the inherited `GIT_DIR` makes those calls hit the real repo. In the F152 stage 02 job the hook run of this file saw a `git tag` exit 128. Next step: a worker clears `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` in the env of the test's git helper, and the test checks `core.bare` stays false.
