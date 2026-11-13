# Build

> Coordinator-maintained narrative board. TRACK, NEXT, PARKED and DROPPED are coordinator prose: keep them true in the change that moves feature state. NOW and PROVEN are generated from the feature lanes by `limen land`, `limen ticket done` and `limen board --write`; edit the tickets, not those lines.

TRACK at most three bullets. NEXT one clause per ticket. PROVEN names the last ten landed features, then one count line per month.

Status marks are prose only: 🟠 ACTIVE · 🔴 PLANNED · 🟢 PROVEN · ⚪ DROPPED. Nothing in `limen` treats them as workflow state.

## TRACK

- Standing models: worker and reviewer `--engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high`, with the personal Claude route (`~/.pi/agent/AGENTS.md` § Limen). Prepare: `--prepare 'bash scripts/limen-prepare.sh'` (own `.env`, `node_modules`, own DB; drop the job DB by hand after the job).
- Now: S6 pre-sale moves to Limen segment by segment (S6a = F077). The S6 master plan and `s6b`–`s6f` still sit in `tasks/` until `plan-task` plans them here; the old `run-task` flow is removed.
- CI on `master`: green since 2026-11-13 (run 43449221495); ci 4m56s (unit 30 s, int 191 s), e2e 3m0s. Bun pin `.bun-version` 1.3.14. After each land, check `gh run list --branch master --workflow CI --limit 3`; a red run → `docs/code-patterns.md` § Tests (quarantine the same day).

## NOW

<!-- Generated from spec/features/active/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F082-s6b-public-login` (🟠 ACTIVE): The panel login has the production shape: invite only, lockout, leaked-password check, terms, session list
- `F071-limen-transition` (🟠 ACTIVE): Move the agent workflow to Limen
- `F069-compose-network-subnet` (🟠 ACTIVE): Pin the Compose network subnet

## NEXT

- `F086-module-borders` (🔴 ACTIVE, stages 1-4 landed): module borders linted, two violations fixed, the standards in the styleguide; after F093.
- `F087-feature-flags` (🔴 PLANNED, plan landed): `isFeatureOn`, `org_features`, the operator check; after F086.
- `F088-notices-as-facts` (🔴 PLANNED, plan landed): the outbox stores the view, a renderer and a detector registry; after F086.
- `F089-structured-logs` (🔴 PLANNED, plan landed): event logs with run ids and a warn lint; after F086.
- `F090-llm-roles` (🔴 PLANNED, plan landed): `generate({ role })`, a role table, a prompt registry; after F086.
- `F091-repo-split` (🔴 PLANNED, needs plan): the two big repositories split, table-driven apply; after F088 and F090.
- `F092-rls-safety-net` (🔴 PLANNED, needs plan): RLS under the tenant filter; waits for the owner's yes, after F087.

- Stage 2 order: `docs/product/stage-2/05-execution-plan.md` §2. Plan its §2.1 rows in order with `plan-task`; each planned ticket gets a `## Sequenced` section (tickets that must land first, and its gate) and a line here. Start the first line here whose `Sequenced` tickets are all landed and whose gate is done; at most five Stage 2 tickets in build, and two builds never touch the same files and only one adds a migration (the plan gates name the overlaps); a ticket with a second-pass gate stops at that stage and asks the owner (§2.4).
- Planning: a NEXT line that says `needs plan` gets a `--role planner` job (at most three at once); when the plan lands, drop `needs plan` and the ticket builds stage by stage. A ticket without `needs plan` builds directly from `ticket.md` (and an old one-job `plan.md`). Command, review, questions, auto-build: `notes/2026-11-13-limen-planner-role.md`.
- E1 Close the MVP (§2.1 row 1): not planned yet; plan it first (handoff `~/.pi/agent/notes/2026-11-12-handoff-stage2-e01-close-the-mvp.md`). Every other Stage 2 ticket is sequenced after it.

## PROVEN

<!-- Generated from spec/features/done/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F093-ci-green` (🟢 PROVEN): CI on master is green and a flaky test is quarantined the same day; landed 2026-11-13
- `F084-the-mail-host-guard-also-refuses-multicast-broadcast-reserved-nat64-site-local-and-6to4-addresses-and-its-default-policy-is-frozen` (🟢 PROVEN): The mail host guard also refuses multicast, broadcast, reserved, NAT64, site-local and 6to4 addresses, and its default policy is frozen; landed 2026-11-13
- `F079-approvals-at-resume` (🟢 PROVEN): After a pause, an approval request from before the pause cannot go out unseen or late; landed 2026-11-13
- `F077-s6a-customer-core` (🟢 PROVEN): S6a Customer core: a second organization runs next to the pilot; landed 2026-11-13
- `F083-retention-and-review-minors-of-the-s6a-group-review-are-fixed-stuck-rows-delegation-task-text-backfilled-mail-body` (🟢 PROVEN): Retention and review minors of the S6a group review are fixed: stuck rows, delegation task text, backfilled mail body; landed 2026-11-12
- `F080-backfill-suspended-gate` (🟢 PROVEN): The `mailbox:backfill` CLI refuses a suspended organization; landed 2026-11-12
- `F070-editor-rules-cleanup` (🟢 PROVEN): Editor rule files still name Supabase; landed 2026-11-12
- `F059-web-hashed-reset-tokens` (🟢 PROVEN): Store web reset tokens hashed; landed 2026-11-12
- `F058-sync-sort-folders` (🟢 PROVEN): Sync the Interia sort folders and the spam folder (Oferty, Społeczności, Rachunki, Wiadomości-śmieci); landed 2026-11-12
- `F054-s5e-web-deploy-docs` (🟢 PROVEN): S5e Web: deploy and docs; landed 2026-11-12
- 2026-11: 48 landed. spec/features/done/2026-11/
