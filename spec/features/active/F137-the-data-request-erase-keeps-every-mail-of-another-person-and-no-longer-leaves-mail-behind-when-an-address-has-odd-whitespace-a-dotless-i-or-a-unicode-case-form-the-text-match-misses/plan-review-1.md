FINDINGS

The plan reviewed is commit fc1c18001c488df2d02352cd1d976da80b970b45. `git rev-parse HEAD` matches it, and the worktree stayed clean (`/tmp/f137rev-scripts/status.log` is 0 bytes). Below, the folder `spec/features/planned/F137-…/` is written as `F137/`.

BLOCKING

B1. Stage 02 cannot reach its own Done-when on the database the worker uses. The plan treats the needed fix as an unlikely branch and does not design it.
- Where: plan.md:24 (F1) says "No letter differs". F1 ran on an Arch temp cluster (PG 18.6, glibc 2.44).
- What the worker uses: the dev and job database is the `postgres:17` image (`deploy/compose.yaml:18`, published on 5433 by `deploy/compose.dev.yaml:14`). The same image runs in CI (`.github/workflows/ci.yml:20`) and on the VPS. Server version is `PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)`, datctype `en_US.utf8`.
- Proven by query. I ran the current `normalizedAddress` expression over `generate_series(1,1114111)` without surrogates on that database (read-only; 0.8 s) and compared each row with the JS rule under Bun 1.4.4 (`.bun-version`). Result: **52 differences**.
  - 24 are the whitespace of D1.
  - 28 are letters: U+A7CE, U+A7D2, U+A7D4 and U+16EA0–U+16EB8.
  - Bun lowers each of the 28 (for example U+A7CE→U+A7CF, U+16EA0→U+16EBB). The image's glibc keeps them unchanged.
  - Evidence: `/tmp/f137rev-scripts/sql17.txt` and `cmp.ts`.
- What follows:
  - Stage 02 test I2 (`stage-02-one-trim-set.md:24`) will fail. The D8 branch is certain, not "if CI shows".
  - Without the fix, stage 04's default check finds these forms (they are in the case-form table). Every find and erase, and every existing DSR integration test, then refuses with `rule_mismatch`.
  - Today these 28 under-match: a stored capital is not lowered, so the person's mail stays. That is the "left behind" half of the outcome.
- What D8 (plan.md:19; stage-02:26) leaves undecided:
  - Does the worker stop, or apply the default and go on? Line 26 says both "stop and report" and "Coordinator default … then go on".
  - Is `SQL_LOWER_FIXES` a hand list or derived, and which unit test pins each pair to `normalizeSenderAddress`?
  - Does `translate()` come before or after `lower()`?
  - Do items 7 and 8 of `docs/capabilities/account-data.md` name the map?
  - Q3 (questions.md:9) still asks the owner about a hypothetical.
- Fix: move D8 into stage 02 as a decided step with the 28 known code points, and update F1, N1 and Q3.

GAP

G1. The text pattern counts a combining mark as a word boundary. The scrub then changes another person's address. No decision or test covers this.
- Code: `addressRegex` (`apps/server/src/modules/privacy/address-map.ts:384-386`) uses `[:alpha:]` plus the ranges U+00C0–U+024F and U+0370–U+052F. Combining marks (U+0300–U+036F) are in neither the look-behind nor the look-ahead.
- Proven on both the dev `postgres:17` database and the PG 18.6 temp cluster, with the HEAD pattern for `bob@x.test`:
  - `jose` + U+0301 + `bob@x.test` matches (`~*` and `~`), and `regexp_replace(…,'gi')` gives `josé[removed]` with the accent still as a combining mark.
  - `bob@x.test` + U+0301 matches.
  - The NFC spelling `josébob@x.test` does not match.
- By D5 (plan.md:17) the NFD form is another person's address, so this breaks "a mail of another person is never touched".
- D3 rewrites these boundary classes ("add `A-Z`"), so stage 03 is the place to decide it, for example by adding `̀-ͯ` (or the marks in general) to both boundary classes.
- The boundaries also rely on the database `[:alpha:]` for letters outside the explicit ranges (U+212A, U+1E9E and the 28 letters of B1). D7 does not check that.
- Stage 03 test 2 frames every probe with spaces (`stage-03-text-match-forms.md:30`), so it cannot see boundary cases. Add named cases: an NFD letter just before the address, and one just after the domain.

