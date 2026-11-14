# F100 stage 19 — Docs and capability pages

Part of [`../plan.md`](../plan.md). After all other stages of this ticket. The last land closes the ticket (`limen land` without `--keep-open`); coordinator steps C5 and C6 follow.

After this stage the docs describe what E3a built as one whole: the capability pages that stages 03–18 updated agree with each other and with the code, the module and data-model docs name the new parts, and one standard holds for later metric work (PD-009). Stages 03–18 wrote their own page lines in the same change as their behaviour (plan § Rules for every stage); this stage is the last pass, not the first.

## Step 1 — Capability pages: the last pass

**Goal.** Each page states the code at this commit (code patterns § Capability map).

**Files.** `docs/capabilities/measurement.md` (stage 12 created it), `docs/capabilities/README.md`, and the pages the stages touched: `sync.md`, `retention.md`, `triage.md`, `drafts-and-send.md`, `digest-and-notices.md`, `web-panel.md`, `tenancy-and-plans.md`.

Content:

- `measurement.md` complete: "What it does now" (the Monday report, the stats page and route, `stats:week`, M1–M5, M7, M8 with their one-line definitions from plan D11–D17, the snapshot rule D28, real mail only D18); "Rules" (numbered, from D9, D11–D17, D20, D23, D24, D27); "Entry points" (`weekStats` and `recentWeekStats` in `apps/server/src/modules/reports/metrics.ts`, `GET /api/stats`, `bun run stats:week`, `bun run mailbox:signals`, the `weekly_report` detector, the `/stats` page, `packages/core/src/metrics/`); "Data" (`email_headers`, `email_flags`, `action_feedback`, `triage_feedback.source = 'answered_check'`, outbox kind `weekly_report`); "Limits" (holdout, history check and tripwire fields: F110; E5 loop rows: F116; E6 draft outcome line: F115; IMAP IDLE: F114; the M7 backup share is an assumption); "Decisions" (PD-056–PD-068, ADR 0028); "Tests" (the main test files of stages 08–18).
- Every other touched page: read the lines that stages 03–18 added against the code at this commit (names, limits, flags, the 2-min interval); fix what differs; add a line that a stage missed. Do not rewrite the pages.
- `tenancy-and-plans.md`: rule 5 and the Limits line name every flag of the registry and the code that reads them (plan § Rules for every stage, flag rule).

Every page this step changes gets a fresh "Checked against" line (this commit's parent sha and today's date).

**Decisions.** D2–D28 (as listed).

**Test.** `apps/server/src/capability-map.test.ts` passes (paths, `bun run` scripts and ADR numbers exist).

**Check.** `bun test apps/server/src/capability-map.test.ts`

**Done when.** The test passes; `grep -rni "every 5 min" docs/capabilities docs/architecture.md docs/modules.md` shows no line about the mail sync (case-insensitive: "Every 5 minutes" counts; cold review 2 N4); `grep -n "F100" docs/capabilities/*.md` shows no Limits line that says F100 will do a thing it did.

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
