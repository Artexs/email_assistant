# F095 stage 10 — F047 part A: one real delegation round trip (U1), and the E1 close checks [risky]

Part of [`../plan.md`](../plan.md). Decisions D18, D21, D22. Read "Rules for every stage" first.

[risky]: a real mail goes from the owner's address (to the owner's own Gmail, the only delegate). Two parts: a **runbook** that the coordinator runs with the owner (U1), and a **worker job** that records the facts, refreshes stale capability pages (D23) and checks the E1 exit.

## Runbook (coordinator with the owner; not a worker job)

Pre-approved VPS steps (`spec/build.md` NEXT, owner decision 2026-11-13). The owner does the mail and the taps; the coordinator does the VPS reads and the two writes of A2.7. Source of the steps: `spec/features/planned/F047-s4-pilot-week/plan.md` A1–A3 and `spec/features/done/2026-11/F006-s4-drafts-approvals-delegation/stages/stage-22-vps-deploy-self-send.md` step 22.2 (steps 1–10). Shell and ids: stage 09 "Shell" and "Ids". Log form: stage 09 step 1.3.

1. **Time.** `TZ=Europe/Warsaw date` between 07:00 and 21:00 (quiet hours 22:00–07:00; the round trip needs about 45 minutes with the reminder).
2. **State.** SQL, ids and statuses only: the test delegate `3532bf8f-0e43-4da5-bc55-05a578261f5a` is active (`select id, <status or disabled column> from delegates where org_id = '<ORG>'`, column from `\d delegates`); `select count(*) from actions where org_id = '<ORG>' and type = 'send' and status in ('awaiting_approval', 'approved');` → 0, else the owner first rejects or lets those expire (never approve a send for a test mail: F047 § "Test mail in the week"). The owner checks `/status` on the phone: `SEND_SCOPE=all` and 0 approvals waiting.
3. **Task mail.** Write `t0` (UTC). The owner sends from the Gmail to the pilot address: subject `Oferta dla firmy X`, text `Proszę przygotować ofertę na usługę Y dla firmy X do piątku.`
4. **Within 7 minutes** (SQL, ids and codes only; find the mail by `received_at >= '<t0>'`, never by address or subject): the triage category (`delegation`; if `needs_reply`, the owner sends a clearer task mail and the coordinator notes it), the `create_draft` row `applied` with `provider_result->>'folder'`, the `send` row `awaiting_approval`, the delegation `drafted`. The owner looks in webmail `Wersje robocze`: the draft is there (yes or no, how Interia shows it).
5. **Approve.** The owner reads the approval message on the phone and taps `📤 Send`. Within a minute (SQL): the send `applied`, `provider_result->>'sent_copy'` (expect `appended`), the shape of the SMTP response line (`250 …` with ids replaced by `<id>`), the delegation `sent`, the reverse draft row `applied`. The owner checks: Gmail got the mail (the `From` display, the quote, not in spam), webmail `Wysłane` has the copy, `Wersje robocze` is empty.
6. **Reply.** The owner replies `Zrobione.` from Gmail in the thread. Within 7 minutes: the delegation `answered`; the phone shows `📩 … answered`; the owner taps `✅ Done` → `done`.
7. **Reminder.** A second task mail (item 3 again), approve and send it (item 5). Backup first (`spec/build.md` rule): `PATH=$HOME/bin:$PATH deploy/backup.sh` → `backup ok …`; the rollback target is that backup (the writes touch only the second test delegation row). Then the two pre-approved writes: `update delegations set due_at = now() - interval '1 day' where id = '<the second delegation id>';` and `$C exec -T server bun run job:run --name delegation.chaser --force`. The delegation becomes `overdue`; the phone shows `📤 Send 1 reminder?`; the owner taps `📤 Send all`; the reminder arrives in Gmail as `Re: Fwd: …` in the same thread; `reminders_sent` = 1.
8. **Reject.** A third task mail → the approval → the owner taps `✖️ Reject` → the draft is gone from `Wersje robocze`, the delegation `cancelled`, the result notice arrives.
9. **Logs.** Last 60 minutes, by log form: count of error lines (expect 0) and count of lines that hold `@` (expect 0); print counts only.
10. **Owner answers** (D18): the owner's count of wrong drafts in the pilot week (`<START47>` + 7 days) and of injection incidents (a draft with a recipient or text they did not expect; expected 0); keep `SEND_SCOPE=all` and the one test delegate (default Q5) or a change.
11. **Record the raw facts** in `/tmp/f095-u1/u1-facts.md` on this machine (outside every repo, never committed: the post-commit hook would push it before a review; review 1 M8): date, `t0`, the VPS commit, items 4–10 as short lines (statuses, codes, counts, yes or no; no address, no subject, no mail text, no message id). Then spawn the stage 10 worker; its task text names this file.

If a step fails (no draft, no approval message, a send error): stop the runbook, record what happened in `/tmp/f095-u1/u1-facts.md`, and give it to the worker anyway. The worker records a failed round trip as the part A result; the coordinator asks the owner whether to retry (a new U1).

## Step 1 — Record part A (worker)

