# F082 stage 15 — Checkpoint B: review, VPS deploy and checks, close

Part of [`../plan.md`](../plan.md). Read its "User checkpoints", "User steps", L32 and the master plan's "User checkpoints" item 2 and `deploy/README.md` § "Update" first.

Parallel: none. Last; the coordinator and the owner.

The coordinator runs this stage with the owner; it is not a worker job. Steps 15.2–15.4 touch the real system: each needs the owner's fresh yes in the chat (S6b-U4). The agent never reads or prints `.env`, a secret or a link.

- [ ] **15.1 Group review of the segment**
  - Goal: one fresh reviewer checks the whole of S6b against "Done when", because a stage review sees one stage only.
  - Decisions: a review job (Opus, high; the command of `plan.md` § "Review" with `--base <commit before stage 1> --head master` and the label `review S6b · F082`). Its task text adds this pre-mortem: "A person on the tailnet (1) learned whether an address has an account, (2) signed in during a lock or locked out a user without limit, (3) set a leaked password, (4) found a reset or setup link in a log, an audit row, an operator notice or a test snapshot, (5) set a password without the terms, (6) made the server connect to a local address through a DNS change. Which stage let it through?" Also: every `[risky]` stage review finding is closed. File its final message as `review-group.md` in the feature folder. FAIL → fixes as `limen spawn` jobs with the stage spawn command and a task that names the finding; then a second review of the fix commits. At most 2 rounds, then the owner decides.
  - Done when: `review-group.md` ends with a PASS verdict.

- [ ] **15.2 Deploy to the home VPS (owner's go)**
  - Decisions:
    - Order: F077 stage 18 (the S6a deploy) is done. Record the commit that the VPS runs (`git rev-parse --short HEAD` on the VPS) as the rollback target.
    - The steps of `deploy/README.md` § "Update" one by one (backup first, `git fetch && git merge --ff-only origin/master`, `db:migrate`, `up -d --build --wait`); paste the last line of each.
    - The VPS `.env` gets no new key (the `AUTH_*` keys stay empty; `AUTH_PWNED_CHECK` empty = on).
    - After: the start log has `auth mail: off (the CLI prints invite and reset links)` and neither an `AUTH_PWNED_CHECK=off` line nor a `mail: MAIL_ALLOW_LOCAL_HOSTS=true` line; `GET /health` ok; `POST /api/auth/request-password-reset` answers 404.
    - Rollback point: until the owner's OK, `git checkout <recorded commit>` and `$C up -d --build --wait`. The S6b migration only adds columns and a table; the old code does not read them, so they stay.
  - Done when: the server runs the S6b commit and the checks above pass.

- [ ] **15.3 Checks on the VPS (owner's go for each)**
  - Decisions (the owner opens links and types passwords; the agent reads only ids and counts):
    1. `$C exec server bun run org:invite --org-name "S6b test" --email <a test address of the owner> --display-name Test --lang en` → it prints a link (the owner copies it; the agent does not read it back into the log).
    2. The owner opens the link through the tailnet: `/setup` refuses the submit without the terms box; the box ticked and the password `password1234` → "This password is in a list of leaked passwords"; a good password → signed in, no terms dialog.
    3. The owner signs out and types a wrong password 10 times → the 11th try with the right password shows "Wrong e-mail or password."; the agent reads `select failed_count, locked_until is not null from auth_lockouts where user_id = '<test user id>'` (ids only) → locked; after 15 minutes the right password works.
    4. The pilot owner signs in → the terms dialog shows once; "I accept" closes it (S6b-U5).
    5. The Account card lists the sessions with "This device".
    6. The pilot mailbox still syncs: the log shows a sync of the pilot mailbox after the deploy with no `host not allowed` line; `$C exec server bun run mailbox:check --org-id <pilot org> --mailbox-id <pilot mailbox>` passes (the pinned-address TLS check of "Not verified").
    7. Afterwards: `$C exec server bun run org:plan --org-id <test org id> --plan suspended` (S6c deletes test organizations; until then the test org stays paused).
  - Done when: the owner says the checks are OK.

- [ ] **15.4 Close**
  - Decisions:
    - `spec/features/planned/F056-web-public-hardening/`: add `outcome.md` (3–6 sentences: "Replaced by F082 (S6b); built: lockout, leaked-password check, session list with audit, mail host check, the reset request without enumeration; not built: captcha (P9), the public proxy (scope change, P18). Merge commit <sha>."); `git mv` the folder to `spec/features/done/<YYYY-MM>/`.
    - `mkdir -p tasks/done && git mv tasks/planned/s6b-public-login.md tasks/done/`; its status line: "Done <date>: built as Limen ticket F082."
    - The master plan `tasks/active/s6-pre-sale.md`: status line and log ("S6b done, F082").
    - `limen ticket done F082` (the ticket was in `active/` since the first spawn), then `limen board --write`.
    - Commit by explicit paths. Drop the job databases that are left: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop` for each S6b job id (`limen jobs --all | grep F082`) and `bun run db:worktree f082_sNN_e2e --drop` for stages 9–13 (`db:worktree` has no list flag; a missing database is a harmless error).
  - Done when: the commit is on `master`; `limen board` shows F082 under PROVEN.
