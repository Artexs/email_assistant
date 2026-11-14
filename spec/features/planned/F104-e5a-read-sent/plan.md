# F104 · E5a Read Sent — plan

> **Status 2026-11-15 — planned.** Plan base: 560e74e7, refreshed 2026-11-15. 13 stages; nothing built. Build after F095 and F099 (both done).

Defaults: [questions.md](questions.md). Sources: E05 discovery notes §4.1, PD-115–PD-117, ADR 0029, F106 plan D9, D18. The ticket's "Out of scope" DSR line is outdated (D18).

## Input

Owner words, word for word:

- PD-116: "Read Sent per ADR 0029: read-only (`BODY.PEEK`; no flag, move, delete or append), own table, never triaged; system sends linked by `X-EA-Action-Id`; one "answered by the user" mark that E3, E4-B, E5, E6 and E11 read. Per-mailbox switch "Track my sent mail": on for new mailboxes with one line at connect, off for existing mailboxes until the owner turns it on; org flag `sent_sync` off until the pilot passes."
- PD-117: "Sent depth: headers of the last 30 days at connect (history check, threading), text and analysis for the last 14 days; then incremental with each sync run."
- E5 notes §4.1: "The assistant reads Sent, never changes it, to see what you wait for"; "no sent mail seen for 7 days gets one notice"; "the new columns join the DSR address map (E7-T3) and the org-delete test, whichever ticket lands second adds them. Logs: ids and counts only."
- PD-115: "You can go with defaults."

## Decisions

- **D1** Two tables, one migration: `sent_emails` (per sent mail), `mailbox_sent_sync` (per mailbox: switch, path, cursor, pass state); RLS. Rejected: a `mailbox_folders` row (the folder loop would sync it); columns on `emails` (triage, digest, moves, Undo would see sent mail).
- **D2** Switch = `mailbox_sent_sync.enabled`; no row = off; `enabled_at` marks the "on" period. Rejected: a `tool_switches` key (this is consent).
- **D3** Read-only: Sent code takes only `SentFolderReader` (five read methods); reads use PEEK (F1). Rejected: EXAMINE (an adapter change for no gain).
- **D4** `syncSentHeaders`: flag → switch → `folder_map.sent` → a new path resets the cursor → mode `initial`/`incremental`/`rescan` → 30 days of headers by INTERNALDATE, chunks of 50; the incoming dedup key; the upsert moves only the location. Rejected: `decideIncoming` (the system never moves Sent mail).
- **D5** Each write transaction locks the state row and compares `enabled`, `enabled_at`, `path`, cursor with the pass's read; a mismatch writes nothing (`cursor_moved`). The setter and the DSR erase take the same lock.
- **D6** `sentOriginOf` (in `actions`, injected): `system` when the system's send went out; `draft` when the user sent an own draft by hand (user mail, `action_id` kept, PD-076); else null. System rows get no text. Rejected: `isOwnActionId` alone (review 1, M2).
- **D7** `fetchSentTexts`: window min(14 d, retention); 100 per run, oldest first, current path and UIDVALIDITY; guarded write; pending past the window → `headers_only`. Rejected: text in the header step (slow first pass).
- **D8** `syncSentFolder` = header step, then text step on `done`: the one entry point. The header step records `last_pass_at`, `last_error_code`.
- **D9** `mail.sync` runs it after INBOX on the same provider; an error → a `sent_sync_failed` warn and `last_error_code = failed`.
- **D10** Answered mark = reader `listUserAnswers`: the earliest user sent mail of the mailbox whose parent id is the incoming `message_id_header`. Rejected: a column on `emails` (two writers, any order).
- **D11** `setSentSync`: on needs the flag, off always works (review 1, M3); on = new first pass; off deletes the sent rows (Q1); audit `mailbox.sent_sync_changed`, no security-log kind (Q12). Connect sets the switch to the flag (Q3).
- **D12** `SettingsWebView.sentSync` (null when flag and switch are off); owner `PATCH /api/settings/:mailboxId/sent-sync`, 404 when hidden; CLI `mailbox:settings sent-sync`, `show`.
- **D13** Panel card "Sent mail" (flag off: "paused", only off); connect dialog line when `me.features` has `sent_sync`.
- **D14** Retention from `internal_date`: text after `data_retention_days`, subject and addresses after 90 days (Q2).
- **D15** Notice `sent_missing`: flag on, mailbox `active`, switch on, first pass done, no error, 7 quiet days → one row per owner per quiet period (Q6).
- **D16** Stage 06 accepts ADR 0029 and fixes the "never reads Sent" doc lines; `docs/capabilities/sent-mail.md` grows per stage.
- **D17** Web texts `en`, `pl`; notice in `NoticeTexts`; Polish per F098 P6 (`spec/features/done/2026-11/F098-e7-t1-polish-ui-i18n-frame-first/plan.md`), one colon per line.
- **D18** (refresh 1) F106 landed first, so F104 adds the sent columns: stage 01 the trigger, registries and delete seeds; stage 12 F106 D9 for sent mail (a mail whose other parties are own mailboxes goes, with a tombstone; others lose the address and get no text; Q11). Rejected: scrub only (off → on brings the mail back).

## Edge cases

1. Flag off, switch on: no pass, no notice, card "paused", off works; flag on again: incremental.
2. Off during a pass, or off → on: D5. 3. No Sent folder: `no_folder`; gone: `folder_missing`.
4. New UIDVALIDITY: rescan. 5. One mail twice: one row. 6. Crash: nothing half-written; `pending` rows retry.
7. Two orgs: filter and RLS. 8. Bad `X-EA-Action-Id`: user mail. 9. Mailbox or org removed: cascade.
10. Path change: old rows keep their path; readers use the current one. 11. Dates in the org time zone.
12. No subject, address, path or text in logs or audit. 13. Mail stored after an erase: F106 limit.

