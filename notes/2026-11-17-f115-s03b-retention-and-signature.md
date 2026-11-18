# F115 stage 03b: decisions (2026-11-17)

## Reply text retention (review 3 N6)

- One cut-off column: `reply_requests.created_at`. Reason: the instruction is written when the row is made, and the sample is
  written once at the end of the request. A claim, a release or a finish moves `updated_at` but never makes a text newer, so
  `created_at` is stable and cannot keep a text alive.
- One day count: `RETENTION_TEXT_DAYS` (90), the same for every organization. It is not `data_retention_days` (that is the mail
  body period). `retention.ts` passes `textsBefore` to `clearReplyTexts`.
- Where it stands: `modules/replies/retention.ts`, `docs/architecture.md` §7, `docs/capabilities/retention.md` (rule 2 table, rule 8),
  the category `reply-texts` in `packages/core/src/legal/data-categories.ts`, `docs/legal/records-of-processing.md`.
- Tests: `apps/server/src/legal-retention.test.ts` (number, column, docs agree), `apps/server/test/integration/replies-retention.test.ts`
  (created_at vs updated_at, org with 30 and 365 days, repeat run, lock, batch).
- No status filter: an open request older than 90 days is dead; its texts go too. No `texts_cleared_at` column (no migration): a row
  with both texts null is not selected, so a repeat run changes nothing.

## Signature fallback (review 3 N5)

- `mailbox_profiles.signature` is a snapshot of `organizations.style_text` made by the stage 03 migration.
- Fallback order, read at send time (stages 04, 11): profile `signature` (not null) → current `organizations.style_text` → owner name.
  A mailbox with no profile row (made after the migration) reads as "signature null".
- After stage 11 the org card is read-only, so `style_text` does not change and the snapshot and the fallback cannot drift.
- The decision lines are in `stages/stage-04-reply-kind.md` (step 3) and `stages/stage-11-style-card.md` (step 2).
