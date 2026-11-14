# F100 stage 19 — Docs and capability pages

Part of [`../plan.md`](../plan.md). After all other stages of this ticket. The last land closes the ticket (`limen land` without `--keep-open`); coordinator steps C5 and C6 follow.

After this stage the docs describe what E3a built: a new capability page for measurement, the touched capability pages, the module and data-model docs, and one standard for later metric work (PD-009).

## Step 1 — Capability pages

**Goal.** One page per capability states the code at this commit (code patterns § Capability map).

**Files.** `docs/capabilities/measurement.md` (new, the template of `docs/capabilities/README.md`), `docs/capabilities/README.md` (index row), and the pages that F095 created for: sync, triage, drafts and send, digest and notices, web panel, retention (file names as they are in `docs/capabilities/` at your HEAD).

Content:

- `measurement.md`: "What it does now" (the Monday report, the stats page and route, `stats:week`, M1–M5, M7, M8 with their one-line definitions from plan D11–D17, the snapshot rule D28, real mail only D18); "Rules" (numbered, from D9, D11–D17, D20, D23, D24, D27); "Entry points" (`weekStats` and `recentWeekStats` in `apps/server/src/modules/reports/metrics.ts`, `GET /api/stats`, `bun run stats:week`, `bun run mailbox:signals`, the `weekly_report` detector, `packages/core/src/metrics/`); "Data" (`email_headers`, `email_flags`, `action_feedback`, `triage_feedback.source = 'answered_check'`, outbox kind `weekly_report`); "Limits" (holdout, history check and tripwire fields: F110; E5 loop rows: F116; E6 draft outcome line: F115; IMAP IDLE: F114; the M7 backup share is an assumption); "Decisions" (PD-056–PD-068, ADR 0028); "Tests" (the main test files of stages 08–17).
- sync page: the interval key `MAIL_SYNC_EVERY_MIN` (default 2), the header capture (D2, D4) and the flag refresh (D6) with their limits.
- triage page: the answered check and the `answered_check` feedback source (D22).
- drafts and send page: reject reasons and the mistake mark (D21), the two routes.
- digest and notices page: the `weekly_report` kind, the handled-share line, the LLM pause line (D8, D23, D24).
- web panel page: the stats page, `features` in `/api/me` (D25).
- retention page: the `email_headers` row (if stage 05 put it in `docs/architecture.md` §7 instead, leave it there).

Every page gets a fresh "Checked against" line (this commit's parent sha and today's date).

**Decisions.** D2–D28 (as listed).

**Test.** `apps/server/src/capability-map.test.ts` passes (paths, `bun run` scripts and ADR numbers exist).

**Check.** `bun test apps/server/src/capability-map.test.ts`

**Done when.** The test passes; `grep -rn "every 5 min" docs/capabilities docs/architecture.md` shows no line about the mail sync.

**Out of scope.** User docs (E10a does not exist yet).

## Step 2 — Module docs, data model, the standard

**Goal.** The reference docs name the new parts; later epics find the metric rule.

**Files.** `docs/modules.md` (§3.2 mail: capture and flags; §3.5 actions: `action_feedback` and the two routes; §3.7 reports: the metric service; §3.8 channels: the weekly detector and the answered-check taps; §3.10 routes: `GET /api/stats`, `POST /api/actions/:id/reject-reason`, `POST /api/actions/:id/mistake`; §4 web: `/stats`; §5 core: `metrics/`), `docs/architecture.md` (the data model table: rows for `email_headers`, `email_flags`, `action_feedback`; the `outbox` kind list if stage 17 did not update it), `docs/code-patterns.md` and `.agents/limen/styleguide.md` (one rule, below).

The rule (code patterns, a new short section "Metrics"; the styleguide gets the one-line form under "Prefer"):

> A Stage 2 metric has one definition: a pure function in `packages/core/src/metrics/` over plain rows, a field in `weekStatsSchema`, and a reader in the module that owns its table. The weekly report, the stats route, `stats:week` and the E2b week scorer call the same function. A new metric or a new source of rows (E5 loops, E6 drafts) adds to these three places; it never computes a metric in a route, a renderer or a script.

**Decisions.** D10, D19.

**Test.** None beyond the capability test.

**Check.** `bun test apps/server/src/capability-map.test.ts && bun run lint`

**Done when.** The sections exist; the styleguide stays under 1,000 lines (`wc -l .agents/limen/styleguide.md`).

**Out of scope.** `docs/product/stage-2/*` and `spec/build.md` (the coordinator edits them).

## Done when (stage)

Steps 1–2 done; the Proof command of `plan.md` passes (`/tmp/f100-s19`).
