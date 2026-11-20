FAIL 925c5a4f9d1a64b80c8a1491930257ca894e84ec

Cold review of the F122 plan (an owner gets a writing style suggested from their own sent mail), at `spec/features/planned/F122-e6b-style-from-sent/`. HEAD matches the candidate. I ran no suite, lint or typecheck. I only used read, grep, git and ls. "Proven by reading" below means I quote the code at HEAD. I did not execute anything.

## Blocking

**B1. The contract step breaks the code of the previous release.** Proven by reading.
- What the plan says: D13 (`plan.md:36`) says that after stage 04 "no code reads or writes the column". But stage 04 keeps the export map entry (`stage-04-style-text-stop.md:19`: "The DSR address map, the export map and `schema.ts` keep the column until stage 05").
- Why that is a read: the export map lists `style_text` as an exported column of `organizations` (`apps/server/src/modules/privacy/export-map/tables-n-s.ts:47-52`). The exporter selects every listed column (`apps/server/src/modules/privacy/export.ts:59`).
- The stage 05 release migrates before the swap (F8). `deploy/rollback.sh:3` says "The schema stays: no migration step". So an organization export fails on the missing column in two cases: in the swap window, and after a rollback to the stage-04 release.
- The repo rule says "A release's migration must work with the code of the previous release" (`apps/server/src/scripts/lib/check-migrations-rules.ts:3`).
- Fix: stage 04 moves `style_text` out of the exported columns, for example with `byOrgExcluding` and a reason. The column then stays classified but is never selected. Stage 04 then needs one test: the organization export holds no `style_text` while the column still exists.

**B2. The checks of stages 04 and 05 cannot hold with the tests that exist or that the plan adds.** Proven by reading.
- Stage 04 test 5 (`stage-04:25`) says the `rg` scan "finds only the test that asserts the 400". Two tests contradict that:
  - Stage 04's own copy-migration tests (`stage-04:12-14`) must seed `organizations.style_text`.
  - The F115 schema test seeds it too (`apps/server/test/integration/reply-drafts-schema.test.ts:374-375`). That file is neither under `privacy/` nor `schema.ts`.
- Stage 05 drops the column. `reply-drafts-schema.test.ts` tests 13 and 14 run the Down part and then the Up part of `20261117130001_reply_drafts.sql` (lines 30-33, 390-391). That Up part selects `o.style_text` (`db/migrations/20261117130001_reply_drafts.sql:78`), so both tests fail after the drop. The stage 04 copy test then fails the same way.
- Stage 05 (`stage-05:20-21`) has no decision on what happens to tests of applied migrations that name the column. Should they be deleted, or narrowed to run only up to the drop? A Sonnet worker would have to guess, and `check:job` runs the full suites there.
- Fix: write that decision into stage 05. Widen the stage 04 `rg` exception to list the migration tests by name.

## Unverified

- Runtime proof of B1 (an export after the drop under stage-04 code) and of B2 (tests 13 and 14 after the drop). I did not run them, because the job rules forbid suites.

## Notes

**Pre-mortem: which stage let a bug reach the user.**

**N1. The suggestion learns the assistant's own drafts.** Stage 02 (D3) lets this through. Gap proven by reading; user impact plausible.
- A reply draft that the user sends by hand is an `origin = user` row that keeps its action id (`docs/capabilities/sent-mail.md:17`). D3 (`plan.md:26`) does not exclude `action_id IS NOT NULL`.
- With `reply_drafts` on, the samples then contain the skeleton drafts ("Regarding <topic>: …", the code signature). The suggested style then describes the drafter, not the user. This also touches the ticket's out-of-scope line "Learning from draft edits" (`ticket.md:21`).
- Needs a decision: exclude rows with an action id, or keep them on purpose. Add a test for it.

**N2. Forwards and Outlook/OWA quotes are not cut.** Stage 01 lets this through. Plausible.
- The cut finds a `From:`/`Od:` header block only "after a blank line" (`stage-01:10`, test 4).
- Gmail forwards ("---------- Forwarded message ---------" or "Wiadomość przekazana") and Outlook/OWA replies ("________________________________" then `From:`) put a separator line before that block. Third-party text then goes into the samples and to the LLM. ADR 0029 decision 7 says "quotes cut".
- Add the forward and separator forms to the cut list, with tests.

