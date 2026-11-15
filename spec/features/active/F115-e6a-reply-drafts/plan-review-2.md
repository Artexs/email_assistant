# F115 · Plan review 2 (refresh 1, claude-opus-5-5, job 2026-11-15-f115-plan-review-refresh-1-7dfcc27e)

FAIL 7827e51dbdc499d1483b5079daec6ef3d0d568aa

HEAD matches the candidate (`git rev-parse HEAD` = 7827e51dbdc499d1483b5079daec6ef3d0d568aa). The tree was clean. I added no commit. My probe test file is deleted.

## Blocking

**B1 (proven, by code read and a probe test). Stage 03 adds new outbox kinds in the DB but not in core, so the Proof cannot pass as written. The "rollback safety" item also fixes the wrong function.**
- `stages/stage-03-migration.md:15` adds `replies_ready`, `reply_prompt` and `reply_result` to `outbox_kind_check` only. `apps/server/test/integration/telegram-schema.test.ts:412` requires the DB list to equal `noticeKinds` exactly (`expect(values("outbox_kind_check")).toEqual([...noticeKinds].sort())`). So `test:int:ci` fails.
- If the worker adds the kinds to `noticeKinds` (`packages/core/src/notices/kinds.ts:6`), three more tests need entries for each kind:
  - `packages/core/src/notices/registry.test.ts:304-309` needs a renderer, a view schema and a fixture case.
  - `apps/server/src/modules/channels/notices/registry.test.ts:16-20` needs a detector or a `queuedBy` entry.
- Stage 03 names none of this, and `Out of scope` excludes the producers. The renderers come in stages 12–13. A Sonnet worker must guess between three paths: stub renderers in 03, kinds left out of core (red Proof), or a test change.
- The rollback reasoning is wrong at HEAD. A row of an unknown kind never reaches `renderNotice`:
  - `claimDueOutbox` runs `noticeKindSchema.parse(row.kind)` (`apps/server/src/modules/channels/repo.ts:407`). This happens after the UPDATE to `sending` and for the whole batch.
  - The sender logs `outbox_claim_failed` and returns (`sender.ts:80-89`).
  - So in a release that does not know the kinds, one such row makes the whole claim batch fail. The batch spans all orgs. Its rows stay `sending` until they are stale, then they are claimed again with the bad row. The `OUTBOX_MAX_AGE_MS` expiry (sender.ts:113) is never reached.
- Probe (temporary bun test, then deleted): `noticeKindSchema.parse("reply_prompt")` throws, and `renderNotice("reply_prompt", …)` throws. Both checks passed.
- The `renderNotice` change (`stage-03:33`, questions 28) does not make a release safe. It only helps if the kind is in `noticeKinds` with no renderer, and the registry tests forbid that state.
- Fix to decide:
  - Stage 03 adds the three kinds to `noticeKinds`, `noticeViewSchemas`, `noticeRenderers` and `queuedBy` in one commit with the CHECK, with minimal views and renderers. Stages 12–13 then fill them. Or move the CHECK change to the stage that adds the renderers. That breaks "the only migration", so it needs a decision.
  - Drop or reword the `renderNotice` item.
  - In stage 17/18, the rollback SQL must fail the new-kind rows in `pending` and in `sending` (`stage-17-docs.md:10`, `stage-18-pilot.md:23` say "pending" only).
  - Stage 18 must name the real failure, which is a stuck claim batch for all orgs. It is not "renderNotice throws".

## Findings (not blocking)

