# Build

> Coordinator-maintained narrative board. TRACK, NEXT, PARKED and DROPPED are coordinator prose: keep them true in the change that moves feature state. NOW and PROVEN are generated from the feature lanes by `limen land`, `limen ticket done` and `limen board --write`; edit the tickets, not those lines.

TRACK at most three bullets. NEXT one clause per ticket. PROVEN names the last ten landed features, then one count line per month.

Status marks are prose only: 🟠 ACTIVE · 🔴 PLANNED · 🟢 PROVEN · ⚪ DROPPED. Nothing in `limen` treats them as workflow state.

## TRACK

- Standing models: worker and reviewer `--engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high`, with the personal Claude route (`~/.pi/agent/AGENTS.md` § Limen). Prepare: `--prepare 'bash scripts/limen-prepare.sh'` (own `.env`, `node_modules`, own DB; drop the job DB by hand after the job).
- Now: S6 pre-sale moves to Limen segment by segment (S6a = F077). The S6 master plan and `s6b`–`s6f` still sit in `tasks/` until `plan-task` plans them here; the old `run-task` flow is removed.

## NOW

<!-- Generated from spec/features/active/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F082-s6b-public-login` (🟠 ACTIVE): The panel login has the production shape: invite only, lockout, leaked-password check, terms, session list
- `F077-s6a-customer-core` (🟠 ACTIVE): S6a Customer core: a second organization runs next to the pilot
- `F071-limen-transition` (🟠 ACTIVE): Move the agent workflow to Limen
- `F069-compose-network-subnet` (🟠 ACTIVE): Pin the Compose network subnet

## NEXT

- `F082-s6b-public-login` (🔴 PLANNED): S6b login hardening, 15 stages; build after F077 stage 18 (the S6a VPS deploy).

## PROVEN

<!-- Generated from spec/features/done/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F079-approvals-at-resume` (🟢 PROVEN): After a pause, an approval request from before the pause cannot go out unseen or late; landed 2026-11-13
- `F083-retention-and-review-minors-of-the-s6a-group-review-are-fixed-stuck-rows-delegation-task-text-backfilled-mail-body` (🟢 PROVEN): Retention and review minors of the S6a group review are fixed: stuck rows, delegation task text, backfilled mail body; landed 2026-11-12
- `F080-backfill-suspended-gate` (🟢 PROVEN): The `mailbox:backfill` CLI refuses a suspended organization; landed 2026-11-12
- `F070-editor-rules-cleanup` (🟢 PROVEN): Editor rule files still name Supabase; landed 2026-11-12
- `F059-web-hashed-reset-tokens` (🟢 PROVEN): Store web reset tokens hashed; landed 2026-11-12
- `F058-sync-sort-folders` (🟢 PROVEN): Sync the Interia sort folders and the spam folder (Oferty, Społeczności, Rachunki, Wiadomości-śmieci); landed 2026-11-12
- `F054-s5e-web-deploy-docs` (🟢 PROVEN): S5e Web: deploy and docs; landed 2026-11-12
- `F049-mail-smtp-starttls-587` (🟢 PROVEN): SMTP on port 587 with STARTTLS; landed 2026-11-12
- `F045-approval-quote-address` (🟢 PROVEN): Keep the sender address in the approval quote header; landed 2026-11-12
- `F044-send-retry-cap` (🟢 PROVEN): A shorter cap for send retries; landed 2026-11-12
- 2026-11: 43 landed. spec/features/done/2026-11/
