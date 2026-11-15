# F102 stage 15 review (Sonnet 5.5, PASS 0be955a3)

Model: Sonnet 5.5, because the stage is not on the risky list (API, flag-gated, no migration, no new UI text); it writes state, so the races were attacked with two connections.

No BLOCKING, no TEST GAP. Flag before role (mutant: role first fails T11), second org and table-owner pool (22 pass as owner), cancel races (done vs cancel: one 200, one 409 `not_open`, one audit row; approve vs cancel: send ends `rejected`, delegation `cancelled`), the row lock (T10c), apiDoc, suspended gate, no log lines, no migration.

Judged: 409 `sending` for a send `applying` or `approved` with a fresh lock is correct (safer than `not_open`; `commands.md` lists `sending`). No send goes out after a 200 cancel on the `drafted` path. Mutants m13 and m26 are equivalent (join on `g.org_id`; composite FK).

Notes:
- N1 (real, carry-over to stage 18): a panel approve of a timed-out send answers `expired` but queues no card edit: the Telegram cards stay live (review-9 N3 and review-11 N3 point here; no stage owned it).
- N2 (plausible, not reproduced): review-9 N1 (`newerEditSent` ordering): the web cancel reads `deps.now()` before the send lock, so a cancel that commits after a later-started approve could mark its card edit `stale_edit`; window of milliseconds.
- N3: a reminder already in flight still goes out after a cancel (matches the stage text).
- N4: the draft action stays `applied`; the Drafts copy is handled by `closeDraftOfSend` (same code as the Telegram reject).
- N5: the 2 `cli-streams-other.test.ts` failures in the reviewer's int run are the reviewer's TMPDIR inside the repo (known), not the candidate.
