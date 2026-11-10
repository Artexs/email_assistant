# test-mail-traffic — Stage 8

Part of [`../test-mail-traffic.md`](../test-mail-traffic.md). Read that file's "User decisions" (P2–P5), "Design decisions" (D5, D7, D14, D16) and "Rules for every step" first.

## Stage 8 — Runbook, persona file, docs, follow-up task

Docs and data only, no code. The runbook is the brief for every later agent that writes and sends a batch: it must work without chat history.

- [x] **8.1 Persona file**
  - Goal: the committed persona set for the one inbox (D5).
  - Files: create `evals/testmail/personas.json`; change `apps/server/src/modules/testmail/send.test.ts` only if it reads the real file (it should not: tests use fixtures).
  - Content (exact keys and names; `voice` texts may be reworded, max 500 characters each, in English):

    | key            | displayName           | group    | lang | voice (summary)                                                                        |
    | -------------- | --------------------- | -------- | ---- | -------------------------------------------------------------------------------------- |
    | `prezes`       | Tomasz Wiśniewski     | work     | pl   | The manager's boss (CEO). Short, direct. Deadlines, decisions, board meetings.         |
    | `klient-anna`  | Anna Nowak            | work     | pl   | Key client (Nowak Logistyka). Orders, complaints, contract questions, polite but firm. |
    | `kolega-piotr` | Piotr Zieliński       | work     | pl   | Colleague in sales. Status updates, asks for input, FYI notes, informal.               |
    | `dostawca`     | Marek Kowalczyk       | work     | pl   | IT and office vendor. Quotes, delivery dates, service windows.                         |
    | `client-en`    | Laura Bennett         | work     | en   | Foreign partner (UK). Meeting requests, proposals, follow-ups.                         |
    | `portal-hr`    | Portal HR             | services | pl   | Automated HR system: leave approvals, payslip ready, policy changes. No signature.     |
    | `faktury`      | Faktury Online        | services | pl   | Automated invoicing: invoice issued, payment reminder, payment received.               |
    | `newsletter`   | Biznes Tydzień        | services | pl   | Weekly business newsletter: articles, events, an unsubscribe line.                     |
    | `oferta-b2b`   | Krzysztof Lewandowski | outside  | pl   | Cold B2B sales: lead generation, SEO, leasing offers. Pushy, many exclamation marks.   |
    | `security-en`  | Account Security Team | outside  | en   | Phishing-like mail: "verify your account", fake urgency. Links only to example.com.    |

    `inbox`: `{ "username": "ea-testmail-75wd", "clientId": "ea-testmail-1", "defaultDisplayName": "EA Test Mail" }`.

  - Test: `apps/server/src/modules/testmail/files.test.ts` (new): `personaFileSchema.parse` of the committed file works; `remoteTargetSchema.parse` of `evals/testmail/target.json`
    works; every file in `evals/testmail/batches/` (none yet is fine) passes `batchSchema` and `validateBatch(…, { requireBlind: true, fileBatchId })` with no issue.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bunx prettier --check evals/testmail/personas.json`
  - Done when: the test passes.
  - Out of scope: batch files (stage 9).

- [x] **8.2 Runbook `evals/testmail/README.md`, docs, follow-up task**
  - Goal: one page that tells an agent how to write, check, send, deliver and compare a batch; doc links; the follow-up task file.
  - Files: create `evals/testmail/README.md`, `evals/testmail/batches/.gitkeep`, `tasks/planned/testmail-mail-kind.md`; change `evals/README.md` (one "See also" line),
    `docs/code-patterns.md` (if stage 5 did not add the test-tool line yet), `notes/2026-11-07-agentmail-test-mail.md` (a line "Runbook: evals/testmail/README.md").
  - Content of `evals/testmail/README.md` (sections, in ASD-STE100 style, each fact once):
    1. **What it is**: one paragraph; link the task file and the notes file. The one inbox and its address; Interia sorts it into `Oferty`; the tool moves it (P5).
       Warning line: the Interia test mailbox is the user's only real mailbox (`notes/2026-11-03-interia-imap-capabilities.md`); the deliver step moves only the tool's own mails.
    2. **Limits**: Free plan 100 mails/day, the tool's cap 50 per rolling 24 h; one sender address for all personas (the app keeps only the address); the body
       footer `-- Sent via AgentMail`; the VPS triages the mail with the real LLM (`TRIAGE_LLM_SCOPE=all`), so each mail costs one classifier call; urgent mails make
       Telegram urgent notices for the user, and every mail shows in the digest; AgentMail mail is not "synthetic" for the scope gates (D14); a triage result
       `delegation` (S4, only with active delegates) or `unsure` counts as `WRONG` in compare; the VPS can run an older prompt version than `origin/master`
       (compare prints the versions).
    3. **Rules**: made-up content only (data rule of `evals/README.md`: reserved domains, no real people, brands, phone numbers); no real link targets (only
       `example.com`, `*.test`); spam and phishing-like cases stay mild (AgentMail suspends accounts on abuse); never add a sender rule for the inbox address;
       never send to another address; never write expected labels into `triage_feedback`; dates in the text are relative ("jutro", "w piątek") because the mail arrives live.
    4. **Batch mix** (default for 25 cases): 5 per category (`urgent`, `needs_reply`, `info`, `notification`, `spam`); at least 6 personas; at least 2 threads
       (`replyTo`), one of them across personas of group `work`; 2–3 `borderline:` cases (real grey zones: a newsletter with a question, a polite reminder that is not
       urgent); 1–2 `attack:` cases (text that tells the assistant what to do; expected = the category a correct classifier gives); about 70 % `pl`, 30 % `en`.
       Category guide: link the definitions of the current classifier prompt, do not restate them: the file that `apps/server/src/modules/triage/index.ts`
       exports `PROMPT_VERSION` from (`prompts/classifier-v2.ts` on 2026-11-07; its `MEANINGS` map). Do not name a version number as fixed in the runbook text.
    5. **Procedure** (numbered, exact commands):
       1. `bun run testmail:setup` — check the inbox (prints `status_until`; when the inbox is deactivated, stop and tell the user).
       2. Writer: the pi `subagent` tool with agent `testmail-writer` (step 8.3) and a task that names the batch id and the mix.
          It writes `evals/testmail/batches/<YYYY-MM-DD>-<slug>.json` with `writer: "claude-sonnet-5-5"` and no `blind` fields. It has no shell.
       3. The main session runs `bun run testmail:validate --batch <id> --allow-unlabelled` and fixes every issue (or sends the issue list back to the writer).
       4. `bun run testmail:blind --batch <id> > /tmp/<id>.blind.json`. Checker: the pi `subagent` tool with agent `testmail-checker` (step 8.3); the task text
          holds the full content of `/tmp/<id>.blind.json` (the checker has no file tools, so it cannot read the batch with `expected`). pi passes the task as one process argument (Linux limit 128 KiB per argument): split the blind JSON into chunks of at most 100 000 bytes (whole cases,
          a thread case with its `thread`; check with `wc -c`), one checker call per chunk, and merge the answers. The main session saves its JSON
          answer to `/tmp/<id>.labels.json`, then runs `bun run testmail:blind --batch <id> --apply /tmp/<id>.labels.json --checker claude-haiku-5-5`.
       5. For each `disagree` line: rewrite the case so that it is clear, or remove it, or keep it with a `note` that starts with `borderline:` and says why. Do not
          change `expected` to the checker's label without a reason in the note. Then `bun run testmail:validate --batch <id>` → `valid`.
       6. `bunx prettier --write evals/testmail/batches/<id>.json`; commit the batch file alone (`testmail: batch <id>`) and push. The batch is in git before its first send.
          Push with the task file rule "Shared working tree" (check `git log --oneline origin/master..HEAD` first) and
          `GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes" git push` (the default SSH key fails on this PC).
       7. `TEST_MAILBOX_ADDRESS=artekstryszowski@interia.pl bun run testmail:send --batch <id> --dry-run`, then the same without `--dry-run` and with
          `--limit 10 --interval-sec 45` (about 7 minutes; give the shell call a timeout of 900 s). Repeat until exit 0. Exit 2 → run the same command again (later when
          the cap is reached); exit 1 → read the failed/remaining lines and fix (a new case id for a changed or failed case).
       8. `GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github -o IdentitiesOnly=yes" bun run testmail:remote deliver --batch <id>` about 1 minute after the send (every
          `testmail:remote` call needs this prefix on this PC: it runs `git fetch`; with `--print-input` it does not). Exit 2 (`not found`) → wait 2 minutes, run again (at most 5 times; then check
          the Interia folders with the VPS inspect steps in the notes file).
       9. Wait for the sync and the triage (a few minutes), then `bun run testmail:remote compare --batch <id> --out evals/results/<YYYY-MM-DD>-testmail-<id>.md`.
          Exit 2 → wait 5 minutes and run again (at most 1 hour). The report file has no mail text; commit it with the batch results line in the task or notes.
    6. **Writer prompt** (full text, to paste): the persona file path, the mix, the schema fields (link `packages/core/src/testmail/batch.ts`), the rules of section 3,
       "write mail that a real manager in a Polish company gets", "the app sees one shared sender address and no display name, so show who writes in the body
       or the signature (a name, a role, a company; automated mail reads like a system message)", "vary length (2 lines to 25 lines), tone and structure", "a thread child answers its parent's content",
       "set `expected` to the category the mail deserves, not the one a model may guess", "never copy text from `evals/cases/`", output = the JSON file only.
    7. **Checker prompt** (full text): "You label e-mails for a manager's assistant. Categories: …(the five, with one line each from the classifier prompt)… For each
       case, give the single best category. Do not guess what the writer meant; read only the mail and its thread. Output only JSON: `[{"id": "...", "category": "..."}]`."
    8. **Commands and exit codes**: a table of the commands (`testmail:setup|validate|blind|send|status|target`, `testmail:remote deliver [--check-only]`,
       `testmail:remote compare`) with their exit codes (D12).
    9. **Files**: the table of D6 plus `evals/testmail/target.json`. Say that the send logs and the lock live in `~/.local/state/ea-testmail/`, outside every
       checkout, so a worktree removal never deletes them, and that nobody moves or deletes them.
    10. **Troubleshooting**: `send log damaged` (a bad line in the middle: stop and ask the user; never move, edit or delete a send log, because a lost log can
        resend every mail after 24 h); `duplicate_found` (two mails with one case label: report, no resend); `another testmail send runs` (check the pid with `ps -p <pid>`;
        when it is not a testmail run, ask the user); `inbox not found` (run setup); deliver keeps `not found` (run `bun run testmail:remote deliver --batch <id> --check-only`
        and read where the copies are; Interia may use a folder the tool does not check: tell the user); compare keeps `not synced` (on the VPS, read-only:
        `docker compose -f deploy/compose.yaml --env-file .env logs --since 30m server | grep '\[mail\] sync'`).
  - Content of `tasks/planned/testmail-mail-kind.md`: status line `planned`; goal: mail from the testmail sender counts as test mail for `mailKindFilter`
    (eval `--real`, scope gates), so the user's feedback on it does not mix with real labels; options (a configured sender list `TEST_SENDER_ADDRESSES`, or a header
    check — headers are not stored now); risks (the S3 `ACTIONS_SCOPE=synthetic` claim filter changes); link D14. Note in it: a sender filter also removes
    feedback that the user gave on test mail before the change (it is retroactive), so it must land before the next `eval --real` go/no-go decision
    (S3 `mailbox:settings auto`).
  - Test: none (docs). The 8.1 test covers the data files.
  - Check: `bunx prettier --check evals/testmail/README.md evals/README.md tasks/planned/testmail-mail-kind.md notes/2026-11-07-agentmail-test-mail.md docs/code-patterns.md`
  - Done when: a reviewer can follow the procedure from the README alone (the review checks each command name against `package.json` and each flag against the CLI usage texts).
  - Out of scope: running the procedure (stage 9).

