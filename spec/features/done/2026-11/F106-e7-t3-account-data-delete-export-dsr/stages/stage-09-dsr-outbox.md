# F106 stage 09 — Erase: Telegram messages that list many mails

Part of [`../plan.md`](../plan.md). `[risky]` (privacy). Cold review 1, finding B1.

## Step 1 — the notice registry and the erase step

**Goal.** After an erase, no stored digest or approval-set message keeps the erased mail's sender, subject or AI text.

**Why a new rule.** These outbox rows hold rendered text and buttons, no per-item mail id (the digest `view` is `{ text, buttons }`, `modules/channels/digest-job.ts`), and the sender in them is cut to 40 characters (`senderLabel`, `packages/core/src/digest/text.ts`), so the address pattern of stage 06 misses it. An `approval_set` row carries only its first mail's id (`channels/notices/approval-set.ts`). `delete_mailbox` already blanks digests (`20261114100002_rls_tenant_policies.sql`).

**Files.** `modules/privacy/` (registry, erase step); tests.

**Interfaces.**

```ts
export type NoticeMailContent = "one_mail" | "many_mails" | "no_mail";
export const NOTICE_MAIL_CONTENT: Readonly<Record<NoticeKind, NoticeMailContent>>; // NoticeKind from @ea/core
export const eraseManyMailOutbox: EraseStep; // stage 08 calls it as step 6
```

**Decisions.** D19.

- **Classes at `HEAD`:** `digest` and `approval_set` → `many_mails`. `auth_error`, `sync_stale`, `sync_ok`, `mailbox_removed` → `no_mail`. Each other kind → `one_mail` only when every queue path of it sets `emailId` (then the cascade removes it); else `many_mails`. `weekly_report` → `many_mails` when its text names a mail (sender or subject), else `no_mail`. The worker reads each queue path and renderer at `HEAD` and lists the result per kind in the final message. If the `/review` list of `packages/core/src/digest/review.ts` is stored in `outbox`, its kind follows the same rule; if it is sent at once, nothing to do (say which).
- **Rule** (only when the erase removes at least one mail): rows of a `many_mails` kind of the organization with `created_at` at or after the earliest `emails.created_at` of the erased mails:
  - `sent` or `failed` → `text = '[removed]'`, `view = '{}'` (counted `outbox_blanked`);
  - `pending` or `sending` of kind `digest` → deleted (counted `outbox_dropped`; the next slot covers the period, as `delete_mailbox` does);
  - `pending` or `sending` of any other kind → unchanged: the open-action refusal (stage 06) means no pending approval request names a mail that goes.
- Rejected: the pattern scrub alone (misses the cut sender, the subject and the AI text); blanking every row of the organization (removes unrelated history); a per-item mail id in the view (changes every renderer; a later ticket may add it).
- The counts go into the `dsr.erase` audit data and to stdout: `blanked outbox <n>`, `dropped outbox <n>`.
- Messages already delivered stay in the Telegram chat (runbook, stage 10).

**Test** (integration; the stage 08 seed plus outbox rows; erased person `jan.kowalski-nowak.dzial.ksiegowosci@example-firma.test`, 55 characters):

1. Typecheck: `NOTICE_MAIL_CONTENT` covers every `NoticeKind` (a new kind fails `bun run typecheck`).
2. A `sent` digest created after the erased mail, whose text holds `jan.kowalski-nowak.dzial.ksiegowosci@ex…` and the mail's subject → `[removed]`, view `{}`.
3. A `pending` digest in that range → deleted; its `digests` row stays; the next run of the digest job for the next slot works (no error, no second message for the dropped slot).
4. A `sent` digest created before the earliest erased mail → unchanged.
5. A `sent` `approval_set` whose `email_id` is a kept mail → blanked; one whose `email_id` is the erased mail → gone by cascade.
6. A `pending` `approval_set` of kept mails → unchanged.
7. An erase that removes no mail changes no outbox row.
8. The `dsr.erase` data holds `outbox_blanked` 2 and `outbox_dropped` 1 for this seed; stdout shows both lines.
9. Organization B's digests are unchanged.

**Check.** `bun test` on the erase test file.

**Done when.** Tests 1–9 pass, the final message lists the class of every notice kind, and the plan Proof (server chain) prints `PROOF_OK`.

**Out of scope.** Changing renderers or the digest view shape; deleting messages in Telegram.
