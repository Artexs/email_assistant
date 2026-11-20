PASS 82b2225233aed414d79d18ef2c7e234fdfe160bd

This is a cold review of the F150 plan: the ticket that removes stale state statements and bare ticket codes outside comments, and extends the bare-code scan to cover them. HEAD is `82b22252…`, the same as the candidate. The tree is clean. I found no blocking finding. The plan can meet the five acceptance bullets of `ticket.md:26-30`. My pre-mortem answer: stage 04 under D12 is the stage most likely to break master CI. Stage 02 is the step most likely to make a Sonnet worker guess. Fix findings 1–3 before stage 01 starts.

Unverified: none of the findings depends on a check I could not run. Per the reminders, I ran no test suite, lint or typecheck.

## Findings

1. **Master CI will go red after stage 04, and the plan records no rejected option for D12.** Label: plausible, with evidence.
   - Where: `plan.md:31` (D12) says "A code that another ticket lands after stage 04 turns master CI red; that ticket fixes its string." This conflicts with `CLAUDE.md` "CI on master must stay green". D12 also gives no rejected option, which `.agents/limen/planner.md:44` asks for.
   - Evidence that this will happen often: `git log --since=2026-11-15 -- docs/modules.md` shows 44 commits in 5 days. Those commits added 49 lines with an F-number or "stage N". This provenance style is the house style for the module map, for example `docs/modules.md:431` "(F115, layer 3)".
   - Active tickets still write it: F115 stage 18, F141, F143, F147 and F129. Nothing catches it before the land:
     - `scripts/test-unit-changed.sh:8-9` and `check-job.sh:49` select tests by import, and the scan reads files at run time.
     - `scripts/land-check.sh:10,78` runs typecheck only.
   - Missing decision: run `bun test apps/server/src/bare-codes.test.ts` every time. Two places can do it: at the end of `check:job`, or in the pre-commit hook when a scanned file type is staged. The F125 review says the scan takes about 3 s. The other option is to record why D12 rejects this.

2. **Stage 02 tells the worker to prefer a button label, and the delegate button label fails 11 docs pages.** Label: proven, by reproduction.
   - Where: `stages/stage-02-flag-guard-truth.md:16` says "Prefer a title, a switch label or a button". Line 18 points the worker at "the `dla_*` keys of the delegate dialog".
   - `dla_button` is "Delegate" (8 chars, so it passes `MIN_PART` = 7). I ran `flaggedTextProblems` over `apps/docs/src/content/docs`, with each key as the only entry:

     | Key | Text | Docs pages that fail |
     |---|---|---|
     | `dla_button` | "Delegate" | 11 |
     | `dla_title` | "Delegate this mail" | 0 |
     | `push_title` | "Phone notices" | 0 |
     | `switch_reply_drafts` | "Reply drafts" | 0 |

   - D6 (`plan.md:25`) and step 2 (`stage-02…:25`) forbid narrowing the scan. So the worker must either rewrite 11 delegation pages to avoid a common word, or stop.
   - Missing decision: choose a key whose text a page holds only when it quotes the UI, not a single common word. Before you keep a key, run the page scan with only that entry.

3. **One text in stage 02 shows when either of two flags is on, and the plan gives no rule for it.** Label: proven, by reading the code.
   - `packages/core/src/digest/approvals.ts:148` shows `sendLineEditable` when `view.kind === "reply" || view.copyCheck === true`. So the text shows when `reply_drafts` is on or when `draft_copy_check` is on.
   - The edge rule at `stage-02…:19` says "A key shared by two flags goes to the flag that gates it". That rule assumes one gating flag. It does not cover an OR of two flags.
   - Missing decision: list the text under each flag that can show it. A duplicate is harmless to T2 and to `flaggedTextProblems`. Without that rule, `draft_copy_check` can keep a reason that is false.

4. **The in-place docs pages are left out of the scan with no decision, so the outcome claim is wrong.** Label: proven, by reading the code.
   - `ticket.md:9` promises that codes no longer hide in "the public docs pages". The scan of P1/D1 (`plan.md:15`, `stage-04…:15`) reads only `apps/docs/src/content/**`.
   - `apps/docs/src/in-place.ts:24-25` publishes two more pages on the docs site: `deploy/README.md` (`operate/install-and-run`, 47 lines that match `CODE`) and `docs/release-checklist.md` (1 line).
   - Not a break of acceptance bullet 4, which reads "a docs site page". It is a missing scope decision. Either name these pages in Out of scope with a reason, or add them to the scan.
   - `CHANGELOG.md:76` "(F118)" is fine. I ran `changelogPage` on the real file, and the line does not reach the page.

5. **The plan's list of string hits at its base misses one.** Label: proven, by probe.
   - `plan.md:37` lists 11 string hits as the full set, and `stage-01…:23-28` copies that list. My TypeScript AST probe of non-test sources found a 12th: `apps/server/src/modules/actions/repo/notify.ts:283`.
   - The hit is the SQL comment `-- loop rows: open loops stage 10/11`, inside a `sql` tagged template that starts on line 274. It was already there at the plan base `e8f6f2b1`.
   - Stage 01's "Find more" (`stage-01…:29`) asks only for hits "that landed after the plan base". A worker who trusts the list misses this one. Stage 04's repo case catches it later, but that moves product-code work into the closing stage.
   - Also missing: a decision for SQL comments inside strings, and a stage 04 test row with a hit inside a tagged-template part.
   - The other 11 hits, the JSON hit (`layers.json $.sameLayerEdges.11.why`), the 0 docs-page hits and the 195 `docs/modules.md` lines all match the plan.

