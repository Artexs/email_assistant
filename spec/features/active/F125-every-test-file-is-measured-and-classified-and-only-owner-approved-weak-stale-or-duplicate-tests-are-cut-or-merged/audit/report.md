# F125 test audit: report for gate G1

The audit read 1,026 items (single cases, groups of look-alike cases, core test files) and found few to change: 101 rows propose a change and 925 keep. The 10 approval groups below would remove or move 18 cases and about 700 test lines, and would save 53 s of the 1,125 s serial integration run. Write `ok`, `no` or `ask` in the `Owner` column of each group in section 2.

Honest size check: 704 of 263,169 test lines (0.3 %) and 4.7 % of the int time. The audit finds the suite mostly sound. It does not find a large cut. The value is in 28 weak tests that get exact checks, 25 tests that run nowhere, and the gaps in section 4.

Data and method: `data/` (static scan, JUnit timings, coverage, core mutation run), `review-core-web-tools.md`, `review-server-unit.md`, `review-int-e2e.md` (one row per item read, with evidence), `approval-groups.tsv` (the groups, with every key). Method: `plan.md` § Reader method. Nothing in this audit changed a test.

## 1. Summary

**Size of the suite** (data base, stage 02 run; a fresh scan at the base of this stage counts 12,223 call sites in 1,046 files, log `/tmp/f125s07/rescan.log`):

| Lane | Cases (JUnit; e2e: call sites) | Serial time |
| --- | --- | --- |
| Unit | 7,039 | 98.5 s |
| Integration | 5,924 (3 skipped) | 1,125.1 s |
| e2e (Playwright, not run) | 225 | – |
| Total | 13,188 | |

**Read versus flagged.** The static scan flags 622 of 11,673 call sites (S1–S9, `not-run`, `unscanned`). The core mutation run adds 439 cases that kill no mutant (`S11`) and 1,567 that kill only mutants another case also kills (`S10`). A reader looked at 1,026 items: 660 in `packages/core`, `apps/web`, `apps/docs`, `deploy/test` and `tools`; 143 in `apps/server/src`; 223 in integration and e2e. No e2e case is flagged, so none was read. Every case that is in no item is `KEEP (not read)`. Not read by cap: 0 items. Not read because they are newer than the data: see section 5.

**Rows by action** (1,026 rows: 925 `KEEP`, 101 below):

| Action | Groups | Rows | Cases | Lines | Time saved |
| --- | --- | --- | --- | --- | --- |
| `MOVE-TO-UNIT` | 1 | 13 | 13 | 281 | 45.0 s (int lane) |
| `DELETE-DUP` | 1 | 5 | 5 | 67 | 8.0 s |
| `MERGE-TABLE` | 3 | 30 | 118 (stay as table rows) | 356 | 0 s |
| `REWRITE-WEAK` | 2 | 28 | 28 | 0 | 0 s |
| `FIX-NEVER-RUNS` | 3 | 25 | 25 | 0 | 0 s |
| `DELETE-STALE` | 0 | 0 | 0 | 0 | 0 s |

`KEEP` rows by rule (925): K2 261 (registry and completeness checks), K3 265 (security and privacy), K6 30 (capability page), K5 5, K4 1, K1 2, `unsure` 84 (kept because a wrong keep costs nothing), no rule 277 (plain cases of another input class).

**Core mutation score:** 86.45 % (21,250 mutants: 11,535 killed, 76 timeout, 1,483 survived, 337 no coverage, 7,819 error or ignored). Source: `data/mutation-summary.md`.

**Open branches.** 13 `limen/*` branches are unmerged; 10 change test files (33 files). Two groups have rows in those files: `G04` (1 row) and `G09` (3 rows), 4 rows in all. They wait for phase B (Cut stage rule 3). One more row (`G09`, `time-rewrite-check.test.ts:43`) is stale: its file was deleted on master after the review (checked at master `17497c5a`); no other key of the 101 rows changed its file.

**Checks of this stage.** Kept-key conflicts: 0 (no `Kept key` of a `DELETE-DUP` or `MOVE-TO-UNIT` row is a key of a cut row). Pairs file: `data/unit-int-pairs.tsv` holds only its header, and stage 06 wrote no `int-unit-pairs.tsv`, so nothing merged; each unit twin is named in the `Kept key` and `Evidence` of its row.

## 2. Approval table

Columns: `Rows` = items; `Lines` = test lines the action removes (estimate for tables; 0 for rewrites); `Time saved` = integration time (serial) of the cases that go. `Example` links to the row in the review file. Keys of all rows: `approval-groups.tsv`. Key drift: keys are `file:line` of each review's base; a cut stage re-resolves them by name (Cut stage rule 2).

