# S5d web activity: facts and deviations

Source: `tasks/active/s5d-web-activity.md` (facts 1–14, B1–B15, Log). The task file moves to `tasks/done/` at the merge. Built 2026-11-11 in the worktree `task/s5d-web-activity`. Read this note before you change the Undo path, the feedback path, the activity read model, the activity page or the e2e data.

## The shared words (B2, U6)

- `packages/core/src/digest/answers.ts` is the one source of the Telegram answers: `UNDO_TEXTS` (five texts), `rightAnswer`, `pickedText`, `pickAnswer`. Names come from `categoryLabels`.
- `channels/callbacks.ts` imports them. It re-exports `UNDO_TEXTS` because other code and tests import it from `channels`. Its answers are byte-equal to the old ones.
- The web keeps its own strings in `apps/web/src/i18n/en.ts` (keys `act_cat_*`, `act_toast_*`, `undo_*`). Reason: every web string must stay in `en.ts` for S6 translators.
- `apps/web/src/lib/activity-text.test.ts` ties each key to the core function or constant. If you change a Telegram answer, this test fails until `en.ts` follows.

## `undoWithFeedback` and the Telegram path (B4, B5)

- `triage/undo.ts` `undoWithFeedback` is the one Undo path for the Telegram tap and `POST /api/actions/undo`.
- The order is fixed: `getLabelTarget` first (no triage result or another organization gives `not_found` with no other query), then `undo()`, then, only for `started` and a category other than `unsure`, `recordFeedback({ verdict: "wrong", source: "undo", skipIfSame: true, keepLabel: true })`. One transaction. A feedback error rolls the reverse rows back.
- The triage-result check comes first on purpose: Telegram did it first, so both channels answer `not_found` alike for a mail with actions and no triage result.
- `recordWebFeedback` (`triage/feedback.ts`) does the same for ✅ and ✏️: `getLabelTarget` first, so no `HardError` for a mail with no triage result. The route maps `not_found` to 404.
- The web `trueCategory` accepts only the five label categories (`labelCategories`). Telegram offers no ✅ for `delegation` or `unsure`, so the web does not either.
- Both functions join the caller's transaction (`db.isTransaction`).

## The read model (B6, B7)

- `reports/activity.ts` `listActivity` runs at most 7 queries per page, the same for 3 and for 60 rows (a test counts them with a Kysely plugin, fact 7). An empty id list skips its query. Order:
  1. `listActivityRows` (`limit + 1` rows; the mails and their latest triage result in one SQL).
  2. `listActionsForEmails`.
  3. `listSummaries` (`info` mails).
  4. `listDraftTasks` (`delegation` mails).
  5. `listLatestFeedbackByEmailIds`.
  6. `listLatestDelegationsByEmailIds`.
  7. `listDelegateNames`.
