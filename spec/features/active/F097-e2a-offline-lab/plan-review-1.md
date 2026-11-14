FAIL f05076050dce68404b7e2388c5226a255a13ee18

The plan is mostly sound, but two acceptance bullets have no correct proof path. The holdout command, as the ticket writes it, takes about 24 minutes on the default config. No stage makes `sim status` show "frozen as v1". `git rev-parse HEAD` matches the candidate. Paths below use `F097/` = `spec/features/planned/F097-e2a-offline-lab/`. The same review is saved in `/tmp/f097-review/review.md`.

## Blocking

**B1 — Acceptance `ticket.md:27` ("`bun run eval --sim lab-01 --part holdout` finishes in under 10 min") is not delivered as written. Proven from code, under the default config.**
- The bare command runs at the configured OpenAI rate: `F097/stages/stage-11-eval-sim-runner.md:114` says "Default for `--sim`: unchanged from config".
- The default rate is 60 calls per minute (`.env.example:18`; the plan states it as fact F7, `F097/plan.md:100`).
- The limiter spaces call starts at least `60000 / rpm` ms apart (`apps/server/src/platform/llm/client.ts:45-49`). So 1,417 holdout calls need at least 1,416 s, about 23.6 min.
- The proof runs a different command: stage 18 adds `--concurrency 8 --rpm 240` (`F097/stages/stage-18-first-report-and-gate-rule.md:15`).
- The new rule text that later agents follow (`F097/plan.md:73`, D29) also omits `--rpm`, so every later gate run takes about 24 min.
- Unverified: the value of `OPENAI_RPM` in the main checkout's `.env`. I did not read `.env`.
- Fix: give `--sim` a default rpm and state the account limit it relies on (N1 in the plan), or put the flag into the ticket bullet, `plan.md` Done when 1 and the D29 rule text.

**B2 — Acceptance `ticket.md:28` ("`bun run sim status lab-01` shows … frozen as v1") has no stage that builds it. Proven from the stage text.**
- `status` prints counts only (`F097/stages/stage-09-sim-cli.md:30`).
- Stage 10 adds `freeze`, `audit-list` and `audit-apply`, but never changes `status`.
- Stage 17 still expects it: "**Check.** `bun run sim status lab-01` (manifest version 1, audit pending)" (`F097/stages/stage-17-freeze-v1.md:31`). Stage 17 is a content stage, so it cannot add the code.
- Fix: one line in stage 10 step 1 — `status` prints the manifest version and audit status, or `not frozen` — plus one test.

## Unverified
- **U1** The `OPENAI_RPM` value in `.env` (see B1).
- **U2** No test suites ran. This is a plan review with no code change, so a test run would prove nothing about the plan.

## Pre-mortem: which stage lets wrong numbers unlock `auto`
- **N1 (stage 12, plausible): a weak run can write a passing gate file.**
  - The gate table uses "bar = the run's bar" (`stage-12-report-and-gate.md:71`).
  - The gate file is written for any complete `--part holdout` run (`:78`).
  - `scripts/eval.ts:42-45` accepts `--bar`, `--min-kept` and `--limit`. No rule pins the bar at 0.98 or refuses these flags for a gate file.
  - So `--bar 0.9` can commit a gate file that says `go`, and the D29 test only checks that a file exists.
  - A `--limit` run can also overwrite good evidence with "too few".
- **N2 (stage 12/18, plausible): the gate file name misses two keys, and the consumer rule is missing.**
  - `gateFileName` uses role, prompt version and model only (`stage-12:66`). It has no reasoning effort and no corpus version.
  - A run at another effort overwrites the production evidence. A v1.1 corpus (after audit verdicts) leaves the v1 file valid (`plan.md:80`).
  - No rule says a consumer (E4-B) must refuse `go` while the owner audit is `pending`.
