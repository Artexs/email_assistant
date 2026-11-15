# F116 stage 08 review (Sonnet 5.5, PASS 5f51e3f7)

Model: Sonnet 5.5, because the stage has no migration and no new user text; tenancy and erase code attacked hard.

No BLOCKING. Filters, retention (closed loops only, exact boundary, idempotent, skip locked, batched), the sent-off hook from the real `setSentSync` path, logs (no text or address) and docs hold.

TG1 (proven by mutant; fixed in a Sonnet continue): the inner org filter of `clearLoopTexts` was covered only by RLS; add a test that fails without it.
TG2 (proven by mutant; fixed): no test asserted that `restartLoop` keeps `surfaced_at` (owner decision 51).

Carry-over notes (each also in the stage file it concerns):
- N1 stage 14: the commands `laterLoop` and `reopenLoop` share names with the repo functions (both exported from `loops/index.ts`): import the repo ones under an alias or rename the commands.
- N2 stage 14: repo `laterLoop(trx, ctx, { loopId, dueAt, userId?, at })` takes a computed `dueAt` and refuses no kind; the command must refuse `promised` with `not_allowed`.
- N3 stages 20/21: `listLoops` takes `now` and a decoded `before: LoopCursor` (`next` is an encoded string); `due` is `due_at <= now`, so the route passes the end-of-local-day instant as `now`; `briefLoopsOf` uses `< dayEnd`: the two differ at exactly midnight.
- N4 docs: `interfaces.md` shows the old `clearLoopTexts(db, { before, batch })`; it is `(…, ctx, now)` now. Fixed in the continue.
- N6 docs: `retention.md` rule 8 does not name `loop_rows` in the log-count list. Fixed in the continue.
- N7: `onSentOff` leaves loops already closed (e.g. `replied`) with their texts until the 90-day retention (T7, D18): texts outlive the withdrawal by up to 90 days. State it in the docs.
- N8: an open loop keeps its subject after the Sent subject clears at 90 days (owner decision 51).
- N9 (plausible): `onSentOff` locks the sent-sync state first, then the loops; the stage 12 analysis job locks the loop first, then sends. Stage 12 must confirm there is no deadlock with `setSentSync`.