G2. The run-time check (D7) only probes forms that JS knows. A database that lowers more than JS passes it, and that direction over-matches.
- Plan: interfaces.md:24 and stage-04:9 probe `ADDRESS_RULE_PROBES` plus `x<form>y@x.test` for the 2,968 forms. I counted 1,479 targets and 2,968 forms; F3 is correct.
- The failure: a code point that Bun leaves unchanged but a newer glibc lowers is never probed. This is the reverse of B1, for example a later image pull with newer Unicode than Bun.
  - The equality rule then matches a stored address that the JS rule calls another person.
  - The mail of that other person goes.
- The reason given for the small set (Q5, questions.md:11: "a few milliseconds") is weak. The full range took 0.8 s on the dev database.
- Decide: the full range at run time (about 1–2 s for a rare CLI command), or record the rejected option with its reason.

G3. The runbook line for `rule_mismatch` points the operator at the wrong cause and gives them nothing to act on.
- Stage-04:32 says: check `datctype` (`en_US.utf8` expected).
- B1 shows a mismatch with `datctype = en_US.utf8`; the cause is the glibc Unicode version.
- The image tag `postgres:17` floats (`deploy/compose.yaml:18`), and the VPS image date is unknown (deploy/README.md has no pull step). A static `SQL_LOWER_FIXES` made from the dev image may not cover the VPS, so every find and erase there would refuse.
- The refusal gives only a count (`differences`). Code points are not personal data.
- Decide how the operator gets the differing code points (for example a `--rule-check` mode that prints them) and what the next step is. "Tell the owner" alone is not enough.
- N1 (plan.md:32) treats "CI" and "deploy" as one image. They are the same tag, not the same build.

G4. Who writes the `dsr_rule_mismatch` warn line is undecided, and two rules conflict.
- The rules:
  - Stage-04:19 says find and erase "return … one warn line `dsr_rule_mismatch`".
  - The module comments say "The module logs nothing" (`erase.ts:195`, `dsr.ts:134`).
  - interfaces.md:26 puts the event under the CLI.
- The CLI already logs `org_dsr_refused {reason}` at error level for every refusal kind (`apps/server/src/scripts/org-dsr.ts:24-26, 66-68`). A CLI-side line would make two lines.
- No refusal prints a `refused: …` text to stderr today, so the new format has no precedent.
- The field `differences` is not in `apps/server/src/platform/log-fields.ts` (ADR 0024 allow-list).
- Decide one place and one format.

G5. Stage 04 test 5 has no seam to test. `org-dsr.ts` has no test (only `org-dsr-args.test.ts`), and it calls `findSubjectData` and `eraseSubjectData` without `ruleCheck` (org-dsr.ts:18-23, 50-55). The fallback "test the formatter of the refusal line" (stage-04:27) names a function that does not exist. Decide whether the CLI gets an injectable seam or an extracted formatter.

NOTE

N1. D7 probes `unnest($probes)` with the default collation. That is right today: no migration has `COLLATE` (checked with grep in `db/migrations`). A finding from this review: text that comes from a `name`-typed argument gets collation "C". For example `convert_from(bytea,'UTF8')` gives `pg_collation_for = "C"`, and its `lower('Σ')` returns `Σ`. Stage 02 I1 and I2, and D7, must build probe text so that it carries the default collation; a worker who builds it with `convert_from` gets false differences. One line in D7 would prevent that.

