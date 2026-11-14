# F085 stage 07 — Docs, known alert, deploy and rollback note

Part of [`../plan.md`](../plan.md). Read its D1–D21, the "States and events" table and "Rules for every stage" first. Needs stages 01–06 landed. Docs only: no code, no migration. Two normal steps, about 150 changed lines.

Read each file at your start: other tickets edit the same pages. Change only the sentences named here and the ones that become false; keep the page's style (ASD-STE100 plain English, short sentences). Every repo path you write must exist: `apps/server/src/capability-map.test.ts` checks the paths, the `bun run` scripts, the headings and the "Checked against" line of each capability page.

- [ ] **7.1 Capability pages**
  - Goal: the pages say what the code does after stages 01–06.
  - Files and changes:
    - `docs/capabilities/sync.md`:
      - Rule 2 (host guard): add that a refused host at a sync run or at a committer open makes an `active` mailbox `host_blocked` (`markHostBlocked`, audit row `mailbox.host_blocked`), and that a DNS failure keeps the old path (a warning, the next tick).
      - Rule 4 (capability check): `mailbox:check` prints `status:`, `imap-host:`, `smtp-host:` first; a refused host gives exit 2 and no connection.
      - Rule 12 (statuses): add `host_blocked`: set by the sync job or the committer when the guard refuses a host; not synced, triaged or sent; a pause or resume answers `409 wrong_status` on the web and is skipped on Telegram.
      - Rule 13 (mailbox errors): a refused host → `host_blocked`, one Telegram notice to the linked owners per `status_changed_at`; the way out: the re-check at the start of each `mail.sync` run (`recheckBlockedHosts`: the guard on both hosts, no connection; both pass → `active`, audit row `mailbox.host_allowed`, the same run syncs it) and a successful password change (`updateMailboxPassword`).
      - Data: `mailboxes.status` lists four values; audit events gain `mailbox.host_blocked`, `mailbox.host_allowed`.
      - Entry points: functions `checkMailboxHosts`, `markHostBlocked` (`apps/server/src/modules/mail/host-status.ts`), `inspectMailbox` (`apps/server/src/modules/mail/check.ts`).
      - Limits: remove the `F085-…` line.
      - Tests: add `apps/server/test/integration/mail-host-status.test.ts`, `apps/server/test/integration/mail-host-blocked.test.ts`, `apps/server/src/modules/mail/host-status.test.ts`.
      - The "Checked against" line: the `master` commit you read.
    - `docs/capabilities/digest-and-notices.md`: rule 4 (the digest mailbox line also shows `server not allowed`); rule 5 (the detector order gains `host blocked` after `auth error`; a table row `host_blocked`: trigger "A mailbox has the status `host_blocked`", who "Linked owners", key `host_blocked:<mailbox id>:<status_changed_at ms>`, buttons none; the text names the mailbox address, never a host name or address); rule 6 (`host_blocked` goes to linked owners; a pending row becomes `failed` / `outdated` when the mailbox leaves the status); rule 9 (`/status` shows the state; `/pause` and `/resume` skip a `host_blocked` mailbox with a hint); Data (`outbox.kind`: thirteen kinds). The "Checked against" line.
    - `docs/capabilities/drafts-and-send.md`: the send outcome table gets the row "Host refused by the guard (at the committer open)" → `approved`; the mailbox becomes `host_blocked` → no change; the held causes (near line 55 and line 97) name "the mail server is not allowed" next to the login error. The "Checked against" line.
    - `docs/capabilities/actions-and-undo.md` (rule near line 23): a refused host at the committer open → the mailbox becomes `host_blocked`, the batch is released with no count. The "Checked against" line.
    - `docs/capabilities/web-panel.md`: the Mailboxes page shows the badge "Server not allowed" and an owner hint for a `host_blocked` mailbox (no pause, resume or password button); the operator organization list counts mailboxes with a login error and with a server not allowed. The "Checked against" line.
  - Decisions: all of plan.md § Input.
  - Test: `bun test apps/server/src/capability-map.test.ts`.
  - Check: `bunx prettier --check <the changed files>`.
  - Done when: the test passes; `grep -n "F085" docs/capabilities/*.md` prints nothing.
  - Out of scope: pages of other capabilities.

