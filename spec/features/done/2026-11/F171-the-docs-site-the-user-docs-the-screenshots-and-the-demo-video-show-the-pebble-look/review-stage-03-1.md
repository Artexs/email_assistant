PASS cefc46ca98b636c4e539b64bc034e8dae6ea87b1

Reviewed commit: `cefc46ca98b636c4e539b64bc034e8dae6ea87b1`. It is the merge of master `3c64a5886` into the stage 03 work commit `b3524849c`. `git rev-parse HEAD` matches it. The tree is clean.

The candidate does what stage 03 of `spec/features/active/F171-…/stages/stage-03-docs-text.md` asks:
- **Step 1, one prefix list:** the list moved unchanged into `apps/web/src/i18n/runtime-key-prefixes.ts`, with the new `switch_` entry pointing at `ModeCard.tsx`.
- **Step 2, the docs text check:** `docsOnlyKeys` and its tests are in `apps/docs/src/panel-keys.ts` and `panel-keys.test.ts`.
- **Step 3, the `check:job` step:** it is added and the header comment is updated.
- **Step 4, the page sweep:** it produced no page edits. The page tickets had already fixed the "Account card" sentence in `start/index.mdx` that the plan expected to change.

No blocking finding.

## Unverified
- **The full Proof with `PROOF_OK`:** the worker ran the steps one at a time, not as one chained command. Each log ends in success, so `PROOF_OK` never reached a log:
  - `check.log` ends with `check:job PASS master=3c64a5886f tip=cefc46ca98 full=0`.
  - `build.log` ends with `Exited with code 0`.
  - `docs.log` shows `166 passed`.
  - The tip in `check.log` is the candidate commit.
- **The worker's own page sweep:** it has no log. The worker says it was "my own reading". I sampled the pages myself (see the notes below).

## Notes
1. **Proven (reproduction, `/tmp/f171-review-1/sigpipe.txt`): the new `check:job` step skips without a message when a branch changes about 350 or more files.** The line is `printf '%s\n' "${changed[@]}" | grep -qE '^(apps/web/src/|…)' && panel_changed=1` under `set -euo pipefail`.
   - `grep -q` exits on its first match, `printf` then gets SIGPIPE (141), and with pipefail the `&&` never sets `panel_changed=1`.
   - Reproduction with `set -euo pipefail` and 54-byte `apps/web/src/...` paths:
     - Up to 300 paths: the flag was set in 5 of 5 runs.
     - 350 or more paths: the flag was not set in 5 of 5 runs.
     - 400 paths: `PIPESTATUS` showed `141 0` in 5 of 5 runs.
   - So on the large panel changes that most need it, the docs text check does not run and `check:job` still prints PASS.
   - The same pattern already exists in the `full` and `docs_changed` lines. The `full` line is the worse one: a big branch with a migration would not run the full suites.
   - The largest of the last 40 master merges changed 170 files, so this is rare today.
   - Fix: drop `-q` (`… | grep -E … >/dev/null && …`), or use `grep -qE … <<<"$(printf …)"`. Apply it to all three lines.
   - Not blocking: the stage acceptance (test 10, the log line) passed.
2. **Proven (grep, `/tmp/f171-review-1/polish-gender.txt`): one Polish sentence gives the reader a gender.** `apps/docs/src/content/docs/pl/faq.mdx:54` reads "Możesz też sam przenieść wiadomość z powrotem." This breaks PB-8 of `docs/product/pebble-ui/README.md`.
   - It is older than this branch (added in F112 stage 10, commit `fac877cf1`). The plan rule D6 gives stage 03 every docs page, but its sweep checks panel names, not gender.
   - Fix: "Możesz też samodzielnie przenieść…" or "…przenieść wiadomość ręcznie z powrotem." Then restamp with `bun run docs:stale --stamp`.
   - Borderline, not a finding: "Jesteś właścicielem organizacji" in `pl/how-to/approve-a-send.mdx:16` and `pl/how-to/delegate-and-follow-up.mdx:22` uses the panel's role noun "właściciel".
   - No `-łeś`, `-łaś` or `-łbyś` forms were found in the Polish pages or the docs components.
3. **Plausible: one bold name in the docs is not a real text.** `explanation/never-sends-alone.mdx:43` says "You get the notice **Sends held**". No such title exists: the notice starts "⏸ Sends from {address} wait: …" (`packages/core/src/texts/notices-en.ts:125`).
   - This is a Telegram notice on an approvals page, not a Pebble panel text, so it is outside the sweep. Worth a follow-up.
4. **Checked: the docs pages match the panel at HEAD in my sample.** Some sample values are saved in `/tmp/f171-review-1/panel-samples.txt`.
   - The check-button and pencil-button order on the Activity page, the "Only not rated" chip, and the category picker dialog title.
   - The rule chip's X button and its 10-second Undo toast at the top (`UNDO_TOAST_MS = 10_000`, `Toaster position="top-center"`).
   - The digest-time pills with their X and the round plus button, with a maximum of 6.
   - On a phone, 5 tabs (`PHONE_TAB_LIMIT = 5`) and a menu sheet with the help link and log out.
   - Four Settings groups, and the Account card that holds Language (`faq.mdx:73` is true).
   - The server badges in the assist dialog (`AssistDialog` uses `ScopeBadges`).
   - The Delegations columns, "Show more" and the closed list.
   - The category row layout.
   - The paused banner key.
