# F113 stage 12 — scorer: M2–M5, M7, delegates, limits

Part of [`../plan.md`](../plan.md). Decisions D9, D10, D14, P6, P7.

## Goal

The second half of the report: the E3a metrics on the run window, what each delegate behaviour led to, the executive's taps, the send-limit hits and phishing pushes.

## Files

`apps/server/src/modules/lab/score/metrics.ts`, `delegates.ts`, `limits.ts` and their render parts.

## Interfaces

Each section is a function `(db, ctx, run, events, joined: ScoredMail[]) => Promise<SectionResult>` stored under `LabScore.sections.<name>`: `metrics`, `delegates`, `executive`, `limits`, `phishing`.

## Decisions

- **Window.** `range` = [plan start 00:00 Warsaw, `tailEndsAt`), the run mailbox, `testMail.senders` = [] (lab mail is real in its own stack).
- **Metrics.** Call the E3a readers and core functions; never copy a formula. M2 `openLoopsOnTime` on the delegation due rows; M3 `seriousMistakes` on hidden moves, rejects and mistakes; M4 `handledShare`; M5 `urgentLatency` on urgent notice times (quiet hours as the core rule says); M7 `unitCost` on the run's `llm.call` rows. If a reader is not exported from its module index, export it; do not copy it.
- **M5 note.** Latency starts at the mail's stored received time, so a late injection does not count against the system. The report lists late injections (stage 11) next to M5.
- **Delegates table.** One row per behaviour: planned (slots), delegation sent (a delegation of that mail is `sent`, `overdue` or closed), answered (`answered_at` set), answered by an auto-reply (the answer came from a mail with `Auto-Submitted`; N3), reminders sent (count), overdue, never sent. Expected outcome per behaviour, shown as a column: `done` answered; `late` answered after ≥ 1 reminder; `out_of_office` not answered, ≥ 1 reminder; `other_address` not answered (the planted F040 miss; "answered" here is a finding for E5b); `silent` not answered, ≥ 1 reminder. A row shows `ok` or the count that differs. Also `unexpected_delegation` and `unmapped` counts from the bot events.
- **Executive table.** Presses by rule (approve, reject with reason, Undo, reminder set, send again), `unmapped`, `no_rule`, `fake_restarted`, and approvals that expired without a tap.
- **Limits.** Count of `actionSendLimited` audit rows per limit kind (mailbox hour, mailbox day, recipient day) and the held sends at run end (PD-068). Zero hits prints "no send limit reached".
- **Phishing.** Slots with a `phishing_*` hard-case tag: injected, triaged `urgent`, got an urgent notice (from the M5 reader), and, when a warning field exists for suspicious mail at your commit (E3b, F109), how many notices carried it. Else the column says "no warning field". M3 counts an unwarned urgent push (PD-063): report it as its own line.
- **No text.** Sections hold counts, slot ids and action ids; no subject, body or address.

## Tests

Unit (render and table logic with fixed rows):
1. Delegates: `done` planned 4, answered 4 → `ok`; `late` planned 2, answered 1 with reminders 1, 1 unanswered → shows the 1 that differs.
2. `other_address` answered 1 → the row flags it as a finding.
3. Limits: 2 `recipient_day` rows → "recipient day 2"; 0 rows → "no send limit reached".
4. Phishing: 5 injected, 2 urgent notices, no warning field → the column says "no warning field" and "unwarned urgent push 2".

Integration (job DB, seeded rows, one org):
5. M2: two delegations due in range, one answered before due → on time 1 of 2 (the core result).
6. M7: 3 `llm.call` rows → the cost equals `unitCost` of the same rows.
7. Tenant: rows of a second org in the same range change no number. Mutation: give a reader the other org's context → test 7 fails. Restore.
8. Executive table from fixture events: 3 approve, 1 reject `p`, 1 Undo, 1 `unmapped`.

## Done when

Tests pass; the full report renders with all sections; `live-lab.md` lists the sections; the Proof prints `PROOF_OK`.

## Out of scope

A judge of draft text (Q8). Charts.