**N3. The $1.00 cap of stage 08 has no headroom.** Plausible as an outcome. The cap mechanism is proven by reading.
- The estimates add up to exactly $1.00 (`stage-08:13-18`): 0.03 + 0.01 + 0.01 + 0.07 + 0.44 + 0.44.
- The A run with `judge-v4` will likely cost at least the judge-v3 figure of $0.4329 (F7, N2). So the rule "stop when the next estimate takes the total above $1.00" (`stage-08:9`) likely stops before run 6. Then no gate file exists, and ticket acceptance (`ticket.md:30`) is not met. The plan has no outcome path for "stopped without a verdict".
- Each `--budget-usd 0.50` is a cap per invocation: `runCap` uses `requested` and the month spend only (`apps/server/src/scripts/lib/eval-drafter.ts:237-243`, `platform/eval-ledger.ts:59-61`). So the rule "resumes with the same command" (`stage-08:21`) allows another $0.50 on each resume. Nothing enforces the $1.00 total.
- Fix:
  - Pass `--budget-usd` as `1.00` minus the spend so far for runs 5 and 6, and for any resume.
  - Shrink smoke run 4.
  - Name the verdict for a stage that the budget stopped.

**N4. The facts bars of the gate are within run-to-run noise.** Plausible. The figures come from the committed holdout report: send as is is 242/255 = 0.949.
- The binomial SD of the A − B difference is about 0.02. So "send as is ≥ A − 0.02" (`stage-07:29`) fails with no real effect about 15 % of the time, minus whatever the pairing removes.
- No A-versus-A noise run exists.
- Fix: use a paired flip count (for example McNemar-style on send as is), or a tolerance taken from noise.
- The gain bar itself is sound. I checked the Wilson lower bounds 0.5981 and 0.3866 (`stage-07:31-32`). n = 20 needs 15 wins.

**N5. Undefined case: designed skips in the missing-pairs count.** The baseline has 3 language skips and 2 `needs_facts` no-drafts per run. Their union across A and B is near the 5 % `too_many_errors` line (`stage-07:29`). Test 6 covers judge errors only. Decide whether skips count as missing.

**N6. A cheap stop rule is missing.** `drafter-v4` drafts are skeletons (P4, F4). The plan's own risk N1 already expects few style differences. Run 4 stops only on judge errors or a constant `style_match` (`stage-08:21`). If the A and B dev drafts are almost identical, $0.88 goes to confirm a fail. Add a stop rule on the share of drafts that differ.

**Privacy of real Sent text.**
- Consistent with ADR 0029 decisions 6 and 7: the switch is the consent, and the tap triggers the one call.
- Stage 02 rewrites the stale `sent-mail.md` rule 13 line "goes to no LLM … must add the consent text and its version first" (`docs/capabilities/sent-mail.md:26`). That rewrite is correct, but the plan should cite the ADR as its source.
- N7 (plausible): the `name` check takes tokens only from recipients and from the word after a greeting (`interfaces.md:10`). A third-party name elsewhere in the body, a company name, or a Polish inflected form (greeting "Panie Marku", output "Marek") passes. The saved text is then trusted by `allowedOf` (F9). Today only the owner's read before Save stops this.
- N8: an organization can have several owners (`docs/capabilities/tenancy-and-plans.md:14`). An owner can then make a suggestion from another person's mailbox. "Their own sent mail" (`ticket.md:9`) is not enforced. This is a product decision to record.
- N9: the button note "Only the text you save is kept" (`stage-03:13`) does not say that the mail goes to the AI provider.

**Rule conflicts.**
- N10: the rule that a prompt change commits its gate file before the merge (`docs/code-patterns.md:257` and the styleguide) conflicts with stage 01. Stage 01 lands the new role and `stylist-v1`, and stage 08 may add `stylist-v2` with no gate file before it lands. The owner's board line allows the gate to come last (`spec/build.md:36`), but the plan does not name the exception. A stage 01 reviewer could FAIL it. Name the exception in P3.
- N11: two rules make the outcomes inconsistent:
  - Schema and check: `stylistOutputSchema` caps the answer at 1–1,000 code points (`interfaces.md:12`). So the `too_long` check code (`interfaces.md:13`) is unreachable in the server. A long answer becomes `output` instead, and D7 says no retry for a schema failure.
  - Limit and audit rows: D9 counts audit rows. Outcomes with no call (`too_few`, `sent_off`, `failed` / `llm_off`) write rows (`interfaces.md:33`), so they use up the 3 runs a day. That conflicts with the `too_few` text "Try again after you send more mail" (`stage-03:16`).
  - Decide both.

