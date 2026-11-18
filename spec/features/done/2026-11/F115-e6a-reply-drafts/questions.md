# F115 · Defaults for the owner

The planner took these defaults (no blocking question). Each is a decision in `plan.md` or a stage. The coordinator copies the `[important]` ones to `docs/owner-decisions.md` when it lands the plan.

1. **[important: privacy]** Telegram consent bump in stage 12 (D16). Default: bump `TELEGRAM_CONSENT_VERSION`. The new text adds "reply drafts that the AI writes for you, and the addresses of the other recipients of a mail (To, Cc, Reply-To)". A chat linked with an older consent keeps its link but gets no reply text and no other addresses until the user agrees again in the panel (stages 12, 15); it gets the count and a panel link. Why: the job's consent rule, and the version check today runs only at a new link (review G12). The Polish text is an agent draft.
2. **[important: user-visible]** Flag `reply_drafts` off (D12). Default: it stops new drafts and notices. Approve of an open reply answers "off", and the committer holds reply sends until they expire. Rejected: let open drafts still send (a kill switch that does not stop sends).
3. **[important: user-visible]** Cap share (D5). Default: an automatic draft waits for the next quota day at 80% of `LLM_DAILY_CAP` (not dropped). A tap at 100% fails at once with a message.
4. **[important: user-visible]** Reply cards show the full draft text in Telegram until E9b adds the detail levels (D15, ADR 0032). Why: today's approval cards do the same, and PD-074 needs the full text for a tap.
5. **[important: scope]** Stages 01–02 (prototype) may build before E4-A, E5a and the other needs land. They need only F097 in `done/`. The `05-execution-plan.md` row 21 lists all needs for the whole ticket; the coordinator may add "stages 01–02 need only E2a" to that row.
6. **[important: money]** Stage 02 spends real LLM money. Default: `--budget-usd 2` for each of three runs (dev, holdout, injection set). That is at most $6, inside the $20 month cap that F109 and F113 also use. The judge runs on the other provider (PD-026).
7. **[important: user-visible]** The sweep closes a waiting draft (`answered`, `newer_mail`, `original_moved`, `suspicious`, `policy_changed`) with no result notice. A draft that the user already tapped Send on gets a result notice (stage 09). Why: a notice for each closed draft is noise.
8. **[minor]** Tap, redraft and sample need a `triage_results` row and an `email_headers` row. Mail stored before header capture gets "not checked" (D4, F109 N3).
9. **[minor]** A tap on mail in a language other than pl or en drafts in the owner's locale (null = Polish) (stage 06).
10. **[minor]** Reply all adds at most 10 recipients (D14).
11. **[minor]** Any newer mail in the thread closes the older open reply. This covers every category and every sender, also an own mailbox (D7). The reason code is `newer_mail`, not `superseded`.
12. **[minor]** A draft made before stage 08 (no `copy_hash`) keeps today's send path (D9).
13. **[minor]** "✍️ Draft reply" shows on urgent notices and on digest rows of `needs_reply` and `urgent` mail. Any other mail gets the button on the panel activity row (stage 13).
14. **[minor]** `original_moved` = any change of `emails.folder` after the request. This covers moves by the user and by the system (D11).
15. **[minor]** Redraft, Reply all, Use Reply-To, Draft reply, Preview and samples are for owners only. Members can read only.
16. **[minor]** Turning the switch on drafts open `needs_reply` mail of the last 7 days (stage 10).
17. **[minor]** Preview: at most 10 a day per mailbox. Samples: one run a day per mailbox (stages 10, 16).
18. **[important: scope]** The "Show 3 sample drafts" button sits on the style card. The E4-B report (F110) links to it later (stage 16).
19. **[important: user-visible]** The copy check of delegation, clarification and reminder sends sits behind a new org flag `draft_copy_check` (default off). Reply sends always check. Stage 18 turns the flag on for the pilot org after probe P1 shows a stable copy hash on Interia. Why: if the server changes the copy, every delegation send would stop as `draft_changed` (review G10).
20. **[important: user-visible]** The organization signature card becomes read-only after the stage 03 copy into each mailbox. Signatures are edited per mailbox (stage 11, review G9).
21. **[minor]** The copy hash covers the text, Subject, To, Cc and the attachment list. A copy whose text cannot be read counts as changed (D9, review B2).
22. **[minor]** A newer automatic mail in the thread (`Auto-Submitted` set and not `no`, for example an out-of-office) does not close the open reply (D7).
23. **[minor]** A tap or redraft request that is not done 10 min after the tap ends `failed` / `timeout`, and the user is told (stage 07).
24. **[minor]** A reply draft with no copy baseline (the read after APPEND failed) never sends; it ends `draft_missing` and the copy stays (stage 08).

## Refresh 1 (2026-11-15, plan base 17b2a369)

25. **[important: scope]** OAuth mailboxes (F117) now exist. Default (D19): reply drafts only for password IMAP mailboxes until E9. The switch `reply_drafts` refuses a mailbox with `oauth_provider` set (stage 10), and samples answer `blocked` (stage 16). Why: the ticket puts replies on Graph and Gmail out of scope (E9); a Microsoft mailbox sends through Graph. Option: allow them now (the follow-up kind of F116 already sends through the same senders).
26. **[minor]** The consent version is a date and the link route checks equality. F109 already set `2026-11-15`. Default: stage 12 sets the land date, or `<date>-2` when the value is that date already, so linked users confirm again.
27. **[minor]** The reply request id in log lines is `reply_request_id`. `request_id` is the HTTP request context of F103 (`deploy/logs.sh --request`).
28. **[important: production]** A code rollback to a release older than stage 03 needs SQL first: an outbox row of a new kind (`pending` or `sending`) makes the old claim fail its whole batch for all orgs. Default (stages 17, 18): flag off, then one SQL that fails those rows and, for a release older than stage 04, ends open `reply` actions (reason `rollback`). Stage 03 adds the kinds to core with minimal renderers (coordinator decision B1).
29. **[minor]** Reply drafts for an OAuth mailbox are refused with the reason `oauth_mailbox`; the settings toggle shows disabled with a short reason (stages 10, 11, 16).
