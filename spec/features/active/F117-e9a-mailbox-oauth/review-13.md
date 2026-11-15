# F117 stage 13 review (Opus 5.5, PASS 4e1e8475)

Model: Opus 5.5, because the stage is [risky]: Graph `sendMail` sends mail to people. No BLOCKING.

Fixed in one Sonnet continue (no re-review): TG1 (a connection reset or half response after the request left is `unknown`: the main double-send guard, pinned by a `node:net` test) and a doc drift in `drafts-and-send.md` (`connect` is only a connection that cannot open; a redirect is `unknown`).

Verified: the Graph sender only replaces `deps.sender` inside `applySend`: approval, `SEND_SCOPE`, the limits (under the mailbox lock), `applying` before the call and crash recovery (search only, never send again) are unchanged; the recipient comes only from `payload.to` and the envelope must equal the MIME To/Cc/Bcc; a 401 gets one fresh-token repeat, a 5xx, a 200 that is not 202 or a timeout is `unknown` (no new send); no APPEND of a Sent copy (3 looks at 0, 5 and 15 s); `redirect: "error"`; tokens in no log, error, cause or row; fake Graph only; the sender is picked by `send_via` (Microsoft Graph, Google SMTP XOAUTH2, password SMTP); 23 worker mutations killed.

Notes:
- Spike rows M2 and M10 need the real Microsoft account. If they are false nothing double-sends: no copy is found (`sent_copy` `provider`, Graph keeps its own copy); an `applying` row ends `failed/outcome_unknown`; only delegation-reply matching by Message-ID breaks if Graph rewrites Message-ID (the stage says stop and ask).
- The size limit is 3 MiB in code, doc and test; the stage text says "3 MB". If Graph's 4 MB limit means 4,000,000 bytes, a raw between about 2.86 and 3 MiB gets a 413 (a clean `envelope` refusal, no partial send). Row M10 settles it. Fix the stage wording in stage 19.
- The Sent copy looks (waits 5 s and 10 s) run inside the committer batch: a batch of 20 Graph sends adds up to 5 min and could pass `STALE_AFTER_MS` (10 min); a second claim is `lost`, recovery never sends: delay, not a double send.
- If the process stops during the waits, the row stays `applied` with `sent_copy = pending`; after 10 min the notice says "No copy in Sent" though Graph has its own copy (wrong text, not a wrong send).
- A redirect is `unknown` (pessimistic but safe). A 503 maps to `connect`/soft, so the committer sends again: a gateway 503 after Graph took the mail would double send (plausible, unlikely; the stage file fixes this mapping): decide with the real-account smoke.
