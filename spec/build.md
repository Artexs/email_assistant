# Build

> Coordinator-maintained narrative board. TRACK, NEXT, PARKED and DROPPED are coordinator prose: keep them true in the change that moves feature state. NOW and PROVEN are generated from the feature lanes by `limen land`, `limen ticket done` and `limen board --write`; edit the tickets, not those lines.

TRACK at most three bullets. NEXT one clause per ticket. PROVEN names the last ten landed features, then one count line per month.

Status marks are prose only: 🟠 ACTIVE · 🔴 PLANNED · 🟢 PROVEN · ⚪ DROPPED. Nothing in `limen` treats them as workflow state.

## TRACK

- Standing models: worker and reviewer `--engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high`, with the personal Claude route (`~/.pi/agent/AGENTS.md` § Limen). Prepare: `--prepare 'bash scripts/limen-prepare.sh'` (own `.env`, `node_modules`, own DB; drop the job DB by hand after the job).
- Now: S6 pre-sale runs in the old flow (`tasks/active/s6-pre-sale.md`); new work goes here.

## NOW

<!-- Generated from spec/features/active/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F077-s6a-customer-core` (🟠 ACTIVE): S6a Customer core: a second organization runs next to the pilot
- `F071-limen-transition` (🟠 ACTIVE): Move the agent workflow to Limen
- `F069-compose-network-subnet` (🟠 ACTIVE): Pin the Compose network subnet

## NEXT

## PROVEN

<!-- Generated from spec/features/done/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F070-editor-rules-cleanup` (🟢 PROVEN): Editor rule files still name Supabase; landed 2026-11-12
- `F059-web-hashed-reset-tokens` (🟢 PROVEN): Store web reset tokens hashed; landed 2026-11-12
- `F058-sync-sort-folders` (🟢 PROVEN): Sync the Interia sort folders and the spam folder (Oferty, Społeczności, Rachunki, Wiadomości-śmieci); landed 2026-11-12
- `F054-s5e-web-deploy-docs` (🟢 PROVEN): S5e Web: deploy and docs; landed 2026-11-12
- `F049-mail-smtp-starttls-587` (🟢 PROVEN): SMTP on port 587 with STARTTLS; landed 2026-11-12
- `F045-approval-quote-address` (🟢 PROVEN): Keep the sender address in the approval quote header; landed 2026-11-12
- `F044-send-retry-cap` (🟢 PROVEN): A shorter cap for send retries; landed 2026-11-12
- `F041-delegation-went-out-button` (🟢 PROVEN): A button 'It went out' after outcome_unknown; landed 2026-11-12
- `F026-llm-provider-switch` (🟢 PROVEN): LLM provider switch: Gemini and OpenAI; landed 2026-11-12
- `F007-s5-web-panel` (🟢 PROVEN): S5 Web panel (lite); landed 2026-11-12
- 2026-11: 40 landed. spec/features/done/2026-11/
