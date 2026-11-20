# F150 scout packets

Three scouts, started 2026-11-20 at plan base `e8f6f2b1`. Each packet is copied whole from the job log (the text the scout wrote before its note check). A packet is a lead, not a fact: plan.md § Facts checked names what the planner read or ran itself.

## Scout 1

Job: `2026-11-20-f150-scout-1-4d362df3`

Question:

> How does the lint rule that bans bare ticket codes in comments (added by F132) work: rule name, file, the regex, which files and node kinds it scans, its allow-list, how ESLint config applies it (which globs, does it cover apps/docs, JSON files, Markdown), and what it would take to extend it to string literals in apps/docs/src/*.ts and to apps/server/src/modules/layers.json and docs/*.md? Also: is there any other existing check (scan test, script) that scans Markdown docs for bare codes? Context: spec/features/planned/F150-stale-state-statements-and-bare-codes-outside-comments-are-cleaned-and-the-lint-rule-covers-them/ticket.md and spec/quality/2026-11-20-pass-2.md finding 14. Answer for the code at HEAD.

Packet:

**Correction to the premise:** the rule is not an ESLint rule. It is a Bun test, `apps/server/src/comment-codes.test.ts`, and ESLint does not apply it. F132's ticket folder is `spec/features/done/2026-11/F132-comments-carry-no-bare-ticket-or-decision-codes-quality-pass-1-finding-8/`.

Packet: How does the F132 bare-code check work, and what does it take to extend it to string literals in `apps/docs/src/*.ts`, `layers.json` and `docs/*.md`?
Base: e8f6f2b1
Verified: `grep -n "comment" eslint.config.js` -> only line 223, `skipComments: false` for a size option (no code-scanning rule). `tools/eslint-rules/index.js` exports only `no-time-literals`. I did not run the test.
Unknowns:
- Whether any other test scans Markdown for bare codes: I found none. My grep for `F\d{3}` and `PD-\d` patterns in `*.ts`, `*.sh` and `*.js` files matched only `comment-codes.test.ts`, but a differently written pattern could be missed.
- Current hit counts. I read `docs/modules.md` at 70 lines with an `F###` code (`grep -c`, a line count; the pass-2 report says 74 codes). I did not run the scan over strings, JSON or the other 10 `docs/*.md` files.
- `note.md` at the path in the task did not exist. I did not write it, because the packet is read-only.
1. `apps/server/src/comment-codes.test.ts` (`CODE` regex, lines 15-16) — the regex is `\bF\d{3}\b(?!-[a-z0-9])|\bPD-\d+\b|\b[Ss]tages? \d+[a-z]?\b|\b[Rr]eview (?:round )?\d+\b|\b[SDPNAQTU]\d{1,2}[a-z]?\b(?! \d{4}\b)`. A folder path such as `F115-slug` passes, and so does a quarter with a year such as `Q3 2025`. — observed
2. Same file, scope — it scans `apps`, `packages`, `scripts` and `tools` for `*.{ts,tsx,mjs,js,astro,css,sh}`. `skipped` excludes `node_modules`, `dist`, `.astro`, `test-results` and a few other output folders. Only comment text is read. TS, TSX, MJS and JS use the TypeScript compiler's leading and trailing comment ranges per node. Shell, CSS and Astro use line regexes. The allow-list is `FIXTURE_LABELS`, which strips `[UC]\d`, `U\d` and `[DU]\d` in 3 named test files. The inline test asserts that `const x = "F115 D12 stage 09";` yields no hit. It runs in `bun run test:unit`, which includes `apps/server/src`. It is not in `lint`. — observed
3. Extending to string literals in `apps/docs/src/*.ts` — `apps/docs/src` is already under `apps`, so its `.ts` files are scanned, but only comments are. To scan strings, add a function that walks `ts.StringLiteral`, `NoSubstitutionTemplateLiteral` and `TemplateExpression` parts with the TypeScript compiler and applies `CODE`. It needs a file filter, because many `.ts` files elsewhere hold legitimate code-like strings. The direct targets are `flagged-text.ts:103-110` (`NO_VISIBLE_TEXT`, with `F115 stage 03b`, `F118 stage 02`, `F115 stage 08` and "the stages 12 to 15"); `no-time-literals.js` is the only existing rule that visits literal nodes. — guessed
4. Extending to `layers.json` and `docs/*.md` — `layers.json` line 49 holds a code ("F115 stages 05 to 09", from the pass-2 report; I saw the neighboring `why` strings at lines 47-50 but not that exact line). Scan its `why` values by `JSON.parse`, or by regex over the text. `docs/*.md` has 11 files. `docs/modules.md` is the main hit and holds a 3,000-character paragraph at line 416 (per the pass-2 report). Markdown needs fenced-code skipping and a decision on `docs/owner-decisions.md` and ADRs, which may cite codes on purpose. `CODE` would also match `D12`-style names in prose, so a Markdown run probably needs a wider allow-list. — guessed
5. No other scanner found — `apps/docs/src/markdown-code.test.ts` exists, and I did not read it. Its name suggests code blocks, not ticket codes. `apps/docs/src/cold-read.test.ts` reads `apps/docs/cold-read.md` for other checks. — guessed
Checks: `comment-codes.test.ts` covers comments in the 4 source roots, in 7 file types; it misses string literals, JSON, Markdown, `docs/`, `CLAUDE.md`, `spec/` and `db/`. `bun run lint` covers no bare-code rule.
Packet: F132 bare-code check and the extension to strings, `layers.json` and `docs/*.md`; note reconstructed from `task.md`.
Base: e8f6f2b1
Verified: none in this turn. I ran no new command.
Unknowns: I did not write `note.md`. The scout rules say to create no files. No bash call from this session passed the proof test (exit 0, joined only with `&&`, no pipe before it). The earlier calls used `;` or `|`.

**Note check**
- Rule name, file, regex, scanned files and node kinds, allow-list: proven. `apps/server/src/comment-codes.test.ts` holds all of them (the `CODE` regex, 4 roots, 7 file types, `FIXTURE_LABELS`, TypeScript comment ranges). I read the whole file with `cat`.
- ESLint application (globs, `apps/docs`, JSON, Markdown): proven. No ESLint rule exists. `tools/eslint-rules/index.js` exports only `no-time-literals`, and `eslint.config.js` has no bare-code rule. The test covers `apps/docs/src` comments only, and no JSON or Markdown. Both files read.
- Extension to strings in `apps/docs/src/*.ts`, to `layers.json` and to `docs/*.md`: not proven. The design comes from reading, not from a run. I wrote no prototype and ran no scan of strings, JSON or Markdown. I did not check the `layers.json` line 49 text itself.
- Other Markdown scanner for bare codes: not proven. My grep found none, but I did not read `apps/docs/src/markdown-code.test.ts` and did not search the scripts for other patterns.

**Easy-to-miss rule**
- "Read, search, and run existing checks. Do not edit, create, or delete files." Followed. I made no file change; I did not run `git status` to confirm that.

**Project reminders**
- Run tests once and never `--no-verify`: followed. I ran no test and made no commit.
- `check:job` for jobs that commit product code: followed, not applicable. This is a scout job and it commits nothing.
- Review job runs no suite: followed, not applicable.
- Never delete `node_modules/.cache/`: followed. I did not touch it.

Not proven yet: string-literal extension design, `layers.json` and `docs/*.md` scan scope, absence of other Markdown scanners.
[limen 2026-11-20T11:35:48.216Z] done: pi exited 0

## Scout 2

Job: `2026-11-20-f150-scout-2-24df0d71`

Question:

> Inventory of the stale state statements and bare codes of quality pass 2 finding 14 at HEAD: CLAUDE.md line 4, tasks/planned/s6c-account-data.md and s6e-papers-cost.md (and what else is in tasks/), scripts/one-off/migrate-tasks.ts, apps/docs/src/flagged-text.ts NO_VISIBLE_TEXT (each entry, whether its claim is still true: does web_push have routes/sender/text now, do reply_drafts texts exist), apps/server/src/modules/layers.json codes, and bare F-codes in docs/modules.md (count, and in which sections). For each: who reads or references the file (CLAUDE.md, AGENTS, scripts, package.json, tests, docs), so a delete breaks nothing. Context: spec/features/planned/F150-stale-state-statements-and-bare-codes-outside-comments-are-cleaned-and-the-lint-rule-covers-them/ticket.md and spec/quality/2026-11-20-pass-2.md finding 14. Answer for the code at HEAD.

Packet:

Packet: stale state statements and bare codes of quality pass 2 finding 14 at HEAD, with each file's readers.
Base: e8f6f2b1
Verified: `rg -o -n "\bF[0-9]{3}\b" docs/modules.md | wc -l` -> `74`
Unknowns: whether the `ea` lint plugin should carry a bare-code rule. `tools/eslint-rules/` holds only `no-time-literals.js` and `index.js`, so no code-lint rule exists today (observed). I did not check the "reply_drafts texts exist" claim beyond the evidence in item 3.

1. **`CLAUDE.md:4`** — observed stale. It says "Now: Astro starter in `src/`, old Bun backend in `backend/`". The body of `CLAUDE.md` already describes `apps/server`, `apps/web` and `packages/core`. Readers of `CLAUDE.md` are the agents, plus finding 14's own text. The line has no code or test reader.

2. **`tasks/` and `scripts/one-off/migrate-tasks.ts`** — observed. `tasks/` holds `README.md`, `active/s6-pre-sale.md`, `done/s6b-public-login.md`, and `planned/s6c-account-data.md`, `s6e-papers-cost.md`, `s6f-hosted-production.md`.
   - `s6c` and `s6e` both start "Moved 2026-11-14: … now F106 / F107. This file is history". Their status line still says "planned".
   - Readers of `s6c` and `s6e`:
     - `tasks/active/s6-pre-sale.md` lines 37, 263, 265: links in the master plan, which is itself history.
     - `docs/product/stage-2/epics/E10-discovery-notes.md:9`: a path to `s6e-papers-cost.md`.
     - `spec/quality/2026-11-20-pass-2.md`: finding 14 only.
   - No code, test, script, `package.json` or CI file references either file (the `rg` over `*.ts`, `*.json`, `*.sh`, `*.yml`, `*.mjs` found only `migrate-tasks.ts` itself). `tasks/README.md` names `s6b`–`s6f` generically ("The S6 files left here") and not by path. `CLAUDE.md` says "The old S6 files in `tasks/` are history: S6a = F077 (done), S6b = F082, S6c = F106, S6e = F107, S6f = F108".
   - The `docs/product/stage-2/epics/E10-discovery-notes.md:9` link breaks on a delete.
   - `scripts/one-off/migrate-tasks.ts`: line 3 says "Delete this file when the Limen transition is complete", and the transition landed. The only file that names it is `spec/features/done/2026-11/F071-limen-transition/stages/stage-1-out-of-box.md`, plus pass 2. Nothing in `package.json` or any script runs it. It is the only file in `scripts/one-off/`.

3. **`apps/docs/src/flagged-text.ts:99-110` `NO_VISIBLE_TEXT`** — observed. The entries are `delegate_button`, `trust_ladder`, `reply_drafts`, `draft_copy_check` and `web_push`. Each is a default-off flag, and `flagged-text.test.ts` T2 (line 38) requires "text or reason, never both".
   - `web_push` is stale. The claim is "no route, sender or text exists yet". `channels/push/` now has `routes.ts`, `send.ts`, `vapid.ts` and `encrypt.ts`. `packages/core/src/texts/push.ts` exists, and so does `apps/web/src/lib/use-rebind-push.ts`. It also names "F118 stage 02, 03, 08". If the claim is dropped, the flag needs strings in `FLAGGED_BOT_TEXT` or `FLAGGED_PANEL_KEYS`, because T2 fails with neither. `packages/core/src/texts/push.ts` is the likely source.
   - `reply_drafts` is stale. The claim is that the text "comes in the stages 12 to 15". Panel texts exist: `apps/web/src/i18n/texts/pl-reply.ts` has `switch_reply_drafts`, and `ReplyStyleCard.tsx`, `ReplySamples.tsx` and `ModeCard.tsx` read the flag. `notices-en.ts:80` has the "reply draft is ready" notice. It also names "F115 stage 03b".
   - `draft_copy_check` names "F115 stage 08". The claim that only the committer reads it (`actions/send.ts`) is plausible. `draft_changed` appears in `actions/send.ts`. I did not check that no other reader exists.
   - `delegate_button`: `delegateMail` is named as the only reader, but `apps/web/src/lib/delegate-action.ts`, `DelegateHintProvider.tsx` and `packages/core/src/web/loops.ts` also reference `delegate_button`. The claim "no button text exists yet" is unverified. It carries a path (`modules/loops/delegate.ts`) and no F-code.
   - `trust_ladder` says "no text", but `packages/core/src/texts/notices.ts` holds `trustReady` and `autonomyPaused` (`notes/2026-11-15-f112-s09-reference-explanation.md:27` flags the same gap).
   - The only readers of `NO_VISIBLE_TEXT` are `flagged-text.test.ts` and the docs scan. The notes name the file, but no code reads it by key.

4. **`apps/server/src/modules/layers.json:54`** — observed. This is the only bare code in the file: "(F115 stages 05 to 09)", in the `replies → actions` pair `why`. The pair itself is live. `bun run lint` reads this file and `bun run graph:modules` reads the pairs. A text edit to the `why` changes no behavior.

5. **`docs/modules.md`** — observed, 74 bare `F###` codes in 493 lines. Counts by section:

| Section | Count |
|---|---|
| Title (line 3) | 1 |
| §2 How the modules talk | 2 |
| §3.1 tenancy | 2 |
| §3.2 mail | 7 |
| §3.5 actions | 5 |
| §3.6 audit | 4 |
| §3.7 reports | 2 |
| §3.8 channels | 9 |
| §3.9 delegation | 1 |
| §3.10 HTTP API | 21 |
| §3.12 operator | 2 |
| §3.13 privacy | 1 |
| §3.14 loops | 5 |
| §3.15 trust | 2 |
| §3.16 contacts | 1 |
| §3.17 replies | 1 |
| §4 `apps/web` | 6 |
| §5 `packages/core` | 2 |

§1, §3.0, §3.3, §3.4, §3.11 and §6 have none. Line 416 (§3.14) alone has 4 codes. The section headings in §3.12–§3.17 also carry a code in parentheses (for example "(F099, layer 5)").

Checks: `flagged-text.test.ts` covers "each default-off flag has text or a reason, never both" and "each literal still stands in `packages/core/src/texts`"; it misses whether a reason is true and whether it holds an F-code. No lint rule or test covers bare codes in `layers.json`, `docs/modules.md`, `CLAUDE.md` or `tasks/`. The Styleguide "Avoid" line names bare codes in comments only.

## Scout 3

Job: `2026-11-20-f150-scout-3-a58272f0`

Question:

> What does apps/docs/src/flagged-text.ts and its test check (the docs guard it feeds): how NO_VISIBLE_TEXT is used, what happens to the guard and the docs build when an entry is removed or changed (e.g. web_push, reply_drafts), which flags in packages/core/src/features.ts have visible text now, and which tests or docs build would fail? Also: are there bare ticket codes (F1xx, S6x, E5b style) in other non-comment places a lint could reach: string literals in apps/*/src and packages/core/src (non-test), JSON configs, and docs/capabilities/*.md? Give counts per area. Context: spec/features/planned/F150-stale-state-statements-and-bare-codes-outside-comments-are-cleaned-and-the-lint-rule-covers-them/ticket.md and spec/quality/2026-11-20-pass-2.md finding 14. Answer for the code at HEAD.

Packet:

Packet: What `flagged-text.ts` and its test guard, how `NO_VISIBLE_TEXT` behaves, and where bare ticket codes sit outside comments.
Base: e8f6f2b1
Verified: `cd apps/docs && bun -e '…featureKeys/FLAGGED_TEXT/NO_VISIBLE_TEXT…'` -> `total 36 off 36 withText 31` and `noText delegate_button,trust_ladder,reply_drafts,draft_copy_check,web_push`. The count commands for bare codes (a TypeScript-scanner run over non-test `.ts`/`.tsx`, plus `rg`) also ran. I did not run `bun test` on the flagged-text test.
Unknowns:
- Docs build. I did not run it or the test, so "would fail" below is read from code, not observed. The only build-time check is the `dist/changelog/index.html` test, and it skips when `dist` is missing.
- Other non-test file types (`.astro`, `.mdx`, `.js`, `.sh`). I scanned `.ts`/`.tsx` only. The JSON scan is a plain regex over tracked `*.json` that excludes locks and `evals/results|sim`.
- `/tmp` is at its quota, so scratch scripts were not written. Everything ran inline.

1. `apps/docs/src/flagged-text.ts:96` (`NO_VISIBLE_TEXT`) and `flagged-text.test.ts` test "each default-off flag has flagged text, or a reason; never both". All 36 flags in `features.ts` default off. 31 have entries in `FLAGGED_PANEL_KEYS` or `FLAGGED_BOT_TEXT`. 5 have only a reason: `delegate_button`, `trust_ladder`, `reply_drafts`, `draft_copy_check`, `web_push`. A page scan (`flaggedTextProblems`) also fails any `content/docs` page, public claim or changelog page that holds a flagged string. — observed
2. Effect of editing `NO_VISIBLE_TEXT`:
   - Removing an entry with no replacement fails the "never both / not neither" test, which is the only check on `NO_VISIBLE_TEXT`. `NO_VISIBLE_TEXT` has no other reader: a grep outside the file and its test found only docs and notes.
   - Changing only the reason text breaks nothing, because no test reads the text.
   - Moving a flag into the panel-key or bot-text lists is the intended change. It then tightens the page scan, and each new string must stand in `packages/core/src/texts` or `digest`.
   - The docs build itself does not import this file. Only `bun test` and the changelog `dist` test use it. — observed
3. Stale reasons:
   - `web_push` says "no route, sender or text exists yet". Text exists: `apps/web/src/i18n/texts/en-phone.ts` has `push_title`, `push_help` and more. Routes exist too: `modules/channels/push/routes.ts` and `send.test.ts`.
   - `reply_drafts` says the text "comes in the stages 12 to 15". Text exists: `en-reply.ts` has `switch_reply_drafts`, `rs_switch_help` and more, and `en-reply-panel.ts` has more.
   - If F150 moves these two to `FLAGGED_PANEL_KEYS`, the real strings are then scanned against all pages, claims and the changelog. That could surface new hits. The page scan is untested for those strings. — observed for the missing text/routes; guessed for what the scan would then find
4. Bare codes in string literals (non-test `.ts`/`.tsx`; the scan covers TypeScript only). `apps/web/src`: 0. `apps/docs/src`: 3, the `NO_VISIBLE_TEXT` reasons, at lines 104, 106 and 108 (`F115 stage 03b`, `F115 stage 08`, `F118 stage 02`). `apps/server/src`: 31. Of those, 28 are `E1`–`E22` transition ids in `actions/transitions.ts` and `lab/score/delegates.ts:231` (`E5b`). Those are data ids, probably not stale. 2 are `F141` in `platform/config-llm.ts:122` and a `deepseek` string in `platform/outside-services.ts:14`. `packages/core/src`: 38, of which 36 are `epic: "E…"` in `features.ts` (a typed field, not stale text), 1 is `"E11 discovery notes §6"` in `llm-providers.ts:43` and 1 is `E03-discovery-notes.md` in `metrics/cost-model.ts:7`. Real stale F-codes in strings: 4 (3 docs, 1 server `F141`). — observed
5. Other areas:
   - JSON: 1 file, `apps/server/src/modules/layers.json:54` (`F115 stages 05 to 09`). The quality pass cited line 49, so the line moved.
   - `docs/capabilities/*.md`: 21 files, 277 lines and 407 code hits for F/S/E codes. F-only: 239 lines. The most are in `digest-and-notices.md` (39 lines), `drafts-and-send.md` (38), `web-panel.md` (35) and `triage.md` (35). A lint that reaches `docs/capabilities` hits all of these. — observed

Checks: `flagged-text.test.ts` covers the 36-flag coverage rule, panel-key and Telegram-literal presence, and the page, claim and changelog scans. It misses the truth of any reason text, since nothing checks that a flag with a reason really has no text, so `web_push` and `reply_drafts` pass today while stale. The existing `ea` lint rule scans comments only, so it misses all of items 4 and 5.