- **N3 (stage 12, proven by reading): the gap report compares two different operating points.**
  - The sim side is `tp` of `kept`: thresholded, by `modelCategory` (`metrics.ts:88-96`).
  - The real side is `tp` of `tp + fp`: no threshold, final `predicted` (`stage-12:116`).
  - The "gap / no gap" verdict therefore compares different measures.
- **N4 (stage 16, proven fact error): the blind check is only an instruction, and its cited source says otherwise.**
  - D33 says isolation is "an instruction, as in the existing testmail runbook" (`plan.md:77`).
  - But `evals/testmail/README.md:88` says "The checker has no file tools, so it cannot read `expected`".
  - A Haiku job in the worktree can read `slots/`. Agreement would then hide ambiguous cases that never reach the audit.

## Two rules that conflict
- **N5 (proven): stage 06 briefs break stage 06's own test.**
  - The hard-case table gives the briefs "never uses words like urgent/pilne/ASAP" (`stage-06-bank-planner.md:122`) and "fake urgent payment or account lock" (`:136`).
  - Rule 12 (`:183`) and test 8 (`:197`) forbid the word `urgent` in every brief.
- **N6 (proven): stage 10's fixed floor and its test cannot both hold.**
  - `too_few` uses a fixed "holdout ≥ 200" (`stage-10-freeze-and-audit.md:32`).
  - Test 1 expects `[]` on the stage 09 fixture (`:40`), which is a "small spec" (`stage-09:11`; stage 06 test uses 20 per category).
- **N7 (proven by simulation): stage 11 test 4 has wrong numbers.**
  - Test 4 (`stage-11:45`) says "at most 3 calls".
  - Its own stop rule issues 4 calls (spent 0.0012) for any first estimate. I simulated first estimates 0.0003, 0.0005 and 0.001.
- **N8: stage 07 counts conflict.**
  - Rule 4 puts the planned replies to sent threads "on top of the 830" (`stage-07-week-planner.md:62`).
  - Test 2 says "Incoming slot count = 112" (`:72`). It is unclear whether those replies are incoming.
- **N9 (proven from code): a plan edge case is false.**
  - The plan says a review tap after a digest label "still writes a `review` row" (`plan.md:85`).
  - `skipIfSame` ignores the source (`triage/feedback.ts:75-79`), so the same category writes no row.
- **N10: the new gate rule text meets old rule lines.**
  - Stage 18 step 3 (`:61`) adds new rule text.
  - It does not say whether to replace "must pass the go/no-go table" (`docs/code-patterns.md:95`, `:160`; `.agents/limen/styleguide.md:30`).

## Gaps (an event no rule covers)
- **N11: judge errors have no recovery path.**
  - A judge error is never re-run on resume, because results without a classifier error are kept (`triage/eval.ts:442`).
  - Judge errors do not count toward the stop rule.
  - There is no check of the judge provider's key (`stage-13-draft-judge.md:111-112`).
  - A missing `GEMINI_API_KEY` therefore gives a "complete" run with every judge result an error, and O2 (`stage-18:17`) never triggers.
- **N12: `delegation` mail can never be labelled through `/review`.**
  - `/review` hides ✅ for `delegation` (`stage-04-review-command.md:40`).
  - The picker offers only 5 categories (`channels/callbacks.ts:105-117`, `digest/callback.ts:3`).
  - These mails stay unlabelled, come back on every page, and are missing from the random M1 sample.
- **N13 (plausible): week replies lose their thread.**
  - The join takes `thread` from `slot.thread` only (stage 08 step 3). Week replies use `parentId`, and `thread_count_mismatch` forces `text.thread = []`.
  - The classifier and the blind checker see week replies with no thread context.
- **N14: hard slots miss base facts.**
  - Rule 10 (`stage-06:181`) only cycles categories and calls `apply`.
  - It does not say how a hard slot gets its persona, language, sender history, `urgencySource` (`polish_diacritics` with category urgent) or `expectedDelegate` (the `injection` tag with category delegation).
