# F104 questions (defaults taken; owner to confirm)

The owner answered the product questions of E5 (PD-115–PD-129: "You can go with defaults."). These are smaller choices the plan had to make. None blocks the build; each names the decision in `plan.md` that holds it and how to change it.

## Q1 [important: privacy] Turning the switch off deletes the stored sent mail

- Default: "Track my sent mail" off deletes every `sent_emails` row of the mailbox in the same transaction (rows, text, recipients). The card says so before the tap ("Turning it off deletes the sent mail that the assistant stored."). D11, stage 08.
- Why: the switch is the consent to read Sent; off withdraws it. The "answered by the user" marks of that mailbox go too (they are computed from the rows, D10).
- Turning off works also while the operator has the organization flag off (the card then says "paused"), so the owner can always withdraw consent (cold review 1, M3).
- Other option: keep the rows until retention clears them (text after 30 days, headers after 90). Change: drop the `deleteSentEmails` call in `setSentSync` and the card note.

## Q2 [important: privacy] Retention of sent mail counts from the Sent folder date

- Default: sent text is cleared after the organization's `data_retention_days` (30) and subject and addresses after 90 days, both counted from the mail's INTERNALDATE in Sent; the row with ids and times stays (reply times for E11a), as `emails` rows stay. D14, stage 07.
- Why: the first pass stores mail up to 30 days old; counted from the store time, old mail text would live up to 60 days.
- Other option: count from `created_at` like `emails`, or delete the whole row after 90 days. Change: the two clear functions.

## Q3 [important: user-visible] A mailbox connected while the flag is off starts with the switch off

- Default: connect sets "Track my sent mail" = the organization flag `sent_sync` at that moment. With the flag off the connect dialog shows no Sent line, so the switch starts off; when the flag goes on later, that mailbox counts as an existing one (off until the owner turns it on). D11, stage 08.
- Why: PD-116 ties "on" for new mailboxes to the one plain line at connect; no line, no consent.
- Other option: always on for new mailboxes. Change: `connectMailbox` inserts `enabled: true`.

## Q4 [minor] Only a known Sent folder is read

- Default: the pass reads `mailboxes.folder_map.sent` only (the `\Sent` special-use folder at connect, or the `Sent` folder the committer creates for its own copies). No guess by folder name; without it the card says "No Sent folder found in this mailbox." D4, edge case 4.

## Q5 [minor] "Answered by the user" = a direct reply from the user's mail app

- Default: an incoming mail is answered when a user sent mail (not a system send; the user's own send of a system draft counts) names it as its parent (`In-Reply-To`, else the last `References` id); the time is the earliest such reply. A later reply elsewhere in the thread does not mark older mails; readers that want the thread rule build it from `sent_emails.thread_key`. D10, stage 07.

## Q6 [important: user-visible] The "no sent mail seen" notice goes to owners only

- Default: one Telegram notice per owner per quiet period of 7 days (after the first pass, or since the newest sent mail); members get none; the settings card shows the setup line to everyone. D15, stage 11.
- Other option: all linked members. Change: `run.members` instead of `run.owners` in the detector.

## Q7 [minor] Old mail moved into Sent later is not stored

- Default: the table holds Sent mail of the last 30 days at the time of the read; an older mail that appears in Sent later (moved in by hand) is skipped (`tooOld`), and the cursor passes it. D4.

## Q8 [minor] At most 100 sent texts per sync run

- Default: the first pass stores all headers at once; the text of the window (14 days, or the organization's retention when shorter) comes in batches of 100 per run, oldest first. Pending text older than the window is never fetched. D7.

## Q9 [minor] The CLI connect sets the switch like the web

- Default: `bun run mailbox:connect` follows the same rule as the web (flag on → switch on) and prints one line that says so and how to turn it off. D11, stage 08 step 2.

## Q10 [important: user-visible] A system draft that the user sends from a mail app is the user's mail

- Default: a Sent mail whose `X-EA-Action-Id` names a system draft counts as the system's send only when the system's send of that draft went out (`applied` or SMTP started). Otherwise it is the user's own send: it gets text, counts as an answer and keeps the action id as a link, so the reply-draft ticket (E6a) can see "sent by the user" (PD-076). D6, stage 03 step 3.
- Other option: every mail with an own action id is a system send (no text, no answer mark). Change: `sentOriginOf` answers `system` for every own id.
