# F104 plan review 1

> Cold review job `2026-11-14-f104-plan-review-2f081687` (Opus 5.5, high, fresh context) on candidate `5f7062a`. Filed whole: the review message (from the job log), then the job's final message (its note check).

## Review message

FAIL 5f7062a8952a4a46968fb14e6f3dc704607466d4

The plan fails on one blocking defect. When the Sent folder path changes, the text step can save the text of one sent mail on the row of another mail. Two more major findings are not blocking. HEAD matches the candidate (`git rev-parse HEAD` = 5f7062a…). No code changed since the plan base f36794e: `scripts/plan-drift.sh … f36794e` printed "no drift", exit 0.

## Blocking

**M1 [major, proven by tracing the plan text against the fake's code, not run] A path change makes the text step save the wrong mail's text.**
- **Old rows stay.** Stage 04 test 10 (`stage-04-header-pass.md:69`) changes the path Sent → Wysłane and says "rows of `Sent` stay". Those old rows can still be `pending`.
- **The table cannot tell the folders apart.** `sent_emails` has no folder column (`stage-01-migration.md:18-50`).
- **The text step mixes the folders.**
  - `listPendingSentTexts` filters only by `uidValidity` (`stage-02-repository.md:119`).
  - `fetchSentTexts` fetches each row from the current path: `fetchContent(path, row.uid)` (`stage-05-text-step.md:38`).
  - The write guard compares only `uid` and `uidvalidity` (`plan.md:35`).
- **The plan's reason is wrong.** D7 says "A UID is never reused within one UIDVALIDITY (RFC 9051 §2.3.1.1), so no identity check is needed". That rule holds per mailbox folder, not across folders.
- **The fake gives every folder the same UIDVALIDITY.** It creates each folder with `uidValidity: 1` and UIDs that start at 1 (`apps/server/src/modules/mail/fake/index.ts:157`).
- **Result.** Old row "Sent uid 1" gets the text and markers of "Wysłane uid 1". This breaks acceptance bullet 1 ("text for the last 14 days"). On real servers, two folders with the same UIDVALIDITY are plausible but rarer.
- **Stages that let it through.** Stage 01 has no folder column. Stage 05 has no test that runs a path change before the text step.
- **Fix.** Pick one:
  - Add `sent_emails.path` and filter and guard on it.
  - Or have `resetSentCursor` set the mailbox's `pending` rows to `headers_only` in the same transaction, and add a stage 05 test for it.

## Major, not blocking

**M2 [major, plausible] A draft that the user sends from their own mail app counts as a system send.**
- **The draft carries the action id.** System drafts hold `X-EA-Action-Id` = the draft action id (`actions/drafts.ts:35`). The system send uses the same id (`actions/send.ts:232-237`).
- **The check cannot tell a draft from a send.** `isOwnActionId` accepts both `create_draft` and `send` actions (`actions/repo/planned.ts:25`).
- **D6 treats every own action id as a system send** (`plan.md:34`). Then `content = 'headers_only'`, and `listUserAnswers` skips rows with `action_id` (`plan.md:38`).
- **Result.** The user opens the assistant's draft in their mail app and sends it. If the app keeps the header, the incoming mail never reads "answered by the user".
  - `notes/2026-11-13-reply-drafts-facts.md:31` names this risk ("If a mail client keeps the header on an edited draft").
  - PD-076 needs this case: "missing and answered → `sent_by_user`". Seam S1 (`plan.md:181`) would get `draft_missing` instead.
  - The rows check `sent_emails_system_check` (`stage-01-migration.md:48`) fixes this choice in the schema.
- **Stages that let it through.** Stage 03 and stage 04 define the rule; stage 07 builds the reader on it.
- **Fix.** Count a mail as a system send only when a `send` action exists for that draft. Otherwise store it as user mail and keep `action_id` as a link only. Or add an `origin` column.

**M3 [major, proven conflict between two plan texts] The owner cannot delete the stored sent mail while the flag is off.**
- **The plan refuses the switch.** `setSentSync` returns `flag_off` before any change (`stage-08-switch.md:32`). The route returns 404 (`stage-09-settings-api-and-cli.md:43`). The card is hidden (edge case 1, `plan.md:49`).
- **The rollback text says the opposite.** `stage-12-pilot-deploy.md:50` says "the rows stay until retention or the switch's off". With the flag off, the switch cannot go off.
- **Retention does not delete rows.** It keeps the rows (ids, thread keys, times) for ever (`plan.md:42`).
- **Result.** After a rollback with the flag off, the owner cannot withdraw consent (Q1 is marked "important: privacy").
- **Fix.** Pick one:
  - Allow `enabled: false` (with its delete) when the flag is off.
  - Or let the rollback runbook delete the rows itself.

## Minor

1. **Wrong console spy (proven by reading the code).** Stage 06 step 2 test 3 (`stage-06-wiring-and-docs.md:71`) spies on `console.warn`. But `log.warn` writes to `console.error` (`apps/server/src/platform/log.ts:135`), so the test fails as written. Fix: spy on `console.error`, as `actions-close.test.ts:301` does.
2. **The test's own calls break its read-only check (worker must guess).** Stage 04 test 9 (`stage-04-header-pass.md:68`) seeds mail with `fake.appendMessage("Sent", …)` and reads `fetchFlagsIn`. Both calls add `"Sent"` entries to `folderCalls` (`fake/index.ts:174-175`). The list then fails "holds only folderStatus, fetchAbove, searchSinceIn, fetchByUidsIn". Fix: say "take a snapshot of `folderCalls.length` before the pass".
3. **The failure cannot target the 2nd call (worker must guess).** Stage 05 test 8 (`stage-05-text-step.md:56`) asks for `fetchContent` to fail "on the 2nd of 3 pending rows". But `failOn(method, error, times)` fails the next calls (`fake/index.ts:252`, `failIfSet` at line 164). Fix: say how to wrap the provider.
4. **The CLI step leaves out two facts (worker must guess).**
   - The parser's `default:` branch builds a `switch` command (`scripts/mailbox-settings-args.ts:126`), so `sent-sync` needs its own `case`.
   - `show` reads `getSettingsView`, not `buildSettingsView` (`scripts/mailbox-settings.ts:50`). Stage 09 step 2 (`:76-77`) does not say to call `getSentSyncView`.
5. **Text can be fetched after the organization's retention period.** The text window ignores `data_retention_days`, which can be as low as 1 (`db/migrations/20261103000002_tenancy.sql:6`). With a value below 14, the text step stores text that is already past retention. The daily retention run then clears it, up to a day later (D7 against D14). Fix: window = min(14 d, retention).
6. **Fact with no source.** N2 (`plan.md:89`) says "notes say the webmail and IMAP clients do" keep a copy in Wysłane. `notes/2026-11-03-interia-imap-capabilities.md` says only "SMTP does not save sent mail" (lines 27, 50, 76). No note covers webmail.
7. **The answered mark is never checked on real mail.** Stage 12 checks only `stored > 0`. Nothing shows that Interia's webmail sets `In-Reply-To`/`References`, so acceptance bullet 3 is proven only with synthetic headers. Add a stage 12 count of `sent_emails` rows whose `parent_message_id` matches an `emails.message_id_header`, plus an N4 entry.
8. **Misleading notice (gap).** A mailbox stuck on `folder_missing` or `failed` after its first pass still gets the `sent_missing` notice "does your mail app keep a copy?" (D15, `plan.md:43`). The card says something different. Fix: skip the notice while `last_error_code` is set, or name the error.
9. **Old-path rows inflate the counts.** After a path change they still count in `storedCount` and `newestUserAt` (`stage-07-readers-and-retention.md:27-29`). That can hide a quiet new folder from the card and the notice. If the M1 fix adds a path column, filter these reads by it too.
10. **Parallel stages edit the same docs.** Stage 11 may run next to stages 08–10 (`ticket.md:33`, `plan.md:166`). All of them edit `docs/capabilities/sent-mail.md` and `docs/architecture.md` §5. Plan step 5 lists overlaps with other tickets only.
11. **No review job for stages 06 and 07.** Stage 06 wires the pass into the live sync loop on the shared IMAP connection. Stage 07 is retention of the mail text. `plan.md:144` sets no review for either.
12. **A printed command does not exist yet.** After stage 08, `mailbox:connect` prints `bun run mailbox:settings sent-sync …` (`stage-08-switch.md:69`). That command exists only after stage 09. The flag is off, so this is low risk.
13. **Two stages are large.** Stage 04 (~450 lines, 15 integration cases, risky) and stage 09 (core schema, a new server module, a route, `web.ts`, the CLI parser and script, subprocess tests, docs) are near the limit for one Sonnet job. Splitting is optional.
14. **Imprecise path.** F12 and F13 name `layers.json`; the file is `apps/server/src/modules/layers.json`.

## Checked and correct

- **F1, F2:** imapflow 1.7.8 uses `setBodyPeek` (`lib/commands/fetch.js:53-70, 136`), and `lib/imap-flow.js:4590` matches.
- **F4:** `RESERVED_MAP_KEYS` is at `mail/sync.ts:506`.
- **F7:** the `fetchSince` signature is at `mail/sync.ts:440`.
- **F8:** `main.ts:87` matches.
- **F11:** the newest `outbox_kind_check` migration is `20261114100003_outbox_send_held.sql`.
- **F19:** `delete_mailbox` is at line 106 of `20261114100002_rls_tenant_policies.sql`.
- **Existing names and signatures** match the plan: `upsertOrgFeature`, `setFolderMapEntry`, `recordAudit` (with `at`), `insertDraftAndSend` (returns `draftId`), `OrgRun.db`/`owners`/`mailboxes`/`timeZone`, `queue`, `warnSkipped`, `renderSyncStaleNotice`, `NoticeTexts`, `defineRenderer`, `textsFor`, `formatClock`, `getLocale`, `MailboxCard.tsx:58`, `AccountCard.tsx:282`, `settingsRouteDeps`, `respond`, `ensureSettings`, `RetentionCounts`, `Clearers`, `runOrg`, `textsBefore`, `createOrgWithMailbox` (folder map `{ drafts }`), `errorFields`, and the log field names.

## Checks run

- `git rev-parse HEAD` → 5f7062a8952a4a46968fb14e6f3dc704607466d4 (matches the candidate).
- `bash scripts/plan-drift.sh spec/features/planned/F104-e5a-read-sent f36794e` → "named paths: 79; changed since base: 0; gone: 0 / no drift", exit 0.
- Existence check of every repo path named in the plan and stages: every path that is not marked new exists. The only "missing" hit, `db/schema.ts`, is a regex cut of `apps/server/src/platform/db/schema.ts`, which exists.
- Code reads at HEAD: mail jobs, sync, sync-rules, port, mapper, fake, connect, the committer and send Sent copy, `isOwnActionId`, config view and routes, `web.ts`, the CLI parser and script, retention, notices (core and detectors), log, errors, migrations, web settings and the connect dialog.
- **Not run:** lint, typecheck, unit and integration suites. The candidate is a plan with no code diff since its base, so these would show nothing about it. The M1 and minor 1–3 results come from tracing the code, not from running it.
- `git status --short` was empty: I wrote no files in the repo.

Verdict: FAIL. M1 must be fixed before the build. M2 and M3 need a decision in `plan.md` before stages 03, 04 and 08 start.

## Final message

FAIL 5f7062a8952a4a46968fb14e6f3dc704607466d4

The review result is unchanged. M1 is still the one blocking finding. The full findings are in my previous message.

## Note check

- head-match: proven. `test -z "$(git status --short)" && test "$(git rev-parse HEAD)" = 5f7062a8952a4a46968fb14e6f3dc704607466d4 && git rev-parse HEAD` exited 0 and printed 5f7062a8952a4a46968fb14e6f3dc704607466d4.
- findings-quoted: not proven. My previous message ranks each finding major or minor and quotes a file and line for each. No file or command can prove that, and the coordinator must check the message.
- coverage: not proven. My previous message has sections for the pre-mortem (each major finding names the stage that let it through), gaps, rule conflicts, steps that need a guess, facts with no source, wrong paths and names, and oversized stages. Only a reading of that message can confirm this.
- verdict-line: not proven. The first line of the previous message and of this one is `FAIL 5f7062a8952a4a46968fb14e6f3dc704607466d4`, and the previous message ends with a verdict line. This is not a file or a command.
- Easy-to-miss rule ("You write no files"): followed. The same command above exited 0, and its `test -z "$(git status --short)"` part shows that the worktree is clean. The only file I wrote is the job note `.limen/jobs/2026-11-14-f104-plan-review-2f081687/note.md`, outside the worktree, which the harness requires.
