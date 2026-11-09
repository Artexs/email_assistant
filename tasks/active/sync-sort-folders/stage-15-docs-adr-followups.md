# sync-sort-folders — Stage 15

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's "Input" (all of it) and "Rules for every step" first. Needs stages 1–14 (the docs describe what was built).

## Stage 15 — Docs, ADR 0014, notes, follow-up tasks

- [ ] **15.1 ADR 0014 and the architecture docs**
  - Goal: the docs say which folders the sync reads and how (done-when 6). One source per fact: link the task file and the notes, do not copy them.
  - Files: create `docs/decisions/0014-sync-provider-sort-folders.md`; change `docs/decisions/README.md` (row 0014; row 0010 status "accepted, amended by 0014"),
    `docs/decisions/0010-imap-first.md` (only the status line: "accepted, amended by 0014"; the ADR rule allows a status change), `docs/architecture.md`,
    `docs/modules.md`, `docs/roadmap.md` (line 14 "Fetch new INBOX mail every 5 minutes"), `docs/code-patterns.md` (test-tool list: `mailbox:seed --folder`;
    the port list if it names the INBOX-only calls), `deploy/README.md` (the `mailbox:audit` line near line 121 now says per folder and `cross`; a section for this migration: "Roll back the code, not the migration" holds; the
    off switch per folder).
  - Decisions (ADR 0014 content, template of `docs/decisions/README.md`): Status accepted (the user approved the plan); Context = Interia tabs are folders,
    notes §10, F1–F4; Decision = D1, D2, D4, D5, D7, D11, D12, D14, D16, D23 in short form with links to this task; Consequences = one cursor per folder, the Interia
    UIDNEXT rule, the known limits D24 (a)–(h), the old cursor columns stay until `tasks/planned/drop-mailbox-cursor-columns.md`, a new provider needs its
    own `SYNC_FOLDER_DEFAULTS`.
    `docs/architecture.md` changes: §4.1 flow node `mail.sync` ("INBOX and the synced folders above each folder's UID cursor") and pipeline rule 1 (the new
    rule: the system reads INBOX and the synced folders of `mailbox_folders`; it never reads `AI/*`, Sent, Drafts, Trash or the user's own folders);
    §4.2 (a short paragraph: plan for spam folder mail, D11, D12); §4.4 Undo text ("move: ensure the mail in its source folder"); §5 tables
    (`mailbox_folders` row; `emails.source_folder`; the meaning of `inbox_uid` and `undo_pending_at`; `mailboxes.uidvalidity`/`last_uid` = a copy of the INBOX
    cursor for a code rollback); §6.1 bullets "Sync cursor", "Which mail is new", "Known mail in INBOX" (→ "Known mail"), "Returned below the cursor",
    "First connect" (24 h for every new synced folder), "UIDVALIDITY change" (per folder), "Move" (`transferByAppend` for INBOX targets of non-INBOX mail and for an Undo into a `sort` folder, U11, F12),
    and the Interia facts (F2, F3, notes link). Also §4.2 the VIP line (unchanged rule; add "also for spam folder mail") and §4.3: the go/no-go sentence
    and the policy table row "Move to an `AI/*` folder" (it now reads "Move to an `AI/*` folder or, for spam folder mail, into INBOX"), plus a line for D23
    (no urgent notice for spam folder mail) and D24 (the known limits, short, link the ADR).
  - Test: none (docs).
  - Check: `bunx prettier --check docs/decisions/0014-sync-provider-sort-folders.md docs/decisions/README.md docs/decisions/0010-imap-first.md docs/architecture.md docs/modules.md docs/roadmap.md docs/code-patterns.md deploy/README.md`;
    `grep -rn "reads only INBOX" docs/` → no hit.
  - Done when: the check passes; the reviewer finds no rule in the docs that the code does not follow.
  - Out of scope: the web panel docs (S5).

- [ ] **15.2 Notes, known alerts, follow-up tasks**
  - Goal: the facts for later agents and the ideas that this task did not build.
  - Files: change `notes/2026-11-03-interia-imap-capabilities.md` (F1–F3 and the stage 1 result, if stage 1 did not write them all), `notes/2026-11-07-agentmail-test-mail.md`
    (§10: a line that the sync reads `Oferty` now; `deliver` is not needed), `docs/known-alerts.md` (the `mailbox:audit` entry near line 359: `listInboxEmailKeys` is now `listFolderEmailKeys`, and a `cross` count is no
    problem, independent review m10; the UIDNEXT entry: STATUS gives 1 at Interia; the fix is
    D4); create in `tasks/planned/`: `drop-mailbox-cursor-columns.md` (rename `inbox_uid` → `source_uid`, `undo_pending_at` → `move_pending_at`, drop
    `mailboxes.uidvalidity`/`last_uid` and the dual write, after the pilot weeks), `junk-llm-cap.md` (D14), `classifier-folder-hint.md` (D13, needs an eval run),
    `sync-return-to-other-folder.md` (the known limit of stage 8), `backfill-per-folder.md` (`mailbox:backfill --folder`); change
    `tasks/planned/copy-below-cursor.md` and `tasks/planned/sync-return-of-a-later-copy.md` (one line each: the rules are per synced folder now, link this task).
  - Decisions: each new task file uses the template of `tasks/README.md` (status line `planned`, goal, done-when, the source decision of this task).
  - Test: none (docs).
  - Check: `bunx prettier --check` on every changed or new Markdown file of the step.
  - Done when: the check passes.
  - Out of scope: changes to `tasks/active/test-mail-traffic.md` (stage 17) and to the pilot-week tasks (stage 16).