6. **The overlap list leaves out two active tickets that edit the same files.** Label: proven, by reading the other plans.
   - `plan.md:81` names only F141 and F143.
   - The reply drafts ticket (F115, active) refers to `NO_VISIBLE_TEXT.draft_copy_check` and to the draft-send pages in `spec/features/active/F115-e6a-reply-drafts/stages/stage-17-docs.md:27`. Stage 02 can move that flag.
   - The one-locale ticket (F147, active) edits the inline locale type in `flagged-text.ts` (`stages/stage-02-one-locale.md:12`).
   - "Merge master, re-prove" covers the conflict. But the stage 02 worker and reviewer should know that F115 expects a reason for `draft_copy_check` to exist.

7. **JSON that `JSON.parse` cannot read has no rule.** Label: plausible.
   - `stage-04…:13` parses every `**/*.json` under the four roots with `JSON.parse`. All tracked JSON parses today; I checked each file.
   - A `tsconfig*.json` with a comment is valid for `tsc`, but it would crash the whole scan with a parse error instead of a hit.
   - Missing decision: skip the file, report it as a hit, or strip comments first.

8. **Stage 04 has test gaps.** Label: test gap, by reading the stage.
   - The table at `stage-04…:16-26` has one row for the D3 skip (`a.test.ts`). It has no row for:
     - `*.test-helper.ts`
     - a file under `test/`
     - a file under `e2e/` (the JSON file at `apps/web/e2e/gate-fixture/classifier-e2e-trust.json` depends on this)
     - `.test.tsx`
   - It also has no row for "keys too" (a code in a JSON key).
   - Missing break check: a JSON hit. The listed checks use only a string and a `docs/modules.md` line.

9. **Some source strings are still not scanned.** Label: note.
   - P1 (`plan.md:15`) scans strings in TS, TSX, MJS and JS only. `.astro` template and frontmatter text and `.sh` strings are not scanned. Ticket bullet 4 says "non-test source string".
   - My probe found 0 `.astro` hits today. Either name the gap in D13's style, or accept it there.

10. **Renaming the scan file leaves stale names in the test audit.** Label: note.
    - D1 renames `comment-codes.test.ts`. The audit data of the active test-audit ticket (F125: `audit/data/cases*.tsv`, `audit/review-server-unit.md:151`) names the old file. The plan rule `plan.md:55` forbids F150 workers to edit those files, so the rename leaves them stale.
    - The coordinator should tell F125.

There is no stage that is too big. Word counts: `plan.md` 1,329 words (limit 1,500), stage files 307–630 words (limit 700). The Needs lines follow `planner.md:53`. I found no other pair of rules that conflict, apart from D12 and the `CLAUDE.md` CI rule (finding 1).

## Checks I ran

- A single `&&` chain printed `82b2225233aed414d79d18ef2c7e234fdfe160bd` for HEAD. In the same chain, greps confirmed `notify.ts:283`, `in-place.ts:24-25`, `approvals.ts:148`, `dla_button: "Delegate"`, the 11 docs pages that contain "delegate", and `land-check.sh:10,78` (typecheck only).
- `git status --short` printed nothing.
- `bun install --frozen-lockfile` installed 991 packages.
- A throw-away AST probe (kept outside the repo, now deleted) with the plan's `STRING_CODE` and `CODE`:
  - Source strings: 12 hits, the plan's 11 plus `notify.ts`.
  - JSON: 1 hit (`layers.json`), and no parse errors.
  - `apps/docs/src/content` pages: 0 hits. `docs/modules.md`: 195 lines. `CHANGELOG.md`: 1 line.
- A `flaggedTextProblems` probe of the docs pages with the four candidate keys in the table of finding 2.
- `changelogPage(CHANGELOG.md)`: the page does not contain "F118".
- Line greps on `deploy/README.md` (47) and `docs/release-checklist.md` (1).
- `git log --since=2026-11-15` on `docs/modules.md`: 44 commits, 49 added lines with a code.

I ran no test suite, lint or typecheck, as the review reminder says.

## Note check

- HEAD is the candidate: proven. `git rev-parse HEAD && grep -n "stage 10/11" apps/server/src/modules/actions/repo/notify.ts && …` (one `&&` chain, exit 0) printed `82b2225233aed414d79d18ef2c7e234fdfe160bd`.
- Each finding quotes file and line: proven. This final message gives each of findings 1–10 a path and a line.
- Each disputed plan claim is checked against the repo: partly proven.
  - Proven by the same `&&` chain: the `notify.ts:283` hit (finding 5), `in-place.ts:24-25` (finding 4), `approvals.ts:148` (finding 3), `dla_button` and the 11 docs pages that contain "delegate" (finding 2), and land-check runs typecheck only (finding 1).
  - Not proven by an accepted command, because these calls used `;` or `|` and the probe scripts are deleted: the 44-commit and 49-line counts of finding 1, the "11 pages fail" output of the `flaggedTextProblems` probe, and the 47-line count of `deploy/README.md`.
- Easy-to-miss rule (do not report code detail as a finding): followed. Each finding names a missing decision, edge case, test or wrong fact. None asks for line numbers or edit text.

Project reminders:
- Tests run once, and no `--no-verify`: followed. I ran no suite and made no commit.
- `check:job` for jobs that commit product code: not applicable. This review job commits nothing.
- A review runs no suite, lint or typecheck: followed. I ran only throw-away probes outside the repo and greps.
- Never delete `node_modules/.cache/`: followed. I did not touch it.

## Decisions for the owner

none
