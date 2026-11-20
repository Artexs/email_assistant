# F150 plan — stale state statements and bare codes outside comments

> **Status 2026-11-20 — planned.** Plan base: e8f6f2b1, fixed after cold review 1. Five stages; 01, 02 and 03 run next to each other, then 04, then 05.

Source: `spec/quality/2026-11-20-pass-2.md` finding 14.

### Product and scope

- **P1 Scan scope** (default, owner to confirm; `questions.md` Q1). The scan reads: comments (as today); string literals and JSX text of non-test TS/TSX/MJS/JS files under `apps`, `packages`, `scripts`, `tools`; every string of every tracked JSON file under those roots; the docs site pages (`apps/docs/src/content/**/*.{md,mdx}`); `docs/modules.md`. Rejected: `docs/capabilities/` and other `docs/*.md` (637 hits in capabilities alone; a follow-up ticket).
- **P2 No behaviour change.** A string that a user or operator sees changes only its words; a flag default never changes.
- **P3 In-place docs pages stay out** (default, owner to confirm; `questions.md` Q4; review finding 4). The docs site also publishes `deploy/README.md` (47 code lines) and `docs/release-checklist.md` (1) through `apps/docs/src/in-place.ts`. They are operator runbooks: many codes are release markers or drill step ids, and deploy tickets edit them each week. They join the capabilities follow-up. `CHANGELOG.md` needs nothing: its page shows only the "For users" items, which hold no code. Rejected: clean them now (a large runbook rewrite that conflicts with every deploy ticket).

### Design

- **D1 One scan, still a Bun test.** Rename `apps/server/src/comment-codes.test.ts` to `apps/server/src/bare-codes.test.ts` and extend it. Rejected: an ESLint rule (it reads neither Markdown nor JSON); the old name (it would lie).
- **D2 Two patterns.** `CODE` (the existing regex) for comments and Markdown. A new `STRING_CODE` for strings and JSON: an F-number not followed by a slug, a PD-number, "stage(s) N", "review (round) N". Single-letter codes are not checked in strings: they are data ids (`S1`–`S11` audit flags, `P1`–`P7` transitions, `T00:00:00Z`). Rejected: `CODE` with an allow-list (about 50 entries that rot).
- **D3 Test files are out of the string and JSON scan:** `*.test.ts(x)`, `*.test-helper.ts`, files under a `test/` or `e2e/` folder. Their comments stay scanned. Reason: the test audit ticket (F125) owns test files.
- **D4 How a code is replaced.** A code that only says which ticket added something is dropped. A code that names a rule becomes the rule in words, or an ADR or capability page link. A ticket folder path (number plus slug) only where developer text needs a pointer. A test that asserts a changed string changes with it. Committed reports under `evals/results/` stay.
- **D5 Flag guard truth.** Each of the five `NO_VISIBLE_TEXT` flags (`delegate_button`, `trust_ladder`, `reply_drafts`, `draft_copy_check`, `web_push`) is checked against the code. Text shown only while the flag is on → the flag moves to `FLAGGED_PANEL_KEYS` or `FLAGGED_BOT_TEXT` with one to three entries, and loses its reason. No such text → the reason stays, in words, with the reader's file path.
- **D6 A docs page that a moved text now fails** is a real docs finding: rewrite the sentence without the flagged string, in the page's language. Never change a flag default, drop an entry or narrow the scan. If a page needs the string, stop and ask.
- **D7 Task files.** Delete `tasks/planned/s6c-account-data.md` and `s6e-papers-cost.md` (their tickets are done). Keep `s6f`, `s6-pre-sale.md` and `done/s6b`. Links in history records stay. `tasks/README.md` and the S6 line of `CLAUDE.md` name only the files that remain.
- **D8 `CLAUDE.md` layout line** says what `docs/architecture.md` says now, with no LLM provider list (the active provider ticket F141 changes it).
- **D9** Delete `scripts/one-off/` (one finished migration script).
- **D10 `docs/modules.md`:** remove every `CODE` hit by D4; "(F116, layer 3)" becomes "(layer 3)". No other rewrite.
- **D11 Rule text.** `docs/code-patterns.md` § Comments and the styleguide "Avoid" line name the new reach, the scan file and the `check:job` step (`questions.md` Q2).
- **D12 Where the scan runs** (review finding 1). It imports no product file, so the import-based test choice never picks it. Stage 05 adds one fixed step to `scripts/check-job.sh`: `bun test apps/server/src/bare-codes.test.ts` on every job (about 3 s), on the tree merged with master. A code that another ticket writes then fails that ticket's own `check:job`; its worker fixes the text by D4 before the land, and master CI stays green. Rejected: the pre-commit hook when a scanned file type is staged (a scan of the whole repo on every commit breaks the owner's fast-hook rule, and the hook exits early on `.md`- or `.json`-only commits today). Rejected: GitHub CI only (master goes red after a land).
- **D13 Template literals:** each literal part is scanned alone; a code split by `${…}` is not found (accepted). A tagged template such as `sql` is a string: an SQL comment in it is checked with `STRING_CODE` and fixed by D4 (review finding 5).
- **D14 JSON is read with `ts.parseJsonText`**, not `JSON.parse` (review finding 7). It accepts comments and trailing commas like `tsc` and gives line numbers. Every string node, keys and values, is checked with `STRING_CODE`. A file that `ts.parseConfigFileTextToJson` reports as broken is one hit (`path: cannot parse`). Rejected: skip the file (hides codes); `JSON.parse` (a commented `tsconfig` crashes the scan).
- **D15 Flag texts in the docs guard** (review findings 2, 3). An entry is a phrase that a page holds only when it quotes the UI: two or more words, a title or a switch label, never one common word (`dla_button` "Delegate" fails 11 pages; `dla_title` "Delegate this mail" fails 0). The worker runs the page scan with each entry alone before keeping it. A text that shows when either of two flags is on is listed under each flag (`sendLineEditable` in `digest/approvals.ts`: `reply_drafts` and `draft_copy_check`).

