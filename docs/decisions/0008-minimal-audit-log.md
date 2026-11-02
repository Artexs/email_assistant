# 0008 — Minimal append-only audit log in MVP
- Status: accepted (user, 2026-11-02)
- Date: 2026-11-01

## Context
The old docs postponed all logging, but the DDD analysis calls audit a core domain, and the digest needs the same data.
The user accepted the recommendation (product brief Q6).

## Decision
- One append-only `audit_log` table: org, email, action, actor (`system` or user id), event, reason, data, time.
- The committer writes the audit row in the same transaction as the status change.
- No event sourcing and no separate audit database in MVP.

## Consequences
- The digest and the future "what happened to my mail" view read from one table.
- No UPDATE or DELETE on `audit_log`: the server's DB role `app` has only INSERT and SELECT on it (ADR 0011).
  One privileged function deletes the rows of a removed mailbox or organization.
- `audit_log.data` holds ids, codes and numbers, never mail text (retention rules: `docs/architecture.md` §7).
