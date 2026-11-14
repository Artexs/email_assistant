# Build

> Coordinator-maintained narrative board. TRACK, NEXT, PARKED and DROPPED are coordinator prose: keep them true in the change that moves feature state. NOW and PROVEN are generated from the feature lanes by `limen land`, `limen ticket done` and `limen board --write`; edit the tickets, not those lines.

TRACK at most three bullets. NEXT one clause per ticket. PROVEN names the last ten landed features, then one count line per month.

Status marks are prose only: 🟠 ACTIVE · 🔴 PLANNED · 🟢 PROVEN · ⚪ DROPPED. Nothing in `limen` treats them as workflow state.

## TRACK

- Standing models: worker and reviewer `--engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high`, with the personal Claude route (`~/.pi/agent/AGENTS.md` § Limen). Prepare: `--prepare 'bash scripts/limen-prepare.sh'` (own `.env`, `node_modules`, own DB; drop the job DB by hand after the job). Log lint backlog (E8a): 395 old-form log calls warn after F089 stage 06 (2026-11-13); the converted files (`platform/`, `main.ts`) are at error.
- Now: S6 pre-sale moves to Limen segment by segment (S6a = F077). The S6 master plan and `s6b`–`s6f` still sit in `tasks/` until `plan-task` plans them here; the old `run-task` flow is removed.
- CI on `master`: green since 2026-11-13 (run 43449221495); ci 4m56s (unit 30 s, int 191 s), e2e 3m0s. Bun pin `.bun-version` 1.3.14. After each land, check `gh run list --branch master --workflow CI --limit 3`; a red run → `docs/code-patterns.md` § Tests (quarantine the same day).

## NOW

