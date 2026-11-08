# sync-sort-folders — Stage 11

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's U5, U6, D11, D13 and "Rules for every step" first. Needs stages 3, 4 and 10.

## Stage 11 — Triage: plan by the source folder [risky]

Why risky: it decides which actions the committer runs on mail from the spam folder (moves into INBOX, no move for spam). No prompt change.

- [ ] **11.1 `ClaimedEmail.source_folder`, `TriageMailbox.junkFolder`, `planActions` with `{ fromJunk }`**
  - Goal: the triage worker plans D11 for spam folder mail and the plan of today for INBOX and `sort` mail.
  - Files: change `apps/server/src/modules/mail/repo.ts` (`ClaimedEmail`, `claimEmails` returning), `apps/server/src/modules/triage/service.ts`,
    `apps/server/src/modules/triage/jobs.ts` (the mailbox snapshot), tests `apps/server/test/integration/triage-service.test.ts`, `apps/server/test/integration/triage-job.test.ts`.
  - Interfaces:

    ```ts
    // apps/server/src/modules/mail/repo.ts
    export interface ClaimedEmail {
      /* … */ source_folder: string;
    }
    // apps/server/src/modules/triage/service.ts
    export interface TriageMailbox {
      /* … */ junkFolder: string | null;
    } // getJunkFolderPath, read once per mailbox run with the snapshot
    ```

  - Decisions:
    - Where the job builds `TriageMailbox` (settings, rules, delegates, timezone), it also reads `getJunkFolderPath(db, ctx, mailboxId)`.
    - `saveTriage` calls `planActions(category, summary, delegation, { fromJunk: mailbox.junkFolder !== null && email.source_folder === mailbox.junkFolder })`.
    - The policy call is unchanged (it gets each action; D12 lives in `decidePolicy`).
    - The eval runner (`triage/eval.ts`) passes no source: unchanged.
  - Test (`triage-service.test.ts`; mode `assist`, switches `move`, `mark_read`, `flag` on, `move_unsure` off; `auto` on only for `notification`; a mailbox with a
    `junk` row `Wiadomości-śmieci` via `ensureSyncFolders`; mail rows with `source_folder` set; the LLM fake returns the named category):
    1. Spam folder mail, LLM `spam` → triaged, no `actions` row.
    2. Spam folder mail from a blocklisted sender → `spam`, no LLM call, no `actions` row.
    3. Spam folder mail, `urgent`, `auto urgent` off → one `move` `{ folder: "inbox" }` `logged`, no `flag` row.
    4. The same with `auto urgent` on (set in the settings row) → the `move` `inbox` is `ready`.
    5. Spam folder mail, `info` (`auto` off) → `save_summary` `ready`, `move` `ai_info` `logged`.
    6. Spam folder mail from a VIP sender, `notification` (`auto` on) → `mark_read` `logged`, `move` `ai_notifications` `logged` (the VIP rule).
    7. Spam folder mail, `delegation` with a delegate, switch `create_draft` on for this test (default off, `settings.ts`) → one `move` `inbox` `logged` (no
       `auto` for `delegation`); no `create_draft` row, no `send` row, no `delegations` row (U10).
    8. `Oferty` mail (`sort`), `needs_reply` → no `actions` row (it stays, as INBOX mail); `urgent` → `flag` `ready` (as INBOX mail).
    9. `Oferty` mail, `notification` (`auto` on) → `mark_read` and `move` `ai_notifications` `ready` (as INBOX mail).
    10. The `junk` row disabled → test 3 gives the same plan (the role comes from the row); a mailbox without a `junk` row: mail with `source_folder`
        `Wiadomości-śmieci` (old data) → the plan of today.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`
  - Done when: tests 1–10 pass; `bun run eval` is not needed (no prompt change).
  - Out of scope: texts (stage 12).
