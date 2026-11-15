# F114 stage 01 — Alert state: table, repository, step rule

Part of [`../plan.md`](../plan.md). [risky] (migration). Decisions D1, D2, D3.

## Step 1 — Kinds and the step rule (pure)

- **Goal:** one pure function decides the job's step for one kind on one tick. **Files:** new `packages/core/src/ops/`, exported from the core index.
- **Interfaces (later stages use these names):**
  - `SLO_KINDS = ["slo_sync_lag", "slo_urgent_latency", "slo_llm_errors", "slo_disk", "slo_backup_age"] as const`; `type SloKind`.
  - `type SloCheck = { kind: SloKind; state: "firing" | "between" | "clear"; facts: Record<string, number> }`. `firing` wins over `between`; `between` = the fire rule is false but the clear rule is false too (hysteresis).
  - `type AlertState = { openSentAt: Date | null; lastSentAt: Date | null; resolvedAt: Date | null; resolvedSentAt: Date | null }`.
  - `nextAlertStep(row: AlertState | null, check: SloCheck, now: Date, repeatMs: number): "none" | "open" | "repeat" | "resolve" | "silent_close"`.
- **Rule table** (a row with `resolvedSentAt` set is history, never passed):

| Row | Check | Step |
| --- | --- | --- |
| none | firing | `open` (insert, send) |
| none | between or clear | `none` |
| open notice not sent | firing or between | `open` (send again) |
| open notice not sent | clear | `silent_close` (no notice was ever seen) |
| open sent, `resolvedAt` null | firing or between, `now − lastSentAt ≥ repeatMs` | `repeat` |
| open sent, `resolvedAt` null | firing or between, less | `none` |
| open sent, `resolvedAt` null | clear | `resolve` |
| `resolvedAt` set, `resolvedSentAt` null | any | `resolve` (send the resolved notice again) |

- **Test** (unit, `now = 2026-11-20T10:00:00Z`, `repeatMs = 6 h`):
  1. null + firing → `open`. 2. null + clear → `none`. 3. null + between → `none`.
  4. `openSentAt` null + firing → `open`. 5. `openSentAt` null + clear → `silent_close`.
  6. sent, `lastSentAt = 04:00:01Z`, firing → `none`. 7. `lastSentAt = 04:00:00Z`, firing → `repeat`.
  8. `lastSentAt = 03:00Z`, between → `repeat`. 9. `lastSentAt = 09:55Z`, clear → `resolve`.
  10. `resolvedAt = 09:58Z`, `resolvedSentAt` null, firing → `resolve`.

## Step 2 — Migration `ops_alerts` [risky]

- **Goal:** the open state survives a restart. **Files:** one new migration (next timestamp at your base); `bun run db:types`.
- **Schema:**
  - `id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
  - `kind text NOT NULL CHECK (kind IN (<the five SLO_KINDS>))`
  - `opened_at timestamptz NOT NULL`, `open_sent_at timestamptz`, `last_sent_at timestamptz`
  - `notice_count integer NOT NULL DEFAULT 0`
  - `resolved_at timestamptz`, `resolved_sent_at timestamptz`
  - `facts jsonb NOT NULL DEFAULT '{}'` (numbers only; the repository checks it)
  - `UNIQUE INDEX ops_alerts_active_kind ON ops_alerts (kind) WHERE resolved_sent_at IS NULL`
- **Decisions:** no `org_id` (D1); app-role grants by the repo pattern. Register it like `auth_lockouts`: RLS test, `EXPORT_MAP` (`export: false`, "host-wide alert state, no organization"), `NO_PERSONAL_TABLES` ("numbers only"), any test that lists tables. No retention (Q9).

## Step 3 — Repository

- **Files:** `modules/operator/alerts-repo.ts`, exported by the operator `index.ts`.
- **Interfaces** (no `TenantContext`; add to the `docs/code-patterns.md` exceptions):
  - `getActiveAlert(db, kind): Promise<OpsAlertRow | null>` — the row with `resolved_sent_at IS NULL`.
  - `openAlert(db, { kind, at, facts }): Promise<OpsAlertRow>` — insert; on the unique conflict return the existing row.
  - `markAlertSent(db, id, phase: "open" | "repeat" | "resolved", at, facts)` — `open`: `open_sent_at`, `last_sent_at`, count + 1; `repeat`: `last_sent_at`, count + 1; `resolved`: `resolved_sent_at` (and `resolved_at` when null).
  - `resolveAlert(db, id, at, facts, { silent: boolean })` — sets `resolved_at`; `silent` also sets `resolved_sent_at`.
  - `listAlerts(db, { since: Date, limit: number })` — newest first.
- **Test** (integration, own file):
  1. `openAlert` twice for `slo_disk` → one row, same `id`.
  2. resolve with `silent: true`, then `openAlert` → a second row.
  3. `markAlertSent` open then repeat → `notice_count = 2`, `last_sent_at` = the second time.
  4. `facts = { free_gb: "a" }` → throws, no row written.
  5. `listAlerts({ since: 2026-11-19T00:00Z, limit: 1 })` with two rows → the newer one.

## Check

The new unit and integration files, then the Proof.

## Done when

Both test lists pass; `db:types` output committed; RLS and privacy tests pass; the Proof prints `PROOF_OK`.
