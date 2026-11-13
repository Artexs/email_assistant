PASS 074c24440394d2f57d4a54576173f6e6e514ba84

# F088 group review C1 (stages 03–05), file: review-group-c1.md

The checked-out HEAD is `074c244`, the same as the candidate. The tree was clean.
The range I reviewed is `aa315e2^..074c244`, limited to the F088 files: the migration, `channels/{repo,sender,notice-queue,notices,digest-job,callbacks,port,index}.ts`, `packages/core/src/notices/*` as the stages use it, and the test diffs.

## Blocking findings

None.

## Unverified checks

- The full `bun run test:int` suite did not run. I ran only the 21 F088-related int files (list below). The other int files are not checked at this commit.
- `bun run test:e2e` did not run, by the job rules. Nothing proves the path from a real detector through the sender to a fake Telegram chat in a browser-level run.

## What a user receives (the checkpoint questions)

1. **The texts did not change. Proven by code and tests.** Every producer queues a view. The sender renders that view with the same function as the test helpers (`renderNotice` with the same options) and stores the result in the same `UPDATE` as `sent` (`repo.ts` `markOutboxSent`). The renderer entries call the old render functions with the old inputs (`packages/core/src/notices/renderers.ts`). Two cases differ only in form: urgent rebuilds `aiTextFor` and `describeActions` from facts, and send_result maps a null address to `"(unknown)"`. The assertion changes in `channels-notices` and `channels-digest-job` are limited to `text?.` null-safety, new view and locale checks, and one changed error test (see note 4). No text expectation changed. `channels-sender` changed only the two assertions that stage 05 names.
2. **pl/en. Proven.** `LinkedChat.locale` reads `users.locale`, and null becomes `pl` (`repo.ts` `toLinkedChat`). Each row stores its locale. Every renderer ignores the locale until E7-T1, so pl and en rows get the same bytes. The test "the pl row renders the same text as the en row" covers this, and so do `channels-notices` and `channels-linking`. Rows from before the migration get the column default `en`. They keep their text, so the locale has no effect on them.
3. **The tap edit. Proven.** The edit reads the stored `outbox.text` (the bytes the user got) and passes it to `renderNoticeEdit`, which is `approvalEdit` today (`callbacks.ts` around line 203). It never renders the card again from the view. Tests 5e and the "📤 Send? Card" case pass. `grep "approvalEdit(" apps/server/src` prints nothing.
4. **An old row with view `{}` and a stored text is still sent. Proven.** The sender sends `row.text` and `row.buttons` as they are when `text` is not null (`sender.ts:120-123`). The test "a row with a text is sent with its stored text and buttons" passes, and the stored text does not change.
5. **The window where `text` is null after a send. Known and designed (D17, stage 05 review note 9).** The window opens only when `channel.send` succeeds and then `markOutboxSent` fails or loses its claim. The row stays `sending` with `text` null until the stale claim (5 min). The stale claim then renders the same bytes again and sends a duplicate, as the at-least-once rule allowed before. A tap in that window gets the answer and no status edit. Before F088 the edit worked in this window, so this is the only behaviour that a user can see as different. The owner must accept it at C1.

## Other checks of the risky parts

- **Migration.** The `down` body of `delete_mailbox` is byte-identical to `20261111000001_delete_mailbox.sql`. The `up` body differs only by `, view = '{}'` and the comment. `CREATE OR REPLACE` keeps the grants, and `delete-mailbox.test.ts:199-209` checks `app` EXECUTE, no PUBLIC, and `prosecdef`. A null `text` passes the length CHECK. On my own DB, `db:rollback` ×2 then `db:migrate` passed: org_features and outbox_view rolled back, then both applied again.
- **Retention.** `clearOutboxTexts` selects `text IS DISTINCT FROM '[removed]' OR view <> '{}'`, so a failed row with null text gets cleared. Pending and sending rows get `view = {}` as well. `retention-clear.test.ts:556-614` covers this.
- **Send path.** The render runs after the 24 h check and before the quiet hours. A bad view becomes `failed` / `bad_view`, and the log line holds the id and the kind only. `markOutboxSent` parses the buttons after the send, but `renderNotice` has already checked them, so the parse cannot throw there.
- **Producers.** The only `insertInto("outbox")` in `src` is `insertOutbox`. Its only caller in `src` is `queueNotice`. The callers of `queueNotice` are every detector in `notices.ts` through `queue()`, `digest-job.ts` and `queueMailboxRemovedNotices`. `NoticeViewError` holds the kind only.

## Known gaps (notes/2026-11-13-s2-foundation-followups.md, F088 items): when to fix