- The cursor is the base64url of `<received_at text with microseconds>|<email id>`. `received_at_key` comes from `to_char(… 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, so a writer with microseconds cannot make the cursor skip or repeat a row. `decodeActivityCursor` refuses a bad base64url, a missing or double `|`, a date that does not exist (also year 0000) and a non-UUID id. The route answers 400 `validation` with the path `before`, code `invalid_cursor`.
- The window is the later of `since` (default 7 days) and 90 days back (`ACTIVITY_MAX_DAYS`). A `since` older than 90 days is clamped, not refused.
- No migration and no new index. At pilot size (hundreds to a few thousand mails per organization) the keyset query sorts the organization's mails in the window in memory. Add an index on `emails (org_id, received_at, id)` if a page gets slow. The existing indexes are `emails_org_id_idx`, `emails_claim_idx`, `triage_results_email_created_idx`, `triage_feedback_email_created_idx`, `actions_email_id_idx`; `delegations` has none on `email_id`.
- `ActivityItem` has no `statusReason` and no "(removed)" text. No user text exists for the internal reason codes. No retention job exists yet, so no subject or sender is cleared; a `null` subject shows "(no subject)" and a `null` sender "(unknown sender)".
- **Action order needs distinct `created_at`.** `listActionsForEmails` orders by `created_at, id`. Equal `created_at` gives a random phrase order (the id is a random UUID). Seeds and tests must give each action of a mail its own `created_at` (stage 4 test 1; stage 10 M1: the move at now − 1 h, the `mark_read` at now − 1 h + 1 s). The Telegram digest has the same behaviour today; it is an existing property, not new.
- `GET /api/activity` answers 200 with no items for another organization's `mailboxId` (the tenant filter; nothing leaks). A foreign or unknown mail on `POST /api/feedback` and `POST /api/actions/undo` is 404 `{ error: "not_found" }`. A bad id in a body or query is 400 (the id is not in the path).

## The list state and polling (B11, U7)

- `lib/activity-list.ts` holds the pure state functions (`firstPage`, `mergePolled`, `appendOlder`, `patchItem`); `lib/use-activity-list.ts` is the hook (30 s poll through `startPolling`, visible tab only).
- A poll refreshes the first page. `mergePolled` keeps the older loaded pages that are older than the last polled item, without duplicates. When no older page is loaded, or the polled page is empty, it takes the polled page as it is. `nextBefore` and `loadingMore` stay while a "Load more" runs.
- "Load more" has its own token. A poll does not invalidate it; `refresh()` does. `appendOlder` applies only when `nextBefore` still equals the cursor that the request sent.
- `patch()` (a tap on ✅, ✏️ or ↩️) bumps the first-page sequence number, so a poll in flight at that moment is dropped. The next poll brings the data.
- A filter change re-keys the list, so a new hook starts and a failed refresh cannot show rows of the old filter.

## The e2e data (B12, B14, facts 9 and 10)

- The global seed adds a second organization `E2E Other` with a paused mailbox and one triaged mail (`SeedFile.otherOrg`). The tenant tests (404 on feedback and undo) use `otherOrg.emailId`. It also adds one extra `assistant` per project (`SeedFile.activityMembers`), because `account.spec.ts` changes the password of `members[project]` before `activity.spec.ts` runs. The wipe deletes both organizations.
- The activity mail is not in the seed. `scripts/e2e-activity.ts --mailbox-id <uuid>` inserts it per test after the spec connects its GreenMail mailbox (`seedActivityRows` in `e2e-activity-rows.ts`). `cleanUpOrg` removes the mailbox and the rows with it.
- The script refuses every database whose name does not end in `_e2e` (`seedTargetOk`). It never runs in the image: no route calls it.
- The seeded mail has `folder = source_folder = INBOX` and a synthetic Message-ID (`…@ea-seed.test>`), so `ACTIONS_SCOPE=synthetic` admits an Undo. A reverse move then goes INBOX → INBOX; the committer only looks for the mail.
- **Committer outcome (fact 9), seen in stage 10:** the e2e server log had no `error` line and no `failed mail_not_found` line. The committer did not run before `cleanUpOrg` removed the mailbox. From the code, a committer run would end the reverse move and the reverse `mark_read` of M1 with `action <id>: failed mail_not_found` (a `warn` line and an `action.failed` audit row, no retry), because the synthetic mail is not in GreenMail. Fact 9 is "partly verified": no error line; the warn lines did not appear.
- Playwright counts: 40 tests (10 new). Block 90/190 of `x-forwarded-for` is the activity spec's.

## Fact 14: `en.test.ts` now runs in `test:unit`

`apps/web/src/i18n/en.test.ts` (S5c) was outside the `test:unit` paths, so it never ran in the check line. Stage 7 added `apps/web/src/i18n` to the root script. Before that, only a manual `bun test apps/web/src/i18n` ran it.

## Deviations from the plan

- Stage 1: `callbacks.ts` lost the unused `label` helper.
- Stage 4: test 1 gives the move and the `mark_read` distinct `createdAt` (see "Action order" above). Review minor fixed: `decodeActivityCursor` refused only bad shapes, not dates that do not exist (`567211f`, then year 0000 in `0d62296`).
- Stage 3: review minor fixed in its own commit (`ageFeedback` in `activity-repo.test.ts` had no `WHERE`).
- Stage 6: the unused `post()` parameter of the test helper was removed.
- Stage 7: `use-media` got a stable `subscribe` (`3134b4d`); one more pick-toast assertion.
- Stage 8: the "Updated" time resets on a filter change; the mailbox filter shows only with two or more mailboxes.
- Stage 9: row lines are `span`s (a `button` holds phrasing content only); `CategoryPicker` has a `DialogDescription`; `SheetContent` has `aria-describedby={undefined}`.
- Stage 10: test 3 uses an exact Undo button locator; M1 `mark_read` is at now − 1 h + 1 s.

## Review notes that stay open (accepted minors)

- The row and the panel each have their own pending state in `ActionButtons`. A tap in one does not disable the buttons in the other; the server answers "Already saved." or "already" for a double tap.
- Focus returns to `body` after a tap on a button that becomes disabled.
- The panel empties at once while it slides out (cosmetic).
- The optimistic `feedback.at` after a tap uses the client clock; the next poll replaces it with the server time.
- With a failed `GET /api/mailboxes`, a mailbox id in the URL counts as "all mailboxes".
- `en.test.ts` (fact 14) runs in `test:unit` now, but it checks only the messages of the core body schemas. The activity schemas have no custom messages, so it checks nothing new for S5d.
- iOS Safari is not verified (the S5e hand check on the phone). The bottom Sheet with a long AI text was checked by Playwright on the Pixel 7 viewport only.
