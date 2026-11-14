# F095 stage 04 — Page `actions-and-undo.md`

Part of [`../plan.md`](../plan.md). Decisions D1, D2, D4–D7, D19. Read "Rules for every stage" and the method box of [`stage-03-cap-sync-triage.md`](stage-03-cap-sync-triage.md) ("How to write a page", items 1–8) first: this stage follows it.

One page: how a plan becomes a mailbox change, how Undo and "moved back" work, and the `actions` status flow. Two steps. Docs only.

## Step 1 — `docs/capabilities/actions-and-undo.md` ("Actions and Undo")

- **Goal:** an agent knows which component may change a mailbox, when an action runs, retries, expires or fails, and how the user reverses it.
- **Seams:** `apps/server/src/modules/actions/` (`index.ts`, `committer.ts`, `apply.ts`, `move.ts`, `expire.ts`, `undo.ts`, `scope.ts`, `transitions.ts`, `hooks.ts`, `repo.ts`), `apps/server/src/modules/triage/returned.ts` and `triage/undo.ts`, `apps/server/src/modules/config/` (mailbox settings: mode, switches, `auto` per category; `routes.ts`, `service.ts`), the policy in `packages/core`, `apps/server/src/scripts/mailbox-settings.ts`, `mailbox-probe-move.ts`; `docs/architecture.md` §4.1 rules 3–5 and §4.3 (stay; link them).
- **Must cover:** plan → policy → committer (link rules 3–5), the modes and the policy table (link §4.3), `ACTIONS_SCOPE`, the committer job and its schedule, the ensure rule for idempotent actions, retries and expiry (24 h, 7 days), the Undo tap (Telegram `fu:` and the web panel, if the code has it), user-moved-back detection and the `triage.returned` job, `bun run mailbox:settings` (its sub-commands from `mailbox-settings-args.ts`), the `action_failed` notice (one line; link `digest-and-notices.md`).
- **Moves from `architecture.md`:**
  - §4.1 rule 6: the bullet "Idempotent actions (move, flag, mark read, save summary) …" with its sub-lines → "Rules". Rule 6 keeps its first three lines (headline, unique key, idempotency key and `X-EA-Action-Id`); the bullets on `create_draft`, `send`, SMTP stage, "Send again", "It went out", the send-outcome table and the soft cap stay for stage 05.
  - §4.1 rule 7: the paragraph "The committer (…) applies the rule to the action row as follows:" with its bullets (Soft error … the order per mail) → "Rules"; one link line.
  - §4.4: the bullets "Moved back by the user" and "Undo (S3)" → "Rules".
  - §4.6: the `actions.status:` block (with its code-map line `transitions.ts`) → "Data" (fenced block). The `delegations.status:` block stays for stage 05.
  - §8: the bullet "S3 jobs" (committer, `triage.returned`, the failed-action detection) → "Rules".
- **Limits (at least):** no web list of actions with approve and reject (E4-A F102); the runtime transition guard (F068, by folder name); `emails.status = 'done'` is in the CHECK but never written (`06-architecture-review.md` §3.15; check the code first).
- **Decisions:** ADR 0003, 0008, 0014; PD-029 (E4 split) only if you name E4 in Limits.
- **Tests:** `apps/server/test/integration/actions-committer.test.ts`, `actions-apply.test.ts`, `actions-move.test.ts`, `actions-undo.test.ts`, `actions-transitions.test.ts`, `actions-expiry.test.ts`, `actions-end-to-end.test.ts`, `apps/server/src/modules/actions/transitions.test.ts`, `scope.test.ts`.
- **Done when:** the page exists; method items 1–8 hold.

## Step 2 — Check `architecture.md`

- **Check:** `grep -n "Moved to \[\`docs/capabilities/actions-and-undo.md" docs/architecture.md` → 5 lines (rule 6 idempotent, rule 7 committer, §4.4, §4.6 actions, §8 S3 jobs). Rule 6 still holds its headline and the `create_draft` and `send` bullets. `git diff` shows no change in rules 1–5, §4.2, §4.3.
- **Done when:** the check holds and `bun test apps/server/src/capability-map.test.ts` → 0 fail.

## Review focus

Ten claims against the code (committer order per mail, expiry windows, Undo window, `ACTIONS_SCOPE` values, job schedules). The `actions.status` block in the page is the newest one from `architecture.md` (F091 may change `actions/` files; the block names `transitions.ts`).

## Done when

- Steps 1–2 hold.
- The Proof command of `plan.md` (`/tmp/f095-s04`, files: `docs/capabilities/actions-and-undo.md docs/capabilities/README.md docs/architecture.md` plus each other `.md` file whose references you changed) prints `PROOF_OK`.
