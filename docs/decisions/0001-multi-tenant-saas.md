# 0001 — Multi-tenant SaaS, one pilot tenant in MVP
- Status: proposed
- Date: 2026-11-01

## Context
The product is for sale to business owners and managers (product brief Q1). The old docs planned single-tenant MVP
and multi-tenancy "later". Adding tenancy later means a data migration and a security review of every query.

## Decision
- The data model is tenant-aware from the first migration: `organizations` → `memberships` (role `owner` / `assistant`) → `mailboxes`.
  Users live in an own `users` table (no Supabase Auth, ADR 0011).
- Every domain table has `org_id`.
- MVP runs one organization (the pilot user). Sign-up for other organizations comes in slice S6.

## Consequences
- Small extra cost now (one column, one policy per table). No rewrite later.
- Every server query must carry a `TenantContext` (see ADR 0011).
- The assistant role exists in the schema but has no UI until Phase 2.
