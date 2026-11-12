# s6a-customer-core — Stage 18

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read the whole segment file, the master plan's D2, "User checkpoints" item 1 and `deploy/README.md` § "Update" first.

## Stage 18 — Group review, merge, D2 mailbox list, deploy (checkpoint 1)

Four steps. Steps 18.3 and 18.4 touch the real system: each needs the user's fresh yes in the chat (S6a-U1, S6a-U2). The agent never reads or prints a secret or a mailbox address; the VPS `.env` is the user's file.

- [ ] **18.1 Group review of stages 1–17**
  - Goal: one fresh reviewer (Opus, high) checks the whole segment against the "Done when" list and the decisions, because a stage review sees one stage only.
  - Files: none (review). The record: `tasks/active/s6a-customer-core/review-group.md`.
  - Decisions: scope = the commit range from the branch start to the last stage commit. The reviewer gets the segment file, the master plan D1–D6, D29, D31, and this question set: (1) pre-mortem "a customer's mail reached the LLM, or a mailbox changed, or a mail went out, while the organization was `suspended` or the mailbox in `shadow`: which stage let it through?"; (2) every job of `main.ts` against the stage 6 table; (3) every web write route against the stage 8 gate and every Telegram command and tap against stage 7; (6) a text of the §7 table that can stay longer than its period (paused mailbox, suspended org, triage scope `off`); (4) a log line, an error text, an audit row or an operator text that holds an address, a name or mail text; (5) a retention rule that clears open work. FAIL → the fixes are new commits on the branch (pipeline mode), then a second review of the fix commits. Max 2 rounds, then the user decides.
  - Test: the reviewer runs `bun run lint && bun run typecheck && bun run test:unit` in its copy; the main session runs `bun run test:int` and `bun run test:e2e` in the worktree.
  - Check: the review file ends with `VERDICT: PASS`.
  - Done when: PASS.
  - Out of scope: new features.

- [ ] **18.2 Merge into `master`**
  - Goal: the segment is on `master` and the dev database has the two migrations.
  - Decisions: `README.md` § "Git mode" `worktree` steps 3 and 4: `git fetch && git merge origin/master` in the branch, all checks green (the two known CI timing tests excepted); then in the main checkout `git merge --no-ff task/s6a-customer-core` (stage nothing of the other session; the main checkout must have no conflict in their files), push. Then `bun run db:migrate` on the dev database from the main checkout, and only when no other checkout runs `test:int` (ask the user if the other session is active). Then the dev `.env` rule: run `bun run org:status` against the dev database and pause the extra dev mailboxes before a dev server runs with a scope `all`.
  - Check: `git log --oneline -3` on `master`; CI of the merge commit: `image` and `e2e` success, `ci` fails only on the two known timing tests.
  - Done when: pushed and CI as above.

- [ ] **18.3 D2 mailbox list on the VPS (S6a-U1: the user's go first)**
  - Goal: after the deploy, `all` reaches every mailbox on the VPS, so every mailbox that is not the pilot mailbox is paused or removed before it (D2).
  - Decisions:
    - Read only, ids only: `ssh home_vm`, `cd ~/email_assistant`, `C="docker compose -f deploy/compose.yaml --env-file .env"`, then `$C exec -T db psql -U postgres -d email_assistant -c "select m.org_id, m.id, m.status, s.mode from mailboxes m left join mailbox_settings s on s.mailbox_id = m.id order by m.created_at"` (no address column; the `psql` form of `deploy/README.md:239`). Never print `.env`.
    - Paste the rows in the log (ids, status, mode). The pilot ids are org `ac6ed6a2-ee37-461f-9632-cc08cf549e40`, mailbox `8bc7f572-a7f5-4fa5-aaab-db16dc663e96` (handoff).
    - Any other row: tell the user the id; the user pauses it (panel or Telegram `/pause`) or removes it (panel). The agent does not pause or remove a mailbox on the VPS without the user's explicit yes for that id. Run the query again and log the result.
  - Done when: the log shows only the pilot mailbox `active`; every other row is `paused` or gone. An `auth_error` row counts as not done: a password fix makes it `active`, and then `all` reaches it, so the user pauses or removes it too.

- [ ] **18.4 Deploy and one day of the pilot (S6a-U2: the user's go first)**
  - Goal: the home VPS runs the S6a code, the pilot organization is `active`, and the pilot works as before for one day.
  - Decisions:
    - Before (optional, U9): the user may put `OPERATOR_CONTACT` and `OPERATOR_TELEGRAM_CHAT_ID` into the VPS `.env`. Without them the server logs the `OPERATOR_CONTACT is empty` warning, the banner says "contact the operator", and the operator notices are log lines; that is accepted (scope change, P17).
    - First record the commit that the VPS runs (`git rev-parse --short HEAD` on the VPS; the handoff says `8f6a8b2`, not verified) in the log: it is the rollback target. Then the steps of `deploy/README.md` § "Update" (backup first, disk check, `git fetch && git merge --ff-only origin/master`, `db:migrate`, `up -d --build --wait`). Run them one by one and paste the last line of each.
    - After: `$C exec -T server bun run org:status` → the pilot org `plan=active max_mailboxes=2`, `mailboxes total=1 active=1`; the server log has the start line `scope targets: 1 active mailboxes in 1 organizations, 0 suspended organizations` (when a scope is `all`); `GET /health` ok; one triage of new mail in the log; the next digest goes out.
    - Rollback point: until the user's OK after one day, a rollback is `git checkout <the recorded commit>` plus `$C up -d --build --wait`. The two S6a migrations only add columns and indexes, and the S5 code does not read them, so they stay (no down migration on the VPS).
    - One day later (or the user says so): check the log for errors since the deploy (`$C logs --since 24h server | grep -c " error "`, paste the count and the distinct messages without ids of mail), the digest count, and the triage count; report to the user.
  - Done when: the user says the pilot works.

- [ ] **18.5 Close the segment**
  - Decisions: tick the done-checklist of the segment file (each item with its command and output). Close the two Limen tickets that S6a replaces (`CLAUDE.md` § Work; the `limen` CLI if it exists, else by hand): `git mv spec/features/planned/F027-retention-job spec/features/done/<YYYY-MM>/` and `git mv spec/features/planned/F031-actions-scope-removal spec/features/done/<YYYY-MM>/`, each with an `outcome.md` from `spec/features/_template/outcome.md` ("Replaced by S6a `tasks/done/s6a-customer-core.md`, merge commit `<sha>`"); run `limen board --write` if the CLI exists. The `docs/roadmap.md` state line (stage 17). Set the segment status `done` and `git mv` the file and its folder to `tasks/done/`; update the master plan status line and log. Remove the worktree, the branch (local and remote) and the two worktree DBs (`bun run db:worktree s6a --drop`, `bun run db:worktree s6a_e2e --drop`). Commit on `master`.
  - Done when: pushed; `git worktree list` has no S6a entry.