1. **Proven: stage 12 and F116 stage 17 use two different consent-version rules.**
   - `stage-12-telegram-review.md:29` uses "the land date, or `<date>-2` if it already holds that date". Its test only checks "≠ `2026-11-15`" (line 32).
   - `spec/features/active/F116-e5b-open-loops/stages/stage-17-consent-gate.md:13,22-23` uses `<date>.2`. Its new value must be "strictly greater than the value before". It compares by order (`consentCovers`: `version >= since`), and its test T7 needs `TELEGRAM_CONSENT_VERSION >= OPEN_LOOPS_CONSENT_SINCE`.
   - Failure case: F116 lands `2026-11-20.2`, then F115 lands on 2026-11-20. The current value is not the bare land date, so F115 sets `2026-11-20`. That value sorts below F116's version and closes the loop gate (F116 T7 goes red).
   - D16 "older" (`stage-12:30`) also gives no compare rule (equality, or `>=` a reply "since" constant), and F115 has no `REPLY_CONSENT_SINCE`.
   - Fix: take F116's rule (strictly greater, `.2` suffix, `consentCovers` with a reply "since" constant), and test "new > previous".
2. **Proven: stage 18 check 1 cannot run.** `stage-18-pilot.md:9` runs `job:run --name replies.drafter`. `apps/server/src/scripts/job-run-args.ts:11-17` accepts only five names, so the command exits with a usage error. `bun -e` on `jobNames.includes("replies.drafter")` printed `false`. No stage adds the name. `plan-refresh-1.md:65` lists `job:run` as "exists". Stage 07 needs a step that adds `replies.drafter` to `jobNames` and the usage text, with a test in `job-run-args.test.ts`.
3. **Proven: fact F5 contradicts the refresh.** `plan.md:43` still says "no thread index". `interfaces.md` § Data and `stage-03:14` say that `emails_thread_received_idx` exists (`db/migrations/20261115160001_open_loops.sql:115`).
4. **Plausible: stage 04 opens Cc for `reply` without a check that the send and the draft agree.**
   - `prepare` (`apps/server/src/modules/actions/send.ts:160-170`) checks "the send goes to nobody that the draft does not name" only for `follow_up`.
   - The envelope comes from the send payload (`send.ts:558`). The headers come from the draft.
   - Stage 13 (Reply all, Use Reply-To) rewrites both payloads through `replaceApproval`. If the two drift apart, the mail goes to a hidden recipient or misses one, and no test covers it.
   - Suggest: in stage 04, apply the drafted-recipient match to `reply` too, and add a test: send `cc` ≠ draft `cc` → `bad_payload`, no SMTP.
5. **Plausible: stage 08 says "`follow_up` too" but has no `follow_up` test.** Tests 1–7 (`stage-08-copy-hash.md:24-30`) cover delegation and reply only. Two risks are not ruled out:
   - A `follow_up` has no `email_id`, but `closeSend(draft_changed, notify: true, claimed: true)` runs on it from the committer.
   - D9 "`sent_by_user` if answered" needs a mail. For a loop send, that check must be skipped.
   - Add a test: a `follow_up` with an edited copy → `draft_changed`, no SMTP, the loop row unchanged, no outbox CHECK error.
6. **D19 gaps (plausible):**
   - Stage 16 answers 409 `blocked` for an OAuth mailbox, but `ReplyBlockReason` (`interfaces.md` § Core) has no reason code for it.
   - Stage 10 puts the guard on "the route and CLI". Both call `setToolSwitch` (`config/service.ts:272`; callers `config/routes.ts:119` and `scripts/mailbox-settings.ts:145`). Put the guard in the service and test the CLI path too, because test 4 covers only the API.
   - Stage 11 does not say what the settings form and style card show for an OAuth mailbox (a toggle that answers 400).
   - I checked one edge and it is safe: `oauth_provider` is set only at insert (`mail/repo/mailboxes.ts:87`), and a reconnect needs the same provider (`mail/oauth/apply.ts:278`). So a mailbox cannot become OAuth after its switch is on.
7. **Plausible: the rollback note in stage 18 ("open reply sends stay held by the committer (D12)", line 23) is true only for new code.**
   - A release older than stage 04 does not know kind `reply` or the flag.
   - Its approval detector throws for each row on `draftPayloadSchema.parse` (`channels/notices/approval.ts:43`; caught at `:108-129`) and logs an error every run.
   - Its committer would end approved replies as `bad_payload`.
   - The rollback SQL should also expire open `reply` actions.
