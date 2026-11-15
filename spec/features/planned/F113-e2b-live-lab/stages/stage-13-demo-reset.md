# F113 stage 13 — demo reset

Part of [`../plan.md`](../plan.md). Decisions D13, D15, P5. Data delete: only sim data, only the demo organization.

## Goal

`bun run lab demo-reset --yes` rebuilds the demo organization from nothing and starts its week: shadow for days 1–3, assist from day 4.

## Files

`apps/server/src/modules/lab/demo.ts`, the `demo-reset` command.

## Interfaces

```ts
resetDemo(deps: DemoDeps, opts: { startDate?: string }): Promise<{ orgId: string; runId: string; deleted: boolean }>;
```

## Decisions

- **Steps, in order:**
  1. `checkSimEnv` clean (the command frame does it).
  2. Read `orgs.json`. With a `demo` entry: load that organization. Its name must be `LAB_TARGETS.demo.orgName` and its mailbox address `LAB_TARGETS.demo.mailbox`; else exit 1 `demo_mismatch` and change nothing.
  3. Stop the active demo run, if any (`stopped: operator`, lock released).
  4. Delete the organization through the privacy module's organization delete (the function the `org:delete` CLI uses; not the route, so no flag and no password). Remove the `demo` entry from `orgs.json`.
  5. Empty the demo mailbox in GreenMail: delete every message in every folder of that address (IMAP), so old mail does not sync into the new org.
  6. `seedLabOrg(LAB_TARGETS.demo)` (stage 05; mode `shadow`, Telegram chat 5550002).
  7. Start a week run for org `demo` with `modePlan: { assistFromDay: 4 }`, cap $5, start = `--date` or the next Monday.
- **Never touches** the `lab` organization, its mailbox or its runs.
- **Crash between steps:** each step can run again. After step 4 and before step 6, `orgs.json` has no `demo` entry, so the next reset skips steps 2–4 and goes on at step 5.
- **Without `--yes`** the command prints what it would delete (org id, mailbox address, message count) and exits 1 `confirm_needed`.
- **First reset** (no `demo` entry): steps 5–7 only.
- The demo executive is the same scripted executive (stage 09) on chat 5550002; it has nothing to tap in shadow days.

## Tests (integration: job DB, shared GreenMail with a random demo address through a test target, fake Telegram)

1. First reset → one demo org in `shadow`, a week run with `assistFromDay` 4, `orgs.json` has `demo`.
2. Second reset → the old org id is gone (its emails and actions too, by the delete function), one new demo org, a new run; the old run has `stopped: operator`.
3. The `lab` org and its rows are the same before and after (two-tenant check: row counts of emails, actions, delegations).
4. GreenMail: after reset the demo mailbox has 0 messages in INBOX and `Sent`.
5. `orgs.json` names an org whose name is "Kordelan lab" → `demo_mismatch`, nothing deleted. Mutation: remove the name check → test 5 deletes the lab org and fails. Restore.
6. No `--yes` → `confirm_needed`, nothing deleted.
7. Crash after step 4 (simulate by stopping after the delete) → the next reset ends with one demo org.

## Done when

Tests pass; `live-lab.md` has the demo rules; the Proof prints `PROOF_OK`. The final message lists the guard of test 5 and its failing run.

## Out of scope

Export and import (stage 14). The tailnet panel (C1).
