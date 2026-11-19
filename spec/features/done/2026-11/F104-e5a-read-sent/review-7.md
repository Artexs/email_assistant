# F104 stage 07 review notes (Opus review of 9c08b0e0: PASS with test gaps)

Source: `.limen/jobs/2026-11-15-f104-review-s07-opus-retention-o-bbbcf479/result`, mutation files in `/tmp/f104-s07-review/`.

## Test gaps (closed in the follow-up commit)

1. The `org_id` filter in the inner subquery of `clearSentBodies` and `clearSentHeaders` is not an equivalent mutant: without it the batch fills with rows of other organizations and locks them, and org A is not cleared. `retention-clear.test.ts` now has, for both functions, a case with an old org B row of a lower id, an old org A row of a higher id and `batch: 1`. The reviewer mutations M1 and M2 fail it (logs `/tmp/f104-s07/tg1-M1.log`, `tg1-M2.log`).
2. The readers had no log canary test. `mail-sent-readers.test.ts` now captures every console method with `util.format` while it calls `listUserAnswers`, `getSentSummary` and `listSentHealth` on a sent row with a canary subject, body and address: no line at all. A `console.log` added to `listSentHealth` fails it (`/tmp/f104-s07/tg2-mut.log`).

## Notes

- Equivalent mutants (survive every test, no risk): the outer `org_id` filter of `clearSentBodies`; the `org_id` filter of `getSentSummary` (`getSentSyncState` scopes by org and mailbox ids are unique); single drops of an `org_id` filter in `listUserAnswers` (the join has `s.org_id = e.org_id` and both sides are filtered; only the pair drop fails).
- The `SKIP LOCKED` mutants (and the value-guard mutants) fail by the 5 s test timeout, a hang, not an assertion. They still discriminate.
- Stage 12 carry-over: after retention, a kept `stored` row exports `body_text` null; the erase of it expects `[removed]` (see the Carry-over section of `stages/stage-12-dsr-sent.md`).
- Hardening idea only: `listUserAnswers` with a non-UUID id raises Postgres 22P02. Callers pass DB ids.
- F116: a loop open longer than `data_retention_days` needs its own copy (Sent text goes after that); stated in `docs/capabilities/sent-mail.md` Limits.
