# F097 · E2a Offline lab — plan

> **Status 2026-11-14 — planned.** 22 stages written; cold review 1 (FAIL, 2 blocking, 31 notes) filed in [plan-review-1.md](plan-review-1.md) and applied (§ Cold review). Nothing built yet. The build waits for F095 (E1) in `spec/features/done/`. Plan base: `54b715b`, refreshed 2026-11-14 ([plan-refresh-1.md](plan-refresh-1.md); first base `9d9bfb8`).

Sources: `docs/product/stage-2/epics/E02-quality-lab.md` (epic page, "Discovery" section), `docs/product/stage-2/epics/E02-discovery-notes.md` (design sketch §2, cross-epic §3), `docs/product/stage-2/decisions.md` (PD-013–PD-028, PD-030, PD-032, PD-057, PD-058, PD-061, PD-063), ADR 0021 (simulator stack, E2b), ADR 0028 (autonomy evidence), the cross-epic sections of `docs/product/stage-2/05-execution-plan.md` § 2.5. Old tickets absorbed: `spec/features/dropped/2026-11/F028-telegram-review-command/`, `F057-testmail-mail-kind/`, `F065-testmail-delegation-label/`.

## Input

### Owner words (word for word)

- Epic idea: "create more synthetic emails that will mock behaviors" (`E02-quality-lab.md` header).
- E2 discovery decisions: "Looks like a good plan, so yes, go with defaults." (`decisions.md` PD-013).
- PD-030 (E4 decision 15): "we can't rely on users to confirm any values there, whether this is 30 or 10 or even 1 … system should also work properly based on the global assumptions … those 10 corrections or checks are fine but they should be optional or suggested but definitely not mandatory. So it can't block the system."
- Planner job rules (2026-11-13, `task.md` of this job): "no owner checkpoints for confirmation; list an owner step only for what needs the owner's hands (VPS, real secrets, real money); small questions get a default in questions.md."

### Product decisions (from `decisions.md`; do not reopen)

- **P1 (PD-013)** E2 splits. This ticket is **E2a Offline lab**: scenario, corpora, `eval --sim`, report, draft judge, model gate, real labels. E2b (F113) builds the sim stack, injector, delegate bots, scripted executive, week scorer and demo.
- **P2 (PD-014)** Label first: the ground truth comes from the planned slot; Claude Sonnet writes the text in agent sessions; Claude Haiku labels blind; the owner audits 30 random + up to 20 contested cases per corpus version. The classifier family (OpenAI, Gemini) differs from the generator family (Claude).
- **P3 (PD-015)** Two frozen corpora in git: a category bank of 250 per value category (50 dev + 200 holdout) plus the hard cases, and a realistic week (150 mails per weekday, 40 per weekend day). Prompt tuning never opens the holdout.
- **P4 (PD-016)** Languages: week 70 % Polish / 30 % English; bank 60 / 40; a few German mails as hard cases.
- **P5 (PD-017)** Urgency context: one profile per scenario executive (VIP people as VIP sender rules, topics, deadlines); each `urgent` case carries its source (`text`, `vip`, `context`); the report gives urgent recall per source. E2a defines the shape; E3 owns the prompt; E4 owns the editor.
- **P6 (PD-018 as changed by PD-030)** F028 (`/review`) and F057 (test mail kind) are in E2a so real labels start early. Real labels measure and can block; they never unlock `auto`. Global evidence = the E2a holdout per prompt and model version (ADR 0028).
- **P7 (PD-019)** No Enron. A sim-vs-real gap check on `notification` and `spam` replaces it.
- **P8 (PD-023)** Budget caps, the runner stops: $1 per offline run, $20 per month (the $5 live week cap is E2b).
- **P9 (PD-024)** Sim gate: at least 200 holdout cases per category; the report shows the Wilson 95 % lower bound; ADR 0028 point 1 reads it as "Wilson 95 % lower bound against the bar".
- **P10 (PD-025)** Model-upgrade gate: a release-checklist step (E8 builds the checklist) and a rule for every ticket that changes a prompt or model; the holdout report goes to `evals/results/`. No LLM key in GitHub CI.
- **P11 (PD-026)** Draft judge: code checks plus a rubric from another model family than the drafter (Gemini judges OpenAI drafts). It scores delegation drafts now; E6 reuses it.
- **P12 (PD-028)** Hard-case list adds auto-replies and bounces, calendar invites, CC-only and list mail, a thread the executive already answered, German mail.
- **P13 (PD-032, PD-058)** Telegram `/review` stays in E2a. The random part of `/review` gives E3 the unbiased M1 estimate; the `\Answered` part is E3a's.
- **P14 (PD-057, PD-063)** The corpora plant phishing cases that try an urgent push, a delegation and an unsubscribe.

### Cross-epic inputs (§ 2.5 of `05-execution-plan.md`; built into this plan)

- **X1 (E4 notes §5)** Newsletter and marketing mail carries `List-Unsubscribe` headers. → D16.
- **X2 (E6 notes §5, §3.11)** `needs_reply` cases carry `expected_points` and `must_not`; the judge rubric has the reply items; the reply injection set joins the hard cases. → D15, D17, D30.
- **X3 (E11 notes §5)** Bank cases carry the sender profile (E11 §2.2 shape) from the persona story; the week starts with a 30-day prior history (counts and flags, no text). → D9, D19.
- **X4 (E2 notes §3)** The week plants threads the executive started (Sent side) for E5. → D19.
- **X5 (E5 notes §6)** The sent-mail bank is E5b's work with these tools, not an E2a deliverable. → out of scope; D7 keeps the planner generic.
- **X6 (E3 notes §5, E3 page "Input from the E3 discovery")** E3b tunes only on the dev set; one metric module in `packages/core` is E3a's (E2b's week scorer calls it). → D23 puts the Wilson function in `packages/core/src/triage/metrics.ts` for E3a to reuse.
- **X7 (E4 notes §5, ADR 0028)** The holdout result is stored per prompt and model version. → D27 (JSON gate file).

### Design decisions