## Facts checked (at 560e74e7)

- **F1** imapflow 1.7.8 (unchanged): body fetches are `BODY.PEEK`/`BINARY.PEEK` (`lib/commands/fetch.js`).
- **F2** `folder_map.sent` comes from `\Sent` (Interia: `Wysłane`) or the committer's `Sent`; the folder sync skips it.
- **F3** `MessageMeta` has no Bcc; `fetchContent` gives nulls for a gone UID. System mail carries the draft id.
- **F5** `isFeatureOn` and `getOrganization` come from `tenancy` (now `tenancy/repo/`).
- **F6** Layers: `mail`, `config` layer 2; `actions` 3; `channels` 4; `privacy` 5. `config` and `mail` get functions injected.
- **F7** F106 tests fail for an unclassified table: `privacy-export-map`, `privacy-dsr-match` test 1, `account-data-delete` tests 1 and 9; `findMentions` throws without a `ROW_SHAPE`.
- **F8** 14 notice kinds, last `host_blocked` (`20261114154826_mailbox_host_blocked.sql`); newest migration `20261114170001_sso.sql`.
- **F9** Log names: one flat list (F103 stage 01 not landed). `mail.sync` runs once at a time.

## Not verified

N1 GreenMail keeps flags and UIDs (stage 06; fails → stop). N2 Interia keeps sends in `Wysłane`, N3 pilot Sent size, N4 replies carry `In-Reply-To` (stage 13 checks 4, 5, 9).

## Done when

The ticket's Acceptance holds, shown by the tests of stages 04–12 and the checks of stage 13.

## Rules for every stage

- Read `ticket.md`, this file and your stage. A gap or a deviation is a question, not a choice.
- Sent code takes a `SentFolderReader`. Sent mail never enters `emails`, triage, digest, moves or Undo.
- Logs: event form, names from `platform/log-fields.ts`; never a subject, address, path, text or `error.message`.
- Repository functions take a `TenantContext`, filter by `org_id`, and get a two-org test.
- Tests: `withRollback`; `NOW = 2026-11-20T10:00:00Z`; flags by `upsertOrgFeature` after `configureFeatures({ off: [] })`.
- Migrations: up and down, then `bun run db:types`; never next to another migration in build.
- Format only your files. Keep `docs/capabilities/sent-mail.md` true. End with `Decisions for the owner`.

## Proof

After the last commit, one bash call, nothing after it; read the logs separately.

```
mkdir -p /tmp/f104-sNN && bun run lint > /tmp/f104-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f104-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f104-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f104-sNN/int.log 2>&1 && echo PROOF_OK
```

## Owner steps

- **U1** Stage 13: the owner turns on "Track my sent mail" for the pilot mailbox in the panel (consent; never by CLI).
- The coordinator runs `bun run db:migrate` on the dev DB after stages 01 and 11.

## Review

Review job before the land of stages 01, 03–08, 11, 12.

## Stages

01 [Migration, registries](stages/stage-01-migration.md) `[risky]` · 02 [Repository](stages/stage-02-repository.md) · 03 [Reader, rules, origin](stages/stage-03-rules.md) · 04 [Header pass](stages/stage-04-header-pass.md) `[risky]` · 05 [Text step](stages/stage-05-text-step.md) · 06 [Job, docs](stages/stage-06-wiring-and-docs.md) · 07 [Readers, retention](stages/stage-07-readers-and-retention.md) · 08 [Switch](stages/stage-08-switch.md) `[risky]` · 09 [API, CLI](stages/stage-09-settings-api-and-cli.md) · 10 [Panel](stages/stage-10-panel.md) · 11 [Notice](stages/stage-11-notice.md) `[risky]` · 12 [DSR](stages/stage-12-dsr-sent.md) `[risky]` · 13 [Pilot](stages/stage-13-pilot-deploy.md) `[risky]`

## How to run (coordinator)

1. Move the folder to `active/`, commit, run `scripts/plan-drift.sh spec/features/active/F104-e5a-read-sent 560e74e7`; exit 1 → refresh.
2. One stage at a time, after the one before landed, board worker route, `--prepare 'bash scripts/limen-prepare.sh'`: "Implement F104 stage NN. Read ticket.md, plan.md and stages/stage-NN-<slug>.md in spec/features/active/F104-e5a-read-sent/. Final proof: the Proof of plan.md (/tmp/f104-sNN). List as proven only what a saved log shows."
3. Drop the job DB after each land; a conflict → the worker merges `master`.
4. After F103 stage 01 lands, add: "New log names go to the kind list of their value."

## Seams

- E6a (F115): `syncSentHeaders` before a reply send; a user row with the draft's `action_id`. E5b, E6b: stored user rows and markers.
- E3a, E4-B, E11a: `listUserAnswers`, `to_addresses`, `sent_at`. E9a: adapters implement `SentFolderReader`.

## Planning progress

- [x] Stages 01–13 at 560e74e7; word counts in [plan-refresh-1.md](plan-refresh-1.md).

## Cold review

- Review 1 ([plan-review-1.md](plan-review-1.md)): FAIL, 3 major, 14 minor; all fixed or answered.
- Review 2 (refresh 1): [plan-review-2.md](plan-review-2.md).

## Log

- 2026-11-14: plan at `f36794e`; review 1 fixed.
- 2026-11-15: refresh 1 at `560e74e7`.