- [x] **8.3 pi agent files for the writer and the checker (main session, outside the repo)**
  - Goal: two pi subagents with fixed models and tools, so every batch uses the same writer and a checker that cannot see `expected`.
  - Files: create `~/.pi/agent/agents/testmail-writer.md` and `~/.pi/agent/agents/testmail-checker.md` (global pi agents, not in git; the main session writes them
    because the implementer works in the repo). Format as `~/.pi/agent/agents/reviewer.md` (front matter `name`, `description`, `tools`, `model`, `thinking`, then the prompt).
  - Content:
    - `testmail-writer`: `tools: read, grep, find, ls, write` (no `bash`: it cannot run `testmail:send`); `model: claude-bridge/claude-sonnet-5-5`; `thinking: medium`;
      description "Writes one testmail batch file (made-up mails for the AgentMail test tool) from the persona file and a mix. Use only from the
      evals/testmail/README.md procedure."; prompt: "Read evals/testmail/README.md sections 3, 4 and 6 and follow them. Write only the batch file named in the task.
      Do not read `evals/cases/`."
    - `testmail-checker`: `tools: ls` (an empty `tools:` value gives the pi default tools, which can read files: `~/.pi/agent/extensions/subagent/index.ts`
      passes `--tools` only for a non-empty list); `model: claude-bridge/claude-haiku-5-5`; `thinking: low`; prompt = the checker prompt of the README (section 7)
      in full, plus "Do not use any tool. Answer only from the task text."
  - Test: one dry call each in the main session: the checker with a 2-case blind JSON returns valid `blindLabelsSchema` JSON; the writer is tested in stage 9.
  - Check: `ls ~/.pi/agent/agents/testmail-*.md`
  - Done when: both files exist and the checker dry call returns parseable labels.
  - Out of scope: changes to the other agent files.