- **D1 Test mail by sender (F057).** A new config key `TEST_SENDER_ADDRESSES` (comma list, empty default) names the test senders (today the AgentMail inbox). `mailKindFilter(kind, testSenders)` treats a row as test mail when its Message-ID is synthetic **or** its `from_address` (lower case) is in the list; real mail is the rest. The actions scope check does the same. Retroactive by design: old AgentMail feedback leaves the real labels at once. Two callers keep a fixed choice (refresh 1, default Q11): the backfill re-queue `requeueTooOld` keeps today's SQL (`NO_TEST_SENDERS`); the cost report `listUsageSince` uses the rule. Rejected: a header check (needs stored headers, a migration); an `emails.test_mail` column (migration + backfill + a change of the sync write path for one list of addresses).
- **D2 `delegation` in testmail batches (F065).** A batch gets `delegatesActive: boolean` (default `false`). With it, `expected.category` and the blind label may be `delegation`; without it `delegation` is a validation issue. `compare` scores `delegation` like any category.
- **D3 Feedback source `review`.** Labels from `/review` get `triage_feedback.source = 'review'` (one migration that widens the CHECK list; the CHECK change is expand-only). E3's M1 must tell the random review labels from digest taps (P13). Rejected: the same `telegram` source plus an audit row with the shown ids (two joins for every M1 query).
- **D4 `/review` page.** `/review` lists up to 10 unlabelled triaged **real** mails (D1 filter) of the last 30 days of the chat's digest mailboxes, in a seeded random order: `ORDER BY md5(email_id::text || seed)`, seed = `<chat id>:<now ISO>` from the handler (each press gives a new sample; a fixed `now` in tests gives a fixed order). Each line has ✅ (when the category is a label category) and ✏️; the buttons use the review callback kinds (D5). An empty list answers "Nothing to review: every recent mail has a label." Default, owner to confirm (Q2): random only, no "thin categories first" (the old F028 idea), because P13 needs an unbiased sample.
- **D5 Review callbacks.** Four new callback kinds with their own prefixes: `review_right` `vr:`, `review_pick` `vc:`, `review_edit` `ve:`, `review_cancel` `vx:`. They behave like `right`, `pick`, `edit`, `cancel` and record `source: "review"`. Their categories are `reviewLabelCategories` = the five label categories plus `delegation` (code `d`), so a delegation mail can leave the sample. Old digest buttons stay as they are.
- **D6 Flag `review_command`.** `/review` is a new user-visible behaviour: flag `review_command` in `packages/core/src/features.ts` (epic `E2a`, remove-by `2027-03-01`, default off). With the flag off the command answers "This command is not on for your account." The command is in `BOT_COMMANDS` and `/help` for everyone (one bot command list per bot). The coordinator turns it on for the pilot after the deploy (C3).
- **D7 One scenario, generic planner.** One scenario `lab-01` (a Polish company with English clients and partners). The planner is a pure function of the scenario and a plan spec (counts, mixes, seed), so E5b can plan a Sent bank with the same code later.
- **D8 Urgency profile shape.** `packages/core/src/triage/urgency-profile.ts`: `{ topics: { label, keywords[] }[] (≤ 20), deadlines: { label, due: YYYY-MM-DD }[] (≤ 20) }`, labels ≤ 80 chars, keywords ≤ 40 chars and ≤ 10 per topic. VIP people are **not** in this object: they are sender rules of kind `vip` (P5). This is the one shape E3b stores and E4-B edits.
- **D9 Sender history shape.** `packages/core/src/triage/sender-history.ts`: counts and flags only, the E11 §2.2 list: `{ days, received, byCategory, corrections, movedBack, answered, flagged, unseen7d, userMailsTo, lastUserMailDaysAgo, delegationsTo, bulkSignals[], firstSeenDaysAgo, lastSeenDaysAgo, medianUserReplyHours, medianTheirReplyHours, relation }`. `relation` comes from code in E11's order (`delegate`, `vip`, `bulk`, `known`, `new`) by `relationOf(...)`. No text field exists in the type.
- **D10 Seeded planner.** PRNG `mulberry32(seed)` in `packages/core/src/sim/random.ts`. Same scenario + same plan spec + same seed → byte-identical slot files. No `Math.random()` and no `Date.now()` in `packages/core/src/sim/`.
- **D11 Slot = ground truth sidecar.** A slot holds the label and every planned fact (category, urgency source, hard-case tags, expected delegate, expected draft, delegate behaviour, style knobs, headers, attachments, sender history, a one-line `brief` for the writer). The text file holds only what a mail holds. The writer may not change a slot.
- **D12 Corpus layout.** `evals/sim/lab-01/` holds `scenario.json`, `plan-spec.json`, `manifest.json`, `audit/`, and three parts `dev/`, `holdout/`, `week/`; each part has `slots/batch-NNN.json` (25 slots), `texts/batch-NNN.json`, `blind/batch-NNN.json`, `labels/batch-NNN.json`; `week/` also has `history.json`. Prompt tuning reads only `dev/` (P3).
- **D13 Bank sizes.** Per value category (`urgent`, `needs_reply`, `delegation`, `info`, `notification`, `spam`): 263 slots, 53 dev + 210 holdout (split by seeded shuffle); the 5 % over P3's 50 + 200 lets drops (D34) keep the floor. Hard cases come on top: 10 slots per hard-case tag (3 dev + 7 holdout); the 8 reply-injection tags have 5 slots each (2 dev + 3 holdout). Bank total 1,808 (dev 391, holdout 1,417). Default, owner to confirm (Q4).
- **D14 Languages and style knobs.** Bank 60 % `pl` / 40 % `en`; week 70 / 30; German only in the `german` hard case. The planner sets per slot: length bucket (`short` ≤ 60 words, `medium` 60–180, `long` 180–400; 30/50/20 %), format (`plain` 85 %, `html` 15 %; `html_only` hard case 100 %), signature (70 % yes), greeting (`formal`, `informal`, `none`). The code checks (D18) hold the writer to them.
- **D15 Hard-case tags.** A registry `hardCaseTags` in `packages/core/src/sim/hard-cases.ts`; each tag fixes its allowed categories, its language, the case kind (`synthetic` or `injection`) and the facts the planner adds. Tags: `injection`, `vip_looks_like_spam`, `urgent_no_keyword`, `delegation_missing_data`, `forwarded_in_thread`, `polish_diacritics`, `html_only`, `attachments`, `reply_needed_thread`, `auto_reply`, `bounce`, `calendar_invite`, `cc_only`, `list_mail`, `already_answered`, `german`, `phishing_urgent_push`, `phishing_delegation`, `phishing_unsubscribe`, and the reply-injection set of E6 §3.11: `reply_inj_hidden_data`, `reply_inj_blank_lines`, `reply_inj_insert_link`, `reply_inj_other_address`, `reply_inj_ignore_rules`, `reply_inj_fake_agreement`, `reply_inj_header_line`, `reply_inj_internal_note` (category `needs_reply`, kind `injection`). The table with each tag's rule is in stage 06; stage 07 rule 10 says how a hard slot gets its base facts.
- **D16 Headers.** Slots carry `headers`: newsletter and marketing slots (`notification` from a `newsletter` persona, `spam` from a `marketing` persona, `list_mail`, `phishing_unsubscribe`) get `List-Unsubscribe` and `List-Id`; `auto_reply` gets `Auto-Submitted: auto-replied`; `bounce` comes from `mailer-daemon@<domain>.test`. The offline classifier does not read headers today; E3a header capture and the E2b injector do.
- **D17 Writer-filled fields.** For `needs_reply` slots the writer adds `expectedPoints` (1–5 short lines: what the reply must answer) and `mustNot` (0–3 lines: decisions the reply may not make). For injection slots the writer adds `planted` (the exact strings the attack tries to get into a draft, 1–3). These three come from the writer because they depend on the text; the owner audit covers them.
- **D18 Code checks of a written case.** `checkCase(slot, text, scenario)` in `packages/core/src/sim/checks.ts` returns issue codes (never text): reserved hosts and no phone numbers (reuse the `testmail/batch.ts` rules by exporting them), language by `detectLang` (stopwords + Polish diacritics), length bucket, HTML present iff format `html`, signature present iff planned (the persona's signature line), no urgent keyword in `urgent_no_keyword` (list `pilne, pilnie, natychmiast, asap, urgent, urgently, immediately, dringend`), diacritics in `polish_diacritics`, attachment names in the text for `attachments`, `planted` strings present in the body for injection slots, `expectedPoints` for every `needs_reply`. No check for label words in the text (real mail says "notification" or "urgent" too; the blind checker and the audit catch a mail that leans on one). `html` slots carry both a text part and HTML; `html_only` slots carry HTML only. Corpus-level spread checks (D25) run on the whole part; `checkBatch` flags two mails of one batch with the same opening.
- **D19 Week plan.** 7 days from `calendar.weekStart` (a Monday, Europe/Warsaw, a week without a DST change). 150 mails per weekday, 40 per weekend day (830). Mix: notification 35 %, spam/marketing 20 %, info 20 %, needs_reply 13 %, delegation 7 %, urgent 5 % (largest-remainder rounding per day). Threads over days (30 % of person mail is a reply in a thread; thread depth ≤ 5). Delegation slots get a `delegateBehaviour` for E2b (`done` 40 %, `late` 20 %, `out_of_office` 15 %, `other_address` 10 %, `silent` 15 %). 3 executive-started threads per weekday (`direction: "sent"`, X4) with a planned reply or no reply. `week/history.json`: a 30-day prior history per sender in the D9 shape (X3). Hours: weekdays 07:00–20:00 local with 5 % outside; weekends spread.
- **D20 Eval case extension.** `evalCaseSchema` gets optional `receivedAt` (ISO), optional `receivedAt` on thread items, `lang` gains `de`, and one optional `sim` object: `{ corpus, version, part, slotId, urgencySource?, hardCases[], senderHistory?, urgencyProfile?, headers?, attachments?, expectedPoints?, mustNot?, planted? }`. `toClassifierInput` uses `receivedAt` when set, else `EVAL_RECEIVED_AT`. The 108 old cases parse and produce the same classifier input (test).
- **D21 HTML text like the pipeline.** A case's `body` for the classifier is what triage would see: the text part when it exists (an `html` slot has one); for an `html_only` slot, render the mail with `renderSeedMessage` and read it back with `bodyTextFromSource` (the IMAP mapper, `html-to-text`). The core join takes this as a function parameter; the script passes the mail module's one. A week reply's `thread` comes from its parent slots and texts.
- **D22 Worker pool.** `runEval` gets `concurrency` (old CLI default 1, `--sim` default 8). Results go to the report in input order, never in finish order. "3 errors in a row" counts in finish order. The state file stays append-only, one JSON line per result, no text.
- **D23 Wilson interval.** `wilsonInterval(successes, n, z = 1.959964)` → `{ lower, upper }` in `packages/core/src/triage/metrics.ts`; `n = 0` gives `{ lower: 0, upper: 1 }`. E3a reuses it (X6).
- **D24 Sim gate rule.** `simGoNoGo(predictions, { bar = 0.98, minSupport = 200, minKept = 30 })` per bar category: support < 200 → `no-go: too few`; else the lowest threshold of `THRESHOLDS` with `kept ≥ minKept` and Wilson lower bound of precision (`tp` of `kept`) ≥ bar → `go`; else `no-go`. Fact F4: with 200 holdout cases this needs ≥ 189 kept rows and zero false positives.
- **D25 Corpus spread checks.** Per part: each length bucket within ±10 points of its plan share; HTML share within ±5 points; per language share within ±3 points. Output: counts only. Signature diversity equals the persona count and is not checked.
- **D26 Budget.** Cost of a call = `costPerMail(model, tokensIn, tokensOut, at)` (the existing price table). The runner refuses to start when a model of the run has no price. It starts a new call only while `spent + (inFlight + 1) × avgCallCost ≤ cap` (before the first result `avgCallCost` = the price of 2,000 in + 300 out tokens; `spent` includes resumed results), so the run stays under its cap when the estimate holds. Defaults of `--sim`: concurrency 8, rpm 240 (the bare command meets the 10-min exit; the account limit is N1). Run cap = `min(--budget-usd (default 1), 20 − month spend)`. Month spend comes from a ledger file outside git: `$XDG_STATE_HOME/email-assistant/eval-spend.jsonl` (default `~/.local/state/…`), override `--spend-ledger <file>`; one line per run `{ runId, at, usd }`, written when the run ends (also on a stop). A stopped run is "not complete" (exit 2) and resumes from its state file. Default, owner to confirm (Q6).
- **D27 Gate result file.** `eval --sim --part holdout` writes, next to the markdown report, `evals/results/gate/<role>-<promptVersion>-<model>-<effort>-<corpus>-v<version>.json`: corpus id, version, manifest hash, audit status, `provisional` (= audit not done), provider, model, effort, prompt version, date, bar, per bar category `{ support, threshold, kept, precision, wilsonLower, decision }` plus the unthresholded `metrics { tp, fp, fn, support }`, urgent recall per source, injection pass count. No case id, no text. It is written only for a complete holdout run with the default bar 0.98, min-kept 30 and no `--limit` (a gate file never carries a looser bar). E4-B reads it and must not unlock `auto` from a `provisional` file (seam S1).
- **D28 Holdout reports hide ids.** A report of `--part holdout` prints no case id (failed injection ids become a count). Dev and week reports keep ids.
- **D29 Model-upgrade gate rule.** A unit test `apps/server/src/modules/triage/gate-evidence.test.ts` fails when `evals/results/gate/` has no file that starts with `classifier-<prompts.classifier.version>-` (any model, effort and corpus version). The rule text in `docs/code-patterns.md` § Side effects, the styleguide and `evals/README.md`: "A prompt or model change of any role runs `bun run eval --sim lab-01 --part holdout` and commits its report and gate file before the merge." The VPS model check is a line for E8's release checklist (seam; final-message edit for the E8 page).
- **D30 Draft judge.** `apps/server/src/modules/triage/judge.ts` + prompt file `prompts/judge-v1.ts` (role `judge`). Two rubric kinds in one registry: `delegation` (`facts_kept` 0–2, `task_clear` 0–2, `tone_fits` 0–2, `no_invented_promise` yes/no, `injection_ignored` yes/no) and `reply` (`answers_every_question` 0–2, `no_invented_commitment` yes/no, `gaps_marked` yes/no, `form_of_address` 0–2, `language_matches` yes/no, `tone_fits` 0–2, `injection_ignored` yes/no). Code checks first (`draftCodeChecks` in core): recipient = the expected delegate address or the sender (clarification), `textIsClean`, language of the draft = the slot language, length 1–1,500 chars, no `planted` string. Pass = all code checks pass, every yes/no item yes, every 0–2 item ≥ 1. The judge refuses to run when the judge provider equals the classifier provider (P11), exit 1. `eval --sim --judge` judges every case that planned a delegation or clarification draft; only scores go to the state file. E2a calls only `delegation`; `reply` is tested with fakes for E6a.
- **D31 Judge model.** The eval CLI takes `--judge-provider` and `--judge-model`; without them the role table row of `judge` applies. The stage 21 run uses `--judge-provider gemini --judge-model gemini-3.5-flash-lite` (free tier, 12 RPM; the corpus is made-up mail, so the free-tier data terms do not touch real mail). The `--judge` pass is outside the "under 10 min" exit (Gemini free-tier RPM). Default, owner to confirm (Q3).
- **D32 Gap check.** `bun run eval --real … --json <file>` writes counts per category (no text, no ids). `bun run eval --gap --sim-json <gate file> --real-json <file> --out <md>` compares `notification` and `spam` at one operating point on both sides: the final category, no confidence threshold (`computeMetrics`; the sim side from the gate file's `metrics`). Sim precision and recall with Wilson intervals against real; "gap" when the two 95 % precision intervals do not overlap. The real side has its own n (the real-label count); fewer than 30 real labels → "too few real labels" (P9 real-label clause).
- **D33 Blind check isolation.** The checker job (Haiku) reads only `blind/batch-NNN.json` and the checker brief; it writes `labels/batch-NNN.json`. The blind file holds `id`, `from` (display name and address), `to`, `cc`, `subject`, `body`, `thread` (from, subject, body excerpt), attachment names, and no slot field. The checker runs in a worktree that also holds `slots/` and `texts/`, so the isolation is an instruction plus a check: before the land the coordinator greps the job's session log (`.limen/jobs/<id>/session/*.jsonl`, full tool arguments) for reads of `slots/`, `texts/`, `plan-spec.json`, `scenario.json` and the commands `sim brief|reconcile|status` (stage 19). The old testmail checker had no file tools at all (`evals/testmail/README.md:88`); a pi job cannot be started without them. Labels carry a `blindHash`; a rewrite makes only that label stale, so a re-check labels only the rewritten cases.
- **D34 Disagreement rule.** After the blind labels: `label = slot.category` → agree. Else the writer rewrites the text once (`note: "rewritten: <reason>"`) or keeps it with `note: "borderline: <reason>"`. A bank case that disagrees again after the rewrite → `dropped: true` (D13's 5 % margin covers drops; freeze needs ≥ 200 holdout and ≥ 50 dev per category). A week case is never dropped (threads and E2b depend on it): it becomes `borderline:`. Every `borderline:` case is a candidate for the owner's contested list (≤ 20 per version, by id order).
- **D35 Owner audit list.** `bun run sim audit-list lab-01 --version 1` writes `evals/sim/lab-01/audit/v1-list.md` (30 random cases by seed over dev + holdout + week, then ≤ 20 contested) with the mail text, the slot label, the urgency source, the hard-case tags and, for `needs_reply`, the expected points; and `audit/v1-verdicts.json` with one line per case `{ id, verdict: "pending" }`. The owner sets `ok` or `wrong: <category>`; `bun run sim audit-apply` applies a `wrong` verdict to the slot (the owner overrides both agents) and sets the manifest's `audit` to `done` when no `pending` remains.
- **D36 Audit does not stop the build.** The owner audit (O1) runs after stage 20 freezes v1. The build goes on; every report header prints `owner audit: pending` or `done`, and the gate file holds the status. A `wrong` verdict changes slots → the corpus becomes v1.1 (new manifest hash, new gate file name) and the coordinator re-runs the holdout gate run once (O1). Default, owner to confirm (Q1).
- **D38 New files next to big files.** `listReviewSample` goes into a new `apps/server/src/modules/triage/review-repo.ts` (`triage/repo.ts` is 629 lines, F20; F100 does the same with `triage/metrics-repo.ts`). The review picker and the review-kind mapping helpers go into a new `apps/server/src/modules/channels/review-taps.ts`; `callbacks.ts` (393 lines) gets only the dispatch lines. `reviewMessage` stays in `channels/commands.ts` (F100 plan F7 names it there). The worker pool of stage 13 goes into a new `apps/server/src/modules/triage/eval-pool.ts` and the judge pass of stage 16 into a new `triage/eval-judge.ts` (`eval.ts` is 557 lines). `apps/server/src/scripts/eval.ts` (245 lines) grows in stages 01, 13, 14, 15, 16: a stage whose edit would take it past 400 lines moves its mode into its own `scripts/eval-<mode>.ts` (as `eval-sim-load.ts`). `platform/config.ts` (493 lines) gets only the one key of stage 01 and its reader. Default, owner to confirm (Q9).
- **D39 Telegram texts after E7-T1.** When stage 03 or 04 builds and F098 stage 06 or later has landed (`packages/core/src/texts/index.ts` exists), the review texts follow F098 D9 and D18: an entry in a section of `packages/core/src/texts/` with `en` and `pl`, and render functions take `texts: CoreTexts` as the last parameter. Only when F098 stage 11 has landed too (`packages/core/src/texts/bot.ts` exists; it deletes `channels/texts.ts`): the `/review` line goes into `texts.bot.help` (en and pl), `review` into `texts.bot.commands` and its type test against `commandNames`, and stage 04 test 7 checks `texts.bot.help` and `BOT_COMMANDS` instead of `helpText()`. When stages 03–04 land before F098 stages 10–11, F098 must carry the review texts into its registry (an edit of the F098 stages, reported by refresh 1). The English text is the one in the stage file; the Polish text follows the F098 glossary (F098 plan P6) and the stage review job reads it. Before F098 stage 06 lands, the texts stay English inline, as every other Telegram text. Default, owner to confirm (Q10).
- **D37 Writer and checker jobs.** Writer jobs (stage 18) use Claude Sonnet 5.5 (the board's worker model; P2), checker jobs (stage 19) use Claude Haiku 5.5 (`--model claude-haiku-5-5`). A writer job writes the batches named in its spawn text (8 batches = 200 mails); up to 3 writer jobs run at once on disjoint bank ranges; week ranges run one at a time in time order. The writer exports the blind view of its batches; the checker reads only those files.

### Edge cases decided

- **States × events, `/review`:** flag off → refusal text; org suspended → the existing paused text (the command wrapper already does it); no mailbox → "No mailbox."; all labelled → the empty text; a mail labelled by a digest tap after the page was shown → a review tap with the same answer writes nothing (`skipIfSame` ignores the source, `triage/feedback.ts:75-79`; the digest row stays), a different answer writes a `review` row (latest row wins); a `delegation` or `unsure` mail can be labelled on the page (the review picker has `delegation`, D5); a removed member → the chat is unlinked by the existing rules, no command runs; the same answer twice → `skipIfSame` writes nothing.
- **Crash and repeat, eval runner:** the process dies after a call and before the state line → that case runs again on resume (one extra call, inside the cap; accepted). The ledger line is written at the end; a crash loses that run's spend from the month total (accepted: ≤ $1; the report of the resumed run counts the earlier state's usage, D26 counts `spent` from the state file too).
- **Two runs at once:** two runs with the same state file would both append; the CLI takes a lock file `<state>.lock` (`O_EXCL` create, removed at the end; a stale lock older than 6 h may be removed with `--fresh-lock`). Two runs with different state files share only the ledger (append-only; the month total may be under-counted by one running run: accepted).
- **Clocks and time zones:** the planner works in Europe/Warsaw local time through `localToInstant` (core) and writes UTC ISO strings; the chosen week has no DST change (test asserts it). The runner reads `now` only for the report date and the ledger.
- **Secrets and private data:** no mail text, prompt, answer, API key or address from mail data in a log line, a state line, an error text or a test name. The corpus is made-up data on reserved domains (the `evals/README.md` data rule). Real labels never enter git: the real JSON (D32) holds counts only. The judge output in the state is scores only.
- **Tenants:** `listReviewSample` filters `org_id` on every joined table; a mail of another org never shows (test).

## Facts checked

- **F1** The eval runner is sequential: `for (const c of input.cases)` in `apps/server/src/modules/triage/eval.ts` (`runEval`), read 2026-11-14.
- **F2** `mailKindFilter` (`apps/server/src/modules/mail/repo/emails.ts:11`, after the F091 split) filters only on `message_id_header` `ILIKE '%@ea-seed.test>'`; callers: `mail/repo/claims.ts` (2: `claimEmails` ~65, `requeueTooOld` ~171), `mail/repo/lookup.ts` (1: `listThreadContext` ~25), `actions/repo/claims.ts` (1, ~92), `actions/repo/filters.ts` (1: `mailboxFilterExpr`), `triage/repo.ts` (3: ~272, ~322, ~384); the scope check `actions/scope.ts` (`scopeAdmits`, caller `actions/undo.ts:43`) uses `isSyntheticMessageId`; `triage/service.ts:472` passes `syntheticOnly: isSyntheticMessageId(…)` to `listThreadContext`. Read 2026-11-14 at `54b715b`.
- **F3** `triage_feedback.source` has `CHECK (source IN ('cli','telegram','undo','imap_move','web'))` (`db/migrations/20261104000001_triage.sql:49`); `feedbackSources` in `packages/core/src/triage/categories.ts:31`; `packages/core/src/triage/settings.test.ts` tests the list.
- **F4** Wilson 95 % lower bound (planning probe, not committed: the Wilson score formula with z = 1.959964, Bun 1.4.4, 2026-11-14): 200/200 → 0.9812; 199/200 → 0.9722; 190/190 → 0.9802; 185/185 → 0.9797. The smallest n with zero errors and lower bound ≥ 0.98 is 189; with one error it is 280.
- **F5** `mulberry32(97)` gives `0.565584 0.219500 0.833951` for its first three values in Bun 1.4.4 (same probe). Tests may pin these numbers.
- **F6** The role table already has a `judge` row with `LLM_JUDGE_*` keys (F090, `apps/server/src/platform/config.ts`, `.env.example` lines 25–29); `rolesWithoutPrompt` in `modules/triage/prompts/index.ts` says `judge: "E2a"`.
- **F7** Gemini free tier (`notes/2026-11-05-gemini-free-tier-triage.md`): `gemini-3.5-flash-lite` 15 RPM (default `GEMINI_RPM` 12); `gemini-3.8-flash` 5 RPM; free-tier data may be used by Google (so only made-up mail goes there). OpenAI default `OPENAI_RPM` 60 (`.env.example:18`).
- **F8** `llmPrices` (`packages/core/src/triage/cost.ts`) has `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gpt-6-luna`; `gpt-6-luna` classifier cost $0.000143 per mail (`evals/results/2026-11-07-gpt-6-luna-classifier-v2.md`).
- **F9** `bodyTextFromSource` (`apps/server/src/modules/mail/imap/mapper.ts:81`) uses the text part, else `html-to-text` `convert(html, { wordwrap: false })`; `renderSeedMessage` is exported from `mail/index.ts`.
- **F10** The testmail batch schema allows only five categories (`packages/core/src/testmail/batch.ts:3`); the checker agent definitions live outside the repo (`~/.pi/agent/agents/testmail-{writer,checker}.md`).
- **F11** Telegram commands: `commandNames` in `channels/port.ts`, `BOT_COMMANDS` in `channels/telegram/polling.ts`, `helpText()` in `channels/texts.ts`, `runCommand` in `channels/commands.ts`; callback data ≤ 64 bytes (`packages/core/src/digest/message.ts:15`); prefixes in use: `fr fc fe fx fu ap ar as rs ag gw dd` (`packages/core/src/digest/callback.ts`).
- **F12** `listUnlabeled` (`triage/repo.ts:245`) already selects unlabelled latest results per mailbox with `mailKindFilter`.
- **F13** F091 (repo split), F088 (notices as facts) and F030 (picker "Already saved") are done (2026-11-14). `mail/repo.ts` and `actions/repo.ts` are now `repo/` folders behind `repo/index.ts`. F030 changed `pickedText(category, aiCategory, saved)` (defined in `packages/core/src/digest/answers.ts:26`, called at `channels/callbacks.ts:156`). Active tickets that edit files of this plan: F098 (E7-T1) stages 06–12 move every Telegram text into `packages/core/src/texts/` (en and pl) and edit `channels/commands.ts`, `callbacks.ts`, `texts.ts`, `telegram/polling.ts` and `packages/core/src/digest/` (F098 plan D9, D18; stage 11 keys `texts.bot.commands` by the literal command list); F099 stage 12 adds a flag to `packages/core/src/features.ts`. F100 (E3a) builds on the interfaces of stages 01, 03, 04 and 14 of this plan (F100 plan F7) and may add `wilsonInterval` first (F100 plan § Cold review N21, F100 stage 08). Checked 2026-11-14 at `54b715b`.
- **F19** Capability pages exist (`docs/capabilities/`, F095). PD-009 rule (`docs/code-patterns.md` § Capability map, styleguide § Prefer): a change that lands behaviour updates its page in the same change. `apps/server/src/capability-map.test.ts` (in `bun run test:unit`) fails when a page names a backticked repo path that does not exist, a `bun run <script>` that is not in `package.json`, or a missing ADR. Pages this plan touches: `triage.md` (rules 6, 12–15, Entry points, Data, Tests), `actions-and-undo.md` (the `ACTIONS_SCOPE` lines), `digest-and-notices.md` (rule 9 commands, rule 10 callback prefixes, Entry points), `tenancy-and-plans.md` (rule 5 at ~line 31 and Limits at ~line 93: "no flag has a reader", "three flags"), `sync.md` (rule 15, backfill: unchanged by D1).
- **F20** File sizes at `54b715b` against the 400-line rule (`docs/code-patterns.md` § Size and shape): `triage/repo.ts` 629, `channels/callbacks.ts` 393, `channels/commands.ts` 299, `triage/eval.ts` 557, `scripts/eval.ts` 245, `triage/eval-report.ts` 214, `platform/config.ts` 493. New code goes into new files next to `triage/repo.ts`, `channels/callbacks.ts` and `triage/eval.ts` (D38).
- **F21** Tests that list every feature key: `apps/server/test/integration/tenancy-features.test.ts` (`featureStates`, ~line 168), `apps/server/test/integration/web-operator.test.ts` case 4 (one row per flag and organization; "three keys per row" in its title means the keys of each row object), `apps/server/test/integration/org-flag-cli.test.ts` case 1 (`toContain` per key). `features.test.ts` checks only the first three keys.
- **F22** The old eval rule is in three places of `docs/code-patterns.md`: line 75 (§ Add an action type or a draft kind, draft-kind table row 5, `bun run eval` and its go/no-go table; added by F091 stage 04), line 149 (§ Side effects) and line 223 (§ Tests); and in `.agents/limen/styleguide.md:30`.
- **F14** Zod in `packages/core` is `^4.1.12`: `z.partialRecord` exists and `z.iso.date()` refuses `2027-02-30` (planning probe, not committed, 2026-11-14). 2026-11-02, 2026-11-16, 2027-01-11, 2027-01-25 and 2027-03-22 are Mondays; EU DST starts 2027-03-28.
- **F15** Wilson 95 % intervals (planning probe, not committed): 28/30 → [0.7868, 0.9815]; 20/30 → [0.4878, 0.8077]; 200/201 → [0.9724, 0.9991].
- **F17** A Limen job's session log `.limen/jobs/<id>/session/*.jsonl` holds every tool call with its full arguments under `"path"` and `"command"` keys; `tool-calls` holds only a count (checked on the cold-review job, 2026-11-14). Stage 19 uses it.
- **F18** `/usr/bin/time` does not exist on the owner's machine (cold review, 2026-11-14). `createTwoTenants` exists only as private helpers in single test files; `createOrgWithMailbox` is exported from `apps/server/test/integration/fixtures.ts:53`.
- **F16** The digest shows the AI summary, never the body (ADR 0005, `packages/core/src/digest/digest.ts` `DigestItem`); `/review` follows it (vision: Telegram never gets raw mail bodies).

## Not verified

- **N1** OpenAI rate limit of the owner's account for `gpt-6-luna` above 240 RPM. Stage 21 runs with the `--sim` defaults (`--rpm 240 --concurrency 8`); a 429 storm shows as soft errors and retries in the log; the stage records the real run time.
- **N2** That the Limen route serves `claude-haiku-5-5` through `pi-claude-bridge`. Stage 19's first job proves it (its job header shows the model); fallback: the coordinator runs the checker with `claude-sonnet-5-5` in a fresh job (still blind) and the labels file names that model, and the final message says so.
- **N3** That `OPENAI_API_KEY` and `GEMINI_API_KEY` are set in the main checkout's `.env` (the prepare script copies it). Stage 21 checks by the CLI's own key check (prints the key **name** only). Missing key → owner step O2.
- **N4** That a Sonnet writer job writes 200 mails in one 90-min job. Stage 18's first job measures it; the coordinator shrinks the batch range when a job times out.
- **N5** Judge agreement with a human reader. Not measured in E2a; the E6 second pass (trigger "judge exists and the E6a prototype ran") reads the first judge results.

## Done when

1. `bun run eval --sim lab-01 --part holdout` (no `--judge`, `--sim` defaults) prints the full report in under 10 min, with per-category precision and recall, false-negative rate on `urgent` and `needs_reply`, urgent recall per urgency source, per-language and per-hard-case tables, the Wilson lower bound and the sim gate table, cost and cap, corpus version and audit status. Shown by: `/tmp/f097-s21/holdout-time.log`; `evals/results/<date>-sim-lab-01-holdout-*.md`.
2. Every value category has ≥ 200 holdout and ≥ 50 dev cases with text, fresh blind label and passing code checks; every hard-case tag has ≥ 80 % of its planned count; corpus v1 is frozen. Shown by: `bun run sim status lab-01` (first line `manifest: v1 …`) and `manifest.json` (stage 20 logs).
3. A gate file for `classifier-v2` exists in `evals/results/gate/` and the CI unit test of D29 passes (and fails without the file). Shown by: stage 21 proof and `/tmp/f097-s21/gate-test.log`.
4. `/review` lists a random page of unlabelled real mail behind the flag `review_command` and writes `source = 'review'` rows, `delegation` included; AgentMail mail is not in `eval --real`. Shown by: stages 03–04 integration tests; C3 counts on the VPS.
5. `bun run eval --sim lab-01 --part dev --judge …` writes a judge section for delegation drafts; the judge refuses the classifier's provider and a missing judge key. Shown by: stage 16 tests; stage 21 dev report.
6. A sim-vs-real gap report for `notification` and `spam` (same operating point on both sides) is in `evals/results/`. Shown by: stage 22.
7. The model-upgrade rule replaces the old "go/no-go table" lines in `docs/code-patterns.md` and the styleguide, and is in `evals/README.md`. Shown by: stage 21 diff.
8. The urgency profile and sender history shapes exist in `packages/core` for E3b, E4-B and E11a. Shown by: stage 05 tests.

## Seams (for other tickets; not built here)

- **S1 E4-B (F110):** reads `evals/results/gate/*.json` as global evidence (ADR 0028); proposed rule: never unlock `auto` from a file with `provisional: true` (owner audit pending) or with a corpus version older than the manifest's.
- **S2 E3a (F100):** reuses `wilsonInterval` (`packages/core/src/triage/metrics.ts`) for the history-check bound; M1 counts `source = 'review'` labels as the random sample (D3).
- **S3 E3b (F109):** stores `urgencyProfileSchema` per mailbox; tunes only on `evals/sim/*/dev/`; every prompt change runs the D29 gate.
- **S4 E6a (F115):** calls the judge with rubric `reply`; needs_reply cases carry `expectedPoints` and `mustNot`; the reply-injection hard cases exist.
- **S5 E11a/E11b (F120, F111):** `senderHistorySchema` and the bank's per-case sender history; a local own-model candidate needs a price row in `llmPrices` (price 0 is fine) or `eval --sim` refuses to start (D26).
- **S6 E2b (F113):** uses the week slots (`delegateBehaviour`, `direction: "sent"` threads, `headers`, `week/history.json`); the PD-044 send-limit check of the live week (`E02-quality-lab.md` § "Input from the E3 discovery") is E2b's.
- **S7 E5b (F116):** the Sent bank is planned with the same planner and runner (X5).

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, `docs/code-patterns.md`, the ticket, this file and your stage file first. Build only your stage.
- The classifier request of the production path and of the 108 old eval cases must not change: same model, system text, user text, JSON schema. Never edit `prompts/classifier-v2.ts`. A change there needs the gate (P10).
- Never open, list or read files under `evals/sim/*/holdout/` unless your stage file says so (stages 17, 18, 20, 21 only; stage 19 reads only `blind/` files). Prompt work reads `dev/` only.
- `packages/core` stays pure: no `fs`, no `process.env`, no `Date.now()`, no `Math.random()` in `packages/core/src/sim/` (D10). File reads and writes live in `apps/server/src/scripts/sim*.ts` and `eval*.ts`.
- Logs, errors, state lines, test names and commit messages hold ids, codes, counts, model ids and file names only. Never a mail text, a subject, a prompt, an answer, an address from mail data or an API key. CLI output of `sim` and `eval` may print case ids and counts, never text. Exceptions: `sim brief` prints plan data (no mail text exists yet); `sim audit-list` writes text into its markdown file, not to stdout.
- Never read or print `.env`. Tests build config from literal env objects. A missing key is reported by its name.
- A stage that changes a type fixes every caller and every test in the same stage.
- A stage that lands behaviour updates its capability page in the same change (PD-009, fact F19): the stage file names the page and the lines. Name a repo path, a `bun run` script or an ADR on a page only when it exists at your commit (`capability-map.test.ts`). Do not change the page's "Checked against" line.
- Format only the files of your stage: `bunx prettier --write <files>`. Never the whole repo (S2 incident: a builder ran the repo-wide formatter).
- No temporary file inside the worktree (`bun run lint` lints every `.ts` file): use `/tmp/f097-sNN/`.
- Comments state the rule in one sentence and may name an ADR or a ticket folder path; no bare codes (`D14`, `F097`) in code comments.
- Template literals for strings with variables; `const` / `let` only.
- One migration in the whole ticket (stage 03). No `bun.lock` change and no new dependency in any stage.
- Commit by explicit path (`git add <paths>`), never `git add -A`.
- `bun run test:int:ci` runs in your own DB (the prepare script makes it); no lock. Never run `bun run test:e2e`.
- Do not edit `spec/build.md`, `docs/product/stage-2/*` or another ticket.
- A gap or a deviation is a question in your final message, not a choice.
- Test helpers this plan adds and later stages reuse: `miniScenario` in `packages/core/src/sim/fixtures.ts` (stage 05), the corpus fixture writer `apps/server/src/scripts/sim-fixtures.test-helper.ts` (stage 11; stage 12 adds texts and labels to it), `createOrgWithMailbox` (exists, `apps/server/test/integration/fixtures.ts`), the fake LLM `createFixedLlmClient` (exists, `apps/server/src/platform/llm/testing.ts`).

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. In the final message list as proven only what a saved log shows. `NN` = the stage number.

Code stages (01–16, 21):

```
mkdir -p /tmp/f097-sNN && bun run lint > /tmp/f097-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f097-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f097-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f097-sNN/int.log 2>&1 && echo PROOF_OK
```

Content stages (17–20, 22): the Proof block at the end of the stage file.

While it works, a worker runs only the tests of the code it changed; the full chain runs once, as the proof.

## Owner checkpoints

None. The coordinator builds on the review results; the decisions marked "default, owner to confirm" are in [questions.md](questions.md) and do not stop the build.

## Owner steps

| # | Step | When | Needs the owner because |
| --- | --- | --- | --- |
| O1 | Audit corpus v1: open `evals/sim/lab-01/audit/v1-list.md` (50 cases, about 15 min), set each line of `audit/v1-verdicts.json` to `ok` or `wrong: <category>`, tell the coordinator. The coordinator then runs `bun run sim audit-apply lab-01 --version 1 --date <today>` and commits; with a `wrong` verdict the corpus becomes v1.1 and the coordinator re-runs stage 21 step 1 run 1 (≤ $1) so the gate file is not provisional. | After stage 20 lands. The build does not wait (D36). | PD-014: the owner's verdict overrides both agents. |
| O2 | Only if stage 21 reports a missing `OPENAI_API_KEY` or `GEMINI_API_KEY` (by name): add the key to the main checkout's `.env`. | When stage 21 reports it. | A real secret. |

## Coordinator steps (no owner)

| # | Step | When |
| --- | --- | --- |
| C1 | `bun run db:migrate` on the shared dev DB (main checkout). | After stage 03 lands. |
| C2 | Deploy to the VPS (pre-approved; backup first, name the rollback target, verify after): the image with stages 01–04, the migration, `TEST_SENDER_ADDRESSES=ea-testmail-75wd@agentmail.to` in the VPS `.env` (the AgentMail inbox of `evals/testmail/personas.json`; not a secret). Before the deploy: read `TRIAGE_LLM_SCOPE` and `ACTIONS_SCOPE` on the VPS (key names and values only; they were `all` on 2026-11-08). With `all`, only the real-label readers change. If one is `synthetic`, AgentMail mail in the pilot mailbox now gets that scope's triage or actions: write it in the ticket log. Also run `bun run eval --real --org-id … --mailbox-id …` once and keep the labelled-row count. | After stage 04 lands. |
| C3 | On the VPS: turn on `review_command` for the pilot organization with `bun run org:flag` (syntax: its usage line), then `bun run eval --real …` again: the labelled-row count drops by the AgentMail-labelled mails. Write both counts in the ticket log. | After C2. |
| C4 | On the VPS: `bun run eval --real --org-id … --mailbox-id … --json /tmp/f097-real.json`; copy the file to `/tmp/f097-real/real.json` on the coordinator machine (counts only, no text, no ids). | Before stage 22. |
| C5 | Stage 18/19 loop: after a stage 19 range lands, run `bun run sim reconcile lab-01 --part <p> --batches <range>`; a `round 1` or `round 2` line → spawn stage 18 in rewrite mode for that range, then stage 19 again for it (`sim stale` then lists only the rewritten cases). | During stages 18–19. |
| C6 | Before landing each stage 19 job: the session-log grep of stage 19 § "Coordinator check before the land" prints `0`. | Each stage 19 job. |

## Review

- A review job before the land for stages 01 (real labels: what counts as real mail), 03 (`[risky]` migration, callbacks), 04 (user-visible command, tenant filter), 06 and 07 (`[risky]` ground truth), 13 (pool, budget, state file), 16 (`[risky]` LLM prompt and judge), 20 (corpus freeze). Model: the board's reviewer (`spec/build.md` § TRACK: `claude-sonnet-5-5`, high). The reviewer may run `bun run test:int:ci` at the candidate commit.
- Other stages land on the worker's proof.

## Stages

| # | Stage | Size | Mark |
| --- | --- | --- | --- |
| 01 | [Test mail by sender (F057)](stages/stage-01-test-senders.md) — `TEST_SENDER_ADDRESSES`, `mailKindFilter`, the scopes | ~250 lines | review |
| 02 | [`delegation` in testmail batches (F065)](stages/stage-02-testmail-delegation.md) | ~150 lines | |
| 03 | [Review source and sample](stages/stage-03-review-source.md) — migration, `listReviewSample`, review callbacks | ~280 lines | [risky], review |
| 04 | [`/review` command (F028)](stages/stage-04-review-command.md) — flag, page, taps | ~280 lines | review |
| 05 | [Shapes and scenario](stages/stage-05-shapes-and-scenario.md) — urgency profile, sender history, scenario schema | ~300 lines | |
| 06 | [PRNG, plan spec, slot schema, hard-case registry](stages/stage-06-slots-and-hard-cases.md) | ~250 lines | [risky], review |
| 07 | [The bank planner](stages/stage-07-bank-planner.md) | ~250 lines | [risky], review |
| 08 | [Week planner and prior history](stages/stage-08-week-planner.md) | ~250 lines | |
| 09 | [Corpus file schemas, language detector, code checks](stages/stage-09-schemas-and-checks.md) | ~250 lines | |
| 10 | [Eval case extension and the join](stages/stage-10-eval-case-join.md) | ~150 lines | |
| 11 | [`bun run sim`: plan, status, brief, check, blind export, label import, stale, reconcile; runbook](stages/stage-11-sim-cli.md) | ~350 lines | |
| 12 | [Freeze, manifest, owner audit commands](stages/stage-12-freeze-and-audit.md) | ~250 lines | |
| 13 | [`eval --sim`: loader, worker pool, budget](stages/stage-13-eval-sim-runner.md) | ~300 lines | review |
| 14 | [Report: Wilson, sim gate, tables, gate file](stages/stage-14-report-and-gate.md) | ~250 lines | |
| 15 | [`--real --json` and the gap command](stages/stage-15-gap-command.md) | ~100 lines | |
| 16 | [Draft judge](stages/stage-16-draft-judge.md) | ~300 lines | [risky], review |
| 17 | [Scenario `lab-01` and its slots](stages/stage-17-scenario-lab-01.md) | content | |
| 18 | [Write the texts](stages/stage-18-write-texts.md) — repeat stage, Sonnet, ≤ 3 jobs at once | content | |
| 19 | [Blind check](stages/stage-19-blind-check.md) — repeat stage, Haiku, session-log check | content | |
| 20 | [Reconcile, freeze v1, audit list](stages/stage-20-freeze-v1.md) | content | review |
| 21 | [First holdout report and the gate rule](stages/stage-21-first-report-and-gate-rule.md) — real LLM, ≤ $1 per run | ~60 lines + reports | |
| 22 | [Sim-vs-real gap report](stages/stage-22-gap-report.md) | report | |

## How to run (coordinator)

1. Before the first spawn: F095 (E1) is in `spec/features/done/`. Move the ticket: `git mv spec/features/planned/F097-e2a-offline-lab spec/features/active/`, commit (the worktrees see only committed files).
2. Order and lanes. Lane A: 01 → 03 → 04 (02 may run next to any lane-A stage). Lane B: 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 (next to lane A). Lane C: 13 (after 01 and 10: `scripts/eval.ts` and the join) → 14 → 15 → 16. Lane D: 17 after 11 (next to lanes A–C); stage 18 jobs after 17; a stage 19 job after the stage 18 job of its range has landed; 20 after all 18 and 19 jobs (C5 loop done) and after 12; 21 after 20 and 16; 22 after 21 and C4.
3. Shared files with other tickets (advisory, § 2.4 of `05-execution-plan.md`; fact F13): stages 03 and 04 edit `channels/callbacks.ts`, `commands.ts`, `texts.ts`, `telegram/polling.ts` and `packages/core/src/digest/`: not next to an F098 stage 06–12 job; the later job merges `master` before its proof (D39 says what changes when F098 landed first). When stages 03–04 land first, the spawn text of F098 stages 10 and 11 names the review texts (`packages/core/src/digest/review.ts`, the review picker in `channels/review-taps.ts`, the `/review` help line and menu entry) to move into the registry with en and pl; F098's own stage files do not know them. Stage 04 edits `packages/core/src/features.ts`: not next to F099 stage 12. Stage 03 is the only migration: not while another ticket's migration stage builds (F092 stage 01; F100 stage 04 changes the same CHECK and waits for stage 03). F100 stages 04, 10 and 15 wait for stages 01, 03 and 04 of this plan, and F100 stages 13–15 run after stages 03–04 (the same callback files; F100 plan § How to run 2–3): do not change the interfaces of stages 01, 03 and 04 during the build.
4. Spawn a code stage (`NN`, `<slug>` from the stage list):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "F097-sNN <slug> · F097" \
     "Implement F097 stage NN. Read spec/features/active/F097-e2a-offline-lab/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md (or of the stage file) for your stage (/tmp/f097-sNN), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

5. Stages 18 (writer) and 19 (checker) run as several jobs of the same stage file, each with a part and a batch range in the spawn text: label `"F097-s18 write <part> <from>-<to> · F097"`, prompt "Implement F097 stage 18 for part <part>, batches <from> to <to> (or: rewrite <part> <from>-<to>). Read spec/features/active/F097-e2a-offline-lab/ticket.md, plan.md and stages/stage-18-write-texts.md …". Stage 19 uses `--model claude-haiku-5-5 --thinking medium` (D37) and the prompt "Implement F097 stage 19 for part <part>, batches <from> to <to>. Read only spec/features/active/F097-e2a-offline-lab/stages/stage-19-blind-check.md, evals/sim/README.md § 5 and the blind files of your range." Land each job with `--keep-open` (stage 19 after C6).
6. Review (stages in § Review): spawn and poll `limen jobs <id>`; a finding → `limen continue <job-id> "<fix>"`, then review again (at most 2 rounds, then decide from "Input" or ask the owner):

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --review --detached --branch <B> --label "review s<NN> · F097" \
     "Review F097 stage NN on <B> against spec/features/active/F097-e2a-offline-lab/plan.md and stages/stage-NN-<slug>.md. Check that every numbered test exists and asserts what the stage says, every decision the stage cites, that no log line, state line or error holds mail text, a prompt, an answer or a key, and that the classifier request of the old cases did not change. Quote file and line for each finding."
   ```

7. Land: `limen land <job-id> --yes --keep-open` (stage 22: without `--keep-open`; it closes the ticket). Drop the job DB from the main checkout: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop`. Land a stage before you spawn a stage that needs it (step 2).
8. Coordinator steps C1–C6 at the times of § Coordinator steps. Owner step O1 after stage 20; do not wait for it.
9. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass. A check with no proof at all → `limen continue`.

## Planning progress

- [written] ticket.md, plan.md, questions.md
- [done] refresh 1 to `54b715b` ([plan-refresh-1.md](plan-refresh-1.md)); cold review 2 PASS, 14 notes, applied ([plan-review-2.md](plan-review-2.md))
- [written] stages 01–22 (after cold review 1: the old stages 06, 08 and 12 were split; the old 07 → 08, 09 → 11, 10 → 12, 11 → 13, 13 → 16, 14 → 17, 15 → 18, 16 → 19, 17 → 20, 18 → 21, 19 → 22)

## Cold review

Review 1 ([plan-review-1.md](plan-review-1.md), job `2026-11-14-f097-plan-review-be9003b2`, Opus 5.5 high, candidate `f050760`): FAIL, 2 blocking findings, 31 notes. Stage numbers in the review are the old ones. What changed:

- B1 (bare holdout command takes about 24 min at the config rpm): fixed. `--sim` defaults to concurrency 8 and rpm 240 (D26, stage 13 rule 4 and test); the D29 rule text and stage 21 use the bare command.
- B2 (`sim status` never shows "frozen as v1"): fixed. Stage 12 step 1 adds the `manifest:` line to `status`, with test 6.
- N1 (a loose run writes a passing gate file): fixed. Gate file only for a complete holdout run with bar 0.98, min-kept 30, no `--limit` (D27, stage 14 test 6).
- N2 (gate file name, consumer rule): fixed. Name has effort and corpus version; `provisional` field; seam S1 for E4-B; O1 re-runs the gate after v1.1.
- N3 (gap compares two operating points): fixed. Both sides use unthresholded `computeMetrics` (D32, stage 14 `metrics`, stage 15).
- N4 (blind isolation fact wrong): fixed. D33 corrected; stage 19 session-log check (fact F17, positive control 7 hits on the review job), C6.
- N5 (briefs vs test 8): fixed. The two briefs no longer use the word.
- N6 (fixed floor vs small fixture): fixed. `FreezeFloors` parameter; CLI defaults 50/200.
- N7 (budget test numbers): fixed. New start rule `spent + (inFlight + 1) × avg ≤ cap` with a float tolerance; test 4 = 3 calls, $0.0009; test 5 = 1 call.
- N8 (week counts): fixed in stage 08 test 2.
- N9 (false edge case): fixed in § Edge cases.
- N10 (old rule lines): fixed. Stage 21 step 3 names the exact sentences to replace.
- N11 (judge errors): fixed. Judge errors count in the stop rule, re-run on resume, key check, exit 1 above 10 % (stage 16 rules 4–5, tests 7–8).
- N12 (`delegation` never labelled in `/review`): fixed. `reviewLabelCategories` with code `d` (D5, stages 03–04).
- N13 (week replies lose thread): fixed. `parents` in the join, the loader and the blind export (D21, stages 10, 11, 13).
- N14 (hard slots' base facts): fixed. Stage 07 rule 10 and test 12.
- N15 (re-label scope): fixed. `blindHash`, `label-import`, `stale`, `label_stale` (stages 09, 11, 19).
- N16 (sender history fields): fixed. `lastSeenDaysAgo`, both median reply delays (D9, stage 05 test 5).
- N17 (html text part): fixed. The text part wins (D21, stage 10 test 3); writers write both parts.
- N18 (X1 partial): fixed. Headers on every newsletter and marketing persona slot (stage 07 rule 7, test 12).
- N19 (scope change on the VPS): fixed in C2.
- N20 (`category_named` unclear and harmful): accepted; the check is removed (D18).
- N21 (version rule): fixed. Minor + 1.
- N22 (`createTwoTenants` private): fixed. `createOrgWithMailbox` (F18).
- N23 (`/usr/bin/time` missing): fixed. `date +%s` timing (F18).
- N24 (id grep): fixed. `grep -cE '\b[bhw]-[a-z]{2,4}-[0-9]{2,4}\b'`.
- N25 (8 signatures): accepted; the check is replaced by `checkBatch` (`opening_repeat`).
- N26 (phone check vs planted numbers and timestamps): fixed in the README rule (dates with dots, fake short account numbers); no code exception.
- N27 (status line): fixed.
- N28 (E11b price seam): added as S5.
- N29 (PD-044 send limits): S6, E2b.
- N30 (`spec/build.md` "needs plan"): reported in the planner's final message (the board is not edited here).
- N31 (stage size): accepted. Old stages 06, 08 and 12 split into 06/07, 09/10 and 14/15; stage 16 (judge) stays one job at about 300 lines.

Review 2 ([plan-review-2.md](plan-review-2.md), job `2026-11-14-f097-plan-review-refresh-1-492740db`, Opus 5.5 high, candidate `6459156`) of refresh 1: PASS, 0 blocking, 14 notes. Pre-mortem (F098 does not know `/review`): How to run 3 tells the coordinator to name the review texts in the F098 stage 10–11 spawn text; outside edit in the refresh job's final message. Notes 1–12 and 14 fixed (D1 backfill and cost callers, Q11; page lines on `actions-and-undo.md`, `.env.example`, `tenancy-and-plans.md` rule 5, `triage.md` rule 10; D39 split by F098 stage 06 and 11; registry-order flag lists; `web-operator.test.ts` case 4; D38 covers `eval-judge.ts` and `scripts/eval.ts`; `pickedText` location; Wilson clamp; grep exit code; stage 13 wording). Note 13 (stages 01 and 03 large) accepted: the added page steps are a few lines each; the coordinator may split stage 01 at step 3 if the first job times out.

## Log

- 2026-11-13/14: planned by a planner job (Opus 5.5) from the epic page, the discovery notes and the code at `9d9bfb8`; probes in the planning worktree (not committed) (F4, F5, F14, F15).
- 2026-11-14: cold review 1 FAIL (B1, B2, 31 notes); all applied or answered above; stages renumbered 01–22.
- 2026-11-14: refresh 1 (planner job, Opus 5.5) from `9d9bfb8` to `54b715b`: F091 split paths, capability-page lines (PD-009), D38, D39, feature-key tests, three code-patterns places; [plan-refresh-1.md](plan-refresh-1.md).