5. **Checked: the docs text check cannot pass when the scan is empty, and it covers every tag.**
   - The real-tree test requires more than 30 docs files, more than 500 panel files and more than 50 keys.
   - `apps/web/src/i18n/` and `*.test.*` are left out of the panel files, so keys defined in `en.ts` do not count as panel use.
   - All 320 `<UiText` tags in `apps/docs/src/content` and `components` match the `UI_TEXT_KEY` regex.
   - `uiText` throws `ui_text_unknown` and `ui_text_has_vars`, and an empty `pl` text fails `not.toBe("")`.
   - A probe over the real tree found 7 of 112 docs keys that pass only through a prefix: `switch_*` ×5, `undo_started`, `undo_held`. This matches the 7 that plan.md accepts.
   - Static keys under a broad prefix, such as `cat_title`, are matched as real words, not through the prefix.
6. **Proven (`/tmp/f171-03/break.log`, lines copied to `/tmp/f171-review-1/break-lines.txt`): both break checks failed as they should.**
   - Test 6 failed with `docs_key_not_in_panel zz_probe apps/docs/src/content/docs/start/index.mdx`.
   - Test 9 failed with `ui_text_has_vars zz_probe`. The worker reused the probe key instead of one real docs key, so test 1 also failed in that run. It still proves the check; it is not isolated.
   - `stale.log` shows `stale: 0`, and `check.log` line 166 holds `check:job: panel changed: panel-keys.test.ts` (test 10).
7. **Plausible minor issues:**
   - `flagged-text.ts:139` keeps its own copy of the `UiText` regex. It could reuse `docsKeys`, so that the two cannot drift.
   - The worker's final message says "No page needed an edit" but does not list the pages it read. The stage's Done-when asks for that list.
   - Decisions for the owner: none from this review.

## Checks I ran
- `git rev-parse HEAD` and `git status`: the HEAD matches and the tree is clean.
- I read the diff of `b3524849c`, `scripts/check-job.sh`, `apps/docs/src/ui-text.ts`, the stage file, `plan.md` and `ticket.md`.
- I read the five logs in `/tmp/f171-03/`, and the worker's `result` and `note.md`.
- Grep of the Polish docs pages for reader-gender forms: one hit (note 2).
- A throwaway Bun probe script that only reads files: 112 docs keys, 7 only through a prefix.
- Bash one-liners that copy the `check:job` grep pattern: the SIGPIPE skip (note 1).
- One evidence call that saved its output in `/tmp/f171-review-1/` and exited 0.
- I ran no test suite, lint or typecheck.

## Note check
- **HEAD is the candidate:** proven. Seen in `/tmp/f171-review-1/head.txt`.
- **Docs pages match the Pebble panel texts:** proven for the stage's tests and Done-when items that have evidence. Each item:
  - Step 4 sweep, sampled pages against the panel code: proven in my sample. Seen in `/tmp/f171-review-1/panel-samples.txt` and note 4. The worker's own full sweep has no log.
  - Test 1, the real tree gives `[]`: proven. Seen in `/tmp/f171-03/check.log` line 171.
  - Tests 2–5, the unit cases: proven. Seen in `/tmp/f171-03/check.log` lines 173–176.
  - Test 6, break check: proven. Seen in `/tmp/f171-review-1/break-lines.txt`.
  - Test 7, the F166 unused-key test with the moved list: proven. Seen in `/tmp/f171-03/check.log` (`unused-keys.test.ts`, 0 fail).
  - Test 8, `stale: 0`: proven. Seen in `/tmp/f171-03/stale.log`.
  - Test 9, `uiText` in both languages and its break check: proven. Seen in `/tmp/f171-03/check.log` line 172 and `/tmp/f171-review-1/break-lines.txt`.
  - Test 10, the `check:job` log line: proven. Seen in `/tmp/f171-review-1/step-line.txt`.
  - Done-when, the final message lists the pages: not proven. The worker message lists no pages it read (note 7).
  - Done-when, `PROOF_OK`: not proven. No log holds `PROOF_OK`; each step's log ends in success.
- **The new check:job step cannot pass when it should fail:** not proven. Evidence: `/tmp/f171-review-1/sigpipe.txt` shows it can skip without a message on a branch with about 350 or more changed files (note 1, not blocking). For small change lists it runs, as `/tmp/f171-review-1/step-line.txt` shows.
- **Polish docs have no reader gender:** not proven. `/tmp/f171-review-1/polish-gender.txt` shows one older hit in `pl/faq.mdx:54` (note 2).
- **Easy-to-miss rule, "Run no test suite":** followed. I ran only git, grep, sed, one read-only Bun probe and bash one-liners. No suite, lint or typecheck ran.
- **Reminder, tests run once per job and no forbidden suites:** followed. No `test:unit`, `test:int` or `test:e2e` ran.
- **Reminder, `check:job` last:** does not apply. This review commits no product code.
- **Reminder, a review runs no suite, lint or typecheck:** followed.
- **Reminder, never delete `node_modules/.cache/`:** followed. I did not touch it.
