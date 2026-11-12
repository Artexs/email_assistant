# s4-drafts-approvals-delegation — Stage 23

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 23 — `SEND_SCOPE=all`: the first real delegation and one week of use [risky]

Preconditions (user checkpoint 5): stage 22 is done and the user saw one full `self` round trip; the user names at least one real delegate who agreed to get mail from the system (name, address); the user says go. Shell and ids as in stage 22.

**Risk (name it to the user before the go):** from this stage on the system sends mail from the user's real address to real people, after the user's tap. `SEND_SCOPE=all` admits every send of the `TEST_MAILBOX_ADDRESS` mailbox: delegations and reminders to delegates, **and clarification questions to the original sender of a mail** (P6; task file question 9: the default keeps them in). Every send shows the recipient and the draft text first; nothing goes out without the tap; a reminder goes out only after "Send all". To stop at once: `SEND_SCOPE=off` in the VPS `.env` and a restart (approved sends wait and `/status` shows them), or `/pause` (no sync, no triage, no new drafts; a tap still approves, and the committer holds while paused: the S3 committer skips paused mailboxes).

- [ ] **23.1 Start: the real delegate, `SEND_SCOPE=all`**
  - Goal: the policy and the scope admit real sends for the pilot mailbox only.
  - Files: this task file ("Results", log line).
  - Steps: 0. **Held sends first (review round 2 N1):** SQL `select a.id, a.payload->>'kind' as kind, a.approved_at from actions a where a.org_id = '<ORG>' and a.type = 'send' and a.status = 'approved' order by a.approved_at;` → each row is a send that the user approved under `self` and that the scope held (it would go out at the first committer tick after the switch). For each row the user decides: reject it (the `✖️ Reject` button stays on the held approval message, D26) or keep it (the user names the id). Go on only when the query returns no row, or every row left is one the user named. A row whose `approved_at` is older than 48 h is never claimed (stage 10.1) and the next hourly expiry run closes it as `held_timeout` (D22).
    1. `$C run --rm -T server bun run delegates:add --org-id <ORG> --name "<name>" --email <address> --tags <tags>` → an id (the test delegate of stage 22 stays or is disabled: the user decides; a disabled delegate is out of the LLM list).
    2. The user changes the VPS `.env` line to `SEND_SCOPE=all` (`TEST_MAILBOX_ADDRESS` is set since S1a; `SEND_TEST_ADDRESSES` may stay). `$C up -d --wait` (no build). Log: `sends go to real delegates of the TEST_MAILBOX_ADDRESS mailbox (SEND_SCOPE=all)`. `/status` → `Send: real delegates of the test mailbox (SEND_SCOPE=all)`.
    3. Write `<START>` (UTC).
  - Check: the log line and `/status`.
  - Done when: the user confirms the start.

- [ ] **23.2 The first real delegation and the week**
  - Goal: a real task mail becomes a delegation that the real delegate gets after one tap; the week's counts are written down; the done-when items are ticked.
  - Files: this task file ("Results", done-when ticks, log), `docs/roadmap.md` (the S4 state line, by the main session at the close).
  - Steps:
    1. The first real delegation: when a real mail is triaged `delegation` with the real delegate (or the user forwards themselves such a mail), the approval message arrives; the user reads the recipient and the text, and taps `📤 Send` (or `✖️ Reject` when the draft is wrong: a rejected draft counts as a wrong draft). The delegate gets the mail; the user tells them that replies in the thread close the loop.
    2. Daily: `/status` (approvals waiting, held, delegations open and overdue), the digest lines, the notices; `$C logs --since 24h server | grep -cE "\[(actions|delegation)\].*error"` → 0 expected.
    3. After 7 × 24 h from `<START>`, SQL (real mail only: `(e.message_id_header is null or e.message_id_header not ilike '%@ea-seed.test>')` on every join to `emails e`):
       - **Sends by outcome:** `select a.status, a.status_reason, a.payload->>'kind' as kind, count(*) from actions a join emails e on e.id = a.email_id and e.org_id = a.org_id where a.org_id = '<ORG>' and a.type = 'send' and a.created_at >= '<START>' and (…real…) group by 1, 2, 3 order by 1, 2, 3;`
       - **Delegations by status:** `select status, status_reason, count(*), sum(reminders_sent) from delegations where org_id = '<ORG>' and created_at >= '<START>' group by 1, 2;`
       - **Approval time:** `select avg(approved_at - notified_at), max(approved_at - notified_at) from actions where org_id = '<ORG>' and type = 'send' and approved_at is not null and notified_at is not null and created_at >= '<START>';`
       - **Wrong drafts:** the `rejected` sends plus the user's own count of drafts they would have changed; **injection incidents:** the user's answer (any draft with a recipient or a text they did not expect) — expected 0.
       - **Notices:** `select kind, status, count(*) from outbox where org_id = '<ORG>' and created_at >= '<START>' and kind in ('approval', 'approval_set', 'send_result', 'delegation_answered') group by 1, 2;`
    4. Write the tables into "Results"; tick the done-when items with the evidence (the crash tests and the two-taps test are in the integration suite: name the test files; the real-mail items from this week); the cost: `triage:cost --days 7` unchanged in shape (no writer calls).
    5. Close: the done-checklist, status `done`, `git mv` to `tasks/done/` with the folder; the roadmap line.
  - Check: the tables exist in "Results"; every done-when line names its evidence.
  - Done when: the user confirms the week's result; the task is in `tasks/done/`.
  - Out of scope: more delegates (the user adds them with the CLI any time), S5.
