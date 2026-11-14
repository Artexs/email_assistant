# F103 stage 10 — Convert mail

Part of [`../plan.md`](../plan.md). Review job before the land (IMAP and SMTP error texts can hold addresses). Needs stage 01. Two steps.

## Step 1 — Convert 29 calls; no server reply in a mail log line

**Goal.** Every log call in `modules/mail/` is an event (D5, D6, D7). Four calls in `mail/jobs.ts` print a server reply (`error.message`, `statusError.message`, the variable `message`); a reply can hold an address. After this stage no log line reads one.

**New fields** (if missing): number `fetched`, `stored`, `uid_updated`, `returned`, `relocated`, `cross_copies`, `move_in_flight`, `skipped_own`, `ignored_below_cursor`, `folder_count`, `checked`, `copies`, `limit`, `moved`, `in_inbox`, `duplicates_removed`, `synced`, `not_found`, `failed_runs`; code `sync_mode`, `actor`.

**Lookup codes (interface).** `modules/mail/host-guard.ts` puts the system code (`ENOTFOUND`, `ENODATA`) only into a `SoftError` message; `docs/known-alerts.md` tells DNS failures apart by it. Add `export class MailHostLookupError extends SoftError` with `readonly code: string` (system code or `"UNKNOWN"`) and `name = "MailHostLookupError"`; throw it at the three lookup failures, same message. Retry is unchanged; `errorFields` gives `error=MailHostLookupError error_code=ENOTFOUND`. The F085 `HostNotAllowedError` path does not change. Test (`host-guard.test.ts`): a lookup rejected with `{ code: "ENOTFOUND" }` throws a `MailHostLookupError`, `instanceof SoftError`, `code` `ENOTFOUND`.

**Children.** `mailboxLog = log.with({ org_id, mailbox_id })` per sync target (`jobs.ts`) and per `sync.ts` function with `mailboxId` (D6). `folder_key` is a `SyncFolderKey`, never a server folder path.

Old text (start) → event: fields. Levels stay.

- `imap/client.ts`: `IMAP connection error` → `imap_connection_error`: `code` (string code or `"unknown"`).
- `jobs.ts`: `synced …` → `sync_done`: `folder_count`, `fetched`, `stored`, `uid_updated`, `returned`. `failed 3 runs in a row` → `sync_folder_failing`: `folder_key`, `failed_runs: 3`. `close … failed` → `imap_close_failed`: `...errorFields(error)`. `login failed, status is now auth_error` → `sync_auth_error`. `setting auth_error failed` → `sync_auth_error_save_failed`: `...errorFields(statusError)`. `${message}; the next tick tries again` → `sync_soft_error`; `sync … failed` → `sync_failed`: both `...errorFields(error)`.
- `remove.ts`: `status restore failed` → `mailbox_status_restore_failed`: `mailbox_id`, `...errorFields(restoreError)`. `removed by user` → `mailbox_removed`: `mailbox_id`, `user_id`.
- `routes.ts`: `mailbox connect failed` → `mailbox_connect_failed`; `password check failed` → `mailbox_password_check_failed`: both `...errorFields`.
- `status.ts`: `paused/resumed by user` → `mailbox_paused` or `mailbox_resumed` (two literal calls): `mailbox_id`, `actor`.
- `sync.ts`: `is a cross copy` → `sync_cross_copy`: `folder_key`, `email_id`. `target of a move` → `sync_move_target_copy`; `uid update … changed no row` → `sync_uid_update_no_row`; `return … changed no row` → `sync_return_no_row`; `move … changed no row` → `sync_move_no_row`; `copy below cursor` → `sync_below_cursor_copy`: each `email_id`. `list hit the limit` → `sync_below_cursor_limit`: `folder_key`, `limit`. `cursor moved` → `sync_below_cursor_moved`: `folder_key`. `checked N, returned N, copies N` → `sync_below_cursor_done`: `folder_key`, `checked`, `returned`, `copies`. `${mode}, fetched N, …` → `sync_folder_done`: `folder_key`, `sync_mode`, the nine counts of the text. `added sync folders` → `sync_folders_added` (`count`), then one `sync_folder_added` (`folder_key`) per key. `folder discovery failed` → `sync_folder_discovery_failed`: `...errorFields`. `not on the server, skipped` → `sync_folder_missing`: `folder_key`. `${describeError}; the next tick` → `sync_folder_soft_error`: `folder_key`, `...errorFields`. `backfill …` → `backfill_done`: `fetched`, `stored`, `uid_updated`, `returned`, `skipped_own`.
- `tools.ts`: `deliver …` → `deliver_done`: `mailbox_id`, `moved`, `in_inbox`, `duplicates_removed`, `synced`, `not_found`.

- `actor` is a code (`"system"`, `"cli"`, a user id); free text in its type → name the callers.
- No `.message` read inside a log call in `modules/mail/` remains; a read that builds an error stays.

**Decisions.** D2, D5, D6, D7, D16.

**Test.**

1. Tests that matched an old text match the event text (`mail-*.test.ts`, `delete-mailbox.test.ts`, `web-mailboxes.test.ts`).
2. `mail-jobs.test.ts`: `fake.failOn` with `new SoftError("connection lost for MARKER-ADDR@x.test")` → `sync_soft_error` with `error: "SoftError"`; no line holds `MARKER`.
3. `mail-jobs.test.ts`: a provider error that is not soft, message `"NO [AUTHENTICATIONFAILED] MARKER-ADDR@x.test"`, writes `sync_failed`; no line holds `MARKER`.
4. `provider.close()` rejects with `MARKER` in the message; `imap_close_failed` has no `MARKER`.

**Done when.** No `no-restricted-syntax` in `modules/mail/`; tests pass.

## Step 2 — Lint level and docs

- `eslint.config.js`: add `modules/mail/**/*.ts` to the `error` block. `log-lint.test.ts`: an old-form line at `modules/mail/__log-fixture.ts` gives `[2]`.
- Docs by D17. Known quotes: the DNS lookup entry (`error=MailHostLookupError error_code=<code>`), the `sync`/`synced` entries, README § 48-hour test (`rescan:` → `sync_folder_done sync_mode=rescan`), README § Logs sync sentence → "A sync run writes `sync_done` with `mailbox_id` and the counts; a failure is `sync_failed` or `sync_soft_error` with `error` and `error_code`."

**Done when.** No old text of the list in either doc; the Proof (`/tmp/f103-s10`) prints `PROOF_OK`; the final message per plan § Rules.

**Out of scope.** Sync behaviour.
