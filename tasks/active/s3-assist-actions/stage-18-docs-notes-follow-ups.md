# s3-assist-actions — Stage 18

Part of [`../s3-assist-actions.md`](../s3-assist-actions.md). Read that file's "Input" and "Rules for every step" first.

## Stage 18 — Docs, notes, known alerts, follow-ups

Prettier rule for this stage: `bunx prettier --check` must pass on every new Markdown file. `docs/architecture.md`, `docs/modules.md` and `docs/roadmap.md` may already fail `--check` at HEAD (S1b stage 35 log): for them, the edits must not add new problems (compare the `bunx prettier --check` output before and after).

- [ ] **18.1 Architecture, modules, code patterns, roadmap, ADRs, runbook**
  - Goal: `docs/` describe S3 as built (one source per fact, `tasks/README.md`).
  - Files: change `docs/architecture.md`, `docs/modules.md`, `docs/code-patterns.md`, `docs/roadmap.md`, `docs/decisions/0003-plan-policy-commit.md`, `docs/decisions/0010-imap-first.md`, `deploy/README.md`.
  - Interfaces: none (docs).
  - Decisions (what goes where; take the facts from the code and the stage files, not from memory):
    - `architecture.md` §4.1 rule 6: idempotent actions go `ready → applied` with the ensure rule (D5); rule 7: the action error rules as built (soft 5 min no count, hard 3 tries, `mail_not_found` at once without a notice, stale claim 10 min, D21 expiry 24 h). §4.3: `ACTIONS_SCOPE` as a second gate next to the mode. §4.4: Undo as built (per mail, 7 days, reverse rows, the toasts; feedback `undo` by the caller; `user_moved_back`; no feedback for `unsure`). §4.6 status flows: `ready → expired (stale)`, `applied → undone (undo | user_moved_back)`. §5: `actions.applied_at`, `emails.inbox_uid`, `emails.moved_at`, the new indexes, `outbox.kind` `action_failed`. §6.1: replace "the system finds the mail again by `Message-ID` (`SEARCH HEADER Message-ID`)" with the identity locate (D3) and the below-cursor check (D4); the folder creation rule (D9); the Interia move facts from stage 1 (one line each, link to the note). §8: the jobs `actions.committer` and `triage.returned` (every 15 s). §7 logs: folder keys only.
    - `modules.md`: §2 graph text (`actions → mail` for `locateMessage`, `openMailboxProvider`, `updateEmailLocation`; `triage → actions` for the returned job; `channels → actions` for Undo); §3.2 mail: the port methods, `locate.ts`, `open.ts`, `listRecentlyMoved`, `updateEmailLocation`, `setFolderMapEntry`, `listReturned`, `clearReturned`, the removed `findByMessageId`, `mailbox:probe-move`; §3.3 config: `service.ts` and the CLI `mailbox:settings`; §3.4 triage: `returned.ts`; §3.5 actions: "Built in S3" with the real file names (`repo.ts`, `apply.ts`, `move.ts`, `committer.ts`, `undo.ts`) and what each does; §3.6 audit: the new events; §3.8 channels: the Undo tap, `action_failed`; §4: the new CLIs.
    - `code-patterns.md`: "Only the committer changes a mailbox (and the test tools that refuse every address except `TEST_MAILBOX_ADDRESS`)"; the entry-point list gets nothing new (the committer uses `listSyncTargets`); "a mail is located by identity (`locateMessage`), never by `SEARCH HEADER`"; "folder keys in logs and audit, never paths from mail data".
    - `roadmap.md`: an "S3 state (date)" line (built; the dev run result; the VPS state; the one-week result when stage 20 is done), the S3 scripts in §4 (`mailbox:settings`, `mailbox:probe-move`), the S3 row size `L`.
    - ADR 0003: stays `accepted`; one "Implementation (S3)" line under Consequences (the ensure rule, the scope gate, Undo as reverse actions). ADR 0010: one line with the Interia move facts (link to the note) and the identity locate.
    - `deploy/README.md`: an "Assist mode" section (`mailbox:settings` commands, the go/no-go gate, `ACTIONS_SCOPE` in the VPS `.env`, what the `action_failed` notice means and what to do, the D18 meaning of `mailbox:audit` after S3); the 48-hour test section gets one line: "after S3, a user move out of INBOX shows as a duplicate; a system move does not".
  - Test: none (docs).
  - Check: the prettier rule above; `bun run lint` (unchanged code).
  - Done when: the files say what the code does, and the prettier rule holds.
  - Out of scope: changing decisions (only describe what was built).

- [ ] **18.2 Note with the S3 facts, known alerts**
  - Goal: a later agent finds the verified Interia move facts, the dev-run results and the meaning of each new log line.
  - Files: create `notes/<build date>-assist-actions-facts.md`; change `docs/known-alerts.md`, `notes/2026-11-03-interia-imap-capabilities.md` (stage 1 appended the probe section; add the stage 19 facts: the real paths of the `AI/*` folders, the UID behaviour seen by the committer).
  - Decisions:
    - The note: the "Facts checked" and "Not verified" lists of the task file with their outcomes (stage 1, 16, 19), each with its source and date; the Telegram keyboard result (45 buttons); the GreenMail delimiter and `AI/*` paths.
    - `known-alerts.md`, one entry per new log line (template of the file, newest first): `committer <mailboxId>: expired <n> stale actions`; `committer <mailboxId>: ACTIONS_SCOPE=off, <n> mailbox actions wait in mailbox <id>`; `action <id>: failed mail_not_found`; `action <id>: failed hard_error`; `action <id>: failed bad_payload`; `action <id>: <Class code>, try <n> of 3`; `committer <mailboxId>: login failed, status is now auth_error`; `committer <mailboxId>: <Class code>; the next tick tries again`; `sync <mailboxId> returned below cursor: checked <n>, returned <m>`; `returned <mailboxId>: processed <n>`; `notice action_failed queued: outbox <id>`; `mailbox:settings refused: <category> did not pass go/no-go`. Each with the cause and what to do.
  - Test: none (docs).
  - Check: `bunx prettier --check notes/<build date>-assist-actions-facts.md docs/known-alerts.md notes/2026-11-03-interia-imap-capabilities.md`.
  - Done when: the check passes.
  - Out of scope: alerts that did not happen in S3.

- [ ] **18.3 Follow-ups in `tasks/planned/`**
  - Goal: ideas that S3 found but did not build are not lost.
  - Files: create `tasks/planned/handled-share-metric.md`, `tasks/planned/actions-scope-removal.md`, `tasks/planned/own-mail-header-check.md` (template of `tasks/README.md`, status `planned`).
  - Decisions:
    - `handled-share-metric.md`: the weekly "handled share" line of architecture §4.4 (handled = `spam`, `notification`, `info` with an applied plan not undone or corrected within 7 days) is not in the digest yet; S3 stores `applied_at`, `undone` and the feedback rows it needs. Needs: S3.
    - `actions-scope-removal.md`: before the first external customer (S5/S6) the `all` scope must stop depending on `TEST_MAILBOX_ADDRESS`; per-mailbox consent replaces it. Needs: S5.
    - `own-mail-header-check.md`: `main.ts` stubs `isOwnActionId` to `false`; S4 creates drafts and sent mail with `X-EA-Action-Id` and must wire `actions.isOwnActionId` into the sync job. Needs: S4 (put it in the S4 plan input).
  - Test: none.
  - Check: `bunx prettier --check tasks/planned/handled-share-metric.md tasks/planned/actions-scope-removal.md tasks/planned/own-mail-header-check.md`.
  - Done when: the files exist and pass the check.
  - Out of scope: building them.
