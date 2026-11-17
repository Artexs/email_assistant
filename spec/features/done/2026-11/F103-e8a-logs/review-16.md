# F103 stage 16 review (Opus 5.5, PASS eb83873b)

Model: Opus 5.5, because the stage is [risky]: the canary is the proof of the privacy rule. No BLOCKING.

Fixed in one Sonnet continue (no re-review): TG1 (case-insensitive compare; the Message-ID local part is planted too), TG2 (base64, base64url and hex forms of each planted value are checked), TG4 (a planted error `code` that holds text), and one sentence in `docs/capabilities/logs.md`.

Verified: the canary drives every path that the stage names (steps 1-7) and asserts all required events, a `run_id` and a `request_id`; the reviewer's plants on paths outside the worker's 11 mutations (`errorFields` leaking the first word of an error message as `error_code`, the delegate local part, a word of the chat text on `outbox_refused`, the login error text on `sync_auth_error`) all made the canary FAIL; the `console_output` exception does not hide a leak (only the `dropped_fields` problem is removed from the guard lines); the Telegram 400 path and `/api/activity` are valid replacements; the one-line `mail-open.test.ts` change keeps the proof; flaky risk low.

Open (TG3, carry-over for a later stage or ticket): real paths with mail data that the canary does not drive: Telegram inbound updates and chat commands (no `job=telegram.update` line), the delegation chaser (delegate address), Sent-folder sync, apply of a move or label, the permanent `send_failed` and `outcome_unknown` send paths, card edits after a tap, the not-triaged and send-held notices, OAuth token refresh errors, the HTTP error handler for a route that throws, auth mail, privacy export and delete, testmail. The real ImapFlow and nodemailer error mapping is faked (both libraries run with `logger: false`). `logs.md` says this truthfully. Add driven paths when each is touched, and in F103 stage 19 (docs) decide whether to list them as a standing limit.

Other notes: 502 lines is over the 400-line guideline for source files (integration tests here reach 3000 lines); plausible: global console spies could catch a late async log of an earlier file (did not happen in a full run).
