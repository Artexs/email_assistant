# F113 stage 14 — org reset and demo reset

Part of [`../plan.md`](../plan.md). Decisions D13, D15, P5. Review 1: T10. Data delete: only sim data, only the named lab organization.

## Goal

`bun run lab reset --org lab|demo --yes` rebuilds one lab organization from nothing, so every measured run starts on a fresh org (review T10: no metrics of an older run leak in). `bun run lab demo-reset --yes` = reset of `demo`, then its week: shadow for days 1–3, assist from day 4.

## Files

`apps/server/src/modules/lab/reset.ts`, the `reset` and `demo-reset` commands.

## Interfaces

```ts
resetOrg(deps: ResetDeps, key: LabOrgKey): Promise<{ orgId: string; deleted: boolean }>;
resetDemo(deps: ResetDeps, opts: { startDate?: string }): Promise<{ orgId: string; runId: string }>;   // resetOrg("demo") + step 7
```

## Decisions

- **Steps, in order:**
  1. `checkSimEnv` clean (the command frame does it).
  2. Read `orgs.json`. With an entry for `key`: load that organization. Its name must be `LAB_TARGETS[key].orgName` and its mailbox address `LAB_TARGETS[key].mailbox`; else exit 1 `org_mismatch` and change nothing.
  3. Stop the active run of that org, if any (`stopRun(id, "operator")`).
  4. Delete the organization through the privacy module's organization delete (the function the `org:delete` CLI uses; not the route, so no flag and no password). Remove the entry from `orgs.json`.
  5. Empty that mailbox in GreenMail: delete every message in every folder (IMAP), so old mail does not sync into the new org.
  6. `seedLabOrg(LAB_TARGETS[key])` (stage 06).
  7. Demo only: start a week run for `demo` with `modePlan: { assistFromDay: 4 }`, the stage 05 cap rule, start = `--date` or the next Monday.
- **Never touches** the other lab organization, its mailbox or its runs.
- **Crash between steps:** each step can run again. After step 4 and before step 6, `orgs.json` has no entry, so the next reset skips steps 2–4 and goes on at step 5.
- **Without `--yes`** the command prints what it would delete (org id, mailbox address, message count) and exits 1 `confirm_needed`.
- **First reset** (no entry): steps 5–7 only.
- The demo executive is the same scripted executive (stage 10) on chat 5550002; it has nothing to tap in shadow days.

## Tests (integration: job DB, shared GreenMail with a random demo address through a test target, fake Telegram)

1. First `demo-reset` → one demo org in `shadow`, a week run with `assistFromDay` 4, `orgs.json` has `demo`.
1b. `reset --org lab` on a lab org with 3 mails → a fresh lab org with 0 mails in `assist`; `start` then passes the `org_not_fresh` check (stage 05).
2. Second reset → the old org id is gone (its emails and actions too, by the delete function), one new demo org, a new run; the old run has `stopped: operator`.
3. The `lab` org and its rows are the same before and after (two-tenant check: row counts of emails, actions, delegations).
4. GreenMail: after reset the demo mailbox has 0 messages in INBOX and `Sent`.
5. The `demo` entry names an org whose name is "Kordelan lab" → `org_mismatch`, nothing deleted. Mutation: remove the name check → test 5 deletes the lab org and fails. Restore.
6. No `--yes` → `confirm_needed`, nothing deleted.
7. Crash after step 4 (simulate by stopping after the delete) → the next reset ends with one demo org.

## Done when

Tests pass; `live-lab.md` has the reset rules; the Proof prints `PROOF_OK`. The final message lists the guard of test 5 and its failing run.

## Out of scope

Export and import (stage 15). The tailnet panel (C1).
