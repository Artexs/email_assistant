# F109 stage 15: degraded-mode notice (`not_triaged`)

Code: detector `apps/server/src/modules/channels/notices/not-triaged.ts`; readers `mail/repo/waiting.ts` (`listWaitingSenders`, `listWaitingFromSenders`) and `channels/repo.ts` (`listNotTriagedEmailIds`); view, renderer and texts in `packages/core` (`notices/views.ts`, `digest/notices.ts` `renderNotTriagedNotice`, `texts/notices.ts`); flag `degraded_notice` (default off, also in `LAB_FLAGS_ON`).

- Pause source: the in-memory `LlmPause` of the triage worker. `main.ts` builds one object and gives it to the triage job and to the Telegram runtime (`NoticeDeps.degraded = { pause, scope }`). `pausedSince()` is the first trip since the last `reset()`. No worker (`TRIAGE_LLM_SCOPE=off`): no `degraded`, no notice.
- Candidates: pending mail of the last 24 h in an active mailbox, scope `synthetic` → test mail only, sender whitelisted or VIP (`matchSender`; a whitelisted sender wins over a blocklist rule, as in `applyHardRules`). Quiet hours (22:00–07:00 of the org zone): the detector queues nothing.
- Cap: at most 5 mails per mailbox with rows since `pausedSince()`. A mail with rows stays in the set, so a member linked later still gets its row (dedup key `not_triaged:<email id>` per member). Known edge: mail that got rows in an earlier pause and is still pending is retried first (dedup) and uses the cap slots of the new run.
- Rows are `one_mail` in `NOTICE_MAIL_CONTENT` (`emailId` set; the view holds the sender address), so the mail erase removes them with the mail.
- A pending `not_triaged` row is not cancelled when the mail gets triaged before the send. The text then says "not triaged yet" for a mail that is triaged. Accepted (stage 15: no "back" message).
- Consent: no bump. The sender address is a kind of data that the consent text names already; the phrase is fixed text of ours.
- `queue()` in `notices/run.ts` now returns whether a row was inserted.
