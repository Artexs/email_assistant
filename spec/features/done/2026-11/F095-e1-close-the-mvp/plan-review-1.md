# F095 plan review 1

Job `2026-11-14-f095-plan-review-e929d4c8` (Opus 5.5, high), candidate `6abf74d`. Filed whole: the review message, then the job's final message.

## Review message

FAIL 6abf74dda058bed3a2a584fa7f1b2ca4a36fd260

The plan fails. One blocking finding: after F095 closes, the capability-map unit test breaks `test:unit:ci` on `master`. Eight more findings are rated major.

HEAD is `6abf74dda058bed3a2a584fa7f1b2ca4a36fd260` and matches the candidate. The branch base is `9d9bfb8`; `master` is 13 commits ahead at `d117cd6`. I did not edit any file: `git status --short` is empty.

## Blocking

**B1. The map test fails on `master` after F095 closes. Stage 02 let it through.** Proven by reasoning from the fixed text, not by a run (the test does not exist yet).

- `stages/stage-02-capability-frame.md:21` puts `` `spec/features/active/F095-e1-close-the-mvp/` `` in the README.
- `:38` puts `spec/` in `PATH_ROOTS`.
- Case 12 (`:62`) checks every path token of `README.md`.
- No later stage removes that line. Stage 07 step 4 does not.
- `limen land --help` says land "close[s] its active ticket", and stage 10 lands without `--keep-open` (`plan.md:278`). The folder then moves to `done/`, and `bun run test:unit:ci` fails on `master`. That breaks ticket acceptance bullet 1 and the CLAUDE.md rule "CI on `master` must stay green".
- The same applies to any page that cites `spec/features/planned/FNNN-…/` in "Limits" (D2, `plan.md:142`; "by folder name", `stage-03:24`). The next lane move of that ticket turns CI red.
- **Fix:** remove `spec/` from `PATH_ROOTS` (D3, `plan.md:145`). Cite tickets by F-number or by bare folder name only.

## Major

**M1. Stage 06 check expects the wrong row count.** `stage-06-cap-notices-panel.md:33` says "The README index has 8 rows". After stage 06 the index has 7 rows: 2 + 1 + 2 + 2. Proven by count.

**M2. Stage 08 step 3 check cannot pass.** `stage-08-sweep-and-next.md:62` runs `grep -rn "code-map" --include=*.md docs …` and expects no line. Today it hits `docs/product/stage-2/06-architecture-review.md:137,139`. That file is out of scope at `:58`, and `plan.md:206` forbids edits to it. Proven by running the grep.

**M3. Stage 09 SSH commands lose their SQL quotes.** `stage-09-pilot-results.md:9` says `ssh home_vm '<command>'`, and the SQL inside holds `'<ORG>'`. The `--format '{{…}}'` of `:29` has the same problem. A `bash -c` demo printed `org_id = ac6ed6a2-ee37`: the quotes are gone. Proven. The worker must invent the quoting (for example `ssh home_vm bash -s <<'EOF'`).

**M4. Two rules conflict on the stage 09 VPS commands.** D13 (`plan.md:155`) and `stage-09:9` allow "D13 only", and the review focus `:55` enforces that list. The stage itself also uses commands that D13 does not list:

- `curl /health` (`:29`)
- `psql -c "\d …"` (`:22`)
- `--help` (`plan.md:186`)
- `jq` (`:29`)

The rule at `plan.md:201` ("stop") makes the worker halt, or the review fails it. D13 also gives `triage:cost --days 7` without the required `--org-id` and `--mailbox-id` (`apps/server/src/scripts/triage-cost.ts:14`).

**M5. The S3 count N misses web-panel corrections.** `stage-09:36` runs "Wrong moves (N)" as written. That query counts only `undo`, `imap_move` and `telegram`+`wrong` (`F005 …/stage-20…md:31`). The panel writes `source: "web"` with a verdict (`apps/server/src/modules/triage/feedback.ts:113`; the CHECK in `db/migrations/20261104000001_triage.sql:49` allows it). F037 `plan.md:54` says to count `web` with `telegram`. Wrong verdicts from the panel are therefore left out of N, and the S3 bar can pass by mistake. The undercount follows from the query text and the code. Whether any `web` wrong verdict exists is not checked (the live data is on the VPS).