8. **Note: doc drift.** `docs/code-patterns.md:134` says "Chats that are already linked are not asked again, and the senders never read the version". D16 changes this. Stage 17's doc list does not include code-patterns § The consent version.
9. **Note: stage size.** With B1 fixed, stage 03 holds the migration, the repositories, the privacy and retention maps, flags and switches, and the notice-kind registry entries. That is large for one Sonnet job. You could split step 3 into its own stage. The plan can still have only one migration.

## Confirmed against HEAD (no finding)
- F3: `sendRecipients` (`payloads.ts:120`) feeds the envelope (`send.ts:558`), the limits (`send.ts:532`, `send-limit.ts:28`) and the `self` filter (`actions/drafts.ts:98`, `repo/filters.ts:20-31`). Cc is allowed only for `follow_up` (`payloads.ts:102`). The address map reads `payload` by the json rule (`address-map.ts:58`).
- F7: `actions_anchor_check` (`20261115170001_action_loop_anchor.sql`). `closeSendOfClosedLoop` exists (`send.ts:437`).
- F8: `reply_request_id` and `result` are not in `log-fields.ts`. `request_id`, `action_id`, `count`, `error_code` and `reason` are.
- F9: `release.sh`, `rollback.sh` (the schema stays) and `logs.sh --since/--event` exist.
- F10: the version is `"2026-11-15"` (`web/telegram.ts:19`), checked with `!==` (`channels/routes.ts:45`). The schema allows up to 32 characters.
- F11: `mailboxes.oauth_provider` exists.
- Stage 02: `eval-args.ts` has the mode sets for `--extractor` and `--escalate`.
- Stage 03 CHECK lists: the newest `outbox_kind_check` is in `20261115150001`, and `outbox_email_kind_check` has the mail-or-loop shape in `20261115170001`.

## Checks run
- `bun install --frozen-lockfile` (Bun 1.4.4 = `.bun-version`): 991 packages installed.
- `bun run db:check-migrations`: `ok: 1 migration file(s) after 20261115160001`.
- Probe `bun test` (temporary file, now deleted), 2 pass:
  - (a) `noticeKindSchema.parse("reply_prompt")` and `renderNotice` of an unknown kind both throw;
  - (b) `checkMigrationSql` on the stage-03 shape (new table, drop and add of both outbox CHECKs) gives no findings.
- `bun -e` on `jobNames.includes("replies.drafter")`: `false`.
- Not run: lint, typecheck, unit and integration suites. This is a plan-only commit, so they do not discriminate.

## Note check
- HEAD is the candidate: proven. `git rev-parse HEAD` printed 7827e51dbdc499d1483b5079daec6ef3d0d568aa.
- Refresh changes checked against HEAD, with file:line quotes: proven. The key quotes come from `grep -n "noticeKindSchema.parse(row.kind)" apps/server/src/modules/channels/repo.ts && grep -n 'toEqual([...noticeKinds].sort())' apps/server/test/integration/telegram-schema.test.ts && grep -n '"platform.retention",' apps/server/src/scripts/job-run-args.ts && grep -n "<date>.2" spec/features/active/F116-e5b-open-loops/stages/stage-17-consent-gate.md && grep -n "<date>-2" spec/features/planned/F115-e6a-reply-drafts/stages/stage-12-telegram-review.md && grep -n "no thread index" spec/features/planned/F115-e6a-reply-drafts/plan.md && bun run db:check-migrations`. The remaining reads are cited inline above.
- Final message form (first line, blocking findings first, labelled notes, checks run): proven. See `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-15-f115-plan-review-refresh-1-7dfcc27e/review-first-line.txt` and this message.
- Easy-to-miss rule (no finding for missing code detail): followed. Each finding names a missing decision (B1, finding 1), interface (finding 2, finding 6 reason code), test (findings 4, 5), contradicted fact (finding 3) or edge case (finding 7). None of them asks for line numbers or edit text.
