FAIL 038e9f6cc3e9959d51bca962e739b3283e6deeb6

`git rev-parse HEAD` matches the candidate. Three findings are proven by reading code that the split stages would break. Master CI would go red even though `check:job` passes, because `check:job` runs only tests that import a changed file. One more finding is a proven hazard in the history-copy script. Run paths are relative to the F157 folder; plan quotes are `plan.md:<line>`.

## Blocking (proven by reading code; nothing executed)

**B1. Splitting a test file breaks `capability-map.test.ts`, and no stage repoints the pages.**
- `apps/server/src/capability-map.test.ts:157-165` requires every backticked path in `docs/capabilities/*.md` to exist (`existsSync`).
- Pages cite the files that stages 06–19 delete. Examples:
  - `docs/capabilities/sync.md:111` and `:125` cite `mail-sync.test.ts` and `mail-jobs.test.ts`.
  - `drafts-and-send.md:323` cites `actions-send.test.ts`.
  - `delegation.md:122` cites `packages/core/src/digest/approvals.test.ts`.
  - `digest-and-notices.md:183,188` cites `channels-notices.test.ts` and `digest.test.ts`.
  - `web-panel.md:167` cites `web-two-factor.test.ts`.
  - `live-lab.md:206` cites `lab-demo-seed.test.ts`.
- D6 says "no part keeps the old name" (`plan.md:16`), so each split deletes a cited path.
- D13 (`plan.md:23`) only mentions the rules pages. No split stage says to repoint capability pages.
- `check:job` runs only tests that import a changed file, and `capability-map.test.ts` imports none of them. The failure would first show in CI on master.
- Missing decision: each split stage updates the capability pages (and `docs/code-patterns.md:126`, which names `channels-notices.test.ts`) in the same change. Add that to "Done when" and proof.

**B2. Stage 16 breaks the docs build.**
- `apps/docs/src/security/claims.ts:153` cites `apps/server/test/integration/privacy-dsr-erase.test.ts` as a public-claim proof.
- `apps/docs/integrations/claim-check.ts:5-16` fails the build in `astro:build:done` on `proof_missing`.
- It also requires the ledger `docs/legal/claims.md` to name the cited file (`proof_not_in_ledger`).
- `stages/stage-16-split-privacy-retention.md:9` splits that file, and nothing changes `claims.ts` or the ledger.
- A stage-16 worker has no step that finds this. `docs:test` would fail.
- Missing decision: which part is the proof file, and who edits `claims.ts` and the ledger.

**B3. Stage 11 breaks the bare-codes scan.**
- `apps/server/src/bare-codes.test.ts:31` keeps a path-keyed allowance: `"apps/server/test/integration/channels-card-sync.test.ts": /\b[UC]\d\b/`.
- `stages/stage-11-split-channels-rest.md:10` splits that file into parts that are not in the allowance. Their comments with `U1`/`C1` then fail the scan.
- `check:job` runs the bare-code scan, so the worker would see the failure only if the stage names it.
- Missing decision: add each new part to `FIXTURE_LABELS`, or key the allowance by a pattern.
- `web-approvals-kit.ts` and `web-delegations.test.ts` in the same map are not split.

**B4. `history-copies.sh` silently overwrites an existing file with the same part name. The case proof cannot see it.**
- `spec/features/done/2026-11/F091-repo-split/tools.md` runs `git update-index --add --cacheinfo "100644,$blob,$dir/$name.ts"` with no existence check. This replaces any tracked file of that name with a copy of the old file.
- D9 compares only the old file with the new parts, so a lost sibling file gives `split-proof PASS`.
- Only `stages/stage-13-split-mail-sync.md:21` warns, about `capture`. These siblings exist and are open to the same collision:
  - `actions-send-{limit,logs,started}`
  - `actions-committer-logs`
  - `actions-follow-up-concurrency`
  - `follow-up-cards-{races,refused}`
  - `mail-history-backfill-race`
  - `replies-sweep-committed`
  - `privacy-dsr-erase-outbox`
  - `retention-clear-sent-concurrent`
  - `trust-regate-tripwire-race`
  - `trust-history-job-race`
  - `web-two-factor-{reset-cli,status}`
- `procedures.md:41` has no step "the part name must not exist" and no check that the part list does not equal an existing path. Add both. A "topic" like `logs` or `status` is a natural pick.

## Gaps, conflicts and edge cases (plausible unless marked)

