# F116 · Open loops: plan

> **Status 2026-11-15 — planned.** Plan base: 9531f16a. 25 stages, none built.

Names: [interfaces.md](interfaces.md). Defaults: [questions.md](questions.md). Sources: epic E05, its notes §4.2, §5.

## Input

Owner: "You can go with defaults." (PD-115–PD-129). Job: "Owner order: owner steps and checkpoints are not a stop: use plan defaults." "Consent rule: a new kind of mail-derived data in Telegram needs a consent bump and a re-ask for linked chats." Architecture review §8.3: "E5 planning designs a `loops` module (one chaser for delegations, waiting replies and promises) instead of a second engine next to `delegation`."

### Product decisions (do not reopen)

- **P1** PD-118–PD-128 as written in the epic page § Decisions 4–14. G1 may change PD-119 (wait), PD-120 (automatic follow-ups), PD-122 (others' promises).

### Design decisions

- **D1 Module.** New module `loops`, layer 3, same-layer edges `loops → actions`, `loops → delegation`, `loops → triage`. It also holds `delegateMail` (`delegation` may not import `triage`). Rejected: inside `delegation` (size, and the edge to `triage`).
- **D2 Kinds.** `open_loops` holds `waiting`, `promised` and `delegated` (a hand forward to an active delegate, PD-124). Triage and Delegate-button delegations stay in `delegations`. Rejected: nullable mail and action ids there (every delegation reader changes).
- **D3 One chaser.** `loops.chaser` replaces the `delegation.chaser` job: the delegation step unchanged, then the loop step. Schedule, gates and the reminder set stay; the old name is a `job:run` alias. Rejected: a second job.
- **D4 Anchor.** A follow-up has no incoming mail: `actions.loop_id` is a second anchor (exactly one of `email_id`, `loop_id`); the committer and the cards read it through `LoopHooks.anchorOf`. Rejected: an incoming mail of the thread (often none).
- **D5 Copies.** Sent text goes after `data_retention_days`, recipients after 90 days (F104 rule 12): a loop copies subject, To, Cc, counterpart, text and message ids, never the body. The follow-up quotes the sent text while it is stored. Loop texts are cleared 90 days after close.
- **D6 Analysis input.** User rows without `action_id`, with text, ≤ 14 days old, switch and flags `sent_sync`, `open_loops` on. Code filters first (`sentSkipReason`, stage 05), then one `extractor-v1` call on the body cut to 8,000 characters, as untrusted data. A mail in the thread of an open loop: `thread_restart`, no call.
- **D7 Dates.** The LLM gives a date or a time word; code resolves the word from `sent_at` in the org time zone. Before `sent_at` or > 60 days after: dropped. Waiting due = stated date, else `sent_at` + `loop_wait_days` working days, 17:00 local. A promise without a valid date opens nothing.
- **D8 Which loop.** `expects_reply` with a To of an active delegate → `delegated`; else `expects_reply` → `waiting`; a dated promise → `promised` (counterpart = first To). One mail may open two.
- **D9 Restart.** A later user row in the thread of an open `waiting`/`delegated` loop, or an applied follow-up, restarts the wait (new default due). A later user row to the counterpart in a `promised` thread closes it `later_reply`.
- **D10 Close by reply.** A mail after `wait_from_at` from a non-own address closes `waiting`/`delegated`: in the thread → `replied`; else same `normalizeSubject` from a To or Cc within 30 days → `replied_subject`. `isAutoReply` mail never closes; it sets `auto_reply_at`. No `email_headers` row = not auto.
- **D11 Taps.** Done, Drop, Later (+3 working days, at most 3), Reopen (old due). Untrack = Drop for `delegated`. Done, Later: any member; the rest: owners.
- **D12 Follow-up.** Kind `follow_up`: pl/en template, the quote, the mailbox signature; To, Cc from the loop row (`delegated`: the delegate only); In-Reply-To = `message_id`. At most 2, 3 working days apart, one waiting at a time. Shadow: "would draft", no draft. No `create_draft`: `drafts_off`. A thread in `suspiciousThreadKeysOf`: none. Send limits cover `to ∪ cc`.
- **D13 Chaser step.** Once per local day: past-due `delegated` loops get a follow-up in the reminder set (`assist`, drafts on); `waiting` ones only with `auto_follow_up` (off, PD-120); `stale` after 2 follow-ups and 14 days; `promised` `expired` 7 days after due.
- **D14 Crash.** The LLM call is outside a transaction; one transaction writes the analysis row and the loops (unique keys): a repeat costs a call, not a loop. 3 attempts, then `failed`. At ≥ 80% of `LLM_DAILY_CAP`: wait for the next day (`llm_cap`).
- **D15 Locks.** Lock the loop row first, then its sends.
- **D16 Brief.** The first digest of the member's local day gets on top: 🔴 Urgent · ✍️ Waiting on you · ⏳ Waiting on others · 🤝 Promised (5 lines each, "+n in the panel"; rules in stage 18). Later digests: one count line. A shown line sets `surfaced_at` once.
- **D17 Consent.** Loop lines and follow-up cards carry sent-mail data. Stage 17 bumps `TELEGRAM_CONSENT_VERSION` and gates per user: an older consent sees counts and a panel link. F115's gate is reused when at `HEAD`.
- **D18 Switch off.** `onSentOff` closes open loops `sent_off`, clears texts, expires waiting follow-ups, inside `setSentSync`.
- **D19 Logs, privacy.** F103 event lines (ids, codes, counts); new columns join the F106 maps in their stage.

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

- Read `docs/code-patterns.md`, this file, `interfaces.md` and your stage.
- Format only your files. Commit by explicit path after `git diff --staged`.
- No mail text, ask, promise, subject or address in a log, error, audit row or test name.
- New texts in `packages/core/src/texts/` or `apps/web/src/i18n/` (en, pl) with a Polish unit test.
- A new `/api` route gets `apiDoc` in the same commit.
- A gap or deviation is a question in the final message, not a choice.

## Proof

```
mkdir -p /tmp/f116-sNN && bun run lint > /tmp/f116-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f116-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f116-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f116-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages 21 and 22 add the web tail of F102 `plan.md` § Proof (`test:e2e` under `flock`) before `echo PROOF_OK`.

## Gate, checkpoints, owner steps

- **C1** after 06: the gate file. Fail → `extractor-v2` on dev, then holdout; 07–11 may build meanwhile.
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
- 20 [Loop routes](stages/stage-20-loop-routes.md); needs 14, 16
- 21 [Open loops page](stages/stage-21-loops-page.md); needs 20
- 22 [Delegate action and settings](stages/stage-22-panel-delegate-settings.md); needs 20; C3 after
- 23 [M2 for loops](stages/stage-23-m2-loops.md); needs 13
- 24 [Docs](stages/stage-24-docs.md); needs 01–23
- 25 [Pilot](stages/stage-25-pilot.md) `[risky]`; needs 24, G1

## How to run (coordinator)

- Worker `claude-sonnet-5-5`, `--prepare 'bash scripts/limen-prepare.sh'`; ticket in `active/`; drift check first.
- Lanes: {01→02→03→04}, {05} after 01, then 06; {07→08} after F102 and F104 are done, then {17}, {09→10}, {12→13}, {16}, {23} in parallel, 11 after 10 and 17 (09 is a migration: not next to another migration); then by "needs". `spec/build.md` land check; drop the job DB.
- Stage 15 edits the `main.ts` job list: merge `master` first.

## Planning progress

- Scouts: 4, all done (`scouts.md`).
- [written] ticket, plan, interfaces, facts, questions, stages 01–25.
- Words (`wc -w`): plan.md 1498; stage files 401–700.

## Cold review

Pending.

## Log

- 2026-11-15 written.
