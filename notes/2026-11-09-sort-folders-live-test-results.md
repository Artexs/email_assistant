# Live test results of the sort-folder sync with AgentMail test mail

> Written 2026-11-10 by the `test-mail-traffic` session, for `tasks/done/sync-sort-folders.md` stage 17. Procedure: `notes/2026-11-09-sort-folders-live-test-with-testmail.md`.
> Counts only: no subject, no address. Last check: **2026-11-10 11:46Z**. Result: **pass, no finding for the sync.**

## Batches

- `2026-11-09-smoke`: 3 mails sent 2026-11-09 16:41Z (needs_reply 2, notification 1).
- `2026-11-09-batch-01`: 25 mails sent 2026-11-10 10:30–10:47Z (5 each: urgent, needs_reply, info, notification, spam).
- Compare: smoke "triaged 3 of 3 sent; ok 2; wrong 1"; batch-01 "triaged 25 of 25 sent; ok 24; wrong 1" (`tasks/done/test-mail-traffic.md` § Results).
- No test mail had VIP-like sender rules (the tool has one sender address; runbook § 3 forbids `rules:add` for it).

## Landing folder × category × action × status (28 test mails)

All 28 landed in `Oferty` (`emails.source_folder`). None in INBOX, `Społeczności`, `Rachunki` or `Wiadomości-śmieci`.

| source_folder | category     | mails | actions (status)                                                   | folder now       |
| ------------- | ------------ | ----- | ------------------------------------------------------------------ | ---------------- |
| Oferty        | urgent       | 5     | `flag` (applied)                                                   | Oferty           |
| Oferty        | needs_reply  | 6     | none                                                               | Oferty           |
| Oferty        | delegation   | 1     | `create_draft` (applied), `send` (awaiting_approval, not approved) | Oferty           |
| Oferty        | info         | 4     | `save_summary` (applied), move `ai_info` (logged)                  | Oferty           |
| Oferty        | notification | 6     | `mark_read` (applied), move `ai_notifications` (applied)           | AI/Notifications |
| Oferty        | spam         | 6     | move `ai_spam` (logged)                                            | Oferty           |

(`spam` 6 = 5 spam cases + 1 newsletter case expected `info`; `delegation` 1 = smoke case expected `needs_reply`. Both are classifier results, not sync faults.)

## Against the plan (live-test note step 5)

- `Oferty` mail is planned like INBOX mail: urgent → `flag`; needs_reply → no action; info → `save_summary` + move `logged` (auto off); notification → `mark_read` + move applied; spam → move `ai_spam` `logged`. **All as planned.**
- `delegation` from `Oferty` got a draft and an approval prompt, like INBOX mail (D11 limits "no draft" to the spam folder only). As planned.
- Urgent notices: 5 `outbox` rows `urgent`, `sent`, each text has `📁 Oferty`. As planned (U7).
- Digest 2026-11-10 07:00Z (`outbox` kind `digest`, sent): has `📁 Oferty` and a `stays in` line. As planned.
- `Wiadomości-śmieci`: no test mail landed there. One real mail (stored 2026-11-10 08:15Z) → `spam`, no action, stays (U5). As planned.

## Re-sort watch (main risk, F12)

- First applied move on a sort-folder mail: 2026-11-09 16:45:30Z (smoke notification). Batch-01 moves: 2026-11-10 10:45:30–10:45:45Z (5 mails).
- `email.returned` since T / `triage_feedback` `imap_move` since T: 0 / 0 at 2026-11-09 20:58Z (+4 h 13 min), 2026-11-10 11:04Z (+18 min), 11:46Z (+60 min).
- At 11:46Z the 5 batch-01 notification rows still have `folder` `AI/Notifications`. **Interia did not sort a moved mail back.** Moves stay on.

## Rescue check (NV2)

Not run: no test mail landed in `Wiadomości-śmieci`, so no move `inbox` exists. The one real spam-folder mail was `spam` and stays.

## Log grep and audit

- `logs --since 2h` (10:58Z) and `--since 70m` (11:46Z) for `failed|tries again|not on the server|in a row|auth_error`: only committer lines `applied N, failed 0, retry 0`; 0 real failure lines.
- `mailbox:audit --since 2026-11-09T15:21:00Z` (11:46Z), exit 0:
  - `inbox=0 stored=0 missing=0 duplicates=0 cross=0`
  - `folder=offers mail=22 stored=22 missing=0 duplicates=0 cross=0`
  - `folder=social mail=0 stored=0 missing=0 duplicates=0 cross=0`
  - `folder=bills mail=0 stored=0 missing=0 duplicates=0 cross=0`
  - `folder=junk mail=1 stored=1 missing=0 duplicates=0 cross=0`

## Not exercised

- Undo into `Oferty` by APPEND (checkpoint 3): needs a tap on ↩️ in the real Telegram (user only). Candidates: the 6 moved `Oferty` notification mails.
- `Społeczności`, `Rachunki`: no new mail since T.
