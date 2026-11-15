# F110 stage 19 — Report mail: queue mail rows

Part of [`../plan.md`](../plan.md). Flag `report_mail`. The `outbox_channel_check` allows `mail` since stage 03.

## Step 1 — Mail rows for the D14 kinds

- **Goal:** members with `report_channel` `mail` or `both` get `digest`, `weekly_report`, `trust_report_ready` and `autonomy_paused` as outbox rows with `channel = 'mail'` (P4, Q6).
- **Files:** the digest job (`channels/digest-job.ts`), the weekly report detector, `queueTrustNotice` (stage 10).
- **Interfaces:** `queueTrustNotice(trx, ctx, { kind, view, mailboxId })` now targets owners that are linked (`telegram`/`both`) for Telegram rows, and owners with `mail`/`both` and a `report_mailbox_id` for mail rows ([interfaces.md](../interfaces.md)).
- **Decisions:**
  - The digest job visits members that have a linked chat (`telegram`/`both`) or `mail`/`both`, so a mail-only member without Telegram gets digests. The slot rules (`digest-and-notices.md` rule 3) stay; the "last slot" counts per channel.
  - A mail row: `channel = 'mail'`, `mailbox_id = report_mailbox_id`, dedup key `<telegram key>:mail` (the Telegram row keeps its key).
  - Every other kind is queued for Telegram only, as today.
  - `report_mailbox_id` null, or the mailbox is gone → no mail row (the stage 18 card warns).
  - With `report_mail` off: no mail rows; a member with `mail` gets Telegram rows when linked.
- **Test:**
  1. A member with `both` → one Telegram and one mail digest row per slot.
  2. A member with `mail`, no chat → one mail digest row.
  3. A `telegram` member → no mail row.
  4. `trust_report_ready` for an owner with `both` → two rows; for an owner with `mail` and no Telegram link → exactly one mail row (review 1 T4).
  5. `urgent` for a `both` member → Telegram only.
  6. Flag off, `mail` member with a chat → one Telegram row only.
- **Check:** `bun test apps/server/test/integration/channels-digest-job.test.ts` (or the digest-job test at `HEAD`).

## Step 2 — The sender leaves mail rows alone until stage 20

- **Goal:** the Telegram sender never claims a mail row.
- **Decisions:** the claim query of the outbox sender filters `channel = 'telegram'`. Mail rows stay `pending` until stage 20's sender; their 24 h expiry still runs (rule 7), so a build gap between 19 and 20 ends as `failed` / `expired` rows, never as a Telegram send.
- **Test:** 7. A pending mail row and a pending Telegram row → one Telegram send; the mail row is untouched.

## Done when

- Proof (`s19`) prints `PROOF_OK`.

## Out of scope

APPEND, MIME and the own-mail check (stage 20).