- [ ] **7.2 Architecture, modules, known alerts, deploy runbook, code patterns**
  - Goal: the operator knows what the status means, how it ends, and how to roll back.
  - Files and changes:
    - `docs/architecture.md`: the guard line of §7 (line 457, "A host the guard refuses is a `sync <id> failed: host not allowed` log line today."): replace that sentence with "A host the guard refuses at a sync run or a committer open makes the mailbox `host_blocked`; the owners get one notice; the sync re-checks the host at each run (`docs/capabilities/sync.md`)." Check that §5 rows `mailboxes` (status list) and `outbox` (kind, dedup key) name `host_blocked` (stage 02 wrote them).
    - `docs/modules.md`: the mail section (lines near 150–155): `changeMailboxStatus` is a conditional change between any two statuses (callers: pause and resume, `host_blocked` in and out); `updateMailboxPassword` makes `auth_error` and `host_blocked` `active`; `listMailboxTargets` serves the expiry (`active`, `paused`, `auth_error`, `host_blocked`) and the host re-check (`host_blocked`); add one line "Built in F085: `host-status.ts` (`checkMailboxHosts`, `recheckBlockedHosts`, `markHostBlocked`), `inspectMailbox`". Line 386 (`mailbox:password`): "leaves `auth_error` or `host_blocked`". Check that the `channels` table row `notices/` names `host-blocked.ts` (stage 02).
    - `docs/known-alerts.md`: the entry "`sync <id> failed: host not allowed` and `sync <id>: mail host lookup failed (<code>); the next tick tries again`" (near line 47): the heading becomes "`mailbox_host_blocked` (`reason=sync|committer`), `mailbox_host_check_failed`, `mailbox_host_block_failed`, `mailbox_host_recheck_failed` (before F085: `sync <id> failed: host not allowed`) and `sync <id>: mail host lookup failed (<code>); the next tick tries again`"; Source names `mail/host-status.ts`, `mail/jobs.ts` and `actions/committer.ts`; Cause unchanged for the guard; Fix: `mailbox_host_blocked` → run `bun run mailbox:check --org-id … --mailbox-id …` (it prints which side is refused and does not connect), check the provider's DNS from the server container; the mailbox returns by itself when the name resolves to a public address; `mailbox_host_block_failed` → the DB failed, the next run tries again; remove the sentence "Until F085 lands, …". Status: `fixed` for the silent failure, `investigating (per case)` for a real refusal.
    - `deploy/README.md`:
      - A new section `## Mail server not allowed (\`host_blocked\`)` right after `## Login error (\`auth_error\`)`: what the notice means (the server name of the mailbox points to a private or local address, so the system does not connect); step 1 `mailbox:check` (the command form of the `auth_error` section, without a password); step 2 check the DNS answer of the provider host from the server container; step 3 nothing to run: the sync re-checks at each run and the mailbox becomes `active` by itself; a password change also ends it. "Do not set `MAIL_ALLOW_LOCAL_HOSTS` on the VPS."
      - In the same section, "### Roll back": the two SQL lines of plan.md D17, in that order, with the sentence "Run them before a code rollback to a release older than F085 stage 02; roll back the code, not the migration."
      - Line 389 (`held_timeout`): the held causes name "the mail server is not allowed (`host_blocked`)" too. Line 483 (operator console organizations): "mailboxes (all, with a login error, with a server not allowed)".
    - `docs/code-patterns.md` § Data access, the "Mail host check (S6b)" bullet (line 128): add one sentence: "A refused host at a sync run or a committer open goes through `markHostBlocked` (`mail/host-status.ts`); no other code sets `host_blocked`."
  - Decisions: D3, D5, D16, D17.
  - Test: `bun test apps/server/src/capability-map.test.ts`.
  - Check: `bunx prettier --check <the changed files>`; `grep -rn "host not allowed\` log line today" docs` prints nothing.
  - Done when: the checks pass; the rollback SQL in `deploy/README.md` equals D17 word for word.
  - Out of scope: `spec/build.md`, `docs/product/stage-2/*`, `docs/owner-decisions.md` (the coordinator writes those).

## Done when

- Steps 7.1 and 7.2 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 07 (`/tmp/f085-s07`) prints `PROOF_OK`.
