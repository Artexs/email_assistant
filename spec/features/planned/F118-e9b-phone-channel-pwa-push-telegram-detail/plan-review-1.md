# F118 plan review 1

Job `2026-11-18-f118-plan-review-2600f05e`, `claude-opus-5-5`, thinking high, at 8983ee40. Final message, filed whole.

FAIL 8983ee406d7c1cde7df778efda226b08ac68ad52

The plan has five blocking findings. Two rules conflict in each of the first and fourth. The second and third let a notice be duplicated or lost. In the fifth, a stage uses an interface that a later stage creates. HEAD is the candidate commit (`/tmp/f118-plan-review/head.txt`).

**Checks run:** I ran no test suites. This is a plan review, so no code changed and there was nothing to install. All evidence below comes from reading the plan files and the code at HEAD. The size check `wc -w plan.md stages/*.md` shows plan.md at 1,497 words and every stage file at 344–672 words. All are within the limits in `.agents/limen/planner.md:47`. The findings agree with `spec/vision.md` (privacy is a product feature, and Telegram never gets raw mail bodies).

## BLOCKING

**B1. Deleting a device deletes its outbox rows, so the `no_device` rule and its test cannot hold.**
- *Proven by reading the code.*
- D4 (`plan.md:65`) and stage 02 (`stage-02-migration-push.md:12`) put `ON DELETE CASCADE` on `outbox.push_subscription_id`.
- D9 (`plan.md:70`) and stage 08 (`stage-08-push-sender.md:20`) say: "delete the device … row `failed` / `no_device`". Stage 08 test 6 (`stage-08:29`) asserts "device deleted, row `failed` / `no_device`".
- After the cascade, the row no longer exists, so it cannot be marked failed. The new fail code is never stored.
- The same cascade deletes push rows that were already *sent*, on sign-out, a 410 or the 10-device cap. Three readers depend on those rows:
  - the M5 metric and the SLO job (`channels/metrics-repo.ts:23,93-99`);
  - the "an owner received the request" check that picks `timeout` or `not_seen` (`actions/repo/approvals.ts:11-16,84-89`).
- **Decision needed:** what happens to the outbox rows of a removed device. Two options:
  - keep the device row as a tombstone (`removed_at`);
  - or fail the open rows first and relax the CHECK, so a row that is already sent or failed may have a null `push_subscription_id`.
- Then fix test 6 and the 410 test to match.

**B2. A new device on a member who already has a chat gets a burst of old urgent pushes.**
- *Proven by reading the code.*
- The urgent detector looks back 24 h and up to 200 mails: `URGENT_LOOKBACK_MS`, `URGENT_LIMIT` (`notices/urgent.ts:15-16`). Its start time is `sinceOf(member)` = `linkedAt` (`urgent.ts:29`).
- Only the dedup key stops a repeat. The Telegram key already exists, but `<key>:push:<new sub>` does not.
- D8 (`plan.md:69`) sets `since` from the device only for members with *no* chat (`stage-07-fan-out.md:24`).
- Result: when a linked member turns on a phone, or the browser makes a new subscription after a 410, the fan-out writes one push row per urgent mail from the last 24 h. The sender drips them out at 3 per 15 s. `tag` is the row id (D5), so each one is a separate notification.
- Other detectors that rely on dedup alone (sync, auth_error, sent_missing) can do the same. That part is plausible; I did not trace them.
- **Fix:** add a per-device rule: write a push row only for events after the device's `created_at`. Add a stage 07 test with a mail triaged before the device was added and a member who has a chat.

**B3. A push-only owner never gets a push for a follow-up approval, and the approval is still marked notified.**
- *Proven by reading the code.*
- `detectApprovals` splits owners through the loop-consent gate (`notices/approval.ts:151`). That gate is the Telegram data gate (`channels/consent.ts:53-56`). It needs a `web.telegram_consent` audit row, which a push-only owner never writes.
- Owners who fail the gate get a `loop_consent` line (`approval.ts:180`). `loop_consent` is in no route group (`stage-06-routing.md:21`), so with no chat, `effectiveRoute` writes nothing. `markNotified` then runs anyway (`approval.ts:185`).
- The same split exists in the send-result and action-failed paths for follow-ups.
- **Decision needed:** a push row holds no loop data, so the gate probably should not apply to push rows. Add a stage 07 test: push-only owner, follow-up approval.

**B4. Two rules conflict on `/status` for a `minimal` user.**
- *Proven by reading the code.*
- D12 (`plan.md:73`) says: "No address, also not the own mailbox address (Q4)". Q4 (`questions.md:207`, marked important: privacy) says the same.
- Stage 09 says "`/status` stays … it holds no mail text" (`stage-09-minimal-render.md:29`). Its test 3 asserts "unchanged text" (`stage-09:33`).
- `/status` prints `📮 <mailbox address>` (`channels/commands.ts:104`) and `approvalsOf(<address>)` (`commands.ts:190`).
- A worker cannot satisfy both rules. Decide which one holds, then fix the stage 09 test.

