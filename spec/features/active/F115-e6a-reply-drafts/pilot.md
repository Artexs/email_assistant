# F115 stage 18 · Pilot record

Pilot organization `ac6ed6a2-ee37-461f-9632-cc08cf549e40`, pilot mailbox `8bc7f572-a7f5-4fa5-aaab-db16dc663e96` (the owner's Interia mailbox, a password mailbox, mode `assist`). VPS `home_vm`, repo `~/email_assistant`. `C="docker compose -f deploy/compose.yaml --env-file deploy/db.env"`. Every line below holds ids, counts and codes only.

Owner approval: `docs/owner-decisions.md`, entry "2026-11-21 · F115 stage 18". Drafts come from `drafter-v4` (the production pointer in `apps/server/src/modules/triage/prompts/index.ts` at the release commit).

## Step 1 · Release

The release step ran before this job. `deploy/release-state/state` on the VPS (read 2026-11-21 about 02:30Z):

```text
current=v0.4.5
current_commit=f43f787773a28af7f40ffc7c5defa1b62a16cba7
previous=v0.4.4
previous_commit=fb1df6d64370639d6f28a0d0e53673e2f72b30d8
pending=
```

The release holds stage 17: `packages/core/src/web/terms.ts` at `f43f787` lists `TERMS_VERSION` `2026-11-19-2`, and `REPLY_CONSENT_SINCE` is `2026-11-19`. The coordinator reported the 30-minute watch of v0.4.5 clean. Server env (values only, no secret): `TRIAGE_LLM_SCOPE=all`, `LLM_PROVIDER=openai`, `SEND_SCOPE=all` (unchanged), `FEATURES_OFF` holds no `reply_drafts`. Logs before the flag: `deploy/logs.sh --since 1h --level error` 0 lines; `job_scheduled job=replies.drafter` and `job=replies.sweep` at 01:58:19Z.

Telegram consent: the one `web.telegram_consent` row of the pilot organization (actor `8fb22cd6-14f2-4ee0-9f3e-39dcf370f5b1`, 2026-11-20) has version `2026-11-19`. It covers `REPLY_CONSENT_SINCE`, so the owner needs no Confirm tap in the Telegram card.

## Step 1 · Turn on (2026-11-21 02:33:45Z)

```text
$ $C run --rm -T cli bun run org:flag --org-id ac6ed6a2-ee37-461f-9632-cc08cf549e40 --flag reply_drafts --on
[tenancy] org_flag_changed org_id=ac6ed6a2-ee37-461f-9632-cc08cf549e40 flag=reply_drafts enabled=true actor=cli
[org-flag] org ac6ed6a2-ee37-461f-9632-cc08cf549e40: flag reply_drafts unset → on
$ $C run --rm -T cli bun run mailbox:settings switch --org-id ac6ed6a2-… --mailbox-id 8bc7f572-… --name reply_drafts --value on
[mailbox-settings] mode: assist
[mailbox-settings] switch reply_drafts: off -> on
```

Checks after:

```text
[org-flag] org ac6ed6a2-ee37-461f-9632-cc08cf549e40: reply_drafts on (row)
[org-flag] org ac6ed6a2-ee37-461f-9632-cc08cf549e40: draft_copy_check off (default)
[org-flag] org d615e7eb-f3e0-43b1-9ae8-4c906e8d64e6: reply_drafts off (default)
[org-flag] org d615e7eb-f3e0-43b1-9ae8-4c906e8d64e6: draft_copy_check off (default)
[mailbox-settings] mode: assist
[mailbox-settings] switch reply_drafts: on
```

The VPS has two organizations; the second (`d615e7eb-…`) has no mailbox and keeps the flag off. No other flag changed.

## Check 1 · Drafter job and log events

Ran 2026-11-21 02:40:38Z, from a script that ran under `nohup` on the VPS (`/tmp/f115-pilot-watch.sh`, log `/tmp/f115-pilot-watch.log`).

```text
$ $C run --rm -T cli bun run job:run --name replies.drafter
[job-run] replies.drafter: ran once (mailboxes 1, requested 0, claimed 0, timed out 0, done 0, no draft 0, failed 0, cancelled 0, superseded 0, waiting 0, retry 0, lost 0, mailbox errors 0)
job_run_exit=0
```

Log events at 03:11:11Z (`bash deploy/logs.sh --since 2h --event <code> | wc -l`):

```text
reply_drafted 0
reply_draft_failed 0
reply_draft_error 0
reply_sweep_failed 0
errors_2h 0
```

`deploy/logs.sh --since 40m` at 03:12Z: 0 error lines, 0 warn lines.

Result: the job runs clean on the pilot mailbox. It requested 0 drafts, because the mailbox holds no `needs_reply` mail of the last 7 days (the newest one is from 2026-11-10; the auto scan takes 7 days). The event lines with ids and codes come with the first draft (check 2).

## Check 2 · A needs_reply mail gets a draft

Watch from 02:40:38Z to 03:11:08Z (30 minutes, one count each minute):

```text
tick 03:11:08 new_mail needs_reply reply_requests reply_sends: 0 0 0 0
```

No mail reached the pilot mailbox after the flag went on (02:33:45Z), so no `reply_requests` row and no reply `actions` row exists. Result: not run, no `needs_reply` mail in 30 minutes. Waiting for the owner:

1. From your other address (Gmail), send a mail to the pilot Interia mailbox. Write a short, plain question that needs your own answer (for example, ask for a date or a decision). No list footer, no auto-reply.
2. Do nothing more. Within about 1 minute after the sync, the system writes a reply draft into the Interia Drafts folder. The draft also shows in the panel at `/approvals`, and Telegram sends a "replies ready" notice with a Review button. Do not send it yet. If the triage puts the mail in another category than `needs_reply`, no automatic draft comes: send a new mail with a clearer question.
3. The coordinator then checks on the VPS (ids and codes only):
   - `$C exec -T db psql -U postgres -d email_assistant -At -c "select id, trigger, status, coalesce(reason_code, '-') from reply_requests where org_id = 'ac6ed6a2-ee37-461f-9632-cc08cf549e40' order by created_at"` → one `auto` row `done`.
   - `$C exec -T db psql -U postgres -d email_assistant -At -c "select id, type, status, (provider_result ->> 'copy_hash') is not null from actions where org_id = 'ac6ed6a2-ee37-461f-9632-cc08cf549e40' and (payload ->> 'kind' = 'reply' or id in (select depends_on_action_id from actions where payload ->> 'kind' = 'reply')) order by created_at"` → a `create_draft` `applied` with `t`, and a `send` `awaiting_approval`.
   - `bash deploy/logs.sh --since 1h --event reply_drafted` → one line; `--event reply_draft_failed` and `--event reply_draft_error` → no line.
   - The draft must be in the pilot mailbox only (the action row of org `ac6ed6a2-…`; the VPS has no other mailbox).

Result: waiting for the owner's test mail.

## Check 3 · Copy hash stable after 1 h (N1a), then `draft_copy_check`

Not run: it needs the draft of check 2. `draft_copy_check` stays off until this check prints `same`.

At least 1 hour after the draft of check 2, with no edit of the draft, the coordinator runs:

```sh
$C run --rm -T cli bun run reply:check-copy --org-id ac6ed6a2-ee37-461f-9632-cc08cf549e40 --action-id <create_draft action id of check 2>
```

Pass: it prints `same`. Then: `$C run --rm -T cli bun run org:flag --org-id ac6ed6a2-ee37-461f-9632-cc08cf549e40 --flag draft_copy_check --on`, and record both outputs here. Any other answer: keep `draft_copy_check` off and read `docs/known-alerts.md` `draft_copy_unhashed`.

Result: waiting for check 2.

## Check 4 · Draft in the thread in Interia webmail (N1b) · waiting for the owner

1. Open Interia webmail (`poczta.interia.pl`) and sign in to the pilot mailbox.
2. Open the Drafts folder. Find the reply draft to the test mail of check 2 (subject `Re: <your subject>`).
3. Open the test mail in the inbox. Look whether webmail shows the draft as part of the same conversation (thread view).
4. Write the answer here: "draft in Drafts: yes/no", "shown in the thread: yes/no". Do not edit or send the draft yet.

Owner answer: waiting.

## Check 5 · Webmail answer closes the draft (N1c) · waiting for the owner

1. Send a second test mail from your Gmail address to the Interia mailbox with a question, as in check 2. Wait until a draft for it shows in the panel at `/approvals` (about 1 minute).
2. In Interia webmail, answer that mail with the normal Reply button (not from the draft). Send it.
3. Within 10 minutes the coordinator runs, on the VPS:
   `$C exec -T db psql -U postgres -d email_assistant -At -c "select f.answered, a.status, a.status_reason from actions a join email_flags f on f.email_id = a.email_id where a.org_id = 'ac6ed6a2-ee37-461f-9632-cc08cf549e40' and a.payload ->> 'kind' = 'reply' order by a.created_at desc limit 1"`
   Pass: `t|expired|answered` (the sweep `replies.sweep` runs every 5 minutes).

Result: waiting.

## Step 2 · Owner step O1 · waiting for the owner

1. Send three real replies from drafts, after your own edits:
   - at least one by tap: Send on the review card in Telegram, or Send on `/approvals` in the panel;
   - at least one from the mail client: open the draft in Interia Drafts, edit, send it there.
2. After a mail-client send, tap Send on that same draft in Telegram or the panel once. Pass: the send ends `sent_by_user` or `draft_changed`, and no second reply goes out (look in `Wysłane`: one mail only).
3. The coordinator then records the counts: `$C run --rm -T cli bun run stats:week --org-id ac6ed6a2-ee37-461f-9632-cc08cf549e40 --week <Monday of the pilot week>` (the line `reply_drafts made … sent_by_tap … sent_by_user …`).

Result: waiting.

## Step 3 · Exit record (PD-083 exit bar)

- Stage 02 report numbers (production drafter `drafter-v4`, `gpt-6-luna`, effort low, judge `gpt-6.1-terra` `judge-v3`): `evals/results/2026-11-20-sim-lab-01-holdout-gpt-6-luna-drafter-v4-reply-judge-terra-judge-v3.md`; gate file `evals/results/gate/drafter-drafter-v4-gpt-6-luna-low-lab-01-v1.json` `passed: true`: 260 cases, 255 drafts, code checks 1.0 (bar 1), invented commitments 0 (bar 0), send as is 0.949 (bar 0.8), planted leaks 0 (bar 0), needs_facts share 0.008 (bar ≤ 0.3).
- Injection set: `evals/results/2026-11-20-reply-injection-gpt-6-luna-drafter-v4-reply-judge-terra-judge-v3.md`: 14 of 14 passed (bar 100 %).
- Owner check of 20 drafts against the judge (`owner-check-20.md`): not done (20 of 20 answers open). Default: the judge stands as it is; more than 4 disagreements of 20 would mean "fix the judge first". Note: that list holds `drafter-v2` drafts, not the production `drafter-v4`.
- Three real replies: waiting for the owner (Step 2).

## Rollback

`$C run --rm -T cli bun run org:flag --org-id ac6ed6a2-ee37-461f-9632-cc08cf549e40 --flag reply_drafts --off` stops new drafts at once; open reply sends stay held by the committer and expire. Turn it off at once if `reply_draft_failed` shows an unexpected code, a draft goes to a wrong mailbox, or the server logs errors. A code rollback follows `deploy/README.md` § Reply drafts › Roll back (flag off first).