| Group | Action | Rule | Area | Rows | Lines | Time saved | Example (file:line) | Evidence | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G01 | `MOVE-TO-UNIT` | none | `apps/server/test/integration` | 13 | 281 | 45.0 s | [`int/lab-bots.test.ts:610`](review-int-e2e.md#L114) | 11 rows test the lab bot logic over the 5-method `LabMailClient` port, with no DB; a 40-line in-memory fake lets them run as unit tests (new file `src/modules/lab/bots.test.ts`). One real-IMAP case stays (`lab-bots.test.ts:222`). The other 2 rows: `stats-week-cli.test.ts:56` (6 spawns that check `readStatsWeekOptions`) and `mail-sent-budget.test.ts:328` (a 3 s `LOGOUT` wait that only moves to the unit lane). The unit files add lines, so net lines are lower than 281. | ok |
| G02 | `DELETE-DUP` | none | `apps/web`, `apps/server/test/integration` | 5 | 67 | 8.0 s | [`int/org-export-cli.test.ts:123`](review-int-e2e.md#L143) | 4 CLI cases re-check inputs that a unit case already refuses (kept: `rules.test.ts:157`, `lock.test.ts:20`, `org-export-args.test.ts:18`, `mailbox-settings-args.test.ts:138`); 1 web `not.toThrow` case that the next case covers (kept `changelog-releases.test.ts:68`). Each row names its kept key. | ok |
| G03 | `MERGE-TABLE` | none | `apps/server/src`, `apps/docs`, `apps/server/test/integration`, `apps/web`, `deploy/test` | 12 | 211 | 0 s | [`log-lint.test.ts:165`](review-server-unit.md#L144) | Look-alike cases become one `test.each`; each row keeps its old name and inputs. 52 cases. Largest: `log-lint.test.ts` (3 tables, 111 lines of the 211). Saves lines only: the same spawns still run. | ok |
| G04 | `MERGE-TABLE` | K1 | `packages/core` | 10 | 74 | 0 s | [`ops/alert-step.test.ts:43`](review-core-web-tools.md#L171) | Same, but one case in each group kills a mutant that no other case kills (K1), so the table must keep every input. 37 cases. 1 row (`triage/cost.test.ts`, `costPerMail`) waits for an open branch. | ok |
| G05 | `MERGE-TABLE` | none | `packages/core` | 8 | 71 | 0 s | [`digest/llm-pause.test.ts:10`](review-core-web-tools.md#L161) | Same, with no unique kill. 29 cases. | ok |
| G06 | `FIX-NEVER-RUNS` | F6 | `apps/server/test/integration` | 2 | 0 | 0 s | [`int/e2e-seed.test.ts:91`](review-int-e2e.md#L37) | `describe.skipIf` on the E2E database URLs: the `ci` job sets none, the `e2e` job sets them but runs only Playwright. The 2 cases run nowhere. Proposal: run the file in the `e2e` job, or delete it. | ok: run in the `e2e` job |
| G07 | `FIX-NEVER-RUNS` | K3 | `tools/mail-oauth-spike` | 20 | 0 | 0 s | [`probe.test.ts:54`](review-core-web-tools.md#L803) | `test:unit` does not list `tools/mail-oauth-spike`, so CI never runs its tests. They pass now (23 of 23, 0.45 s). 20 rows guard secrets, addresses and send targets (K3). Proposal: add the folder to `test:unit`, or delete the kit with its tests. Same decision as G08. | ok: run (add to `test:unit`) |
| G08 | `FIX-NEVER-RUNS` | none | `tools/mail-oauth-spike` | 3 | 0 | 0 s | [`probe.test.ts:146`](review-core-web-tools.md#L808) | The 3 rows of the same kit without a K rule (timeout, argument parsing, a large `LIST` reply). `spec/quality/2026-11-20-pass-2.md` already asks the owner to keep or drop the spike. Answer G07 and G08 alike. | ok: run (add to `test:unit`) |
| G09 | `REWRITE-WEAK` | none | `apps/server/src` | 21 | 0 | 0 s | [`deploy-logging.test.ts:372`](review-server-unit.md#L51) | The case checks too little (6 have no `expect`, 12 use only `toBeDefined`, `toBeTruthy`, `not.toThrow` or `not.toBeNull`, 3 are regexes over source text). Each row holds the exact assertion to write; no case is removed. 3 rows wait for an open branch (`config.test.ts` ×3). 1 row is stale: `time-rewrite-check.test.ts:43` is gone, because the time-spelling ticket landed on master and deleted that tool and its test; reject it in section 3. 3 rows (`main.test.ts:42`, `:52`, `:61`) need a new seam in product code: see the prose-pin questions below. | ok, except the 3 `main.test.ts` rows (section 3) |
| G10 | `REWRITE-WEAK` | none | `packages/core`, `tools/fake-telegram`, `apps/server/test/integration` | 7 | 0 | 0 s | [`notices/encode.test.ts:100`](review-core-web-tools.md#L156) | Same: `not.toThrow` or no `expect` only (2 core, 1 fake-telegram, 4 int). Each row holds the exact assertion. | ok |

**Advice (a recommendation, not a decision).** `ok` for G01, G02, G03, G04, G05, G09 (not the three `main.test.ts` rows) and G10: every row names its evidence and keeps its inputs. For G06, G07 and G08 the owner decides whether to run or delete: this is a product choice, so the audit proposes no default. A cut stage re-checks the proof of `plan.md` D9 before any group is changed.

### Owner questions that are not groups

1. **Prose-pin tests (unsure; kept).** Four cases in `modules/replies/capability-page.test.ts` (`:11`, `:16`, `:21`, `:31`) assert phrases of `docs/capabilities/drafts-and-send.md`: a page edit fails them. The reader kept them (K6) and asked: keep prose pins at all? Three cases in `main.test.ts` (`:42`, `:52`, `:61`, in G09) match regexes over the source of `main.ts`; a rename or a reformat fails them, and a proper rewrite needs a new exported function. Three cases in `composition.test.ts` (`:214`, `:231`, `:445`, group T4) are source pins of different wirings (kept, `unsure`). Three int cases in `privacy-address-pattern-use.test.ts` scan source text and stay by K3. Answer: `keep all`, or `ask` for a follow-up that replaces the regexes with behaviour tests.
2. **Tests that pin a weak rule.** `triage/payloads.test.ts:49` pins that the date `2026-13-01` passes the draft schema; `web/activity.test.ts:39` pins that an unknown query key passes. Both kept. The question is product: should the schema refuse them? If yes, the follow-up changes product code and flips the two tests.
3. **Time spelling and size rules reach tests.** The time-literal lint rule (one time spelling) covers non-test code only, and the size lint skips test code (owner decisions of 2026-11-20 name this audit as the owner of both). 39 test files pass 800 lines (44,405 lines, 17 % of all test lines; the largest are `mail-sync.test.ts` 3,043, `channels-notices.test.ts` 2,710, `actions-repo.test.ts` 2,008; list in `/tmp/f125s07/big-tests.txt`). No row of this audit splits them. Answer: open a follow-up that splits them and extends both rules to tests, or leave tests out.

### Owner answers (G1, 2026-11-20)

The owner asked the agent to recommend and mark every group; the owner accepted the recommendations. Log: `docs/owner-decisions.md` (F125 G1 entries).

- **G01–G05, G10:** `ok`, as the advice above.
- **G06:** run `int/e2e-seed.test.ts` in the CI `e2e` job (it sets the E2E database URLs). No case is deleted.
- **G07, G08:** keep `tools/mail-oauth-spike/` and add it to `test:unit`, so CI runs its 23 tests. Microsoft and Google mailbox sign-in stays planned (owner, 2026-11-20); the kit is the first step when the owner has test accounts. The kit's own README says the OAuth ticket deletes it at its end. Undo: delete the folder.
- **G09:** `ok`, except the 3 `main.test.ts` rows (reject list).
- **Question 1 (prose pins):** keep the 4 capability-page pins (a behaviour change must update its capability page). Follow-up ticket: replace the `main.test.ts` and `composition.test.ts` source regexes with behaviour tests.
- **Question 2 (weak rules):** yes for the date: a follow-up makes the draft schema refuse `2026-13-01` and flips `triage/payloads.test.ts:49`. No for the query key: an unknown key in a web query stays accepted; `web/activity.test.ts:39` stays.
- **Question 3 (rules reach tests):** yes, as one planned follow-up ticket at low priority: extend the time-literal rule to test files, split the test files over 800 lines, then extend the size lint to tests.

## 3. Reject list

Name single `file:line` keys that stay untouched inside an `ok` group. The list starts with one stale key.

- `apps/server/src/scripts/time-rewrite-check.test.ts:43` (G09): the file no longer exists; the author of this report put it here so that no cut stage looks for it.
- `apps/server/src/main.test.ts:42`, `:52`, `:61` (G09): owner, 2026-11-20: not rewritten in the cut stages; a follow-up ticket replaces the source regexes with behaviour tests (owner question 1).

## 4. Gaps and follow-up proposals

**GAP list (P4).** 122 functions hold 1,257 survived or no-coverage mutants (functions with 5 or more; 6 unstable mutants left out). Full list with example mutants: `review-core-web-tools.md` § GAP. The top 10:

| Function | Mutants | Function | Mutants |
| --- | --- | --- | --- |
| `replies/schema.ts` module level | 42 | `testmail/batch.ts` `validateBatch` | 26 |
| `sim/checks.ts` `checkSpread` | 38 | `web/public-content.ts` `ipv4Allowed` | 25 |
| `sim/sent-slot.ts` module level | 33 | `sim/checks.ts` `checkCase` | 24 |
| `digest/approvals.ts` `renderApprovalRequest` | 29 | `changelog.ts` `parseChangelog` | 23 |
| `triage/suspicious.ts` `isOneEditApart` | 29 | `replies/views.ts` `deobfuscate` | 23 |

**Ticket outcome line (paste):** "The core code that no test catches is covered: the 122 functions with 5 or more surviving mutants get cases that fail when the code breaks, starting with the 10 above (`replies/schema.ts`, `sim/checks.ts`, `sim/sent-slot.ts`, `digest/approvals.ts`, `triage/suspicious.ts`, `testmail/batch.ts`, `web/public-content.ts`, `changelog.ts`, `replies/views.ts`), and a mutation rerun shows the survivors fall."

**Other follow-ups the reviews found** (none is a row; each changes more than one case):

1. **A fake `LabMailClient`** (about 40 lines, `src/modules/lab/`) lets the lab bots, injector and serve tests run as unit tests. G01 uses it; the rest could follow (`review-int-e2e.md` § Proposals).
2. **CLI stream tests.** `mailbox-cli-streams.test.ts` (44 s), `cli-streams-other.test.ts` (37 s) and `testmail-cli.test.ts` spawn a process to pin one stdout or stderr line. A lint rule that every script prints through `cli.fail` could replace many spawns.
3. **Real-clock dependence.** On 2026-11-20 one int case built its mail with `new Date()` next to a fixed fake clock and failed in CI after 07:00Z (fixed in `821e4ce2`). 73 of 435 int files call `new Date()` without an argument; 99 use `new Date()` or `Date.now()` (the replan note counted 82 with a looser pattern). Audit the ones that run under a fake clock (digest, windows, retention, overdue); a lint rule can follow. Not audited here.
4. **Weak assertions are rare.** Only 28 of the 1,026 items are `REWRITE-WEAK`, and the scan flags 8 `S1` and 16 `S2` call sites in 11,650. The new test rules (stage 07) stop new ones; no sweep is needed beyond G09 and G10.
5. **`imap-contract.test.ts`** takes 49.8 s for 72 cases; splitting it would shorten parallel runs (parallel-runs ticket, not this one).

## 5. What the audit cannot see

- **Registry and completeness tests (K2).** Mutation testing gives them zero kills by design: they guard the next change. 229 core rows are kept for this reason. Their value is not measured.
- **No mutation data outside `packages/core`.** `apps/server` and `apps/web` have none (decision D5). There, only line coverage guards a cut, and coverage shows what runs, not what is checked.
- **Cases not read.** A case with no flag is `KEEP (not read)`. The audit read 1,026 items. It did not read the unflagged cases of the integration lane one by one: of the 45 spawning CLI test files only those with a flagged case or one of the 150 slowest cases were read.
- **Newer than the data.** Master moved after the data base (stage 01–03). Cases added since have no timing and no mutation data, so no `S10`, `S11` or K1 flag exists for them: `contacts/address.test.ts` (6 new cases), `send-limits.test.ts` (1), `cli/cli.test.ts` (new file), `legal/seven-day.test.ts` (9), `llm-providers.test.ts` (7), `metrics/m7.test.ts`, `metrics/cost-model.test.ts`, `site.test.ts`, and the int sites added since the data base (105 added, 6 removed; `review-int-e2e.md` § After the data base). The mutant lines of `texts/bot.ts` and `triage/rules.test.ts` are stale. A mutation rerun (`bash scripts/test-audit/mutation.sh`) refreshes them; the groups of this report do not depend on it, but a cut stage measures its own "before" (D9).
- **Mutation timeouts and unstable mutants.** 76 mutants ended in timeout; 6 changed state between two runs (`replies/digits.ts` ×3, `testmail/batch.ts`, `triage/suspicious.ts`); they are out of the GAP counts.
- **Reader accuracy (N3).** The reader decided each row. The `Evidence` column and the linked example exist so that the owner can sample; the owner's marks are the check.
- **Time saved is serial.** The saving counts the serial run of the data base. The parallel runs of the parallel-runs ticket change the wall-clock gain; G01 also takes most cases out of the slowest int file (`lab-bots.test.ts`, 73.3 s, 23 cases).