<!-- Generated from spec/features/active/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F094-the-server-image-ci-and-local-checks-run-one-current-bun-1-4-x` (🟠 ACTIVE): The server image, CI and local checks run one current Bun (1.4.x)
- `F071-limen-transition` (🟠 ACTIVE): Move the agent workflow to Limen
- `F069-compose-network-subnet` (🟠 ACTIVE): Pin the Compose network subnet

## NEXT

- `F091-repo-split` (🟠 ACTIVE, stages 01 and 02 build): the two big repositories split, table-driven apply; after F088 and F090.
- `F092-rls-safety-net` (🔴 PLANNED, needs plan): RLS under the tenant filter; waits for the owner's yes, after F087.
- `F094-the-server-image-ci-and-local-checks-run-one-current-bun-1-4-x` (🟠 ACTIVE, stage 1 landed and deployed; stage 2 next-day VPS check on 2026-11-15): one Bun 1.4.4 in CI, image and VPS; stage 1 builds, stage 2 is the owner VPS deploy (needs your go); the stage 1 job branch is pushed to GitHub for CI (Q1, owner confirms).

- Stage 2 order: `docs/product/stage-2/05-execution-plan.md` §2. Plan its §2.1 rows in order with `plan-task`; each planned ticket gets a `## Sequenced` section (tickets that must land first, and its gate) and a line here. Start the first line here whose `Sequenced` tickets are all landed and whose gate is done; no cap on parallel builds (owner decision 2026-11-13); only one migration in build at a time; file overlaps named in the plan gates are advisory: start the stages anyway, and when a land conflicts, resume the worker to merge `master` and re-prove; a ticket with a second-pass gate on numbers stops at that stage and asks the owner (§2.4). Owner checkpoints and owner steps (U1, U2, ...) are NOT a stop (owner decision 2026-11-13): after the review PASS of the stage before a checkpoint, build the next stages with the plan defaults. Owner decision 2026-11-13 (later): VPS, ssh and deploy steps are pre-approved; the coordinator does them (backup first, name the rollback target, verify after). Stop for the owner only when a step needs an API key or secret the coordinator cannot get itself.
- Planning: a NEXT line that says `needs plan` gets a `--role planner` job (at most three at once); when the plan lands, drop `needs plan` and the ticket builds stage by stage. A ticket without `needs plan` builds directly from `ticket.md` (and an old one-job `plan.md`). Command, review, questions, auto-build: `notes/2026-11-13-limen-planner-role.md`.
- `F095-e1-close-the-mvp` (🔴 PLANNED, needs plan): E1 Close the MVP (capability map, docs boundary, NEXT sweep of the old planned tickets); sequenced after — (F077 landed); gate Owner: F047 A phone test; vision text OK (owner-owned).
- `F096-e8-lr-log-rotation` (🔴 PLANNED, plan landed): Docker rotates every Compose service log (5 × 10 MB), a CI check keeps it; one stage, closed after the check at the next VPS deploy; sequenced after none; gate —.
- `F097-e2a-offline-lab` (🔴 PLANNED, needs plan): E2a Offline lab; sequenced after E1; gate Owner audit of 50 cases per corpus version.
- `F098-e7-t1-polish-ui-i18n-frame-first` (🔴 PLANNED, needs plan): E7-T1 Polish UI (i18n frame first); sequenced after F082; gate —.
- `F099-e7-t2-platform-controls-send-limits-feature-flags-operator-console-security-log` (🔴 PLANNED, needs plan): E7-T2 Platform controls (send limits, feature flags, operator console, security log); sequenced after F082; gate —.
- `F100-e3a-measure` (🔴 PLANNED, needs plan): E3a Measure; sequenced after E1; E7-T2 before its user-visible stages (flags); gate —.
- `F101-panel-to-astro-7` (🔴 PLANNED, needs plan): Panel to Astro 7; sequenced after E1; gate —.
- `F102-e4-a-act-from-the-panel` (🔴 PLANNED, needs plan): E4-A Act from the panel; sequenced after E1, E7-T1, Astro 7; gate —.
- `F103-e8a-logs` (🔴 PLANNED, needs plan): E8a Logs; sequenced after E1; gate —.
- `F104-e5a-read-sent` (🔴 PLANNED, needs plan): E5a Read Sent; sequenced after E1, E7-T2; gate —.
- `F105-e7-t6-identity-a-totp-backup-codes-break-glass` (🔴 PLANNED, needs plan): E7-T6 Identity A (TOTP, backup codes, break-glass); sequenced after F082; gate —.
- `F106-e7-t3-account-data-delete-export-dsr` (🔴 PLANNED, needs plan): E7-T3 Account data (delete, export, DSR); sequenced after F082, E7-T1; gate —.
- `F107-e7-t4-papers-and-cost` (🔴 PLANNED, needs plan): E7-T4 Papers and cost; sequenced after E7-T3; gate —.
- `F108-e7-t5-production-on-the-vps` (🔴 PLANNED, needs plan): E7-T5 Production on the VPS; sequenced after E7-T1 … T4; the E8b drill proves its restore; gate —.
- `F109-e3b-improve` (🔴 PLANNED, needs plan): E3b Improve; sequenced after E2a, E3a; gate Second pass after the first E2a holdout report (PD-060, PD-061).
- `F110-e4-b-earn-trust` (🔴 PLANNED, needs plan): E4-B Earn trust; sequenced after E4-A (command contract stage), E3a (flag store, header capture), E2a (urgency shape); the urgency-editor stage needs E3b's urgency command; gate —.
- `F111-e11b-private-model-option` (🔴 PLANNED, needs plan): E11b Private model option; sequenced after E2a; gate Owner: OpenAI Europe project request (PD-111); second pass on the answer (PD-110) before the EU stage.
- `F112-e10a-docs-site` (🔴 PLANNED, needs plan): E10a Docs site; sequenced after E1, Astro 7; gate —.
- `F113-e2b-live-lab` (🔴 PLANNED, needs plan): E2b Live lab; sequenced after E2a; gate Owner: grow the VPS root volume (PD-055).
- `F114-e8b-alerts-and-releases-incl-the-restore-drill` (🔴 PLANNED, needs plan): E8b Alerts and releases (incl. the restore drill); sequenced after E8a; gate Owner: grow the VPS root volume (PD-055).
- `F115-e6a-reply-drafts` (🔴 PLANNED, needs plan): E6a Reply drafts; sequenced after E2a, E3a, E4-A, E5a, E7-T2; gate Stage 1 is the prototype; second pass after it (PD-071, PD-072, PD-083) before the later stages.
- `F116-e5b-open-loops` (🔴 PLANNED, needs plan): E5b Open loops; sequenced after E2a, E3a, E4-A, E5a; gate Second pass after the first E3a weekly report and the E2b live week (PD-119, PD-120, PD-122).
- `F117-e9a-mailbox-oauth` (🔴 PLANNED, needs plan): E9a Mailbox OAuth; sequenced after F082, E7-T2; gate Owner: one Microsoft 365 Business Basic seat; stage 1 is the spike; second pass after it (PD-086, PD-087).
- `F118-e9b-phone-channel-pwa-push-telegram-detail` (🔴 PLANNED, needs plan): E9b Phone channel (PWA, push, Telegram detail); sequenced after E4-A, E4-B; gate —.
- `F119-e7-t7-identity-b-oidc` (🔴 PLANNED, needs plan): E7-T7 Identity B (OIDC); sequenced after E7-T2, E7-T6; gate Stage 1 is the spike; second pass after it (PD-040, PD-041).
- `F120-e11a-sender-context` (🔴 PLANNED, needs plan): E11a Sender context; sequenced after E3a, E5a, E4-B; gate —.
- `F121-e10b-public-pages-and-demo` (🔴 PLANNED, needs plan): E10b Public pages and demo; sequenced after E2b, E3a, E4-B, E7-T4, E8b; gate —.
- `F122-e6b-style-from-sent` (🔴 PLANNED, needs plan): E6b Style from Sent; sequenced after E6a, E5a; gate Gated: only if the E2a judge shows a gain.

