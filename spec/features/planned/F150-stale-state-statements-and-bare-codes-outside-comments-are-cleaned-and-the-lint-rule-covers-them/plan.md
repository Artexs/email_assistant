# F150 plan — stale state statements and bare codes outside comments

> **Status 2026-11-20 — planned.** Plan base: e8f6f2b1. Four stages; 01, 02 and 03 run next to each other, 04 closes.

## Input

Source: `spec/quality/2026-11-20-pass-2.md` finding 14, word for word:

> "Fix: One small slice: rewrite `CLAUDE.md:4`; delete `tasks/planned/s6c*` and `s6e*` and the one-off script; correct the two `flagged-text.ts` entries (the test there then checks the real flags); replace the codes in `layers.json` and `docs/modules.md` with names; extend the lint rule to `apps/docs/src/*.ts` and `layers.json`."

Ticket line of the pass: "Stale state statements and bare codes outside comments are cleaned; the lint rule covers them."

### Product and scope

- **P1 Scan scope** (default, owner to confirm; `questions.md` Q1). The scan reads: comments (as today); string literals and JSX text of every non-test TS/TSX/MJS/JS file under `apps`, `packages`, `scripts`, `tools`; every string value of every tracked JSON file under those roots; the docs site pages (`apps/docs/src/content/**/*.{md,mdx}`); `docs/modules.md`. Reason: the planner's probe at the base found 10 string hits outside `apps/docs` (an LLM config message, the outside-services list, the drafter eval report, the mail OAuth spike rows), so a guard on `apps/docs` only would leave them. Rejected: all of `docs/*.md` and `docs/capabilities/` (637 hits in capabilities alone; a follow-up ticket, see final message of this job).
- **P2 No behaviour change.** A string that a user or operator sees changes only its words; a flag default never changes.

### Design

- **D1 One scan, still a Bun test.** Rename `apps/server/src/comment-codes.test.ts` to `apps/server/src/bare-codes.test.ts` and extend it. Rejected: an ESLint rule (ESLint here reads neither Markdown nor JSON; two mechanisms for one rule). Rejected: keep the old name (it would lie).
- **D2 Two patterns.** `CODE` (the existing regex) for comments and Markdown. A new `STRING_CODE` for strings and JSON values: an F-number not followed by a slug, a PD-number, "stage(s) N", "review (round) N". Single-letter codes (`S1`, `P1`, `T2`, `Q1`) are not checked in strings. Reason: the probe found real data ids in strings: test-audit flags `S1`–`S11`, transition ids `P1`–`P7`, ISO time parts `T00:00:00Z`, `Q1` in sample mail, epic ids `E7-T2`. Rejected: `CODE` with an allow-list (about 50 entries that would rot).
- **D3 Test files are out of the string and JSON scan:** `*.test.ts(x)`, `*.test-helper.ts`, files under a `test/` or `e2e/` folder. Their comments stay scanned as today. Reason: test names and fixtures carry labels; the test audit ticket (F125) owns test files.
- **D4 How a code is replaced.** A code that only says which ticket added something is dropped. A code that names a rule becomes the rule in words, or an ADR or capability page link. A ticket folder path (number plus slug) only in developer text that needs a pointer. A changed string that a test asserts changes with its test. Generated reports already committed under `evals/results/` are history and stay.
- **D5 Flag guard truth.** Each of the five `NO_VISIBLE_TEXT` flags (`delegate_button`, `trust_ladder`, `reply_drafts`, `draft_copy_check`, `web_push`) is checked against the code. Text shown only while the flag is on → the flag moves to `FLAGGED_PANEL_KEYS` or `FLAGGED_BOT_TEXT` with one to three keys or literals that only that flag shows, and loses its reason. No such text → the reason stays, in words, with the reader's file path and no code.
- **D6 A docs page that the moved texts now fail** is a real docs finding: rewrite the sentence so it does not quote the flagged string, in the page's own language. Never change a flag default, drop a key or narrow the scan to pass. If a page cannot make its point without the string, stop and ask.
- **D7 Task files.** Delete `tasks/planned/s6c-account-data.md` and `s6e-papers-cost.md` (their own first line says "history"; their tickets are done). Keep `s6f` (its ticket F108 is active), `s6-pre-sale.md` and `done/s6b`. Links to the deleted files in history records (`tasks/active/s6-pre-sale.md`, `docs/product/stage-2/epics/E10-discovery-notes.md`) stay: they are records and already hold dead links. `tasks/README.md` and the S6 line of `CLAUDE.md` name only the files that remain.
- **D8 `CLAUDE.md` layout line** describes what `docs/architecture.md` says now (workspaces, Postgres, IMAP, Telegram, the LLM provider registry), with no provider list that the active LLM provider ticket (F141) changes.
- **D9** Delete `scripts/one-off/migrate-tasks.ts` and the empty folder; the history stage file of the Limen move (F071) stays.
- **D10 `docs/modules.md`:** remove every `CODE` hit by D4; provenance tags such as "(F116, layer 3)" become "(layer 3)". No other rewrite.
- **D11 Rule text.** `docs/code-patterns.md` § Comments and the styleguide "Avoid" line say that the ban covers strings, JSON, docs pages and `docs/modules.md`, and name the scan file (`questions.md` Q2).
- **D12 Where the scan runs.** It imports no product file, so the pre-commit hook and `check:job` of other tickets do not run it; GitHub CI on master does (as today for comments). Stage 04 runs it by hand. A code that another ticket lands after stage 04 turns master CI red; that ticket fixes its string.
- **D13 Template literals:** each literal part is scanned on its own; a code split by `${…}` is not found (accepted).