- **Goal:** F047 holds the part A facts and the owner answers, and the docs hold the S4 result.
- **Files:** `spec/features/planned/F047-s4-pilot-week/plan.md`, `notes/2026-11-03-interia-imap-capabilities.md`, `docs/roadmap.md`, `spec/features/done/2026-11/F006-s4-drafts-approvals-delegation/plan.md` (one Log line).
- **Input:** `/tmp/f095-u1/u1-facts.md` (written by the coordinator; read it, do not copy the file into the repo).
- **Edits:**
  1. F047 `plan.md` § Results: a part A section from `u1-facts.md` (items 4–9), and in the part B section replace "owner count: asked at stage 10" and "injection incidents: asked at stage 10" with the owner's answers (item 10). Tick A1–A3; B3 owner parts; B4 with the owner's choice. Done-when items: tick each with its evidence.
  2. The Interia note: append a dated section with the facts that F047 A3 names: the 250 line shape, `sent_copy`, how Interia webmail shows the draft, the `From` display in Gmail, Gmail spam (yes or no). No address, no id.
  3. `docs/roadmap.md`, the `S4 state` line: replace `part A pending.` with ` Part A (YYYY-MM-DD): one real delegation round trip <passed | failed at <item>>: draft, approval, send with the Sent copy, reply → answered → done, reminder, reject.`
  4. F006 `plan.md` § Log: `- YYYY-MM-DD: first real delegation round trip (F047 part A via F095 stage 10): <passed | failed>.`
- **Check:** `grep -n "Part A" docs/roadmap.md`; the part A section exists in F047; `grep -nE "@[a-z0-9.-]+\.[a-z]{2,}" spec/features/planned/F047-s4-pilot-week/plan.md notes/2026-11-03-interia-imap-capabilities.md | grep -v "ea-testmail-75wd@agentmail.to"` → no new line from this stage (compare with `git diff`).
- **Done when:** the check holds.
- **Out of scope:** moving F037 or F047 to `done/` (the coordinator runs `limen ticket done`).

## Step 2 — E1 close checks (worker)

- **Goal:** the final message proves the E1 "Done when" of `plan.md` items 1–8, except the coordinator's parts.
- **Commands (paste each output):**
  1. `ls docs/capabilities/` and `bun test apps/server/src/capability-map.test.ts`.
  2. `grep -c "Moved to \[docs/capabilities/" docs/architecture.md`; `awk '/^## 8\./,/^## 9\./' docs/architecture.md | grep -c "^- \*\*"`.
  3. Stage 01 step 3 checks 1, 3 and 4.
  4. `grep -n "docs/capabilities" docs/code-patterns.md .agents/limen/styleguide.md`.
  5. `git show HEAD:spec/build.md | sed -n '/^## NEXT/,/^## PROVEN/p' | head -5` (the coordinator applied `next.md`), and stage 08 step 1 check 1 run against the NEXT section only: `mkdir -p /tmp/f095-s10 && sed -n '/^## NEXT/,/^## PROVEN/p' spec/build.md > /tmp/f095-s10/next-section.md`, then the loop with that file in place of `next.md` (NOW lists the active tickets again; review 1 M6).
  6. `grep -n "## Results" -A3 spec/features/planned/F037-s3-assist-week-result/plan.md spec/features/planned/F047-s4-pilot-week/plan.md | head -20`; `grep -n "Week result\|Pilot week\|Part A" docs/roadmap.md`.
  7. `grep -n "Day check" notes/2026-11-12-s6a-deploy-log.md`.
  8. `grep -c "This file is history" tasks/active/*.md tasks/planned/*.md`; stage 08 step 3 check.
- **Done when:** each item has its output; an item that fails is named in the final message (the coordinator fixes it or reopens the stage that owns it).

## Step 3 — Refresh stale capability pages (worker, D23)

- **Goal:** no page describes code that changed after its "Checked against" sha.
- **Method:** for each page, `sha=$(sed -nE 's/^> Checked against the code at `([0-9a-f]+)`.*/\1/p' docs/capabilities/<page>.md)`, then `git log --oneline "$sha"..HEAD -- <every path of its "Entry points" and "Tests" tables>`. A page with commits: read those diffs, change the page where the behaviour changed (the method of stage 03), and set its "Checked against" line to your base sha and today's date. A page without commits stays as it is.
- **Check:** `bun test apps/server/src/capability-map.test.ts` → 0 fail; the final message lists each page with "refreshed: <commits>" or "unchanged".
- **Done when:** every page is refreshed or unchanged.
- **Out of scope:** new pages; rewriting text that the diffs do not touch.

## Review focus

Privacy of the four changed files and of `/tmp/f095-u1/u1-facts.md`; the part A result matches `u1-facts.md`; the owner answers are copied, not invented; a failed round trip is recorded as failed.

## Done when

- The runbook ran (or its failure is recorded) and steps 1–3 hold.
- The Proof command of `plan.md` (`/tmp/f095-s10`, files: `spec/features/planned/F047-s4-pilot-week/plan.md notes/2026-11-03-interia-imap-capabilities.md docs/roadmap.md spec/features/done/2026-11/F006-s4-drafts-approvals-delegation/plan.md` plus each refreshed page) prints `PROOF_OK`.