## PROVEN

<!-- Generated from spec/features/done/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F088-notices-as-facts` (🟢 PROVEN): Notices are stored as facts and rendered per channel, detail and locale by a renderer registry; landed 2026-11-14
- `F082-s6b-public-login` (🟢 PROVEN): The panel login has the production shape: invite only, lockout, leaked-password check, terms, session list; landed 2026-11-14
- `F078-auth-verifications-cleanup` (🟢 PROVEN): Expired Better Auth `auth_verifications` rows are deleted by the retention job; landed 2026-11-14
- `F030-telegram-picker-already-saved` (🟢 PROVEN): Telegram picker: say "Already saved" in the message too; landed 2026-11-14
- `F093-ci-green` (🟢 PROVEN): CI on master is green and a flaky test is quarantined the same day; landed 2026-11-13
- `F090-llm-roles` (🟢 PROVEN): LLM calls name a role; provider, model, cap share and prompt version follow the role; landed 2026-11-13
- `F089-structured-logs` (🟢 PROVEN): Logs are events with allow-listed fields and run ids, with a lint rule in warn mode; landed 2026-11-13
- `F087-feature-flags` (🟢 PROVEN): Feature flags per organization and the operator check exist before the first Stage 2 feature; landed 2026-11-13
- `F086-module-borders` (🟢 PROVEN): Module borders are linted: layers, allowed edges, no deep imports, a generated module graph; landed 2026-11-13
- `F084-the-mail-host-guard-also-refuses-multicast-broadcast-reserved-nat64-site-local-and-6to4-addresses-and-its-default-policy-is-frozen` (🟢 PROVEN): The mail host guard also refuses multicast, broadcast, reserved, NAT64, site-local and 6to4 addresses, and its default policy is frozen; landed 2026-11-13
- 2026-11: 58 landed. spec/features/done/2026-11/
