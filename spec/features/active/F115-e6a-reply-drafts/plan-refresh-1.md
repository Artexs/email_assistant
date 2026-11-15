# F115 · Plan refresh 1

- Old base: 9341d9f0 (2026-11-15 05:40). New base: 17b2a369 (`HEAD`, 2026-11-15 17:38).
- Job: refresh, no scouts. Landed since the base (coordinator list): F102 to stage 17, F103 to stage 18, F104 to stage 12, F114 to stage 8, F116 to stage 10 (and 12, 16), F117 to stages 13 and 16, F119 to stage 14, F113 to stage 15; v0.1.0 runs on the VPS.

## Drift output (`/tmp/coord/drift-F115.txt`)

```
plan base: 9341d9f0 2026-11-15 05:40
HEAD:      17b2a369 2026-11-15 17:38
named paths: 7; changed since base: 1; gone: 0
changed: deploy/README.md
commits after the base that touch the named paths:
  3733aeed 11-15 15:27 F114 stage 08 review: restore.sh needs exactly one result line of credentials:check; README note on down -v
  f7e00a46 11-15 14:56 F114 stage 08: credentials:check, restore.sh reads its result line, VPS lost runbook, capability pages
  4767333f 11-15 13:49 F114 stage 07: README names the drill set of check-logging
  5d378f85 11-15 13:42 F114 stage 06 step 3: release checklist, README Release section, migrations rules, operations page
  5170c738 11-15 13:13 F103 stage 18 review fixes: pin vlagent mounts, url, network and disk cap; logs.sh level, unbuffered, root
  dd1eef9a 11-15 12:43 F103 stage 18: log store (Compose profile ops), deploy/logs.sh, testmail remote runs in cli
  cb8ced0b 11-15 12:00 F103 stage 17: log drivers split (server json-file, others local), cli Compose service, check-logging drivers and one-off doc check
  489ff792 11-15 10:03 F114 stage 04 step 4: docs for status file, ping, disk and backup checks
  93f0adb7 11-15 08:41 F103 s13: docs for the final log rules; capability page logs.md
  3a6f5bf5 11-15 07:19 F103 s12: roots and testmail log events; lint error for root files and testmail; web_on carries no origin
  76a86032 11-15 07:11 F119 stage 14: docs for company sign-in (web-panel, tenancy, account data, ADR 0026 amendment, runbook, alerts, code patterns)
  494edee4 11-15 07:01 F103 s10 review: review-10 notes, stage 13 carry-over, README rescan wording
  d07955b4 11-15 06:17 F103 s10: mail folder log events; MailHostLookupError; lint error for modules/mail; canary tests per line
  5ecce6ee 11-15 06:10 F103 s09: apply, drafts and send log events; lint error for the actions folder; log-event tests per line
```

The drift script sees only the 7 named paths. The plan names most code by function, so I also checked every function, table, file and route that the stages name against `HEAD` (§ Facts checked).

## Changes