**M6. The final NEXT check fails for every active ticket.** D10 (`plan.md:152`) puts active tickets in NEXT. `spec/build.md` `## NOW` already lists them; today it holds `F088` and `F094` twice (lines 19, 48, 57, 62). `stage-10…md:47` runs the "exactly once" check over the whole of `build.md`, so every active ticket counts 2. Proven by running the stage 08 loop against `spec/build.md`.

**M7. The stage 01 modules.md row is broken.** `stage-01-boundary-docs.md:36,49`: prettier split the `docs/modules.md` row into 9 cells. "Find" is empty, and "Change" is split across cells. The worker must guess the "exact text". Proven by reading the file.

**M8. The U1 facts are pushed before any privacy review.** Runbook item 11 (`stage-10:21`) commits `u1-facts.md` straight to `master`. The post-commit hook pushes `master`. So the facts are on GitHub before the stage 10 review checks them (`:55`). This is plausible, not proven.

**M9. Pages go stale when active tickets land.** F088 changes the outbox and notices, F091 changes `actions/` and §4.6, and F082 changes login. None of these plans has a step to update a capability page. The "Limits" note in `stage-06:7` covers only the moment of writing. Later planners will read stale pages. This is plausible, not proven.

**Stages that may be too big for one 90-minute job (plausible):**

- Stage 05 moves all of rule 6 and §4.5, writes two pages and checks 10 claims.
- Stage 07 writes three pages, rebuilds §8 as a job table and runs a final shape check.

## Minor

- **Stage 09 step 1.3 (`stage-09:21`):** `git log --grep "F089" master | tail -n 1` returns `0e20022`, a plan commit, not the land. The commit that adds `log-fields.ts` is `a92a2d2`. Proven.
- **Stage 09 step 1.5 (`stage-09:23`):** it names `modules/mail/audit.ts`. `auditMailbox` is in `apps/server/src/modules/mail/tools.ts:115`. The function is read-only and prints counts only.
- **Stage 09 step 2 (`stage-09:29`):** `$C logs` lines carry a `server-1 |` prefix, so `jq` fails without `--no-log-prefix`. Also, `jq` may not be on the VPS. Plausible.
- **Stage 09 step 4:** Delegations and Approval time have no `emails e` join (`F006 stage-23:29-30`). The real-mail filter does not apply, so test mail is counted. Also, the roadmap line at `:44` asks for a "median", but the query returns avg and max.
- **Stage 10 runbook item 7:** it writes on the VPS without a backup first. That conflicts with the `build.md` rule "backup first".
- **No step updates moved paths.** After `limen ticket done` moves F037 and F047, the roadmap paths and the F006 log line still point to `planned/…`.
- **`plan.md:281`** cites "stage 10 step 3". Stage 10 has steps 1–2 only.
- **Review state is inconsistent.** `plan.md:60,79` say cold review 1 is done. `:286` says "(filled after review 1)", and `plan-review-1.md` does not exist.
- **`plan.md:62`** says the ticket names `E01-discovery-notes.md`. `ticket.md:44` does not name it.
- **`questions.md:50`** says "four lines" and then lists five.
- **U1 duration is inconsistent.** `questions.md:55` says 45 min; `plan.md:237` and the epic say 15 min.
- **D8 (`plan.md:150`) claims "no shared file".** Stage 03 changes the §4.1 rule 7 reference at `docs/roadmap.md:133`, and stage 09 also edits `roadmap.md`. Git merges different lines, so the risk is low.
- **F10 lists `docs/product-brief.md:17`** ("Multi-tenant SaaS is the goal") as stale. Stage 01 does not edit it.
- **Stage 01 vs F9:** stage 01 does not say that the first commit reformats all of `product-brief.md`. Stage 08 has the same issue with `docs/decisions/README.md`. Both files fail `prettier --check` today.
- **Fact F6:** the rule lines are 142–229, not 134–229. `actions/repo.ts:1678` cites §7, not §4.5.