**N1. The split proof does not cover lost setup.**
- This is the "a test silently lost its setup" event.
- `procedures.md:43-44` and `plan.md:26,53` compare cases only.
- A top-level `beforeEach`/`afterEach`, `mock.module`, `setSystemTime` or `let` that a part forgets keeps the case count equal.
- The proof then prints an `assertions` line only when a hook contains `expect`. That line "does not fail" (`plan.md:53`) and is waved through with "a reason in the log".
- The after-run is also "in one `bun test` call" (`procedures.md:43`), one process.
  - A sibling part's `mock.module` or leftover DB rows can hide the missing setup. The repo's own gate runs parts as separate files in `--parallel=4`, each with its own DB (`package.json:16`, `scripts/check-job.sh:53`).
  - It can also hide cross-part state coupling that D7 (`plan.md:20`) tries to prevent.
- Suggest:
  - Run each part in its own `bun test <part>` call with a fresh DB.
  - Have `split-proof` treat an `assertions` diff as a stop, unless the log gives a reason for it.
  - Add a step that lists the old file's top-level non-test statements and where each went.

**N2. `check:job` cannot catch a split that is stale against master. D5 has no retry cap or merge-forward path.**
- D5 says "reset to the new master and split again" (`plan.md:18`, `procedures.md:48`).
- 14 stages run in parallel on files other tickets edit. A modify/delete conflict on the old file at the final `check:job` merge restarts the stage, and a 3,043-line file restarts the whole split.
- No limit and no cheaper path is given, such as porting the master diff into the matching part and re-running the proof.
- "A stage could not finish" is plausible for stages 10, 13 and 17.
- `plan.md:9` ("Never rebase or squash") and the reset are consistent only if the branch is unpushed; say so.

**N3. Needs lines are wrong or missing at three points.**
- The ticket says "Build after: F125 cut stages" (`ticket.md:34`). Stages 01–03 and 05 say `Needs: none` (`stage-01…:3`, `stage-02…:3`, `stage-03…:3`, `stage-05…:3`), and `scripts/coord-scan.sh` prints only that line. A coordinator that reads Needs could start stage 01 while F125 is still cutting the same ~288 files. Add a Needs line that names the F125 cut stages.
- Stage 04 (`stage-04…:3`) bundles the s–z fixes (72 files), the config flip, the docs and an open-ended "fix any hit others added". Splitting off the s–z fixes would let stages 17–19 start earlier; they only need their own files (`stage-17…:3`).
- I checked every stage's name range against the files listed (`a–l` → 02, `m–r` → 03, `s–z` → 04, non-int → 01) and found no wrong range. All 39 over-800 files appear in exactly one stage (checked with `wc -l` and `grep`).

**N4. Stage 04 is probably too big for one job.** See N3. Stages 02 and 03 (101 and 63 files of mechanical edits) are large but coherent.

**N5. Coverage hole: `deploy/test/release-harness.ts` is a test helper outside every D1 glob.**
- D1 (`plan.md:7`) lists `apps/server/test/**`, `apps/*/e2e/**` and `tools/*/test/**`, not `deploy/test/**`.
- The size rule already covers it. The time rule's `files` (`eslint.config.js:~315`, `{apps,packages,tools}/*/src/**`) plus the D1 name globs will not.
- It has no hit today (186 lines). Add `deploy/test/**` to D1 or note the exclusion.

**N6. Stale pointers in product code after stages 08–09.**
- `apps/server/src/modules/actions/transitions.ts:523-565` (PAIR_RULES `test:` strings) names `actions-repo.test.ts`, `actions-send.test.ts` and `actions-drafts.test.ts`.
- `transitions.test.ts:197-205` checks only the `<file> › <title>` shape, so this stays green and the pointers go stale.
- Decide who updates them.

**N7. Rule wording conflict.**
- `plan.md:62` says "a gap or a deviation is a question in the final message, not a choice".
- The styleguide says a worker takes the safe default when the answer does not change the stage (`.agents/limen/styleguide.md`, "Decisions for the owner").
- `procedures.md:39` ("a failing case is a stop") adds a third rule that a flaky int test would trip.
- Pick one.

**N8. Smaller points.**
- D8 (`plan.md:52`) names `<old base>-helpers.ts`. Stage 19 (`stage-19…:21`) sends shared code to the existing `two-factor-helpers.ts` and `web-helpers.ts`. Neither is `web-two-factor-helpers.ts`, so the rule and the stage note disagree.
- `stage-12…:23` ("export names … equal") gives no way to list exports. The stage also bundles three file splits with the `fixtures.ts` barrel, and `check:job` then runs nearly all int files.
- `plan.md:97-116` marks all 20 stages `[x]` while `plan.md:37` says "No stage built". That is unverified drift: I could not find the convention in the planning skill.
