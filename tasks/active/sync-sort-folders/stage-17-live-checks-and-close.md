# sync-sort-folders — Stage 17

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's "Done when", D20 and "Rules for every step" first. Needs stage 16.

## Stage 17 — Live checks, unblock `test-mail-traffic`, close [risky]

Why risky: the checks run on the live VPS and the user's only real mailbox (read-only), and the close-out ends the task. Who: the main session and the user (checkpoint 3).

- [ ] **17.1 Live checks after 24 h; unblock `test-mail-traffic`; close the task**
  - Goal: done-when items 1 and 5 on the VPS, the user's look at the result, and the close-out.
  - Files: this task file (§ Results, Log, status, done-checklist); `tasks/active/test-mail-traffic.md` (status line and "Blocked until" line);
    `tasks/active/test-mail-traffic/stage-09-first-real-batch.md` (a note at step 9.1.5/9.1.6: `deliver` is not needed; the 2026-11-08 smoke mails are older than
    the first-sync window, so stage 9 sends a new smoke batch); then `git mv tasks/active/sync-sort-folders.md tasks/done/` and the folder.
  - Interfaces: none (operations); `C`, `<ORG>`, `<MB>` as in stage 16.
  - Decisions: read-only on the VPS; the only writes are task files (master mode, in a temporary detached worktree of `origin/master` as in stage 16
    step 10; the main checkout holds other sessions' work). A finding (an `error` line, a false return, a missing mail) → a fix task in
    `tasks/planned/` and a stop for the user, not a hot fix.
  - Steps:
    1. At `T + 24 h` or later (T from stage 16): `$C logs --since 24h server | grep -c ' error '` → 0; `grep -c 'folder offers: incremental'` > 0;
       `grep -E 'folder [a-z]+: .*; the next tick tries again' | wc -l` → 0 (else a finding).
    2. SQL counts since T: rows by `source_folder`; triage results by `source_folder` and category; actions by type and status (also moves `{ folder: "inbox" }`:
       a real rescue checks NV2: the row is in INBOX and stays there after 1 h); `email.returned` audit rows and `triage_feedback` rows with `source = 'imap_move'`
       since T (expected 0 unless the user moved mail back). Write the tables (counts only) in § Results.
    3. `mailbox:audit --since <T>` on the VPS (`$C run --rm server bun run mailbox:audit --org-id <ORG> --mailbox-id <MB> --since <T>`): the INBOX line as before;
       the `offers` line `missing=0` and `cross` = the number of cross copies (expected 0 or 1).
    4. Checkpoint 3 (user): the user opens a digest with `📁 Oferty` lines; optional: taps ↩️ on a moved `Oferty` mail and checks in the webmail that it is back in `Oferty`.
       The main session checks the row after the tap (`folder` = `source_folder` = `Oferty`, the reverse action's `provider_result.by_append` true; U11).
       Then it waits at least 10 minutes (Interia re-sorts a COPY after about 4–5 minutes, F12) and checks again: the row still has `folder` = `Oferty`, and no
       new row with `source_folder` INBOX and the same `message_id_header` exists. A re-sort = a finding (stop and ask the user).
    5. Unblock `test-mail-traffic` (master-mode commit of task files only, `tasks/README.md` § "Git mode"): its status line names the deploy commit and says stage 9 resumes
       without `deliver`; remove its "Blocked until" line. Tell the user in the end message that the test-mail-traffic session can resume.
    6. Close, in this order: tick the done-checklist (each item with the command and its output in the Log); `git mv` this file and its folder to
       `tasks/done/`, commit and push (temporary worktree of `origin/master`); then `bun run db:worktree sync-sort-folders --drop` (run it in the task
       worktree, which holds the env lines); then remove the task worktree and the branch (`tasks/README.md` § "Git mode" step 4).
  - Test: none (operations).
  - Check: steps 1–3 numbers; the user's answer in step 4.
  - Done when: done-when items 1–7 have their evidence in the Log; the task is in `tasks/done/`.
  - Out of scope: the `test-mail-traffic` run itself (its own task).
