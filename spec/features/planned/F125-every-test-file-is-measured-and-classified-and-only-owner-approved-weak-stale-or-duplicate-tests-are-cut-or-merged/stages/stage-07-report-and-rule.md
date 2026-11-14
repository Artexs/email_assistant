# F125 stage 07 — Report, approval groups and the test-quality rule

Part of [`../plan.md`](../plan.md). Phase A. Needs stages 04–06 landed. Gets a review job before the land (plan § Review). After the land the coordinator stops for gate G1.

Goal of the stage: the owner gets one file to decide from (`audit/report.md`, § Report shape), and the agents get a short test-quality rule.

## Step 1 — Approval groups

- **Input:** `audit/review-core-web-tools.md`, `audit/review-server-unit.md`, `audit/review-int-e2e.md`, `audit/data/*.tsv`.
- **Rule:** group the non-`KEEP`, non-`GAP` rows by action, then by area folder (for example `apps/server/test/integration` CLI tests), then by rule. A group holds 5 to about 60 rows; split a bigger one by folder. A smaller one merges only with a group of the same action and the same rule (another folder); if none exists, it stays a small group. Group ids `G01…` in order of time saved, then lines saved.
- **Open branches:** run `git branch --no-merged master --list 'limen/*'` and `git diff --name-only master...<branch>` per branch. Per group, write the count of rows in files that an open branch changes (they wait in phase B, Cut stage rule 2).
- **Unit/int pairs:** if `unit-int-pairs.tsv` (stage 05) and `int-unit-pairs.tsv` (stage 06) both exist, merge them and remove double rows.
- **Kept-key check:** every `Kept key` of a `DELETE-DUP` or `MOVE-TO-UNIT` row must not appear in the `Keys` of any cut row. A conflict: the row whose group has less time saved becomes `KEEP` with rule `kept-conflict`. Write the conflict count in the final message.
- **Output:** `audit/approval-groups.tsv`: `group`, `action`, `rule`, `area`, `rows`, `lines`, `time_s`, `blocked_rows`, `keys`.

## Step 2 — `audit/report.md`

- **Shape:** `plan.md` § Report shape, sections 1–5. The approval table has one row per group, an empty `Owner` cell, and one example `file:line` with a link to the row in the review file. The reject list starts empty.
- **First lines:** three sentences for the owner: what the audit found, what the groups would remove (cases, lines, time), and what to do ("Write ok, no or ask in the Owner column").
- **Section 5 (what the audit cannot see):** at least: registry tests have zero kills by nature (K2); `apps/server` has no mutation data (D5); cases not read; mutation timeouts.
- **Follow-up proposal (P4):** one paragraph with the GAP count and the top 10 GAP functions, as a ticket outcome line the coordinator can paste.
- **Done when:** the file is committed; the sum of `rows` in the table equals the non-`KEEP`, non-`GAP` rows of the three review files.

## Step 3 — Test-quality rule

- **Files:** `docs/code-patterns.md` § Tests (append bullets), `.agents/limen/styleguide.md` § Prefer and § Avoid (one bullet each that points to the § Tests rule).
- **Text** (adapt the numbers to the report; keep each bullet one sentence):
  - "A test checks one behaviour named in its title, with an exact expected value (`toBe`, `toEqual`, a full error code); `toBeDefined`, `toBeTruthy` or a bare `toHaveBeenCalled()` alone is not a check."
  - "Before you add a test, search the test file and the tests next to the code for the same behaviour; add a row to an existing `test.each` table or extend the case instead of a near copy."
  - "Three or more cases with the same body and other values are one `test.each` table, with one readable label per row."
  - "Pure logic gets a unit test (in `packages/core` when it is core logic); an integration test is for what needs the DB, IMAP, SMTP or a process, and a CLI test proves the wiring once."
  - "A test that cannot fail when the code under it breaks tests nothing: before the commit, break the code once and see the test fail."
  - "Never wait for a production timeout in a test: pass a short one as a parameter."
  - "Registry, enum and completeness tests are wanted: they fail when the next change misses a place."
  - Reviewer line in the styleguide: "A review names each new test that breaks a § Tests rule of `docs/code-patterns.md`."
- Up to 3 more bullets from the findings, each backed by a count in the report (for example "N of the M `REWRITE-WEAK` rows were `toBeDefined` only").
- **Done when:** both files are committed; `.agents/limen/styleguide.md` stays under 1,000 lines (`wc -l`).

## Done when

Steps 1–3 done; the Phase A Proof of `plan.md` § Proof with `NN=07` prints `PROOF_OK`. The final message starts with the three report sentences of Step 2.