- plan.md: status line → `Plan base: 17b2a369, refreshed 2026-11-15`. Why: refresh rule.
- plan.md F3: the envelope, the send limits and the `SEND_SCOPE self` filter already cover `to ∪ cc` for every kind (`sendRecipients`, F116 stage 10); the send schema allows Cc only for `follow_up`. Why: F116 stage 10 built it ("reuse F115 stage 04 when on master, else add it here").
- plan.md D14: last sentence points to F3. No change of the decision.
- plan.md F7–F11 (new facts): `follow_up` loop sends without `email_id`; log field allow-list and `request_id` as HTTP context; deploy = `release.sh`, `cli` service, `db:check-migrations`; consent version `2026-11-15` with an equality check; OAuth mailboxes exist.
- plan.md D19 (new, default, `questions.md` 25): password IMAP mailboxes only until E9. Why: F117 landed OAuth mailboxes; the ticket puts E9 replies out of scope, and nothing guarded it.
- plan.md rules: new log field names in the same stage; reply request id is `reply_request_id`. Advisory merge note now names F116 (F103 stages 08–09 landed).
- plan.md "Done when" now points to ticket § Acceptance (same checks, shorter) and § Log removed, to stay at 1,500 words.
- stage 02 step 2: `--drafter` is a run mode with its own allowed-option set, as F116's `--extractor`; one more failing parse in the test. Why: `eval-args.ts` changed (extractor and escalation modes); "valid only with `--sim`" no longer describes it.
- stage 03 step 1: no index (F116 `20261115160001_open_loops.sql` owns `emails_thread_received_idx`; carry-over folded in, Down test checks it stays); the outbox CHECK lists come from the newest replace at `HEAD` (`20261115150001_outbox_sent_missing.sql`), and `outbox_email_kind_check` (mail or loop anchor, `20261115170001_action_loop_anchor.sql`) gets the two kinds that need `email_id`; `db:check-migrations` passes with no contract line (new test 5). Why: F116 stages 07 and 09, F114 stage 06.
- stage 03 step 3: a "rollback safety" item on `renderNotice` (withdrawn after review 2, B1: wrong function).
- stage 04 step 1: reuse `sendRecipients` paths; open the send schema for `reply` (`to` 1, `cc` 0–10) and keep `follow_up` rules; the address map needs no `cc` entry (the payload is one json rule). Test 2 gains two schema cases. Why: F116 stage 10.
- stage 05 step 3: `closeSend` also takes a loop-anchored `follow_up` send and leaves `closeSendOfClosedLoop` alone; new test 5. Why: F116 stage 09–10; stage 08 closes any kind.
- stage 07: scan only password mailboxes (D19); log field `reply_request_id`. Why: F117; F103 allow-list.
- stage 08: merge note names F116; "other kinds" includes `follow_up`; `result` is a new code field. Why: F116, F103.
- stage 10 step 1: `reply_drafts: true` on an OAuth mailbox → 400 `validation`; new test 4. Why: D19.
- stage 12 step 3: the version is the land date, or `<date>-2` if it already holds that date; test checks it differs from `2026-11-15`. Why: F109 set `2026-11-15`, the route checks equality (`questions.md` 26).
- stage 16 step 1: an OAuth mailbox → 409 `blocked`. Why: D19.
- stage 17: `deploy/README.md` § Reply drafts (turn on, turn off, roll back with the SQL that fails pending new-kind outbox rows before a rollback to a release older than stage 03).
- stage 18 step 1: deploy = a tagged release by `docs/release-checklist.md` and `deploy/release.sh v<x.y.z>` (it backs up and migrates); one-off commands through `$C run --rm cli bun run …`; log checks through `deploy/logs.sh --event`; rollback through `deploy/rollback.sh` after the flag goes off. Why: F114 stage 06, F103 stages 17–18.
- interfaces.md: index line (exists, F116); new § Log fields; consent route reuse rule when F116 stage 17 lands first.
- ticket.md § Sequenced: Plan after adds F116; new `Refresh:` line.
- questions.md: items 25–28.

Stage count, stage order and every earlier decision and owner default are unchanged.

## Facts checked that needed no change

