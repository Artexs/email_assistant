# Stage 01 review (Opus, job 2026-11-20-f062-stage-01-review-ec5deffb) — PASS at 0f57ae36

No blocking finding. Trigger logic, backfill reach, old-code compatibility (v0.4.1 works on the new schema), export map and schema.ts hold. Guards g5, g6, g7, g9 and one own mutation fail their tests.

Non-blocking, for the release step: the backfill `UPDATE emails SET source_uid = inbox_uid, move_pending_at = undo_pending_at` runs under the ACCESS EXCLUSIVE lock of the ALTER. 300k rows with 2 KB bodies took 13.8 s at load 22; live queries of the old release wait that long. Coordinator step before the release that carries stage 01: read `select count(*) from emails` on the VPS (read only). If above about 500k rows, a worker adds `WHERE inbox_uid IS NOT NULL OR undo_pending_at IS NOT NULL` to the backfill before the release.

Land rule: stage 01 lands only after the v0.4.2 tag exists. Merge master again before the land.
