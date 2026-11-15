# F113 stage 13 — scorer: M2–M5, M7, delegates, limits

Part of [`../plan.md`](../plan.md). The second half of the report. Decisions D9, D10, D14, P6, P7. Review 1: T5, T6, N1.

## Files

`apps/server/src/modules/lab/score/` (sections and render parts), `rangeMetrics` in `reports/metrics.ts`.

## Interfaces

Each section is a function `(db, ctx, run, events, joined: ScoredMail[]) => Promise<SectionResult>` stored under `LabScore.sections.<name>`: `metrics`, `delegates`, `executive`, `limits`, `phishing`.

## Decisions

- **Window.** `range` = [plan start 00:00 Warsaw, `tailEndsAt`), the run mailbox, `testMail.senders` = [] (lab mail is real in its own stack).
- **One join point** (review N1): `docs/code-patterns.md` makes `reports/metrics.ts` the only service that joins the metric readers. Add `rangeMetrics(db, ctx, { range, mailboxId, now }, deps)` there, next to `weekStats`, and call it from the scorer. It calls the E3a readers and core functions; never copy a formula: M2 `openLoopsOnTime`, M3 `seriousMistakes`, M4 `handledShare`, M5 `urgentLatency` (quiet hours as the core rule says).
- **M7** (review T6): core `unitCost` scales a 7-day week to a month. Week run: M7 on the 7 run days only (`[start, endsAt)`); the tail cost is a separate USD total. Day run: total USD and USD per mail only; the month figure says "needs a week run".
- **M5.** Latency starts at the stored received time (a late injection does not count against the system); late injections are listed next to it.
- **Delegates table.** One row per behaviour: planned, delegation sent, answered (`answered_at`), answered by an auto-reply (`Auto-Submitted`; N3), reminders sent, overdue, never sent. Expected outcome per behaviour: `done` answered; `late` answered after ≥ 1 reminder; `out_of_office` not answered, ≥ 1 reminder; `other_address` not answered (the planted F040 miss; "answered" is a finding for E5b); `silent` not answered, ≥ 1 reminder. A row shows `ok` or the count that differs.
- **Reachable reminders** (review T5): a delegation expects a reminder only when the first 07:30 Warsaw chaser run after its due time, plus 2 h for the executive's tap, lies before `tailEndsAt`. Other delegations go to a column "reminder not reachable in this run" and never count as a mismatch. A day run has none reachable. Also `unexpected_delegation` and `unmapped` counts from the bot events.
- **Executive table.** Presses by rule, `unmapped`, `no_rule`, `tap_unsure`, `fake_restarted`, approvals expired without a tap.
- **Limits.** Count of `actionSendLimited` audit rows per limit kind (mailbox hour, mailbox day, recipient day) and the held sends at run end (PD-068). Zero hits prints "no send limit reached".
- **Phishing.** Slots with a `phishing_*` hard-case tag: injected, triaged `urgent`, got an urgent notice (from the M5 reader), and, when a warning field exists for suspicious mail at your commit (E3b, F109), how many notices carried it. Else the column says "no warning field". M3 counts an unwarned urgent push (PD-063): report it as its own line.
- **No text.** Sections hold counts, slot ids and action ids; no subject, body or address.

## Tests

Unit, fixed rows:
1. Delegates: `done` planned 4, answered 4 → `ok`; `late` planned 2, answered 1 with reminders 1, 1 unanswered → shows the 1 that differs.
2. `other_address` answered 1 → flagged as a finding.
3. Limits: 2 `recipient_day` rows → "recipient day 2"; 0 rows → "no send limit reached".
4. Phishing: 5 injected, 2 urgent notices, no warning field → the column says "no warning field" and "unwarned urgent push 2".

Integration (job DB, seeded rows, one org):
5. M2: two delegations due in range, one answered before due → on time 1 of 2 (the core result).
6. M7: 3 `llm.call` rows inside the 7 run days and 1 in the tail → M7 equals `unitCost` of the 3; the tail line shows the fourth row's cost.
6b. Day run from 2026-11-27: a `silent` delegation sent at 10:00 (due 2026-11-30) → "not reachable", no mismatch.
7. Tenant: rows of a second org in the same range change no number. Mutation: give a reader the other org's context → test 7 fails. Restore.
8. Executive table from fixture events: 3 approve, 1 reject `p`, 1 Undo, 1 `unmapped`.

## Done when

Tests pass; the report renders all sections; `live-lab.md` lists them; `PROOF_OK`.

## Out of scope

A judge of draft text (Q8). Charts.
