# F103 stage 08 review notes

Opus review of `63dca2a7`: PASS, no blocking item. Report: `.limen/jobs/2026-11-15-f103-review-s08-opus-committer-e-a30e0677/result`, logs in `/tmp/f103-s08-review/` (may be deleted). The two test gaps (TG1, TG2) and N1 are fixed in the follow-up commit. The notes below stay open for later stages.

## N2 — second arguments that are not object literals

`committer.ts` passes `errorFields(error)` (or `errorFields(releaseError)`) directly as the second argument at 8 sites, and `committer_done` passes the local `counts` object. The lint rule does not check the second argument, so this is not a dodge. The runtime filter drops any field name or value that the kind lists do not allow. Precedent: `platform/auth-sso.ts:328`. `counts` holds exactly the five numbers, and the `mailboxLog` child adds `org_id` and `mailbox_id`. Stage 13 may tighten the lint rule to check the second argument.

## N3 — expiry has no `mailboxLog` child

The stage file asks for `mailboxLog = log.with({ org_id, mailbox_id })` in the per-mailbox loop of `expiry.ts`. `expiry.ts` (and `committer_failed` in the run loop) gives `org_id` and `mailbox_id` inline instead. The output is the same. This is a small deviation from D6.

## N4 — old-form warnings left per folder (after the master merge)

105 `no-restricted-syntax` warnings in total; `committer.ts` and `expiry.ts` have 0.

| Folder or file                               | Warnings | Stage |
| -------------------------------------------- | -------- | ----- |
| `modules/triage`                             | 28       | 11    |
| `modules/mail` (incl. `mail/imap` 1)         | 29       | 10    |
| `modules/actions` (apply, drafts, send, ...) | 22       | 09    |
| `web.ts`                                     | 10       | 12    |
| `testmail`                                   | 6        | 12    |
| `composition.ts`                             | 6        | 12    |
| `retention.ts`                               | 4        | 12    |

The counts match the stage 09 to 12 tables, so the master merge brought no new old-form lines into these folders.
