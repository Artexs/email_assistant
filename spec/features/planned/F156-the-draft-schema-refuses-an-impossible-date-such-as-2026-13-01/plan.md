# F156 plan — the draft schema refuses an impossible date

> **Status 2026-11-20 — planned.** Plan base: a5399ff1. One stage, not built.

## Input

Owner words (F125 `audit/report.md` § Questions, answered 2026-11-20, word for word):

> **Question 2 (weak rules):** yes for the date: a follow-up makes the draft schema refuse `2026-13-01` and flips `triage/payloads.test.ts:49`. No for the query key: an unknown key in a web query stays accepted; `web/activity.test.ts:39` stays.

Decisions:

- **P1 — Refuse a date that is not on the calendar.** The `due_date` of a `delegation` and a `reminder` draft accepts `""` (no date) or a real calendar date `YYYY-MM-DD` (month 01–12, day within the month, 29 February only in a leap year). Owner decision above. Rejected: a check of month 01–12 only (it still accepts `2026-02-30`, which the ticket Acceptance refuses).
- **D1 — Use Zod's `z.iso.date()`.** `dueDateSchema = z.union([z.literal(""), z.iso.date()])` in `triage/payloads.ts`, exported. Reason: the Zod 4 built-in checks the calendar, leap years included (Facts checked), and gives one exact issue. Rejected: a hand regex or a `Date` round trip (more code for the same rule; `changelog.ts validDate` and `delegation/service.ts dueInstant` stay as they are, out of scope).
- **D2 — The planner turns an impossible LLM date into "no date".** The classifier analysis schema (`triage/analysis.ts`) accepts any `\d{4}-\d{2}-\d{2}` and stays so (ticket: other schemas out of scope). The planner (`planDelegation` in `triage/planners.ts`) writes `due_date: dueDateOrNone(input.dueDate)`. Reason: a delegation draft is not validated on insert (`actions/repo/planned.ts` checks only reply payloads), and the approval card reads it with `draftPayloadSchema.parse` (`channels/notices/approval.ts`, `approval-set.ts`, `actions/drafts.ts`). Without D2, one bad LLM date makes a draft whose card throws. "No date" is the rule that already holds for the delegation (`docs/capabilities/delegation.md` rule on `due_at`: "A date that does not exist gives no date"). Rejected: refuse the whole analysis (one bad field would drop a good classification); refuse at insert (the delegation would not be planned at all).
- **D3 — The chaser does the same for a stored date.** `delegation/chaser.ts` copies the `due_date` of the stored original draft into the reminder draft. It uses `dueDateOrNone` too, so an old draft that holds an impossible date gives a reminder with `""`, not a reminder that cannot be read.
- **D4 — Interface `dueDateOrNone(value: unknown): string`** in `triage/payloads.ts`, exported from `@ea/core` (the `triage/index.ts` barrel re-exports `payloads`). It returns `value` when `dueDateSchema` accepts it, else `""` (also for `null`, `undefined` and a non-string from an old payload). Both D2 and D3 call it; no other copy of the rule.
- **D5 — Stored drafts with an impossible date: no migration (default, owner to confirm, `questions.md` Q1).** Such a row can exist only if the classifier wrote such a date. After the change, `safeParse` readers treat that draft as invalid (as for any other bad payload), and the `parse` readers throw for it. A migration that rewrites `actions.payload` is out of proportion for a case that may have zero rows. The coordinator runs one read-only count on production after the release (Owner steps); a count above zero becomes a follow-up ticket. Rejected: a data migration now (irreversible write on user data for an unknown count).
- **D6 — Message text.** A delegation with an impossible date now renders with no "Due:" / "Termin:" line, the same as a draft with no date (`outgoing/templates.ts`). No new user text.

Edge cases, answered:

- Valid stored dates (`2026-11-10`, `""`) still parse: T3, and every existing caller test (Done when).
- 29 February: `2028-02-29` passes, `2026-02-29` and `1900-02-29` fail, `2000-02-29` passes (T2).
- A `null` or missing date from the analysis or from an old draft without the key: `dueDateOrNone` returns `""` (T5).
- Other kinds (`clarification`, `follow_up`, `reply`) have no `due_date`; `follow_up.sent_at` is out of scope.
- No log, no secret, no tenant change: the change is a pure schema and two pure calls.

