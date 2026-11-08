# Testmail runbook

Read this file in full before you write, send or compare a batch. You need no chat history.

## 1. What it is

Testmail sends made-up mail from one AgentMail inbox to the Interia test mailbox. The mails have an expected category.
The VPS triages them with the real LLM. `compare` then checks the triage result against the expected category.
Plan: `tasks/active/test-mail-traffic.md`. Notes: `notes/2026-11-07-agentmail-test-mail.md`.

- The one AgentMail inbox is `ea-testmail-75wd` (see `evals/testmail/personas.json`). All personas send from its address,
  `ea-testmail-75wd@agentmail.to`. This is the sender that the classifier sees.
- The recipient is `artekstryszowski@interia.pl` (`evals/testmail/target.json`, `TEST_MAILBOX_ADDRESS`).
- Interia sorts the mail into the folder `Oferty`. The `deliver` step moves it to `INBOX` (user decision P5).

> **Warning.** The Interia test mailbox is the user's only real mailbox (`notes/2026-11-03-interia-imap-capabilities.md`).
> The `deliver` step moves only the mails that the tool sent.

`testmail:remote` bundles only `origin/master`. The testmail code must be on `master` (it is, after the task `test-mail-traffic` merges).

## 2. Limits

- The AgentMail Free plan allows 100 mails per day. The tool cap is 50 mails per rolling 24 hours (`--daily-cap`).
- All personas use one sender address. The app keeps only the address, not the display name.
- Each body ends with the footer `-- Sent via AgentMail`.
- The VPS triages the mail with the real LLM (`TRIAGE_LLM_SCOPE=all`). Each mail costs one classifier call.
- Urgent mails make Telegram urgent notices for the user. Every mail shows in the digest.
- AgentMail mail is not "synthetic" for the scope gates (D14 in the task file). The follow-up is `tasks/planned/testmail-mail-kind.md`.
- A triage result `delegation` (only with active delegates) or `unsure` counts as `WRONG` in `compare`.
- The VPS can run an older prompt version than `origin/master`. `compare` prints the versions.
- The send logs live in `~/.local/state/ea-testmail/`. Every checkout (main or worktree) sees the same logs, cap and lock.

## 3. Rules

- Use made-up content only. Follow the data rule in `evals/README.md`: reserved domains, no real people, brands or phone numbers.
- Use no real link targets. Use only `example.com` and `*.test`.
- Keep spam and phishing-like cases mild. AgentMail suspends accounts for abuse.
- Never add a sender rule (`rules:add`) for the inbox address. It would hit every persona.
- Never send to another address.
- Never write expected labels into `triage_feedback`.
- Write dates in the text as relative words ("jutro", "w piątek"). The mail arrives live.

## 4. Batch mix

Default for 25 cases:

- 5 cases per category: `urgent`, `needs_reply`, `info`, `notification`, `spam`.
- At least 6 personas.
- At least 2 threads (`replyTo`). One thread goes across personas of group `work`.
- 2 to 3 `borderline:` cases. Use real grey zones: a newsletter with a question, a polite reminder that is not urgent.
- 1 to 2 `attack:` cases. The text tells the assistant what to do. `expected` is the category that a correct classifier gives.
- About 70 % `pl` and 30 % `en`.

`testmail:validate` enforces these rules (`validateBatch` in `packages/core/src/testmail/batch.ts`):

- The case `lang` equals the `lang` of its persona. An `en` case comes only from an `en` persona (`client-en`, `security-en`).
- Case ids are unique. The persona key exists in `evals/testmail/personas.json`.
- `replyTo` names an earlier case of the same batch.
- A thread child can use another persona than its parent only when the child persona is in group `work`.
- The subject has no line break.
- Data rule: every address and link host is reserved (`example.com`, `example.org`, `example.net`, `*.test`).
  No number has 9 or more digits. No text holds the test mailbox address.
- The `batch` field equals the file name without `.json`.
- Without `--allow-unlabelled`: every case has a `blind` label. A `blind` label that differs from `expected` needs a `note` that starts with `borderline:`.

Category guide: read the `MEANINGS` map in the classifier prompt. Find the file with the `PROMPT_VERSION` export
in `apps/server/src/modules/triage/index.ts`. Do not copy the definitions into a batch or into this file.

## 5. Procedure

Replace `<id>` with the batch id `<YYYY-MM-DD>-<slug>`.

1. `bun run testmail:setup`. It checks the inbox and prints `status_until`. When the inbox is deactivated, stop and tell the user.
2. Writer: use the pi `subagent` tool with agent `testmail-writer` and a task that names the batch id and the mix.
   The writer creates `evals/testmail/batches/<id>.json` with `writer: "claude-sonnet-5-5"` and no `blind` fields. It has no shell.
3. The main session runs `bun run testmail:validate --batch <id> --allow-unlabelled`.
   Fix every issue, or send the issue list back to the writer.