**Steps a Sonnet worker would have to guess.**
- N12: stage 02 test 4 says a row "to a test address → present" (`stage-02:15`). The open-loop rule it reuses matches the synthetic message-id marker or `from_address` in test senders, not the recipients (`apps/server/src/modules/loops/analysis-repo.ts:82-90`).
- N13: stage 02 says "wired like `createStylePreview` (same `realMail` and scope inputs)" (`stage-02:19`). The preview has no scope input (`apps/server/src/modules/replies/preview.ts:26-37`), and its `realMail` is the drafter role's (`apps/server/src/start/triage.ts:157`). Name the stylist role's provider.
- N14: stage 06 says to apply D3 "through the same core functions; no copy" (`stage-06:10`). D3 lives in the SQL reader `listStyleSources` (`interfaces.md:24`), and the sim blind files lack `origin`, `list_id` and `auto_submitted`. Say which filters the eval applies.
- N15: no stage owns the split of `apps/server/src/scripts/lib/eval-drafter.ts` (458 lines; "split before you add", `plan.md:68`). The split method requires the history merge and no rebase. Stages 06 and 07 may run in parallel and both touch the eval. Assign the split to one stage, probably 07, or to a stage before both.
- N16: stage 02 route tests (`stage-02:37-41`) lack 401 and 400. `docs/code-patterns.md:265` requires both. No decision says whether the `{}` body is strict.
- N17: in the gate file name `stylist-<promptVersion>-<model>-<effort>` (D15, `stage-07:28`), it is not clear whether `<model>` is the stylist's or the drafter's.

**Unsourced facts.** The stylist cost estimates of $0.03, $0.01 and $0.01 (`stage-08:13-15`) have no measurement. The rest of F1–F9 and the scout facts I checked held, including:
- `ReplyStyleCard` has 385 lines.
- The panel no longer sends `styleText`.
- The sent parts each span 2027-01-25 to 01-31, so the 14-day window holds all of them.

**Stage size.** Every stage is within the word limits. Stage 07 holds three separate deliverables (`--style`, `judge-v4`, the `eval:style-gate` CLI), plus the likely split (N15). It is the one stage I would split, into 07a (`--style` and `judge-v4`) and 07b (the gate CLI). Stage 02 is large but coherent.

## Checks run

- `git rev-parse HEAD && git status --short` → `925c5a4f9d1a64b80c8a1491930257ca894e84ec`, clean tree (matches).
- `git log ead9ec4d3..HEAD` → plan commits only.
- `rg` and reads of the files cited above.
- `wc -l` on `eval-drafter.ts` (458) and `ReplyStyleCard.tsx` (385).
- A date-only grep of `sentAt` in the sent-dev and sent-holdout blind files. I read no mail text.

No tests, lint, typecheck or eval were run.

## Note check

- HEAD is the candidate: proven. `git rev-parse HEAD && git status --short` printed `925c5a4f9d1a64b80c8a1491930257ca894e84ec`.
- Each task topic has a verdict with file:line: proven. This message covers every topic: pre-mortem (N1, N2, N3), gaps (N1, N2, N5, N8), rule conflicts (B1, N10, N11), guess steps (B2, N12–N17), unsourced facts, stage size, privacy (N7–N9), the two-release contract (B1, B2), the gate bars (N4, N5), and the $1 cap (N3).
- Findings checked against repo code or docs: proven. The repo files cited are `apps/server/src/modules/privacy/export.ts`, `apps/server/src/modules/privacy/export-map/tables-n-s.ts`, `apps/server/test/integration/reply-drafts-schema.test.ts`, `apps/server/src/modules/loops/analysis-repo.ts`, `apps/server/src/scripts/lib/eval-drafter.ts`, `docs/capabilities/sent-mail.md` and `apps/server/src/modules/replies/preview.ts`.
- Easy-to-miss rule (missing code detail is not a finding): followed. Every finding names a missing decision, edge case, test or interface. None asks for line numbers, edit text or file lists.
- Easy-to-miss rule 2 (run no suite, lint or typecheck): followed. I ran only `git`, `rg`/`grep`, `ls`, `wc`, `sed` and one date-only `python3 -I` read. No `bun` command ran.
- Reminder, tests once per job and no `test:*` runs: followed. No `bun test` or `test:*` command ran.
- Reminder, `check:job` for a product-code job: not applicable. This review commits no code.
- Reminder, a review runs no suite, lint or typecheck: followed, as above.
- Reminder, never delete `node_modules/.cache/`: followed. Nothing was deleted.