**B5. Two interfaces are used before the stage that creates them.**
- *Proven by reading the code.*
- **(a) The `"push"` channel.** `interfaces.md:172` says stage 08 adds `"push"` to `noticeChannels`. Stage 07 already writes `channel: 'push'` rows (`stage-07:12`).
  - `NewOutboxRow.channel` is a `NoticeChannel`.
  - `renderNotice` indexes `renderer[opts.channel]` (`packages/core/src/notices/render.ts:18`).
  - `NoticeRenderer` has only `telegram` and an optional `mail` key (`renderers.ts:38-42`).
  - So stage 07 either fails typecheck or must do stage 08's core change.
- **(b) `pushKinds`.** Stage 06 creates it (`stage-06:11`). Stage 04 already needs "a title and body for every push kind" (`stage-04-pwa-shell.md:10,15`).
- **Fix:** move `"push"` in `noticeChannels`, an optional `push` key on `NoticeRenderer`, and `pushKinds`/`noticeGroups` to the first stage that uses them.

## TEST GAP

**T1. Queries that match the exact Telegram dedup key never see push rows (`<key>:push:<sub>`). No decision and no test covers this.**
- *Proven by reading the code.*
- `failPendingCardsOfSend` (`channels/card-edits-repo.ts:48-56`) matches `approval:<sendId>` only. A pending push for an approval that was answered in the panel still goes out, for example at 07:00 after quiet hours.
- F079 `requestSent` and `listUnseenApprovalSends` (`actions/repo/approvals.ts:11-16,84-89`) do not count a sent push. A push-only owner's approval ends `not_seen` instead of `timeout`. At an org resume, `expireUnseenApprovals` ends those sends too.
- `listSentStaleEpisodes` (`channels/repo.ts:706`) has the same pattern for `sync_ok`.
- Decide, for each query, whether a push row counts. Add tests in stage 07 or 08.

**T2. No test checks the payload as it is actually sent.**
- Ticket acceptance (`ticket.md:26`) names six keys, including `id`.
- Stage 08 test 2 (`stage-08:14`) checks the render output, which by design has no `id`.
- Add to stage 08 integration test 1: decrypt the body that the fake fetch receives and assert exactly the six keys.

**T3. A row can be lost after it is queued, against Q7.**
- *Plausible.*
- Q7 (`questions.md:210`) promises "no notice is lost silently", but D7 applies only when the row is queued.
- Example: a member chose `push`, and a row is held by quiet hours from 22:00 to 07:00. Their SSO session ends at 12 h (D9). The row fails `no_device` and there is no fallback to Telegram.
- Decide whether the sender falls back to Telegram. Add a test either way.

**T4. Organisations whose only recipients are push-only members are not visited.**
- *Proven by reading the code.*
- `detectNotices` builds its organisation list from `listReportMembers`. That list needs a chat or a report mailbox (`report-members.ts:83-88`).
- With no chat in the org, it runs only `mailOnlyDetectors` (`notices/index.ts:96`).
- D8 names only `detectForOrg` (`stage-07:23`). Stage 07 step 2 test 1 must go through `detectNotices`, or it passes while real push-only orgs get nothing.
- The SLO candidates also require a linked chat (`metrics-repo.ts:82,123-130`), so push-only orgs are outside the M5 alert. Decide whether that is acceptable.

## NOTE

- **N1 — Suspended orgs.** *Proven.* D10 and stage 08 (`plan.md:71`, `stage-08:20`) say a suspended org's row becomes `outdated`. But `claimDueOutbox` never claims rows of a suspended org; they wait (`channels/repo.ts:379-390`). That step is dead code and has no test. Pick one rule.
- **N2 — `listLiveDevices` signature.** *Proven.* `interfaces.md:188` and `stage-02:27` say it "decrypts", but it takes no `SecretBox`. The box is built from config (`platform/crypto.ts:34`). `queueNotice(db, ctx, input)` (`notice-queue.ts:37`) has no box either, and about 20 producers call it. The fan-out needs only the device ids: name an ids-only reader. Otherwise `interfaces.md:168` makes the worker stop and ask.
- **N3 — Wrong registry, and papers after the first data flow.**
  - *Proven.* `OUTSIDE_CALL_CLASSES` is for calls to a party that is "no sub-processor" (`platform/outside-services.ts:26-28`). Its test pins the file list to `["web.ts"]` (`outside-services.test.ts:60`). Stage 13 makes the push services a sub-processor row. The stage 01 entry (`stage-01:25`) contradicts that.
  - Real data goes to FCM from checkpoint A onward, with the flag on for the pilot org (O2). The papers come 8 stages later.