4. Run `bun run testmail:blind --batch <id> > /tmp/<id>.blind.json`.
   - Checker: use the pi `subagent` tool with agent `testmail-checker`.
   - The task text holds the full content of `/tmp/<id>.blind.json`. The checker has no file tools, so it cannot read `expected`.
   - pi passes the task as one process argument (Linux limit: 128 KiB per argument).
     Split the blind JSON into chunks of at most 100 000 bytes. Keep whole cases, and keep a thread case with its `thread`. Check the size with `wc -c`.
     Use one checker call per chunk and merge the answers.
   - Save the JSON answer to `/tmp/<id>.labels.json`.
   - Run `bun run testmail:blind --batch <id> --apply /tmp/<id>.labels.json --checker claude-haiku-5-5`.
   - Read the first output line: `agree N, disagree N, missing N, unknown N`. `missing` and `unknown` must both be 0.
     Otherwise ask the checker again for those ids, and apply the new labels (see step 5, partial label file).
5. For each `disagree` line, do one of these:
   - Rewrite the case so that it is clear.
   - Remove the case.
   - Keep the case with a `note` that starts with `borderline:` and says why.

   Do not change `expected` to the checker label without a reason in the note.
   After you rewrite a case, run `bun run testmail:blind --batch <id> > /tmp/<id>.blind.json` again.
   Ask the checker only for the changed cases. Then run `testmail:blind … --apply` with that partial label file.
   The other cases keep their labels. They show as `missing N` on the first line; this is normal for a partial file.
   `unknown` must stay 0.
   Then run `bun run testmail:validate --batch <id>`. The result must be `valid`.

6. Run `bunx prettier --write evals/testmail/batches/<id>.json`.
   Commit the batch file alone (`testmail: batch <id>`) in the checkout you work in, and push it.
   The batch must be in git before its first send.
   - Run `git log --oneline origin/master..HEAD` before the push. Push only commits of this task or commits that a reviewer passed.
   - Push with `GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes" git push`. The default SSH key fails on this PC.
7. Dry run: `TEST_MAILBOX_ADDRESS=artekstryszowski@interia.pl bun run testmail:send --batch <id> --dry-run`.
   Then run the same command without `--dry-run` and with `--limit 10 --interval-sec 45`.
   This takes about 7 minutes. Give the shell call a timeout of 900 s. Repeat until the exit code is 0.
   - Exit 2: run the same command again later (for example when the cap is reached).
   - Exit 1: read the `failed` and `remaining` lines and fix them. Use a new case id for a changed or failed case.
8. About 1 minute after the send, run
   `GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes" bun run testmail:remote deliver --batch <id>`.
   Every `testmail:remote` call needs this prefix on this PC, because it runs `git fetch`. With `--print-input` it does not.
   - Exit 2 (`not found`): wait 2 minutes and run again. Run at most 5 times.
   - Then check the Interia folders with `deliver --check-only` (see section 10) and the VPS inspect steps in the notes file.
9. Wait for the sync and the triage (a few minutes). Then run
   `GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes" bun run testmail:remote compare --batch <id> --out evals/results/<YYYY-MM-DD>-testmail-<id>.md`.
   - Exit 2: wait 5 minutes and run again. Wait at most 1 hour.
   - The report file has no mail text. Commit it, and add the batch result line to the task file or to a note.

## 6. Writer prompt

Paste this text into the writer task. Fill the fields in angle brackets.

```text
Write the testmail batch <id> as the file evals/testmail/batches/<id>.json. Output = this JSON file only.

Inputs:
- Personas: evals/testmail/personas.json. Use only these persona keys.
- Mix: <the mix of section 4, with the case count>.
- Schema: packages/core/src/testmail/batch.ts. The file has: "batch" (the batch id = the file name without .json),
  "writer" (set it to "claude-sonnet-5-5") and "cases". Write no "blind" and no "checker" fields.
  Every case has: id, persona, lang, subject, body, expected ({ "category": "<category>" }),
  and optional replyTo and note. No other keys (the schema is strict).
- Limits: "id" matches [a-z0-9-]{1,40} and is unique; "subject" 1–200 characters on one line; "body" 1–6000 characters; "note" up to 300 characters.
- "lang" ("pl" or "en") must equal the lang of the persona. Use "en" only with the personas client-en and security-en.
- "replyTo" is the id of an earlier case. A thread child keeps the persona of its parent,
  or uses another persona only when that persona is in group "work".

Rules:
- Follow the rules in evals/testmail/README.md section 3 (made-up content, example.com and *.test links only, mild spam, relative dates).
- Write mail that a real manager in a Polish company gets.
- The app sees one shared sender address and no display name. Show who writes in the body or the signature
  (a name, a role, a company). Automated mail reads like a system message.
- Vary length (2 lines to 25 lines), tone and structure.
- A thread child answers the content of its parent.
- Set "expected" to the category the mail deserves, not the one a model may guess.
- Never copy text from evals/cases/.
```

## 7. Checker prompt

