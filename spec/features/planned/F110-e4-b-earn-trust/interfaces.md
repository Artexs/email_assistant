# F110 interfaces (names that cross stages)

Part of [`plan.md`](plan.md). A stage that creates a name below keeps it. A worker that must change one stops and asks.

## Core (`packages/core/src/trust/`, stage 01)

- `EvidenceKey = { provider, model, reasoningEffort: string | null, promptVersion, promptParts: string[] | null, endpoint: "standard" | "eu" | "own", host: string | null }`. `sameKey(a, b)`: equal `provider`, `model`, `reasoningEffort`, `promptVersion`, `promptParts` (sorted; null = none), `endpoint`; `host` only when `endpoint` is `own` (review 1 B4, N13).
- `movingCategories = ["info", "notification", "spam"] as const` (D3).
- `GlobalEvidence = { decision: "go" | "no-go" | "too-few" | "none"; provisional: boolean; precision: number | null; wilsonLower: number | null; threshold: number | null; cases: number; file: string | null }` per category.
- `HistoryOutcome = "pass" | "fail" | "inconclusive" | "no_result"`; `historyOutcome({ acted, moved }): { outcome, upper: number | null }` (D4).
- `TripReason = "corrections" | "important_hidden" | "model_switch" | "evidence_changed" | "history_fail"`; `TripState = { tripped: boolean; reason: TripReason | null; at: Date | null }`.
- `autoEvidence({ global, history, trip, realLabels }): { eligible; recommended; blocks: EvidenceBlock[] }`, `EvidenceBlock = "no_global" | "global_no_go" | "global_provisional" | "history_fail" | "tripped" | "real_labels_no_go"`. `eligible` = no block other than `tripped`; `recommended` = no block at all and a moving category (D5; review 1 N4).
- `tripwireDue({ corrections: { at: Date; important: boolean }[]; now: Date }): "corrections" | "important_hidden" | null` (the caller passes only corrections that count under D9).

## Server

- `triage/evidence.ts` (stage 02): `loadGateEvidence(dir): GateIndex` (once at start); `runningEvidenceKey(llm, prompt): EvidenceKey`; `globalEvidenceFor(index, key): Record<BarCategory, GlobalEvidence>`.
- `triage` (stage 07): `classifyStored(deps, ctx, emailId): Promise<{ category, confidence, reasonCode, wouldMove, usage | null, source: "rule" | "classified" }>`.
- `config` (stage 04): `CategoryGrant = { key: EvidenceKey; by: "evidence" | "forced" | "recommended" | "regate" | "legacy"; at: string }` in `category_policy[cat].grant` (absent = before F110). `effectiveAutoFor(policy, category, runningKey)` = `auto` and (no grant, or `sameKey(grant.key, runningKey)`). `setCategoryAuto` gains an optional in-transaction callback.
- `trust` module (`apps/server/src/modules/trust/`, layer 5; stage 03 on):
  - repo: `queueHistoryCheck(db, ctx, mailboxId, reason)` (no-op when one is open); `latestHistoryCheck`; `historyResultFor(db, ctx, mailboxId)` → per moving category `{ outcome, acted, moved, upper, total, wouldMove } | null`; `activeTripsOf(db, ctx, mailboxId): Map<BarCategory, TripState>`; `insertTrip(trx, ctx, { mailboxId, category, grantedAt, reason, counts })` → id or null; `clearTrips(trx, ctx, mailboxId, category, at)`.
  - `historyActedOn(db, ctx, emailIds)` → `Set<emailId>` (D6; the E5a seam), stage 07.
  - `setCategoryAutoWithEvidence` (stage 04), `regateAll` (stage 08), `runTripwire` (stage 09), `trustViewFor` (stage 11; the one reader of the card, the report page and M8).
