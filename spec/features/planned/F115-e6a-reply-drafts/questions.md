# F115 · Defaults for the owner

The planner took these defaults (no blocking question). Each is a decision in `plan.md` or a stage. The coordinator copies the `[important]` ones to `docs/owner-decisions.md` when it lands the plan.

1. **[important: privacy]** Telegram consent bump in stage 12 (D16). Default: bump `TELEGRAM_CONSENT_VERSION`. The new text adds "reply drafts that the AI writes for you, and the addresses of the other recipients of a mail (To, Cc, Reply-To)". Why: the job's consent rule; other recipients' addresses are new in Telegram. Chats linked before keep their link (owner decision 2026-11-14). The Polish text is an agent draft.
2. **[important: user-visible]** Flag `reply_drafts` off (D12). Default: it stops new drafts and notices. Approve of an open reply answers "off", and the committer holds reply sends until they expire. Rejected: let open drafts still send (a kill switch that does not stop sends).
3. **[important: user-visible]** Cap share (D5). Default: an automatic draft waits for the next quota day at 80% of `LLM_DAILY_CAP` (not dropped). A tap at 100% fails at once with a message.
4. **[important: user-visible]** Reply cards show the full draft text in Telegram until E9b adds the detail levels (D15, ADR 0032). Why: today's approval cards do the same, and PD-074 needs the full text for a tap.
5. **[important: scope]** Stages 01–02 (prototype) may build before E4-A, E5a and the other needs land. They need only F097 in `done/`. The `05-execution-plan.md` row 21 lists all needs for the whole ticket; the coordinator may add "stages 01–02 need only E2a" to that row.
6. **[important: money]** Stage 02 spends real LLM money. Default: `--budget-usd 2` for each of three runs (dev, holdout, injection set). That is at most $6, inside the $20 month cap that F109 and F113 also use. The judge runs on the other provider (PD-026).
7. **[important: user-visible]** No result notice for the quiet closes of the sweep (`answered`, `newer_mail`, `original_moved`, `policy_changed`). A result notice goes out only after the user tapped Send (stage 09). Why: a notice for each closed draft is noise.
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