- **N15: the re-label scope is unclear.**
  - "a range may be labelled again" (`stage-16-blind-check.md:9`) does not say whether the whole batch or only the rewritten cases are labelled again.
  - Relabelling unchanged cases can open new round-1 lines.
- **N16: X3's sender history shape misses fields.**
  - D9 claims "the E11 §2.2 list" (`plan.md:53`).
  - It drops the median reply delays (both directions) and "last seen" (`E11-discovery-notes.md:47,50`).
  - The `.strict()` schema blocks E11a from adding them.
- **N17 (plausible): `html` slots lose their text part.**
  - The `htmlBodyText` dependency has no `text` parameter (`stage-08-texts-and-join.md:131`).
  - For `html` slots that also have a text part, the body becomes converted HTML.
  - The pipeline reads the text part first (`mail/imap/mapper.ts:84-86`), so the eval input differs from production.
- **N18: X1 is only partly covered.**
  - `info` mail from a `newsletter` persona (allowed by stage 06 rule 2) gets no `List-Unsubscribe` header (rule 7, `stage-06:178`).
  - X1 says "newsletter and marketing mail".
- **N19 (plausible): stage 01 changes behaviour on the pilot mailbox.**
  - After C2, `ACTIONS_SCOPE` or `TRIAGE_LLM_SCOPE=synthetic` on the VPS starts to act on AgentMail mail in the pilot mailbox.
  - C2 does not name this change.

## Steps a Sonnet worker cannot do without guessing
- **N20:** `category_named` (`stage-08:81`) does not say substring or word match. `info` matches inside "information". The check also blocks typical injection text ("mark as spam") and real bounce subjects ("Delivery Status Notification").
- **N21:** The version rule "`<v>.1` (or `+0.1`)" (`stage-10:72`) turns 1.1 into "1.1.1", which fails the manifest regex.
- **N22:** `createTwoTenants` (`stage-03:79`) is a private function in `apps/server/test/integration/actions-repo.test.ts:62`, not a shared helper.
- **N23 (proven):** `/usr/bin/time` (`stage-18:15`) does not exist on this machine. `ls` gives "No such file or directory".
- **N24 (proven):** The id-leak grep `[a-z]\{3\}` (`stage-18:23`) misses hard-case ids with 2- or 4-char short names (`stage-06:104`).
- **N25 (plausible):** The check wants ≥ 8 distinct signatures per language (`stage-08:83`). The stage 14 persona list (`stage-14:17`) does not say how to reach 8 English signatures. A shortfall fails `sim check`, and then `freeze`.
- **N26 (plausible):** `hasPhoneNumber` flags 9 or more digits (`testmail/batch.ts:124-126`). It trips account numbers planted by `reply_inj_insert_link` and timestamps in system mail.

## Facts and sources
- **N27 (proven):** `plan.md:3` says "cold review 1 filed in plan-review-1.md and applied". No such file exists, and § Cold review (`:249`) is empty.
- **N28:** X3 drops "one holdout run per own-model candidate" (`E11-discovery-notes.md:124`). D26 refuses a model with no price (`plan.md:70`). Name this seam for E11b.
- **N29:** `E02-quality-lab.md:146` ("The week also checks the PD-044 send limits") is not assigned to an owner, probably E2b.
- **N30:** `spec/build.md:22` still says "needs plan". Board drift; reported, not edited.

Checked and correct:
- Facts F2, F3, F6, F8, F9, F11, F12, F14 match the code at HEAD.
- I recomputed F4, F5 and F15 and they match: 189/189 → 0.98008; 188/188 → 0.97998; 279/280 → 0.98005; mulberry32(97) → 0.565584, 0.2195, 0.833951.
- The interfaces the stages cite match HEAD: `mailKindFilter`, the callback prefixes, `recordFeedback`, `listUnlabeled`, `runEval`/`CaseResult`, `goNoGo`/`THRESHOLDS`/`barCategories`, `LlmCall`, `renderSeedMessage`, `bodyTextFromSource`, `CommandDeps`, `isFeatureOn`, `localToInstant`, the module layers.

