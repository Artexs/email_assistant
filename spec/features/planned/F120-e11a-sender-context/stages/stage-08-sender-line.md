# F120 stage 08 — Sender line in Activity and Approvals

Part of [`../plan.md`](../plan.md). Decisions P1, P2, PD-105. Web stage: Proof with the web tail.

Carry-over reads: `packages/core/src/web/activity.ts` (`ActivityItem`), `packages/core/src/web/approvals.ts`, `apps/server/src/modules/reports/routes.ts` (activity), `modules/channels/approval-routes.ts`, `apps/web/src/components/activity/ActivityPanel.tsx`, `components/approvals/ApprovalSummary.tsx`, stage 03 `readProfiles`.

## Step 1 — API

- `ActivityItem` and the web approval item get the optional key `sender: SenderLine | null` (interfaces.md). Filled only when `sender_context` is on and a profile row exists for the mail's sender in the mail's mailbox; else `null`. With the flag off the key is absent from the answer, so the answer is byte for byte as before.
- One `readProfiles` call per page with the `(mailboxId, address)` pairs of all items (the page can span mailboxes), not one per item.
- Approvals: from the original incoming mail of the approval. A follow-up or reminder (no incoming mail) → `null`.
- The mail's address cleared by retention → `null`.
- Telegram views and outbox views do not change (P2).
- Test (integration):
  1. Flag on, profile of `anna@acme.pl` (received 8, answered 6, userMailsTo 3, relation known, last mail 2 days ago) → activity item `sender = { relation: "known", received: 8, answered: 6, userMailsTo: 3, lastSeenDaysAgo: 2, days: 90 }`.
  2. Flag off → no `sender` key.
  3. Mail with cleared `from_address` → `sender: null`.
  4. Approval of a follow-up → `sender: null`.
  5. A page of 50 items from two mailboxes (no `mailboxId` filter) → one `readProfiles` call (spy on the deps) and both mailboxes' lines filled.

## Step 2 — panel

- Activity detail and the approval summary show one line below the From line:
  - en `{Relation} · you answered {answered} of {received} mails in 90 days · you wrote to them {userMailsTo} times · last mail {n} days ago`
  - pl `{Relation} · odpowiedź na {answered} z {received} wiadomości w 90 dni · Twoje wiadomości do nadawcy: {userMailsTo} · ostatnia wiadomość {n} dni temu`
  - The last-mail part shows when `lastSeenDaysAgo` is not null; 0 → `today` / `dzisiaj`.
  - Relation words: delegate `Delegate`/`Delegat`, vip `VIP`/`VIP`, bulk `Bulk sender`/`Nadawca masowy`, known `Known`/`Znany`, new `New`/`Nowy`.
  - The answered part shows when `received > 0` (also with `answered 0`); the wrote part shows when `userMailsTo > 0`.
- Test:
  1. Unit: the en and pl line for the case of step 1 test 1; `userMailsTo 0` → no "wrote" part; relation `new`, received 1 → `New · you answered 0 of 1 mails in 90 days`.
  2. E2E: the activity detail of a seeded mail shows the line; with `sender: null` no line.

## Done when

All tests pass. Then the Proof command with the web tail.
