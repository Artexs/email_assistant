# F102 stage 08 review (Opus, PASS) and follow-up

Review job `2026-11-15-f102-review-s08-opus-editapprova-4f1c3dc3`, candidate 27d3fe79. Result: PASS, no blocking finding.

## Test gaps (closed in the follow-up commit)

- TG1: `actions-edit.test.ts` T5c now edits a send in `applying`, `applied`, `rejected`, `expired` (plain) and `approved` (held). Each answers `closed` with that state and writes no row. Mutation: the status guard removed fails T5 and T5c (`/tmp/f102-s08/mutTG1-noguard.log`); source restored.
- TG2: T9b (two connections): the setter commits first; the edit answers `drafts_off` and the only send is `expired` / `policy_changed`.
- TG3: the tap test now runs `ap:` and `ar:` in `en` and `pl` and compares with `textTables[locale].bot.taps.changed`.
- TG4: not changed. The lock poller counts all waiting sessions; deterministic in a job DB.

## Notes

- N1: sound. The edit re-reads mode and `create_draft` under the settings share lock instead of comparing a version. The share lock is the first statement, so no earlier version exists. Both setter orders are proven (T9 and T9b); no deadlock, both lock settings and then sends.
- N3: `onSuperseded` uses `new Date()` for `delegations.updated_at` because the hook input has no `at`. Harmless (retention skips open delegations). Carry-over: stage 09 adds `at` to the hook input.
- N5: the edit answer does not say that the old Drafts copy stays without UIDPLUS. This follows `commands.md`: `draftRemovable` belongs to the detail. Carry-over: stage 10.
- N7: a non-UUID `delegateId` or `sendId` reaches Postgres and gives a 500. Carry-over: stage 11 validates route input.
