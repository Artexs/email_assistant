# F029 + F064 · Questions with their defaults

No blocking question. The stages do not change with any answer below; each default is in `plan.md`.

## Q1 — Moves of older mail stay unseen `[minor]`

The move finder uses the flag refresh's list, which holds mail received in the last 30 days. A user move of older mail into a synced folder below its cursor stays unseen (the row keeps its old folder). **Default:** accept (D14). Old mail gets few actions. Option: a wider window costs more IMAP reads per refresh.

## Q2 — Up to 10 minutes until a move shows `[minor]`

The finder runs with the flag refresh, at most every 10 minutes per mailbox; with more than 3,000 mails in 30 days, a gone mail waits for its turn in the refresh queue. **Default:** accept (D14). Option: run the finder in every sync pass, which costs IMAP reads in every pass (F064 done-when 3 forbids a cost that grows with the mailbox).

## Q3 — IMAP load on the pilot mailbox `[important: production]`

Each refresh with gone mail adds `fetchByUidsIn` calls: at most (synced folders) × ⌈gone / 500⌉, so at most 30 at the 3,000 limit with 5 folders. Deleted mail of the last 30 days stays "gone" and is looked for at every refresh. At pilot volumes (about 17 mails a day) this is 1–5 calls per 10 minutes. **Default:** accept, no extra limit (D11). Stage 05 check 4 measures it. Option: a cap per refresh (for example 500 gone rows), which can starve a real move behind deleted mail.

## Q4 — At most 5 identical copies checked `[minor]`

The later-copy check locates at most 5 known identical copies per incoming mail. With 6 or more copies in other folders and only the 6th gone, the sync stores a new copy as today. **Default:** 5 (D2). No such case is known.

## Q5 — A return into another synced folder counts as "wrong" `[minor]`

A mail that the system moved (for example to `AI/Info`) and that the user later files into `Oferty` is a return: the job `triage.returned` writes "wrong" feedback for the system's category. This is the existing rule of the sort-folder sync (ADR 0014 D8, decided 2026-11-08) and now also applies below the cursor. **Default:** keep the rule (D8). Option: a move into a folder that is not the source counts as no feedback; that changes the existing above-cursor rule too (a new ticket).

## Q6 — Flags of a found mail wait one refresh `[minor]`

The finder does not write `email_flags`; the next refresh reads the flags in the new folder. **Default:** accept (D13).