N2. Facts checked and found to hold:
- F3: 1,479 targets and 2,968 forms; the multi-form list is correct; every target is stable under the fold (Bun scan).
- F2: I rebuilt a D3 prototype on the dev `postgres:17` database, with JS case forms, `A-Z` in the boundaries and `~`. Over 40 distinct accepted addresses × 66 probes (2,640 pairs): 0 mismatches. The json form of the 54 equal pairs: 54 matches.
- probe-strings.md matches `/tmp/f135-probe/probe.ts` exactly (66 entries; entry 56 is U+3000).
- 40 distinct accepted addresses: correct.
- D1: 25 code points, correct.
- D2: the only generated column is `emails.from_address_lower = lower(from_address)` (`db/migrations/20261115120001_…sql:27`); no index uses the `normalizedAddress` text.
- F5: `contacts/profiles.ts:53` normalizes again in JS.
- `triage/newsletter-unsubscribe.ts:152` and `tenancy/members.ts:48` write `trim().toLowerCase()`.
- The `users.email` CHECK is `email = lower(email)`; the stage 01 test 3 and 4 values pass it.

N3. Stage 01 mutations, traced by reading `dsr-match.ts:100-126`. Test 1 kills M06, M07 and M08. Test 2 does not kill M07, because PG `lower('Σ')` is `σ`; the stage text says "test 1 or 2", so this is fine. Tests 3 and 4 kill M22, 5 and 7 kill M24, 6 and 7 kill M25.

N4. Stage 03 mutation 2 (`[letter, letter.toUpperCase()]`) gives `SS` for `ß`, a two-code-point form. The mutated pattern then over-matches `STRASSE`. The test still fails, but for a different reason than the stage names.

N5. Word counts drifted: plan.md:89 says plan.md has 1,284 words; `wc -w` gives 1,299, still under the 1,500 cap. Stage 03 has 694 words, close to the 700 cap. Moving D8 into stage 02 (B1) adds about 60–100 words there; stage 02 has room (568).

N6. Pre-mortem answer: a shipped bug most likely enters through one of these.
- Stage 03, through G1: an NFD letter next to another person's address.
- Stage 04, through G2: a later image with newer glibc over-lowers, and the probe set does not see it.
- B1 does not ship silently: test I2 stops stage 02.

Checks run
- `git rev-parse HEAD`: fc1c18001c488df2d02352cd1d976da80b970b45 (`/tmp/f137rev-scripts/head.log`).
- Read the plan files and the code: `address-sql.ts`, `address.ts`, `address-map.ts`, `dsr-match.ts`, `erase.ts`, `dsr.ts`, `org-dsr.ts`. Grepped `~*`, `'gi'`, `addressRegex`, `normalizedAddress`, migrations and log-fields.
- Full-range SQL vs JS query on the dev DB (`postgres:17` 17.11, read-only): 52 differences (`/tmp/f137rev-scripts/sql17.txt`, compared with `cmp.ts`).
- Pattern repros: on a PG 18.6 temp cluster (stopped and deleted) and on the dev DB: G1 confirmed (printed in the session, not saved to a file).
- D3 prototype on the dev DB with temp tables only: 0 of 2,640 mismatches (`/tmp/f137rev-scripts/proto.ts`, `rows.tsv`; the result was printed in the session; `proto-out.txt` holds an earlier run that the collation artifact of N1 spoiled).
- Bun scans: F3 counts; probe list identical to the F135 source.
- Not run: lint, typecheck, unit and integration suites. This is a plan review with no code to test, and `node_modules` is not installed in this worktree.

Note check
- Decisions checked against HEAD code and the F135 review, with file:line quotes: proven. `/tmp/f137rev-scripts/sql17.txt` holds the full-range query output behind B1; the file:line quotes are in the findings above. The prototype and pattern repro results were printed in the session, not saved.
- Findings cover the six classes, sorted BLOCKING / GAP / NOTE: proven by this message. The classes are covered as follows:
  - gaps: G1, G2
  - rule conflict: G4
  - Sonnet guesses: B1 (D8 is undecided), G5
  - facts without a valid source: F1 in B1, N1 in G3
  - tests and mutations: G1, N3, N4
  - stage size: N5
- First line is PASS or FINDINGS: proven by this message (the first line is `FINDINGS`).
- Easy-to-miss rule "Do not edit files" and "missing code detail is not a finding": followed. `/tmp/f137rev-scripts/status.log` is 0 bytes (`git status --porcelain` at fc1c1800). G4 names the missing log-field entry only as part of a design conflict, not as a finding of its own.
