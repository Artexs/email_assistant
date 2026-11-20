PASS 1525e0c0b10a70c6c2b56c8d85e00ecacaf48f99

HEAD matches the candidate. I found no proven break of a ticket acceptance bullet. The plan's code facts held. Two gaps and four smaller notes follow.

**Unverified**
- I did not run the planned tests T1–T7 or `check:job`. The plan has no code yet, and the review rules bar suites. The plan's Zod probe was not run in this worktree, because it has no `node_modules`.
- I re-ran an equivalent probe against the main checkout's zod 4.6.7, which is also the `bun.lock` version of `zod`. It matched `plan.md:66` exactly:
  - `2026-13-01`, `2026-02-30`, `2026-02-29`, `10.11.2026` and `2026-11-10 ` fail, each with one issue `{code:"invalid_format", path:["due_date"]}`.
  - `2000-02-29` and `""` pass.
  - `null` and `42` fail `dueDateSchema`, so `dueDateOrNone` returns `""` for them.

**Notes**
1. **Gap, plausible: the D5 count runs too late.**
   - `plan.md:96` has the coordinator count bad stored drafts after the release. The release itself causes the damage.
   - Code at HEAD:
     - `apps/server/src/modules/channels/notices/approval.ts:74` and `approval-set.ts:31` call `draftPayloadSchema.parse`, so they throw for a stored draft with a bad date.
     - `approvals-read.ts:125-127` skips the approval view for such a draft.
     - `actions/send-prepare.ts:46-47` returns `null` for it.
     - `actions/drafts.ts:279-280` fails a not-yet-applied draft as `bad_payload`.
   - A delegation draft that is pending at release time would have its card, send or draft application fail.
   - Fix: run the same read-only count before the release, or make it a gate for the release. A count above zero then picks between the migration and the read-side fallback (`questions.md:3`, options a/b) before cards break.
   - Plausible, because it depends on the classifier having written such a date. `analysis.ts:17` accepts `\d{4}-\d{2}-\d{2}`, so it can.

2. **Ticket drift, proven by reading `ticket.md:13` against `stage-01-calendar-due-date.md:138-142`.**
   - The ticket scope names only `triage/payloads.ts` and its test.
   - The plan also edits `planners.ts`, `delegation/chaser.ts`, their two tests and two capability pages. The ticket's Acceptance has no bullet for D2/D3 (planner and chaser write `""` for a bad date).
   - Add the planner, the chaser and the pages to the ticket Scope, with one Acceptance bullet for D2/D3. Otherwise a reviewer holding only the ticket cannot judge them.

3. **Test wording, minor, `stage-01-calendar-due-date.md:172` (T4).** The text reads `draftPayloadSchema.safeParse(draft)` where `draft` is the `create_draft` action. At `packages/core/src/triage/planners.test.ts:81-82` the destructured `[draft]` is the action, and the payload is `draft.draft`. A worker will probably find it; say "the `draft` field of the action".

4. **Edge case, minor, P1 `plan.md:48`.** P1 says "real calendar date". `z.iso.date()` also accepts `0000-01-01` and `9999-12-31` (probe). `dueInstant` in `delegation/service.ts:167-171` accepts the same, so there is no inconsistency. Either add one `true` row for the year bounds to T2 or leave it.

5. **T7, minor, `stage-01-calendar-due-date.md:175`.** It says the old regex makes T1, T2 and T4 fail. Because `dueDateOrNone` uses `dueDateSchema`, T5 and T6 would fail too. The listed subset is not wrong, but the worker could treat it as the full set.

6. **Checked and fine.**
   - Writers of `due_date`: `planners.ts:81,98`, `chaser.ts:100,107`, `loops/delegate.ts` (always `null`), and fixtures with only valid dates or `""`.
   - Two literals are not affected:
     - `"CANARYdue"` is a notices fixture (`packages/core/src/notices/minimal.test.ts:30`) that never reaches the draft schema.
     - `"04.11.2026"` already fails in `analysis.test.ts`.
   - `triage/service.ts:190` reads `payload.due_date || null`, so D2's `""` gives `null`, which matches today's `dueInstant` outcome.
   - `payloads.ts:~25` defines `dueDateSchema` as a non-exported `const`, as D1 expects.
   - `planners.ts` already imports `./payloads`, so there is no import cycle.
   - `plan.md` has 83 lines, the stage file 65.
   - D3 is reachable. A null `due_at` becomes send plus 3 days (`delegation.md`), so a reminder can copy an old bad date.
   - Not a finding: the plan follows the size rules, and its code detail is deliberately light.

**Checks run:**
- `git rev-parse HEAD`: matches the candidate.
- One `bun` probe script of `z.union([z.literal(""), z.iso.date()])` inside a `discriminatedUnion`: results as above. I deleted the script afterwards.
- Greps and reads of the files named above.
- No `bun test`, lint, typecheck or `check:job` run.