- F102: `insertEditedPair` (`actions/repo/edit.ts`), `editApproval`, `ApprovalHooks.onDecided`, `listCardsOfSend` (`channels/card-edits-repo.ts`), `approval_edit` kind, `approveRow`, `ApprovalItem` / `ApprovalDetail`, `approvals_page`, `actions-edit.test.ts`, `openapi-routes.test.ts` exist.
- F104: `syncSentHeaders(deps: SentSyncDeps{ provider: SentFolderReader, … }, ctx, mailboxId)` and `listUserAnswers(db, ctx, emailIds)` keep the shapes of F2.
- F109: `suspiciousReasonsOf(db, ctx, emailIds) → Map` unchanged; `suspicionOf`, `replyFactsOf`, `mailboxProfileOf`, `replaceApproval`, `closeSend` do not exist yet (no landed ticket did a step of this plan).
- F4: `judgeCaseDraft` still sends `kind: "delegation"`; gate files keep the `<role>-<prompt>-<model>-<endpoint>-<scenario>-v<n>` name.
- `draftKinds`, `DRAFT_TEMPLATES` (no `NO_TEMPLATE` yet: stage 04 already asks), `buildOutgoingMessage` (now with `cc`), `quoteOriginal`, `startSendWithinLimits`, `locateByActionId`, `fetchMetaIn`, `fetchContent`, `fetchFlagsIn`, `removeDraft`, `applyDraft`, `applySend`, `renderApprovalRequest`, `cleanUserText`, `isNoreplyAddress`, `featureFlags`, `tool_switches`, `llmPrices`, `weekStatsSchema`, `reports/metrics.ts`, `SignatureCard`, `TRIAGE_LLM_SCOPE`, `LLM_DAILY_CAP`, `layers.json`, `graph:modules`, `web:build`, `test:e2e` exist.
- Log fields `action_id`, `count`, `error_code`, `reason`, `status` are in the allow-list.
- ForceReply and `reply_to_message` handling do not exist yet: stage 13 adds them, as planned.
- The master CI lesson on Compose renderings: F115 adds no Compose file or Compose test.
- F119 (company sign-in) and F113 (live lab) touch no name of this plan.

## Review fixes (plan-review-2.md: FAIL, 1 blocking, 9 findings; coordinator decisions)

- B1 → stage 03 step 2 (new): the three outbox kinds go into `noticeKinds`, `noticeViewSchemas`, `noticeRenderers` and `queuedBy` in the commit of the CHECK change, with minimal views and renderers that stages 12–13 fill; names `telegram-schema.test.ts` and both `registry.test.ts`. The `renderNotice` item is gone. The real rollback failure (`claimDueOutbox` parses `row.kind`; one unknown row fails the claim batch of all orgs) is named in stage 03 (note), stage 17 (README SQL: fail new-kind rows in `pending` and `sending`, end open `reply` actions for a release older than stage 04) and stage 18 (rollback line). questions.md 28 rewritten as `[important: production]`.
- Finding 9 → split: stage 03 keeps the migration, the notice kinds and the privacy maps (the completeness tests read the DB columns, so the maps must land with the migration); new stage 03b holds the repositories, retention, flag and switch. Still one migration. Named `03b`, not a renumber: F116 cites F115 stages 04, 12 and 15. Stages 04 and 06 now need 03b.
- Finding 1 → stage 12 step 3: F116 stage 17 rule (strictly greater, `.2` suffix), `REPLY_CONSENT_SINCE`, D16 "older" = `consentCovers` false; reuse F116's reader and route when on `master`; test new > previous.
- Finding 2 → stage 07: `replies.drafter` in `jobNames` and the usage text, test in `job-run-args.test.ts`.
- Finding 3 → plan.md F5: the thread index exists.
- Finding 4 → stage 04: the drafted-recipient match covers `reply`; test 8 (send `cc` ≠ draft `cc` → `bad_payload`, no SMTP).
- Finding 5 → stage 08 test 8: `follow_up` with an edited copy → `draft_changed`, no SMTP, loop row unchanged, no outbox CHECK error; no answered check for a loop send.
- Finding 6 → `ReplyBlockReason` gains `oauth_mailbox` (interfaces.md); the guard is in `setToolSwitch` with a CLI test (stage 10); stage 16 answers that reason; stage 11 shows the toggle disabled for an OAuth mailbox. questions.md 29.
- Finding 7 → stage 17 SQL (b) and stage 18 rollback line.
- Finding 8 → stage 17 doc list adds `docs/code-patterns.md` § The consent version.