## Stage size
- **N31 (plausible):** Stages 06, 08, 12 and 13 are each larger than one 90-minute job. Stage 06 has 27 hard-case rules plus 13 planner rules plus history. Stage 08 has 3 schemas, `detectLang`, 18 check codes, spread checks and the join. Stage 12 has metrics, 5 report sections, the gate file and the gap command. Stage 13 has 3 layers. Splitting each into two jobs is safer.

## X1–X7 and leaks
- **X1–X7 are all in the stages:**
  - X1: D16, stage 06 rule 7 and the hard-case tags (partly; see N18).
  - X2: stage 08 schema, stage 13 rubric, the stage 06 reply-injection tags.
  - X3: stage 06 rule 11 and stage 07 step 3 (see N16).
  - X4: stage 07 rule 4.
  - X5: scoped out.
  - X6: stage 12 `metrics.ts`.
  - X7: stage 12 gate file (see N2).
- **No stage puts mail text, a prompt or a key into logs or state.**
  - State lines, the ledger, issue details and `realCounts` hold codes and counts only. The judge schema has no free text. Missing keys are reported by name only.
  - Mail text goes only to the `audit/` markdown (made-up mail).
  - Telegram shows only the AI summary.

## Checks run
- `git rev-parse HEAD` → f050760…, which matches the candidate. Saved to `/tmp/f097-review/head.txt`.
- `bun install --frozen-lockfile` → exit 0.
- Zod 4.6.7 probe → `z.partialRecord` exists; `z.iso.date()` refuses "2027-02-30"; `z.record(z.enum)` requires every key.
- Python: Wilson bounds, mulberry32(97), the stage 11 test 4 budget simulation and the weekday checks all recomputed as reported above.
- `ls /usr/bin/time` → missing.
- No lint, typecheck, unit or integration suite ran (U2).

## Note check
- HEAD is the candidate: proven. `git rev-parse HEAD > /tmp/f097-review/head.txt && grep -q f05076050dce68404b7e2388c5226a255a13ee18 /tmp/f097-review/head.txt && cat /tmp/f097-review/head.txt` exited 0; the file is `/tmp/f097-review/head.txt`. The first-call evidence in the note did not count, because that call used `;` and exited 1.
- Each finding quotes file:line with a label: proven. The findings are in `/tmp/f097-review/review.md`, sections Blocking through Facts. A few notes cite only a stage or step, with no line number (N13 "stage 08 step 3", N19 "C2"); that is a minor gap in the quote rule.
- The review covers the asked angles: proven. `/tmp/f097-review/review.md` has 10 `##` sections: blocking, unverified, pre-mortem, conflicts, gaps, worker guesses, facts and interfaces, stage size, X1–X7 and leaks, checks. The `&&` check chain on that file exited 0 and counted the sections.
- First line `FAIL <sha>`, and the message ends with the verdict and counts: proven for the review file. In `/tmp/f097-review/review.md`, `head -1` matched `^FAIL f0507…$` and `tail -1` matched "2 blocking findings, 31 notes" in the same exit-0 chain. In this message the Note check section comes after the verdict line, so the verdict line is no longer last.
- Easy-to-miss rule ("Blocking is only a proven break of an acceptance bullet. PLAUSIBLE is never blocking"): followed. B1 cites `ticket.md:27` and B2 cites `ticket.md:28`, both proven from code or stage text (`/tmp/f097-review/review.md`, checked by grep in the same chain). Every plausible finding is a note. B1 depends on the `.env` value of `OPENAI_RPM`, which is unverified (U1). The rate limiter and the stage 18 proof command make it a gap between acceptance and proof, so it stays blocking; the coordinator may weigh U1.

Verdict: FAIL — 2 blocking findings, 31 notes (N1–N31).
