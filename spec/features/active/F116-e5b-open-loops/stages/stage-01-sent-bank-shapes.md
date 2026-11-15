# F116 stage 01 — Sent bank shapes and planner

Part of [`../plan.md`](../plan.md). Needs F097 (offline lab) in `done/`. No DB change.

The extractor gate (PD-123) needs a frozen bank of the executive's sent mail with planted labels; the lab shapes describe incoming mail only (F9).

## Step 1 — Shapes

- **Goal:** a slot, text, blind and label shape for one sent mail.
- **Interfaces (new, used by stages 02–06):**
  - Parts `sent-dev` and `sent-holdout` (a new list `sentParts`; `simParts` stays as it is, so the frozen `lab-01` manifest does not change).
  - `sentSlotSchema`: `id` (`s-<nnnn>` or `sh-<tag short>-<nn>`), `part`, `batch`, `persona` (the executive key), `to` (1–12 persona or delegate keys), `cc`, `lang` (`pl` | `en`), `sentAt` (ISO), `labels` = `{ expectsReply: boolean, ask: string | null (English brief, ≤ 80), due: DueRef | null, promise: string | null, promiseDue: DueRef | null }` (`DueRef` as in `interfaces.md`, also used by the extractor), `hardCases` (tags below), `thread` (0–3 earlier mails, `{ from, subject, brief }`), `quoted` (bool: the text quotes the last thread mail), `style` (length bucket, greeting, signature), `brief` (English, ≤ 300).
  - `sentTextSchema` (`id`, `subject`, `body`, `planted?`); `sentBlindCaseSchema` (what the extractor sees: `from`, `to`, `cc`, `subject`, `sentAt`, `body`, thread subjects; no label); `sentLabelSchema` (the checker's `expectsReply`, `promise` bool, `due`, `promiseDue` as YYYY-MM-DD or null, the blind hash).
- **Dates (new, `packages/core/src/loops/dates.ts`; the product uses them from stage 12):** `DueRef` (zod), `resolveDue(ref, { sentAt, timeZone }) → Date | null` and `defaultDue(sentAt, waitDays, timeZone)` (`addWorkingDays`), all at 17:00 local (D7). Words resolve from the local day of `sentAt`: `today` = that day; `tomorrow` = +1; a weekday = the next such day, never the same day; `end_of_week` = that Friday, or the next Friday when sent on Friday after 17:00 or on a weekend; `next_week` = the next Monday. Before `sentAt` or > 60 days after: null. The checker label of a time word is the resolved date.
- **Test (unit):** T1 each schema accepts the `fixtures.ts` case and refuses `promise` set with `promiseDue` null; T2 `sentParts` and `simParts` share no member; T2b in `Europe/Warsaw`, sent Wed 2026-11-18 10:00: `friday` and `end_of_week` → Fri 2026-11-20 17:00, `tomorrow` → Thu 17:00, `wednesday` → Wed 2026-11-25; sent Fri 2026-11-20 18:00: `end_of_week` → Fri 2026-11-27; sent Sat 2026-03-28: `monday` → Mon 2026-03-30 17:00 CEST; date 2026-11-17 → null; 2027-01-20 (63 days) → null; `defaultDue(Fri 2026-11-20 10:00, 3)` → Wed 2026-11-25 17:00.

## Step 2 — Hard-case tags

- **Goal:** `sentHardCaseTags` (discovery notes §4.2 Eval): `thanks_only`, `fyi_team`, `question_in_forward`, `conditional_promise`, `reported_speech`, `let_me_know_if`, `reply_to_ooo`, `other_thread_subject`, `injection_quote` (quoted third-party text that tells the model to set fields), `time_word_due` (a due as "Friday", "end of week"), `past_date` (a date before `sentAt`), `far_date` (> 60 days), `many_recipients` (> 10).
- **Decisions:** each tag sets its labels: `thanks_only`, `fyi_team`, `reported_speech` → `expectsReply` false; `conditional_promise` → `promise` null (PD-122: only firm promises); `past_date`, `far_date` → the due label is null (code drops it, D7); `many_recipients` → a filter case, labels all false.
- **Test (unit):** T3 every tag has a label rule and a brief hint; T4 `conditional_promise` slots never carry a promise.

## Step 3 — Planner

- **Goal:** `planSentBank(scenario, spec) → { "sent-dev": SentSlot[], "sent-holdout": SentSlot[] }`, seeded.
- **Decisions:** sizes 50 dev, 250 holdout (PD-123); languages 60% `pl`, 40% `en` per part (±1 case); `expectsReply` true in 50%; a dated promise in 25%; a stated due in 30% of the `expectsReply` cases; each hard-case tag at least 6 times in holdout and 1 in dev; `sentAt` on working days and weekends (20%), in the scenario week range; recipients from the scenario personas and delegates (at least 15% of the `expectsReply` cases go to a delegate: they test D8). The spec lives in `evals/sim/lab-01/sent-plan-spec.json` (new file; the frozen `plan-spec.json` does not change). 25 slots per batch.
- **Test (unit):** T5 the same seed gives byte-equal slots twice; T6 the shares above hold on the real spec (`pl` 150 ± 1 of 250); T7 no slot id repeats across the parts; T8 every hard-case tag count meets its floor.

## Check

`bun test packages/core/src/sim`

## Done when

T1–T8 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s01`).

## Out of scope

The CLI (02), texts (03), the extractor (05).

## Build notes (stage 02 check of the stage 01 choices, 2026-11-15)

The stage 01 worker made these choices where this file was silent. Stage 02 checked each one against `plan.md` and `interfaces.md`. No change was needed.

- `sentAt` falls in the `weekStart` week (20% weekend, 07:00–19:00 local): fits "in the scenario week range".
- The promise label always has a `promiseDue`: fits D7 (an undated promise opens nothing); `sentLabelSchema` repeats the rule.
- `question_in_forward`, `past_date`, `far_date` set `expectsReply` true: fits stage 03 (the ask sits above the forward) and the step 2 text (the date is in the ask).
- `reported_speech` and `many_recipients` set `promise` null: fits PD-122 (only firm own promises) and "labels all false".
- `time_word_due` sets a time-word due; `fyi_team` goes to team personas only.
- New spec fields `hardPerTag`, `delegateShare` (0.2, min 0.15), `weekendShare`, `threadShare`, `ccShare`: fit the sizes and the 15% delegate floor of Step 3.
- Stage 02 added `executive.voice` and `executive.signature` to the scenario (default `""`) and set both in `evals/sim/lab-01/scenario.json`.
