# test-mail-traffic — Stage 9

Part of [`../test-mail-traffic.md`](../test-mail-traffic.md). Read that file's "User checkpoints", "Not verified" and the runbook `evals/testmail/README.md` first.

## Stage 9 — First real batch: write, blind check, send, deliver, compare [risky]

Why risky: real systems (the AgentMail account, the Interia mailbox, the VPS DB) and real sends. The main session runs this stage itself (no implementer):
it needs `ssh home_vm`, the real API key and judgement on the results.

Gate: user checkpoint 1 (group reviews of stages 1–5 and 6–8 PASS). Risk to other work: the VPS runs `docker compose run --rm` one-off containers next to the live server
(no restart, no deploy); each test mail costs one classifier call on the VPS and shows in the user's Telegram digest; urgent ones send an urgent notice.
Do not run this stage while an S3 VPS stage (19, 20) runs.

On this PC every `git push` and every `bun run testmail:remote …` (it runs `git fetch`) needs the prefix
`GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes"` (task file "Facts checked"). Each push follows the task file rule "Shared working tree".

- [ ] **9.1 Smoke run (3 mails) and the open facts**
  - Goal: prove the whole loop on 3 mails and settle the "Not verified" items before the big batch.
  - Preconditions: the testmail code (stages 1–8) is pushed (`git log origin/master` has stage 8). Read-only on the VPS:
    `ssh home_vm 'cd ~/email_assistant && docker compose -f deploy/compose.yaml --env-file .env exec -T db psql -U postgres -d email_assistant -At -c "select version from schema_migrations order by version"'`.
    The bundled code uses `mailboxes`, `mailbox_credentials`, `emails` and `triage_results` (all from migrations up to `20261104000001`); a missing one of those → stop.
  - Steps:
    1. `bun run testmail:setup` → record `status` and `status_until` in the notes file (§10, new).
    2. The main session writes `evals/testmail/batches/<today>-smoke.json` by hand: 3 cases (one `work` persona `needs_reply`, its `replyTo` child from another `work`
       persona, one `services` `notification`); blind check with `testmail-checker` (runbook step 4); validate; reviewer (Sonnet, high) on the batch file: PASS;
       then commit and push the batch (`testmail: batch <id>`).
    3. `TEST_MAILBOX_ADDRESS=artekstryszowski@interia.pl bun run testmail:send --batch <id> --interval-sec 10` → exit 0, 3 sent.
    4. One live call of `listByLabel` for the first case's label (a 5-line `bun -e` from the repo root that imports `createAgentMailClient` and `loadTestmailConfig`
       and prints only the count) → expect 1. The raw API filter is checked (task file "Facts checked"); this step checks our client against the real API.
    5. After 60 s: `bun run testmail:remote deliver --batch <id> --dry-run` (prints `bundled origin/master <sha>` and the commands), then without `--dry-run` →
       expect `moved 3` (or `in inbox` if Interia changed its sorting). Record the folder keys and the bundled sha.
    6. Wait for the VPS sync (check `docker compose … logs --since 10m server | grep '\[mail\] sync'`, read-only), then `bun run testmail:remote deliver --batch <id>` again → `synced 3`.
    7. `bun run testmail:remote compare --batch <id>` → exit 0, 3 rows `triaged`; the child row has `thread` = `ok`.
  - Decisions:
    - Any step that fails → stop the stage, write the facts to the notes file, and ask the user only if "Input" does not answer it.
    - A `ConfigError` from the bundle on the VPS (the `origin/master` config needs a key that the VPS `.env` lacks) → stop and ask the user (P8: no `.env` change).
    - A mail found in no folder after 5 deliver runs → `bun run testmail:remote deliver --batch <id> --check-only` and record where the copies are; a mail in no
      checked folder → tell the user (Interia may have a new sort folder).
  - Done when: the preconditions hold and steps 1–7 pass; notes §10 has the facts (label filter, folders, sync delay, triage delay, `status_until`, bundled sha).

- [ ] **9.2 First full batch (25 mails)**
  - Goal: the first useful batch: done-when item 4 of the task.
  - Steps:
    1. Writer: `testmail-writer` for `<today>-batch-01` with the runbook mix (25 cases). Validate with `--allow-unlabelled`.
    2. Checker: `testmail-checker` (runbook step 4); apply; fix each disagreement (runbook step 5); `validate` → `valid`. Record the agreement count (agree / 25).
    3. The main session reads the whole batch once for the data rule (real names, brands, real places that identify people) and the tone of spam/phishing cases; fixes.
    4. Reviewer (Sonnet, high) on the batch file (data rule, labels, tone of spam and phishing-like cases, the mix): PASS. Then commit and push the batch file.
    5. `TEST_MAILBOX_ADDRESS=artekstryszowski@interia.pl bun run testmail:send --batch <id> --limit 10 --interval-sec 45` (shell timeout 900 s); repeat until exit 0.
    6. `testmail:remote deliver` until every case is `synced` (runbook step 8).
    7. `bun run testmail:remote compare --batch <id> --out evals/results/<today>-testmail-batch-01.md` until exit 0.
  - Decisions:
    - The compare report goes into the task file "Results" (the per-category table and the counts) and into `evals/results/` (committed: no mail text in it).
    - The main session writes 3–5 lines of findings under "Results": the categories with the most errors, whether `borderline:` cases explain them, whether the
      `-- Sent via AgentMail` footer or the single sender address seem to steer the classifier (e.g. many `notification` for personal mail), and a proposal for the
      next batch mix. No classifier or prompt change in this task (a prompt change needs its own eval run, `docs/code-patterns.md` "Tests").
  - Check: the command outputs above; `git status` shows only the intended files.
  - Done when: the batch is sent, delivered, triaged and compared; "Results" is filled; the done-when items 1–6 of the task are checked with the commands and outputs
    in the log; a reviewer (Opus, high) checked the results against the compare output (PASS) before the results commit.
  - Out of scope: a second batch, any prompt change, any write to `triage_feedback`.
