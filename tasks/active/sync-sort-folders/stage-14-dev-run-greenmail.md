# sync-sort-folders — Stage 14

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's "Done when" 1, 3, 4 and "Rules for every step" first. Needs stages 2–13.
The procedure follows `tasks/done/s4-drafts-approvals-delegation/stage-19-dev-run-greenmail-dev-bot.md` (read it) with `tools/fake-telegram` as the phone
(`tools/fake-telegram/README.md`).

## Stage 14 — Dev run on GreenMail with the fake Telegram [risky]

Why risky: the first end-to-end run of the new sync and moves (the real classifier, a real IMAP server). Who: the main session (operations, no code). The reviewer (Sonnet, high) checks the Results text against the commands' output.

- [ ] **14.1 End-to-end run: sort folder, spam folder, rescue, Undo, digest texts**
  - Goal: done-when items 1, 3 and 4 on a real local IMAP server, the real classifier and the fake Telegram, before anything goes to the VPS.
  - Files: this task file (§ Results "Stage 14": statuses, counts, the digest lines with mail text replaced by `<subject>`; one Log line).
  - Interfaces: dev shell `D="docker compose -f deploy/compose.yaml -f deploy/compose.dev.yaml --env-file .env"` (through `newgrp docker`); SQL on the worktree DB
    (the env lines of `bun run db:worktree sync-sort-folders`); GreenMail IMAP `127.0.0.1:3143` (auth off); scopes on the command line only:
    `TRIAGE_LLM_SCOPE=synthetic ACTIONS_SCOPE=synthetic` (the seed mails have synthetic `Message-ID`s); `TEST_MAILBOX_ADDRESS=<GreenMail address>` on the seed commands.
  - Decisions:
    - Folders on GreenMail: `Oferty` and `Wiadomości-śmieci` are created once with a `bun -e` one-off (imapflow `mailboxCreate`) before the first sync;
      `AI/*` folders come from the committer (`ensureFolder`).
    - Settings for the run: mode `assist`; switches `move`, `mark_read`, `flag` on; `auto` on for `info`, `notification`, `urgent` and `needs_reply` with
      `--force` (dev only, so the rescue applies; reset at the end).
  - Steps:
    1. `bun run dev:up && bun run db:migrate`; a dev org and a GreenMail mailbox (`bun run org:create`, `bun run mailbox:connect` as in the S3/S4 dev runs, or
       reuse one: `select o.id, mb.id, mb.address from organizations o join mailboxes mb on mb.org_id = o.id;`); the settings above; the fake Telegram linked.
    2. Create `Oferty` and `Wiadomości-śmieci`. Start the server with the scopes. After the first sync tick: `select key, role, enabled, uidvalidity, last_uid from mailbox_folders where mailbox_id = '<mb>';`
       → rows `inbox`, `offers`, `junk` with cursors; the log has `added sync folders offers,junk` and one `sync … folder <key>` line per folder.
    3. Write `t0`. `mailbox:seed --eval-cases synthetic --per-category 1 --folder Oferty` and `--folder Wiadomości-śmieci` (5 cases each: urgent,
       needs_reply, info, notification, spam).
    4. Within 6 minutes: `select e.source_folder, e.folder, t.category, a.type, a.status, a.payload->>'folder' as target from emails e join triage_results t on t.email_id = e.id left join actions a on a.email_id = e.id where e.mailbox_id = '<mb>' and e.created_at > '<t0>' order by 1, 3, 4;`
       Expected for `Oferty`: `urgent` flag applied, folder `Oferty`; `needs_reply` no action; `info` save_summary + move `ai_info` applied, folder `AI/Info`;
       `notification` mark_read + move `ai_notifications` applied; `spam` move `ai_spam` logged (`auto` off). For `Wiadomości-śmieci`: `spam` no action, folder
       stays; `urgent` move `inbox` applied (no flag), folder INBOX, source `Wiadomości-śmieci`; `needs_reply` move `inbox` applied; `info` → `AI/Info`;
       `notification` → `AI/Notifications`. (A classifier result that differs from the case label is a classifier fact, not a bug: write it down and judge the plan
       by the stored category.)
    5. IMAP check (`bun -e`, read-only EXAMINE): the rescued mails are in INBOX with their flags, and not in `Wiadomości-śmieci`; the moved mails are in `AI/*`.
    6. `bun run fake-tg send /digest` → the lines of the `Oferty` and spam folder mail have `📁 Oferty` / `📁 Wiadomości-śmieci`; the spam folder `spam` line
       reads `→ stays in Wiadomości-śmieci`; the rescued line reads `→ done: move to INBOX`. The `Oferty` `urgent` mail got an urgent notice with `📁 Oferty`
       in line 1; the spam folder `urgent` mail got **no** urgent notice (D23): `bun run fake-tg read --last 10` shows none for it.
    7. Undo: `bun run fake-tg press --button "↩️ <n>"` on the rescued `needs_reply` line → within 30 s the row has `folder` = `source_folder` =
       `Wiadomości-śmieci`, `moved_at` null; IMAP: the mail is back in `Wiadomości-śmieci`, not in INBOX. Undo on the `Oferty` `info` line → back in `Oferty`.
    8. Cross copy: APPEND the raw of the `Oferty` `needs_reply` seed mail (it stays in `Oferty`) into INBOX (`bun -e`) → the next tick stores no new row:
       the INBOX pass finds the `Oferty` row (in its source folder, still there) → the INBOX folder line shows `cross copies 1`.
    9. Switch: `mailbox:settings sync-folder --key junk --value off` → the next tick has no `junk` line; `--value on` → the next tick is `initial` for `junk`.
    10. `bun run mailbox:audit --org-id <org> --mailbox-id <mb> --since <t0>` → the INBOX line has `missing=0` and `cross=1` (step 8), exit 0; one line per
        folder; read them against steps 4 and 8.
    11. Logs: no folder path, subject or address in the server output (grep `Oferty`, `śmieci`, the case subjects) and no `error` line.
    12. Stop the server (Ctrl+C, ends within 15 s). Reset: `auto` off for `info`, `notification`, `urgent`, `needs_reply`; mode `shadow`; `junk` on.
  - Test: none (operations); the automated tests of stages 2–13 cover the same paths.
  - Check: steps 2–11 give the results above.
  - Done when: steps 2–11 pass, or each difference is a written finding with a fix step (a new step in the stage of the bug, then this stage again).
  - Out of scope: the VPS and Interia (stages 16–17); real mail.