## Facts checked

- Zod `^4.1.12` (`packages/core/package.json`): probe in this worktree, 2026-11-20. `z.union([z.literal(""), z.iso.date()])` inside `draftPayloadSchema`-like `discriminatedUnion` gives for `2026-13-01` exactly one issue `{ code: "invalid_format", path: ["due_date"] }` (Zod picks the `iso.date` branch issue, not `invalid_union`). Results: `2026-11-10` ✓, `""` ✓, `2028-02-29` ✓, `2000-02-29` ✓; `2026-13-01`, `2026-02-30`, `2026-02-29`, `1900-02-29`, `2026-04-31`, `2026-00-10`, `2026-11-00`, `10.11.2026`, `+2026-01-01` ✗, each `invalid_format` with `format: "date"`.
- Readers of `draftPayloadSchema` at `a5399ff1`: `parse` in `actions/drafts.ts`, `channels/notices/approval.ts`, `channels/notices/approval-set.ts`; `safeParse` in the other action, channel, loop and reply modules (grep `draftPayloadSchema`).
- Writers of `due_date`: the core planner (from `analysis.fields.due_date`), the chaser (copy of the original), `loops/delegate.ts` (always `null` → `""`), test and e2e fixtures (`""` or real dates).

## Not verified

- The production count of drafts with an impossible date (D5). The coordinator checks it after the release (Owner steps).

## Done when

- T1–T7 of stage 01 pass, and the old case `due_date: "2026-13-01"` → `success: true` is gone.
- `bun run check:job` passes: it runs the unit and integration tests that import the changed files (planner, chaser, payload tests and their callers).
- `docs/capabilities/drafts-and-send.md` (the `payload` of a draft line) says that `due_date` is `""` or a real calendar date, and `docs/capabilities/delegation.md` says that the planner and the chaser turn an impossible date into no date.

## Rules for every stage

- Change only the `due_date` rule, the two callers of D2/D3, their tests and the two capability pages. Do not touch `analysis.ts`, the web query schemas, `follow_up.sent_at`, or `web/activity.test.ts`.
- Tests follow `docs/code-patterns.md` § Tests: one named behaviour, exact values, a `test.each` table for the date list; break the code once to see each new test fail.
- Format only the stage's files. A gap or a deviation from a decision is a question in the final message, not a choice.

## Proof

The last line of `bun run check:job` (`check:job PASS master=… tip=…`), run once as the last step.

## User checkpoints

None. The change is one pure schema rule with owner approval.

## Owner steps

- After the release that carries stage 01 (coordinator, production, read-only, a record, not a stop): count `actions` rows of type `create_draft` whose `payload->>'kind'` is `delegation` or `reminder` and whose `payload->>'due_date'` is not `''` and does not pass the calendar rule, grouped by `status`. Above zero: open a follow-up ticket (D5).

## Review

Stage 01 lands on the worker's proof. It is not `[risky]`: no migration, no send path change, no new text.

## Stages

- [ ] [stage 01 — the due date is a calendar date](stages/stage-01-calendar-due-date.md)

## How to run (coordinator)

Move the ticket to `active/`, then spawn stage 01 with the board's worker flags (`spec/build.md`: `claude-sonnet-5-5`, `--thinking high`, personal Claude route, `--prepare 'bash scripts/limen-prepare.sh'`). It may run next to any stage that does not edit `triage/payloads.ts`, `triage/planners.ts` or `delegation/chaser.ts`.

## Planning progress

- Scouts: 0. The job task says "Do not use limen wait or any tool that waits for another job", so I read the code myself (the ticket is small).
- [written] ticket.md (`## Sequenced`, `## Slices` added), plan.md, stages/stage-01-calendar-due-date.md, questions.md.
- Word counts (`wc -w`, before the commit): plan.md 1,196; stage 01 667; ticket.md 199; questions.md 174.

## Cold review

Model: `claude-sonnet-5-5` — the plan has no `[risky]` stage and touches no risk area of the `spec/build.md` standing-models line. Started detached; this job does not wait for it (task rule above). The coordinator files its final message as `plan-review-1.md`.
