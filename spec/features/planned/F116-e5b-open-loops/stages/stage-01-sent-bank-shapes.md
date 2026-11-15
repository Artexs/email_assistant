# F116 stage 01 — Sent bank shapes and planner

Part of [`../plan.md`](../plan.md). Needs F097 (offline lab) in `done/`. No DB change.

The extractor gate (PD-123) needs a frozen bank of the executive's own sent mail with planted labels. The lab shapes today describe incoming mail with a category (F9). This stage adds the sent shapes and the planner, in `packages/core/src/sim/`.

## Step 1 — Shapes

- **Goal:** a slot, text, blind and label shape for one sent mail.
- **Interfaces (new, used by stages 02–06):**
  - Parts `sent-dev` and `sent-holdout` (a new list `sentParts`; `simParts` stays as it is, so the frozen `lab-01` manifest does not change).
  - `sentSlotSchema`: `id` (`s-<nnnn>` or `sh-<tag short>-<nn>`), `part`, `batch`, `persona` (the executive key), `to` (1–12 persona or delegate keys), `cc`, `lang` (`pl` | `en`), `sentAt` (ISO), `labels` = `{ expectsReply: boolean, ask: string | null (English brief, ≤ 80), due: DueRef | null, promise: string | null, promiseDue: DueRef | null }` (`DueRef` as in `interfaces.md`, also used by the extractor), `hardCases` (tags below), `thread` (0–3 earlier mails, `{ from, subject, brief }`), `quoted` (bool: the text quotes the last thread mail), `style` (length bucket, greeting, signature), `brief` (English, ≤ 300).
  - `sentTextSchema`: `id`, `subject`, `body`, optional `planted` (injection cases). `sentBlindCaseSchema`: what the extractor sees (`from`, `to`, `cc`, `subject`, `sentAt`, `body`, `thread` subjects) and no label. `sentLabelSchema`: the checker's `{ expectsReply, promise (bool), due (YYYY-MM-DD | null), promiseDue (YYYY-MM-DD | null) }` plus the blind hash.
- **Decisions:** a time word in a slot is resolved against `sentAt` in the scenario time zone by the core `resolveDue` of stage 05; until stage 05 lands, the planner writes only `{ kind: "date" }` refs and word refs whose date it computes with its own fixed table; stage 05 replaces that table with `resolveDue` (same test values).
- **Test (unit):** T1 each schema accepts the fixture of `fixtures.ts` and refuses a slot with `promise` set and `promiseDue` null; T2 `sentParts` and `simParts` share no member.

## Step 2 — Hard-case tags

- **Goal:** the tags of discovery notes §4.2 Eval as `sentHardCaseTags`: `thanks_only`, `fyi_team`, `question_in_forward`, `conditional_promise`, `reported_speech`, `let_me_know_if`, `reply_to_ooo`, `other_thread_subject`, `injection_quote` (quoted third-party text that tells the model to set fields), `time_word_due` (a due as "Friday", "end of week"), `past_date` (a date before `sentAt`), `far_date` (> 60 days), `many_recipients` (> 10).
- **Decisions:** each tag sets its labels: `thanks_only`, `fyi_team`, `reported_speech` → `expectsReply` false; `conditional_promise` → `promise` null (PD-122: only firm promises); `past_date`, `far_date` → the due label is null (code drops it, D7); `many_recipients` → a filter case, labels all false.
- **Test (unit):** T3 every tag has a label rule and a brief hint; T4 `conditional_promise` slots never carry a promise.

## Step 3 — Planner

- **Goal:** `planSentBank(scenario, spec) → { "sent-dev": SentSlot[], "sent-holdout": SentSlot[] }`, seeded and stable.
- **Decisions:** sizes 50 dev, 250 holdout (PD-123); languages 60% `pl`, 40% `en` per part (±1 case); `expectsReply` true in 50%; a dated promise in 25%; a stated due in 30% of the `expectsReply` cases; each hard-case tag at least 6 times in holdout and 1 in dev; `sentAt` on working days and weekends (20%), in the scenario week range; recipients from the scenario personas and delegates (at least 15% of the `expectsReply` cases go to a delegate: they test D8). The spec lives in `evals/sim/lab-01/sent-plan-spec.json` (new file; the frozen `plan-spec.json` does not change). 25 slots per batch.
- **Test (unit):** T5 the same seed gives byte-equal slots twice; T6 the shares above hold on the real spec (`pl` 150 ± 1 of 250); T7 no slot id repeats across the parts; T8 every hard-case tag count meets its floor.

## Check

`bun test packages/core/src/sim`

## Done when

T1–T8 pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s01`).

## Out of scope

The CLI (stage 02), texts (stage 03), the extractor (stage 05).
