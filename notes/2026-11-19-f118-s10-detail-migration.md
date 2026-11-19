# F118 stage 10 — Migration B, detail level at send time: notes for the next worker

Ticket: `spec/features/active/F118-e9b-phone-channel-pwa-push-telegram-detail/` (stage 10). **Migration** `db/migrations/20261119130001_telegram_detail.sql`. `TERMS_VERSION` NOT bumped (stage 13). Flags `telegram_minimal` and `web_push` stay OFF by default. Nothing is deployed. **No new Polish text** in this stage (the flag description is English like every flag description).

Owner step after the land: `bun run db:migrate` on the shared dev DB (and on production by the release script). The migration changes no message while the flag `telegram_minimal` is off.

## What was built
- Migration (expand only, no `-- contract:` mark: nothing is dropped or narrowed, the contract check reads no finding): `memberships.telegram_detail text NOT NULL DEFAULT 'minimal'` (CHECK `full|minimal`), then `UPDATE ... 'full'` for every member with a `chat_links` row of the same org and user (the pilot keeps `full`); `organizations.telegram_minimal_locked boolean NOT NULL DEFAULT false`; `outbox_detail_check` replaced by `('full','minimal')`. Down: `outbox.detail` `minimal` → `full`, old CHECK, drop both columns.
- Safe to run on the shared dev DB and on production: one transaction (dbmate), no rewrite of `outbox` except the CHECK replace (a scan, about 171 ms on 300k rows in the stage 02 measure for the same kind of change), the previous release runs on the new schema (it never reads the two columns and writes `outbox.detail = 'full'` by default). A second run (down, then up) gives the same state from the same links (test 6).
- Rollback note (also in the file): by code (`deploy/rollback.sh`); the old code ignores the columns. `db:rollback` relabels `minimal` outbox rows to `full` (a pending row has no text, so the old code renders it `full`: a rollback gives every member `full` again) and loses the member levels and the locks. A later up gives `full` to members with a link and `minimal` to the rest.
- Core: `effectiveDetail({ flagOn, locked, memberDetail })` (`notices/detail.ts`), flag `telegram_minimal` (E9, remove-by 2027-06-01, default off; flag lists in the lab seed, the docs flagged-text list, the two flag-list tests).
- Server: `listTelegramDetailsOf(db, pairs)` (`tenancy/repo/memberships.ts`, one query per batch, joins the org lock); `channels/detail.ts` (`detailsOf`, `detailOfUser`, `createDetailGate`; a member with no membership row reads `minimal`). Sender: renders rows without stored text with the gate level, passes `webBaseUrl`, writes `outbox.detail` with the text (`markOutboxSent` `detail`); `createTelegramRuntime` passes `webBaseUrl` to the sender. `queueNotice` stores the effective level on a Telegram row and check-renders with it (mail, push and `only: push` calls stay `full`). `telegramDetailOf` (direct answers) and the tap edit of `approval-taps.ts` use the effective level. Privacy export map has both new columns.
- Tests: `telegram-detail-schema.test.ts` (migration up/down, CHECKs, pilot rule, one user in two orgs, file rules), `channels-detail-send.test.ts` (stage tests 1 to 7 plus edits, batch, readers), `telegram-detail-runtime.test.ts`, `channels-callbacks.test.ts` 5g, unit `notices/detail.test.ts`. `telegram-schema.test.ts` pin of the detail CHECK now follows `noticeDetails` (the stage 09 note said so).

## Decisions (not fixed by the stage file)
1. The edit of a card (`approval_edit` through the sender, and the tap edit of an approval) uses the level of the member NOW: at `minimal` no Reject button, also on a card that went out at `full`. Reply review edits (`reply-redraft.ts`, `reply-taps.ts`) still use the stored level of their card: their outcomes (`changed`, `skipped`) never carry a button.
2. A row with a stored text keeps its stored `detail` (the sender writes no level for it).
3. The sender writes the level of the send over the level that `queueNotice` stored (the stored one is only for the check render).
4. `/pause` and `/resume` still name mailbox addresses at `minimal` (open question from stage 09, not decided here; the stage 11 or a follow-up can use `telegramDetailOf`).
5. Missing membership row → `minimal` (safe side).

## Cost and hazards
- Every `queueNotice` of a Telegram row reads the flag `telegram_minimal` (one query; killed by `FEATURES_OFF` makes none); with the flag on it reads the member too (one more query). The sender reads the flag once per org per run and the members of the batch once.
- The Telegram fallback row of a push row (`queueTelegramFallback`) inserts `detail = full`; the sender rewrites it at send time.
- The old code (before stage 10) renders a pending row at `row.detail` (`full` always): rolling the code back while the flag is on shows `full` text to members who chose `minimal`. Turn the flag off before a code rollback.

## Proof logs
Under `.f118s10-logs/` in the job worktree (untracked, listed in the git exclude): `mutation-m*.log` (one per guard; each shows the failing test names and `RESTORED clean=True`), `proof-*.log`, `int-env-i.log` (changed integration tests under `env -i`, `bun --no-env-file`), `lint-early.log`.