## Facts checked

- The bare-code check is a Bun test, `apps/server/src/comment-codes.test.ts`; `tools/eslint-rules/` holds only `no-time-literals` (planner read both, 2026-11-20).
- Planner probe at the base (a throw-away script, removed: the TypeScript compiler walks string, template and JSX text nodes of non-test sources): with `STRING_CODE` the string hits are 3 in `apps/docs/src/flagged-text.ts`, 1 in `platform/config-llm.ts`, 2 in `platform/outside-services.ts`, 2 in `replies/drafter-eval-report.ts`, 3 in `tools/mail-oauth-spike/rows-*.ts`; with `CODE` many more data ids (D2).
- JSON: 15 tracked files under the roots, 1 hit (`modules/layers.json`, the `replies → actions` reason). Docs site pages: 40 files, 0 hits.
- `docs/modules.md`: 195 lines with a `CODE` hit (old segment names `S0`–`S6f`, F-numbers, `A1`–`A3`, `PD-047`, "stage N").
- All five `NO_VISIBLE_TEXT` reasons are doubtful: the web reads `delegate_button`, `trust_ladder`, `reply_drafts`, `web_push` for visible parts; the approval view reads `draft_copy_check` (planner grep, 2026-11-20).

## Not verified

- Which docs pages fail after D5 (stage 02 runs `bun test apps/docs/src/flagged-text.test.ts`).
- Exact keys per flag (stage 02 reads the components).

## Done when

The ticket acceptance (5 bullets) holds; `bun test apps/server/src/bare-codes.test.ts` passes on the last stage.

## Rules for every stage

- A gap or a deviation from a decision is a question in the final message, not a choice.
- Format only the files of the stage. No mass edit outside the stage's places.
- Do not edit `spec/`, `docs/owner-decisions.md`, `docs/product/stage-2/*` or another ticket.
- Run a changed test file with `bun test <file>`; never the full suites.

## Proof

`bun run check:job` as the last step; the final message copies its last line (`check:job PASS master=… tip=…`). Stage 02 and 04 also name the `bun test` file runs that they list.

## Owner checkpoints and steps

None. No migration, no `bun.lock` change, no VPS.

## Review

- Stage 02: review before the land (it changes the docs guard and may change docs page text). `claude-sonnet-5-5`; `claude-opus-5-5` when it changes a Polish page.
- Stage 04: review before the land (a new guard), `claude-sonnet-5-5`.
- Stages 01 and 03 land on the worker's proof.

## Stages

- [ ] [stage 01 — stale statements and string codes](stages/stage-01-stale-statements-and-string-codes.md)
- [ ] [stage 02 — the docs flag guard lists the real texts](stages/stage-02-flag-guard-truth.md)
- [ ] [stage 03 — the module map holds no bare codes](stages/stage-03-module-map-codes.md)
- [ ] [stage 04 — the bare-code scan reads strings, JSON and docs](stages/stage-04-scan-extension.md)

## How to run (coordinator)

01, 02, 03 start together (no shared file). 04 starts when all three landed. Usual spawn with `--prepare 'bash scripts/limen-prepare.sh'`; drop the job DB after the land. Overlaps: F141 (active) edits `platform/config-llm.ts` and `outside-services.ts`; F143 (active) may edit `docs/modules.md`. A land conflict: merge master, re-prove.

## Planning progress

- Scouts: 3 (packets in `scouts.md`).
- [written] ticket.md, plan.md, stages 01–04, questions.md.
- Word counts (`wc -w`, before the review): plan.md 1314, stage 01 473, stage 02 630, stage 03 307, stage 04 580.

## Cold review

Not run yet.
