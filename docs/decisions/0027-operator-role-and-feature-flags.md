# 0027 — Operator role in the panel and per-organization feature flags

- Status: proposed (E7 discovery, 2026-11-13). The owner accepted the defaults (PD-045, PD-046). The ticket that lands it sets "accepted".
- Date: 2026-11-13

## Context

Every panel route works inside one organization (`TenantContext`, `apps/server/src/platform/db/tenant-context.ts`; the tenant filter is in code, there is no row-level security). The operator works only through CLIs (`org:create`, `org:invite`, `org:plan`, `org:status`) and gets notices in a Telegram chat or the log (`modules/channels/operator.ts`). Some jobs already read across organizations (`listOrganizations`). There are global kill switches in env (`TRIAGE_LLM_SCOPE`, `ACTIONS_SCOPE`, `SEND_SCOPE`) but no switch per organization.

Stage 2 needs an operator console (E7, absorbs F081; E8 relies on it for job state per organization) and a safe roll-out for new behaviour (E4 mail digest, E5 Sent sync and follow-ups, E6 reply drafts, E9 OAuth mailboxes).

## Decision

1. **Operator identity comes from env**: `OPERATOR_USER_IDS` (user ids). A database write cannot make an operator. An operator must have TOTP once ADR 0026 lands.
2. **One operator module** with its own route group `/api/operator/*` and the page `/operator`. It is the only web code that reads across organizations. Every route has route-matrix tests: a non-operator, also an owner, gets 404.
3. **The console shows ids, codes, counts and dates only**: plan, mailboxes and their status, the last run of each job derived from existing rows, failures of the last 24 h, LLM calls and cost today, operator notices and SLO alerts, flags. No mail content, no sender addresses, no log reading (logs stay in the E8 log store).
4. **Console writes call the same service functions as the CLIs** (plan change, suspend, resume, flags, SSO provider setup) and write the same audit rows.
5. **Feature flags per organization**: a registry in `packages/core` (key, default, description, owner epic, remove-by date); a table `org_features (org_id, flag, enabled, set_by, set_at)` where no row means the default; env `FEATURES_OFF` turns a flag off for every organization without a DB write. Code reads flags through one function `isFeatureOn(ctx, flag)`. No flag vendor or SDK.
6. **Every new user-visible Stage 2 behaviour ships behind a flag**, default off, on for the pilot first. Flags are not product settings: the mailbox mode and the per-category `auto` switches stay as they are.

## Consequences

- One more place that crosses tenants; the route-matrix tests and the env-only operator list bound it.
- `org_features` joins the organization-delete test.
- A flag past its remove-by date is a cleanup ticket; the registry makes the list visible.
- If a real flag service is ever needed, it replaces the body of `isFeatureOn` (the call shape follows OpenFeature: a flag key and an evaluation context).