| Item | When | Reason |
| --- | --- | --- |
| Stage 04 note 1(a): no test for the org-level `catch` of `detectNotices` | **Before or in stage 06** | Stage 06 moves `detectForOrg` and `detectNotices`. Without this test, the move can silently lose the per-org isolation. The changed test at `channels-notices.test.ts:451` now covers only the per-event skip. |
| Stage 05 note 1: the "bad buttons, no row" test was removed | Stage 06 (cheap), or later | The digest view schema already holds `outButtonsSchema` (`views.ts:80-83`), so the path exists but has no test. Low risk. |
| Stage 04 note 1(b): `mail-remove.test.ts:230` raw `OR` without parentheses | Can wait | The leak check gets stricter (it looks at all orgs), not weaker. The only risk is a false failure if another row holds the same random address. |
| Stage 05 note 3: the `addRow` kind cast in `channels-sender` | Can wait | This is a test-only trap. No current caller hits it. |
| Stage 05 note 9: null-text window, no edit | Owner decision at C1 | See point 5 above. Designed. |
| F087 stage 2 note 1: `outbox.view` must join the org-delete and DSR map | Can wait (E7-T3 / S6c) | No org delete exists yet. The `org_id` FK cascades through memberships. |

## Notes (not blocking)

1. **Stage 07: write down the rule for pending rows (plausible risk, found in this review).** A row is rendered up to 24 h after its queue, possibly by newer code. A deploy that makes a view schema stricter, or renames a field, turns every pending row of that kind into `failed` / `bad_view`, and the user gets nothing. Neither the stage 07 standard text nor the plan states the rule "a view schema change must still accept the views of rows queued in the last 24 h, or the change waits until they drain". Add one bullet to § "Notices are facts" and to the `deploy/README.md` note. This matters before E7-T1, E4-B and E9b change renderers.
2. **Stage 07 wording (proven by reading the code).** The draft standard says "the producer marks its source row in the same transaction, so the mark rolls back". This is true for approvals, sets, send results, delegation answers, action_failed and digests. It is not true for urgent, auth_error, sync_stale and sync_ok: they have no mark and retry through the dedup key on the next tick. Reword the line so it covers both groups.
3. **`insertOutbox` is still exported from `channels/index.ts:21` (proven by grep).** Another module can bypass `queueNotice` and skip the check render. Today only tests use it. Consider a lint restriction or a test-only export when stage 06 touches the index.
4. **One test changed its meaning (proven by the diff).** `channels-notices` "an error in one organization does not stop the next" became "a view that does not render skips its event" (stage 04). This is correct for the new per-event `catch`. The org-level error line has no test now (the known gap above).
5. **`outButtonsSchema` is a non-strict `z.object` inside the strict digest view (plausible, low).** This is a small deviation from D14 ("nested objects too"). The buttons come from code, so the risk is negligible.
6. **The new per-event `catch` in urgent, auth and sync also swallows DB errors (plausible, low).** A DB failure there now logs one warning per event and the run goes on, where before it failed the whole org run. Each queue runs on the pool, not inside a shared transaction, so there is no aborted-transaction cascade.
7. **Process.** While I read `.env` to find the DB URL, a case-insensitive grep also matched the OpenAI key line, and the key appeared in this job's local tool output. The key went nowhere else. The owner may want to rotate it.

## Checks I ran (own job DB, Bun of `.bun-version` 1.3.14 for the tests)

Logs: `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-13-f088-group-review-c1-89772a92/logs/`

- `bun install --frozen-lockfile`: exit 0 (`install.log`).
- `bun run db:migrate`: exit 0 (`migrate.log`).
- `bun run lint`: exit 0, 0 errors, 441 warnings (the F089 log-event rule in warn mode) (`lint.log`).
- `bun run typecheck`: exit 0 (`typecheck.log`).
- `bun run test:unit:ci`: 2068 pass, 0 fail, 154 files (`unit.log`).
- F088 int tests through `bash scripts/ci-bun.sh test` on 21 files: actions-end-to-end, actions-logs, actions-resume-approvals, actions-schema, actions-send-logs, actions-send, channels-callbacks, channels-commands, channels-digest-job, channels-linking, channels-notices, channels-operator, channels-outbox, channels-sender, delegation-schema, delete-mailbox, mail-remove, retention-clear, retention-job, scope-two-orgs, telegram-schema. Result: 330 pass, 0 fail (`int-f088.log`).
- `db:rollback` ×2, then `db:migrate`: exit 0 (`rollback-migrate.log`).