## Checks I ran

- `bun install --frozen-lockfile` → ok.
- Existence of every seam, script and test path named in stages 03–07 → all exist.
- Root `package.json` → every named `bun run` script exists.
- ADR files → 0018–0020 and 0025 are missing; every other ADR the pages cite exists.
- `prettier --check` on each edited file → `product-brief.md` and `decisions/README.md` warn; all others pass.
- Stage 01 "Find" strings → all found at the F10 lines.
- The `05-execution-plan.md` §2.1 F-number map → matches.
- Stage 08 check 1 → works against a `/tmp` copy; reports active tickets twice against `build.md` (M6).
- Stage 08 step 3 grep → 2 hits (M2).
- `bash -c` quoting demo → quotes lost (M3).
- The commits that the facts and stage 09 cite (`ee3443e`, `ffc6179`, `cab134f`, `8f6a8b2`, `9d9bfb8`, `a92a2d2`) → exist.
- The SQL columns that stage 09 uses → match the migrations.
- `/health` returns `{status, db}` only. `org:status` prints ids and counts only.

**Not run:** the test suites. This candidate changes plan docs only.

VERDICT: FAIL

## Final message

FAIL 6abf74dda058bed3a2a584fa7f1b2ca4a36fd260

The review result is unchanged: the plan fails on one blocking finding (B1) and has 9 major findings. The findings, ratings and evidence are in my previous message; it is the review text for the coordinator.

- **B1 (blocking):** after F095 closes, the capability-map test fails on `master`. The stage 02 README names `spec/features/active/F095-e1-close-the-mvp/`, the test checks paths that start with `spec/`, and `limen land` without `--keep-open` moves the folder to `done/`.
- **Major:**
  - M1: stage 06 expects 8 index rows; the correct count is 7.
  - M2: the stage 08 code-map grep hits a file that the stage must not edit.
  - M3: the stage 09 SSH command loses the quotes around the SQL values.
  - M4: D13 does not allow `curl`, `\d`, `--help` or `jq`, but stage 09 uses them.
  - M5: the S3 count N leaves out corrections from the web panel.
  - M6: the stage 10 check counts active tickets twice in `spec/build.md`.
  - M7: the stage 01 table row for `modules.md` is broken.
  - M8: the U1 facts reach GitHub before the privacy review.
  - M9: active tickets make the capability pages stale when they land.
  - Stages 05 and 07 may be too big for one 90-minute job.

## Note check

- HEAD is 6abf74d…: proven. `git rev-parse HEAD` printed `6abf74dda058bed3a2a584fa7f1b2ca4a36fd260` in the `&&` chain that ended in `NOTE_OK`.
- Every listed category is checked, with file:line and a rating: not proven. The evidence is my previous message, which is not a file. The coordinator saves it as `review-<n>.md`, and no such file exists yet.
- Facts and commands are checked against the repo: proven for the main findings, through the `&&` chain that ended in `NOTE_OK` and the log `/tmp/f095rev-f089.log`. The chain proves 4 points:
  - `grep -c "code-map" docs/product/stage-2/06-architecture-review.md` returned 2, which proves M2.
  - The `bash -c` quoting demo printed `org_id = ac6ed6a2`, without quotes, which proves M3.
  - `git log --grep F089 master` wrote its output to `/tmp/f095rev-f089.log`, the evidence for the F089 commit finding.
  - `test -e apps/server/src/modules/mail/tools.ts` passed; that is the file where `auditMailbox` is.

  Other checks, such as the path loop and the dry run of stage 08 check 1, ran in calls that used `;` or `|`. They are not proven under the strict rule.

- First line `PASS/FAIL <sha>` and `VERDICT:` at the end: not proven. My previous message has both lines, but no file holds that message yet.
- Easy-to-miss rule "Do not edit files": followed. `test -z "$(git status --short)"` exited 0 in the same `&&` chain that ended in `NOTE_OK`. I wrote only to `/tmp` and to the job note, which is outside the worktree.

VERDICT: FAIL
