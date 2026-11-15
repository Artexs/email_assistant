# F103 stage 10 review notes

Opus review of `1ce28ef8`: PASS with test gaps. TG1 (unfiltered canary check in `runWith`) and TG2 (`sync_below_cursor_moved` with key `offers`) are fixed in the follow-up commit. Report: `.limen/jobs/2026-11-15-f103-review-s10-opus-mail-folder-5b4d9f54/result`. The notes stay open for later stages.

- **N1** `mail/tools.ts` (`deliver_done`): `log.with({ ... }).info("deliver_done", ...)` is a call on a chain, so it escapes the `logCall` selector: a template-literal first argument would pass eslint there. Stage 13 adds a chain selector, or the call uses a named child.
- **N2** 12 sites pass `errorFields(error)` as the whole second argument (`jobs.ts` 8, `remove.ts` 1, `routes.ts` 2, `sync.ts` 1). The lint does not check the second argument. The runtime filter applies.
- **N3** A code that looks like a host passes the D7 value rule. imapflow sets only constant codes, so no path exists today.
- **N4** `folder_key` is always a closed `SyncFolderKey`, never a server path.
- **N5** An imapflow-shaped error probe leaked nothing.
- **N6** `MailHostLookupError` keeps the message, the cause and the `SoftError` class.
- **N7** `deploy/README.md` rescan check: in the text form `org_id`, `mailbox_id` and `folder_key` stand between `sync_folder_done` and `sync_mode=rescan`, so a literal grep failed. The wording is fixed.
- **N9** Stage 09 was not on master at review time. It landed later; this branch merges master (keep both sides in `eslint.config.js` and `log-lint.test.ts`).
- **N10** Old-form warnings left after the merge: `modules/triage` 28 (stage 11); `web.ts` 10, `composition.ts` 6, `testmail` 6, `retention.ts` 4 (stage 12).