- `channels` (stage 10, widened in stage 19): `queueTrustNotice(trx, ctx, { kind, view, mailboxId })`. Stage 20: `isOwnReportMail(db, ctx, mailboxId, id)`.
- `reports` (stage 12): week deps gain `trustEvidence?: (ctx, mailboxId) => Promise<TrustEvidenceRows>`, injected by the composition roots.
- `triage/suspicious-repo.ts` (stage 22): `suspiciousSendersOf(db, ctx, mailboxId, sendersLower): Promise<Set<string>>`.
- `trust/newsletters.ts` (stage 22): `listNewsletterSenders(db, ctx, mailboxId, now)`.
- `platform/public-http.ts` (stage 24): `postOneClick(url, deps): Promise<{ kind: "ok" | "refused" | "failed"; code: string }>`.

## Schema (stage 03; stage 22 for unsubscribe)

- `history_checks`: `id`, `org_id`, `mailbox_id`, `status` (`queued`, `backfilling`, `waiting_flags`, `classifying`, `done`, `no_result`), `reason` (`connect`, `cli`, `web`, `model_switch`, `flag_on`), `no_result_reason` (`no_history`, `uidvalidity`, `cost_unknown`, `stopped`, `key_changed`), `key` (jsonb), `window_start`, `backfill_done_at`, `cost_usd` (numeric), `capped`, `result` (jsonb), `attempts`, `locked_at`, `next_attempt_at`, `created_at`, `finished_at`. Partial unique index: one row per mailbox with `status` not in (`done`, `no_result`).
- `history_check_items`: `check_id`, `org_id`, `email_id` (FK `emails`, cascade), `category`, `confidence`, `reason_code`, `would_move`, `acted_on`, `source` (`triage_result`, `classified`, `rule`), `cost_usd`; key `(check_id, email_id)`.
- `autonomy_trips`: `id`, `org_id`, `mailbox_id`, `category`, `granted_at`, `reason` (`TripReason`), `counts` (jsonb), `tripped_at`, `cleared_at`; unique `(mailbox_id, category, granted_at)`.
- `memberships`: `quiet_start`, `quiet_end` (`HH:MM`, both null = 22:00–07:00; equal = none), `report_channel` (`telegram` default, `mail`, `both`), `report_mailbox_id` (composite FK, `SET NULL (report_mailbox_id)`).
- `outbox_kind_check` + `trust_report_ready`, `autonomy_paused`; `outbox_channel_check` = `telegram`, `mail`.
- Stage 22: `email_headers.list_unsubscribe_post` (bool, null on old rows); `unsubscribe_requests`: `id`, `org_id`, `mailbox_id`, `sender_lower`, `sender_domain`, `method` (`one_click`), `status` (`requested`, `done`, `failed`, `refused`), `code`, `created_at`, `finished_at`; unique `(mailbox_id, sender_lower)`.
- Every new table and column: `EXPORT_MAP`, `DSR_ADDRESS_MAP` or `NOT_PERSONAL`, and a `DELETE_SEEDS` seed (F106 tests).

## Notice kinds (stage 10)

- `trust_report_ready` (dedup `trust_report:<mailbox id>`; counts only), `autonomy_paused` (dedup `autonomy_paused:<trip id>`; category and `TripReason` only). Owners. Also by mail (D14).

## Routes (OpenAPI, `apiDoc` in the same commit)

- `GET /api/trust/:mailboxId`, `POST /api/trust/:mailboxId/recommended`, `POST /api/trust/:mailboxId/history-check` (stage 11).
- `GET /api/review/sample`, `POST /api/review/label` (stage 15).
- `GET/PATCH /api/me/notify` (stage 18).
- `GET /api/newsletters/:mailboxId` (stage 23), `POST /api/newsletters/:mailboxId/unsubscribe` (stage 24).

## Feature flags (default off, remove-by 2027-03-01, epic `E4-B`)

`trust_ladder`, `panel_review`, `why_lines`, `spam_review_line`, `report_mail`, `user_quiet_hours`, `urgency_editor`, `bulk_unsubscribe`. Each stage adds its own flag.
