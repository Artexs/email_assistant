# F116 · Open loops: plan

> **Status 2026-11-15 — planned.** Plan base: 9531f16a. 25 stages, none built.

Names: [interfaces.md](interfaces.md). Defaults: [questions.md](questions.md). Source: epic E05 notes §4.2, §5.

## Input

Owner: "You can go with defaults." (PD-115–PD-129). Job: "Owner order: owner steps and checkpoints are not a stop: use plan defaults." "Consent rule: a new kind of mail-derived data in Telegram needs a consent bump and a re-ask for linked chats." Architecture review §8.3: "E5 planning designs a `loops` module (one chaser for delegations, waiting replies and promises) instead of a second engine next to `delegation`."

### Product decisions (do not reopen)

- **P1** PD-118–PD-128 as written in the epic page § Decisions 4–14. G1 may change PD-119 (wait), PD-120 (automatic follow-ups), PD-122 (others' promises).

### Design decisions

- **D1 Module.** New module `loops`, layer 3, edges to `actions`, `delegation`, `triage`; it also holds `delegateMail`. Rejected: inside `delegation` (size; no edge to `triage`).
- **D2 Kinds.** `open_loops`: `waiting`, `promised`, `delegated` (a hand forward to an active delegate, PD-124). Other delegations stay in `delegations`. Rejected: nullable ids there (every reader changes).
- **D3 One chaser.** `loops.chaser` replaces `delegation.chaser`: the delegation step unchanged, then the loop step. Rejected: a second job.
- **D4 Anchor.** A follow-up has no incoming mail: `actions.loop_id` is a second anchor, read through `LoopHooks`. Rejected: an incoming mail of the thread (often none).
- **D5 Copies.** Sent text and recipients expire (F104 rule 12): a loop copies subject, To, Cc, counterpart, text and message ids, never the body; the quote uses the sent text while stored. Loop texts go 90 days after close.
- **D6 Analysis input.** User rows without `action_id`, `content = stored`, ≤ 14 days old, switch and flags on; `pending` rows wait, `headers_only`/`gone` skip (review G3). Code filters first (`sentSkipReason`), then one `extractor-v1` call on the body cut to 8,000 characters, as untrusted data. A mail in the thread of an open loop (D9) or of an open delegation (G10): no call, no loop. A system follow-up's Sent copy is `origin = system` (G1, stage 10).
- **D7 Dates.** The LLM gives a date or a time word; code resolves it (`resolveDue`; > 60 days or past: dropped). Waiting due = stated, else `sent_at` + `loop_wait_days` working days. An undated promise opens nothing.
- **D8 Which loop.** `expects_reply` with a To of an active delegate → `delegated`; else `expects_reply` → `waiting`; a dated promise → `promised` (counterpart = first To). One mail may open two.
- **D9 Restart.** A later user row in the thread of an open `waiting`/`delegated` loop whose To ∪ Cc overlaps the loop's, or an applied follow-up, restarts the wait (due ≥ 3 working days on). No overlap: a side note, analysed as new mail. The quote is always the opening mail (G4). Any later user row to the counterpart closes a `promised` loop `later_reply`, in any thread (PD-122).
- **D10 Close by reply.** A later mail from a non-own address closes `waiting`/`delegated`: in the thread → `replied`; else same normalized subject from a To or Cc within 30 days → `replied_subject`. Auto-replies never close.
- **D11 Taps.** Done, Drop, Later (+3 working days, ≤ 3 times), Reopen, Untrack (`delegated`). Done, Later: any member; the rest: owners.
- **D12 Follow-up.** Kind `follow_up`: pl/en template, the quote, the mailbox signature; To, Cc from the loop row (`delegated`: the `counterpart` only); In-Reply-To = `message_id`. At most 2, 3 working days apart, one waiting at a time; a rejected or expired one may be drafted again (key with an attempt number, G2). Never in an approval set (G6). Shadow: "would draft". Suspicious thread: none. Send limits cover `to ∪ cc`.
- **D13 Chaser step.** Once per local day: past-due `delegated` loops get a follow-up card (`assist`, drafts on); `waiting` ones only with `auto_follow_up` (off, PD-120); `stale` after 2 follow-ups and 14 days, or 30 days after due (G5); `promised` `expired` 7 days after due. Closes run in every mode.
- **D14 Crash.** The LLM call is outside a transaction; one transaction writes the analysis and the loops (unique keys): a repeat costs a call, not a loop. 3 attempts. At ≥ 80% of `LLM_DAILY_CAP`: wait a day.
- **D15 Locks.** Loop first, then sends.
- **D16 Brief.** The first digest of the member's day starts with 🔴 Urgent · ✍️ Waiting on you · ⏳ Waiting on others · 🤝 Promised (stage 18); later digests get a count line. A shown line sets `surfaced_at`.
- **D17 Consent.** Loop lines and follow-up cards carry sent-mail data: stage 17 bumps the consent version and gates per user (older consent: counts and a panel link); F115's gate is reused when at `HEAD`.
- **D18 Switch off.** `onSentOff` closes open loops `sent_off`, clears texts, expires waiting follow-ups, inside `setSentSync`. An org flag off only stops the jobs and hides loops.
- **D19 Logs, privacy.** F103 event lines (ids, codes, counts); F106 maps in each stage.

## Facts checked and not verified

[facts.md](facts.md): F1–F9 (read at 9531f16a), N1 (stage 25), N2 (stage 06).

## Done when

1. The stage 06 gate file passes (PD-123 bars).
2. Each rule of D6–D13 and D18 has a passing test.
3. A follow-up card shows the exact rendered mail; no send without a tap.
4. The brief sections render pl and en within 4096 characters.
5. Delegate taps (Telegram, panel) make a delegation draft.
6. The "Open loops" page passes its e2e and axe checks.
7. Docs updated; M2 counts loops.
8. Stage 25: one real follow-up sent after a tap.

## Rules for every stage

- Read `docs/code-patterns.md`, this file, `interfaces.md`, your stage.
- Format only your files. Commit by explicit path after `git diff --staged`.
- No mail text, ask, promise, subject or address in a log, error, audit row, test name.
- New texts in `packages/core/src/texts/` or `apps/web/src/i18n/` (en, pl) with a Polish unit test.
- A new `/api` route gets `apiDoc` in the same commit.
- A gap or deviation is a question in the final message, not a choice.

## Proof

```
mkdir -p /tmp/f116-sNN && bun run lint > /tmp/f116-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f116-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f116-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f116-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages 21 and 22 add the web tail of F102 `plan.md` § Proof (`test:e2e` under `flock`) before `echo PROOF_OK`.

## Gate, checkpoints, owner steps

- **C1** after 06: the gate file. Fail → `extractor-v2` on dev, then holdout; 07–11 may build meanwhile (06 says the same).
- **C2** after 14, **C3** after 22: a review of the stages since the last stop; not a stop.
- **G1** before 25: second pass PD-119, PD-120, PD-122 from the first E3a weekly report and the E2b week (coordinator on defaults with an owner-decisions entry).
- After 07 and after 09: `bun run db:migrate` on the dev DB.
- **O1** stage 25: flags on for the pilot org; one real follow-up after a tap.

## Review

`claude-opus-5-5` before land: 05, 06, 07, 09–19, 25 (risk, Polish); 21, 22 (Polish). Else `claude-sonnet-5-5`.

## Stages

- 01 [Sent bank shapes](stages/stage-01-sent-bank-shapes.md)
- 02 [Sent bank commands](stages/stage-02-sent-bank-cli.md); needs 01
- 03 [Write sent texts](stages/stage-03-sent-texts.md) (several jobs); needs 02
- 04 [Labels and freeze](stages/stage-04-sent-labels-freeze.md); needs 03
- 05 [Extractor core](stages/stage-05-extractor-core.md) `[risky]`; needs 01
- 06 [Extractor eval](stages/stage-06-extractor-eval.md) `[risky]`; needs 04, 05; C1 after
- 07 [Loop tables](stages/stage-07-migration.md) `[risky]`
- 08 [Loop repository](stages/stage-08-loop-repo.md); needs 07
- 09 [Action anchor](stages/stage-09-action-anchor.md) `[risky]`; needs 08
- 10 [Follow-up kind and send](stages/stage-10-follow-up-kind.md) `[risky]`; needs 09
- 11 [Follow-up cards](stages/stage-11-follow-up-cards.md) `[risky]`; needs 10, 17
- 12 [Sent analysis job](stages/stage-12-analysis-job.md) `[risky]`; needs 06, 08
- 13 [Close rules](stages/stage-13-close-rules.md) `[risky]`; needs 12
- 14 [Loop commands](stages/stage-14-loop-commands.md) `[risky]`; needs 11, 13; C2 after
- 15 [One chaser](stages/stage-15-one-chaser.md) `[risky]`; needs 14
- 16 [Delegate command](stages/stage-16-delegate-command.md) `[risky]`; needs 08
- 17 [Consent gate](stages/stage-17-consent-gate.md) `[risky]`; needs 08
- 18 [Brief sections](stages/stage-18-brief.md) `[risky]`; needs 14, 17
- 19 [Telegram taps](stages/stage-19-telegram-taps.md) `[risky]`; needs 16, 18
- 20 [Loop routes](stages/stage-20-loop-routes.md); needs 15, 16
- 21 [Open loops page](stages/stage-21-loops-page.md); needs 20
- 22 [Delegate action and settings](stages/stage-22-panel-delegate-settings.md); needs 20; C3 after
- 23 [M2 for loops](stages/stage-23-m2-loops.md); needs 10, 13
- 24 [Docs](stages/stage-24-docs.md); needs 01–23
- 25 [Pilot](stages/stage-25-pilot.md) `[risky]`; needs 24, G1

## How to run (coordinator)

- Worker `claude-sonnet-5-5`, `--prepare 'bash scripts/limen-prepare.sh'`; ticket in `active/`; drift check first.
- Lanes: {01→02→03→04}, {05} after 01, then 06; {07→08} after F102 and F104 are done, then {17}, {09→10}, {12→13}, {16} in parallel; 11 after 10 and 17; 23 after 10 and 13 (09 is a migration: not next to another migration); then by "needs". `spec/build.md` land check; drop the job DB.
- Stage 15 edits `main.ts`: merge `master` first.

## Planning progress

- Scouts: 4, all done (`scouts.md`).
- [written] ticket, plan, interfaces, facts, questions, stages 01–25.
- Words (`wc -w`): plan ≤ 1,500; stages ≤ 700.

## Cold review

Model `claude-opus-5-5`: `[risky]` stages (migrations, sending to people, LLM, privacy). [plan-review-1.md](plan-review-1.md): PASS, 0 blocking, 17 gaps, 14 notes; fixes in `plan-review-1-fixes.md`.

## Log

- 2026-11-15 written.