- **N4 — G-flag vs O2.** G-flag (`questions.md:228`) wants `web_push` off between the lands of 07 and 08. O2 (`questions.md:218`) turns it on and nothing turns it off. This is harmless while nobody deploys between 07 and 08 (I found no auto-deploy), but say so in the plan.
- **N5 — CSP claim without a source.** *Plausible.* Stage 04 says `default-src 'self'` "covers the worker" (`stage-04:26`). Astro's CSP emits a `script-src` directive with hashes, and `worker-src` falls back to `script-src`, not to `default-src`. Stage 04 e2e test 4 will catch it.
- **N6 — Consent version bump not decided.** Stage 13 changes `tg_consent_text` (`stage-13:10`). Nothing says whether `TELEGRAM_CONSENT_VERSION` (`core/web/telegram.ts:23`) changes too. Stage 11's PATCH to `full` checks that version (`channels/routes.ts:58`).
- **N7 — Missing index.** No index on `outbox.push_subscription_id` (`stage-02:12`). Every sign-out cascades into the outbox, which may then need a full scan.
- **N8 — No second SSRF check at send time.** `sendWebPush` does not run `checkPushEndpoint` itself (`stage-01:24`). The only check is on `PUT`.
- **N9 — Old buttons still send content.** *Proven; the plan accepts it at `stage-09:29`.* Taps on old `full` cards still send new messages that hold the subject (`callbacks.ts:83`, `delegate-taps.ts:97`) to a user who is now `minimal`. The canary does not cover this path. Write the acceptance down as a decision.
- **N10 — `reply_result` not placed.** `reply_result` (`kinds.ts:29`) is in no D6 group. It is also missing from the no-group list in stage 06 test 8 (`stage-06:21`), while `send_result` is in `updates`. Decide.
- **N11 — Shared browser.** *Plausible.* D16's re-send on panel load (`stage-05:24`) binds whatever subscription the browser holds to the user now signed in. User B on a browser that user A set up gets a device without a click. Decide whether the re-send on load may create a device or only re-bind one the same user already has.
- **N12 — Size and word counts.** Stages 08 and 09 are the largest builds, but within the word limits. `plan.md:157` gives no word counts, which `planner.md:47` requires.

## Pre-mortem: which stage lets each bug through

- **Push with mail content:** none found. The payload and the text are fixed by stages 04 and 08.
- **Lost notice:** B3 and T3 (stages 07 and 08), T4 (stage 07).
- **Duplicated or late notice:** B2 (stage 07), T1 (stages 07 and 08).
- **Push to a signed-out device:** none found. The session cascade (stage 02) and the live check (stage 08) cover it.
- **Telegram content for a `minimal` user:** B4 (stage 09). N9 is accepted by the plan.
- **Migration that broke the outbox:** B1 (stage 02).
- **SSRF through a push endpoint:** none found. Stage 01 tests 6–7 cover it; N8 is extra hardening.

## Note check

- HEAD is 8983ee406d7c1cde7df778efda226b08ac68ad52: proven. `/tmp/f118-plan-review/head.txt`, written by `mkdir -p /tmp/f118-plan-review && git rev-parse HEAD > /tmp/f118-plan-review/head.txt && cat -n <ticket, plan, interfaces, questions, stages/stage-*.md> > /tmp/f118-plan-review/plan-files.txt && cat /tmp/f118-plan-review/head.txt && wc -l /tmp/f118-plan-review/plan-files.txt` (exit 0).
- Every F118 plan file is read (ticket.md, plan.md, interfaces.md, questions.md, 13 stage files): proven. `/tmp/f118-plan-review/plan-files.txt` (680 lines, same command).
- Each finding cites a file and line and has a label; the six pre-mortem cases are covered: not proven. The only evidence is this message. No saved file holds it.
- Code claims that decisions depend on are checked against HEAD: proven. The cited files exist at HEAD: `apps/server/src/modules/channels/notices/urgent.ts`, `apps/server/src/modules/channels/notices/approval.ts`, `apps/server/src/modules/channels/commands.ts`, `apps/server/src/modules/channels/card-edits-repo.ts`, `apps/server/src/modules/actions/repo/approvals.ts`, `apps/server/src/modules/channels/repo.ts`, `apps/server/src/modules/channels/metrics-repo.ts`, `packages/core/src/notices/render.ts`, `packages/core/src/notices/renderers.ts`, `apps/server/src/platform/outside-services.ts`. Most of my read commands were joined with `;`, so the files are the proof, not those commands.
- Easy-to-miss rule ("Missing code detail … is not a finding; a missing decision, edge case, test or interface is"): followed, but not proven by a file. Each finding above names a missing decision, test, edge case or interface. None asks only for line numbers, edit text or a list of files. The only evidence is this message.