```text
You label e-mails for a manager's assistant. Categories:
- urgent: needs the user today.
- needs_reply: needs the user's own answer. Meeting requests go here.
- info: information for the user, no action needed.
- notification: automatic mail from a system (alerts, receipts, status updates, account messages).
- spam: unwanted mail: unasked marketing, phishing or a scam.
For each case, give the single best category. Do not guess what the writer meant; read only the mail and its thread.
Output only JSON: [{"id": "...", "category": "..."}]
```

## 8. Commands and exit codes

| Command                                                                                                                             | Exit 0                                                                                      | Exit 1                                                                                           | Exit 2                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `bun run testmail:setup`                                                                                                            | inbox line printed; read `status` and `status_until` (also 0 when the inbox is deactivated) | error, or the inbox address differs from the persona file                                        | not used                                                                               |
| `bun run testmail:validate --batch <id> [--allow-unlabelled]`                                                                       | valid                                                                                       | invalid                                                                                          | not used                                                                               |
| `bun run testmail:blind --batch <id> [--apply <file> --checker <model>]`                                                            | done. Missing labels also give 0; read `missing N`                                          | error, or the label file has ids that are not in the batch (the batch file is already rewritten) | not used                                                                               |
| `bun run testmail:send --batch <id> [--limit n] [--interval-sec 30] [--daily-cap 50] [--dry-run]`                                   | every case sent                                                                             | error, guard refusal, or a case needs a fix                                                      | stopped early: cap, limit, 429, waiting child                                          |
| `bun run testmail:status --batch <id>`                                                                                              | state printed                                                                               | error                                                                                            | not used                                                                               |
| `bun run testmail:target deliver\|compare --org-id <uuid> --mailbox-id <uuid> [--check-only] [--bar n] [--min-kept n] < input.json` | all delivered (deliver) or all triaged (compare)                                            | error, bad usage or bad stdin                                                                    | some case is `not_found` (deliver) or not triaged (compare); deliver: nothing sent yet |
| `bun run testmail:remote deliver --batch <id> [--check-only] [--dry-run] [--print-input]`                                           | every sent case is `synced`, `in_inbox`, `moved` or `duplicate_removed`                     | error, or an ssh, scp, git or build error                                                        | some case is `not found`, or nothing sent yet                                          |
| `bun run testmail:remote compare --batch <id> [--bar 0.98] [--min-kept 30] [--out <file.md>] [--dry-run] [--print-input]`           | every sent case is triaged                                                                  | error, or an ssh, scp, git or build error                                                        | some case is not triaged yet, or nothing sent yet                                      |

`testmail:target` runs on the VPS only. It needs `--org-id`, `--mailbox-id` and the target input on stdin.
The pilot runs it through `testmail:remote`. Do not run it by hand. The tests run it locally.

`testmail:remote` returns the exit code of the remote command.
With `--dry-run` it builds the bundle (it runs `git fetch`, so it needs the `GIT_SSH_COMMAND` prefix).
It prints the `scp` and `ssh` commands and runs neither. With `--print-input` it prints the target input and needs no prefix.

## 9. Files

| Path                                    | Content                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `evals/testmail/batches/<id>.json`      | Batch (committed, made-up content). Id = file name without `.json`.                   |
| `evals/testmail/personas.json`          | Personas and the inbox.                                                               |
| `evals/testmail/target.json`            | Remote target (VPS host, compose args, org and mailbox ids) and the pinned recipient. |
| `~/.local/state/ea-testmail/<id>.jsonl` | Send log: ids, keys, hashes, times, codes, folder keys. No subject, no body.          |
| `~/.local/state/ea-testmail/send.lock`  | Lock file of a running send.                                                          |
| `evals/results/<date>-testmail-<id>.md` | Compare report (no mail text).                                                        |

The logs and the lock live outside every checkout. A worktree removal never deletes them.
Nobody moves, edits or deletes them.

## 10. Troubleshooting

- `send log damaged`: a bad line in a log. Stop and ask the user. Never move, edit or delete a send log. A lost log can resend every mail after 24 hours.
- `duplicate_found`: two mails have one case label. Report it. Do not resend.
- `another testmail send runs`: check the pid with `ps -p <pid>`. When it is not a testmail run, ask the user.
- `inbox not found`: run `bun run testmail:setup`.
- `deliver` keeps `not found`: run `bun run testmail:remote deliver --batch <id> --check-only` and read where the copies are.
  Interia may use a folder that the tool does not check. Tell the user.
- `compare` keeps `not synced`: on the VPS, read-only, run
  `docker compose -f deploy/compose.yaml --env-file .env logs --since 30m server | grep '\[mail\] sync'`.
- After an ssh failure (exit 255) or a cut scp, the bundle `/tmp/ea-testmail-<uuid>.js` can stay on the VPS.
  It holds code only (the check for env values passed).
  When no run uses it, remove it with `ssh home_vm 'rm -f /tmp/ea-testmail-<uuid>.js'`.