## Facts checked

- `STRING_CODE` string hits at the base: 3 in `apps/docs/src/flagged-text.ts`, 1 `platform/config-llm.ts`, 2 `platform/outside-services.ts`, 2 `replies/drafter-eval-report.ts`, 3 `tools/mail-oauth-spike/rows-*.ts`, 1 SQL comment in a `sql` template of `actions/repo/notify.ts` (found by the cold review).
- JSON: 1 hit (`layers.json`, the `replies → actions` reason). Docs site pages: 0 hits. `docs/modules.md`: 195 lines.
- All five `NO_VISIBLE_TEXT` reasons are doubtful: the web or the approval view reads each flag.

Not verified: which docs pages fail after D5, and the exact entries per flag (stage 02).

## Rules for every stage

- A gap or a deviation from a decision is a question in the final message, not a choice.
- No mass edit outside the stage's places. Do not edit `spec/`, `docs/owner-decisions.md`, `docs/product/stage-2/*` or another ticket.
- Run a changed test file with `bun test <file>`; never the full suites.

## Proof

`bun run check:job` last in each stage; copy its last line. Stages 02 and 04 also name their `bun test` runs. Ticket done: the 5 acceptance bullets hold.

## Owner checkpoints and steps

None. No migration, no `bun.lock` change, no VPS.

## Review

- Stage 02 before the land (docs guard and page text): `claude-sonnet-5-5`; `claude-opus-5-5` when it changes a Polish page.
- Stages 04 and 05 before the land (a new guard; the job check of every ticket): `claude-sonnet-5-5`.
- Stages 01, 03: the worker's proof.

## Stages

- [ ] [stage 01 — stale statements and string codes](stages/stage-01-stale-statements-and-string-codes.md)
- [ ] [stage 02 — the docs flag guard lists the real texts](stages/stage-02-flag-guard-truth.md)
- [ ] [stage 03 — the module map holds no bare codes](stages/stage-03-module-map-codes.md)
- [ ] [stage 04 — the bare-code scan reads strings, JSON and docs](stages/stage-04-scan-extension.md)
- [ ] [stage 05 — every job runs the scan, and the rule text says so](stages/stage-05-scan-in-check-job.md)

## How to run (coordinator)

01, 02, 03 start together. 04 after all three; 05 after 04. Overlaps (merge master, re-prove):
- F141 (active) edits `config-llm.ts` and `outside-services.ts`; F143 (active) may edit `docs/modules.md`.
- The one-locale ticket F147 (active) edits the locale type in `flagged-text.ts`.
- The reply drafts docs stage (F115 stage 17) names `NO_VISIBLE_TEXT.draft_copy_check`. If stage 02 moves that flag, tell F115 to name the flagged list.
- After stage 05 lands, a ticket in flight that writes a code in a scanned place fails its `check:job` (D12). Tell the active workers once.
- After stage 04 lands, tell F125 that its audit data names the old scan file (review finding 10).

## Planning progress

- Scouts: 3 (`scouts.md`). Written: all files.
- `wc -w` after the review fix: plan 1498, stages 554, 695, 307, 572, 462.

## Cold review

Model `claude-opus-5-5` (stage 04 adds a guard that every later ticket meets). `plan-review-1.md`: 10 findings, none blocking. One round.

- 1 → D12, stage 05. 2, 3 → D15, stage 02. 4 → P3, Q4, ticket Out of scope. 5 → D13, stage 01 (full re-scan), stage 04 row. 6 → § How to run. 7 → D14. 8 → stage 04 rows and break check.
- **9 accepted (note).** `.astro` text and `.sh` strings are not scanned; their comments are, as today. The review found 0 `.astro` hits. A known gap like D13; the follow-up may add them.
- **10 accepted (note).** The rename of D1 leaves the old name in F125's audit data. F150 workers do not edit another ticket; the coordinator tells F125.
