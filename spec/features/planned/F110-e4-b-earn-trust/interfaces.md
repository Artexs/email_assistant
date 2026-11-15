# F110 interfaces (names that cross stages)

Part of [`plan.md`](plan.md). A stage that creates a name below keeps it. A worker that must change one stops and asks.

## Core (`packages/core/src/trust/`, stage 01)

- `EvidenceKey = { provider, model, reasoningEffort: string | null, promptVersion, endpoint: "standard" | "eu" | "own" }`; `sameKey(a, b): boolean` (all five fields).
- `movingCategories = ["info", "notification", "spam"] as const` (the categories whose plan moves mail; D3).
- `GlobalEvidence = { decision: "go" | "no-go" | "too-few" | "none"; provisional: boolean; precision: number | null; wilsonLower: number | null; threshold: number | null; cases: number; file: string | null }` per category.
- `HistoryOutcome = "pass" | "fail" | "inconclusive" | "no_result"`; `historyOutcome({ acted: number, moved: number }): { outcome, upper: number | null }` (D4).
- `TripState = { tripped: boolean; reason: "corrections" | "important_hidden" | "model_switch" | null; at: Date | null }`.
- `autoEvidence({ global, history, trip, realLabels }): { eligible: boolean; recommended: boolean; blocks: EvidenceBlock[] }`, `EvidenceBlock = "no_global" | "global_no_go" | "global_provisional" | "history_fail" | "tripped" | "real_labels_no_go"` (D5).
- `tripwireDue({ corrections: { at: Date; important: boolean }[]; grantedAt: Date; now: Date }): TripState["reason"] | null` (D9).

## Server

- `triage/evidence.ts` (stage 02): `loadGateEvidence(dir: string): GateIndex` (read once at start); `runningEvidenceKey(llm: LlmClient, promptVersion): EvidenceKey`; `globalEvidenceFor(index, key): Record<BarCategory, GlobalEvidence>`.
- `config` (stage 04): `CategoryGrant = { key: EvidenceKey; by: "evidence" | "forced" | "recommended" | "regate"; at: string }` stored as `category_policy[cat].grant` (jsonb, optional; absent = granted before F110). `effectiveAutoFor(policy, category, runningKey): boolean` = `auto` and the grant key equals the running key (absent grant: equals only when the running key is the pre-F110 standard key, D7).
- `trust` module (`apps/server/src/modules/trust/`, stage 03 on): `queueHistoryCheck(db, ctx, mailboxId, reason: "connect" | "cli" | "model_switch")` (no second open check per mailbox); `latestHistoryCheck(db, ctx, mailboxId)`; `historyResultFor(db, ctx, mailboxId): Record<MovingCategory, { outcome; acted; moved; upper } | null>`; `activeTripsOf(db, ctx, mailboxId): Map<BarCategory, TripState>`; `trustViewFor(deps, ctx, mailboxId): TrustView` (stage 11; the one reader of the card, the report page and M8).
- `triage/suspicious-repo.ts` (stage 21): `suspiciousSendersOf(db, ctx, mailboxId, sendersLower: readonly string[]): Promise<Set<string>>` (F109 review-4 N5; joins `emails.from_address_lower` to the newest `triage_results` row with reasons).
- `platform/public-http.ts` (stage 23): `postOneClick(url: URL, deps): Promise<{ kind: "ok" | "refused" | "failed"; code: string }>`.

## Schema (stage 03; stage 21 for unsubscribe)

- `history_checks`: `id`, `org_id`, `mailbox_id`, `status` (`queued`, `backfilling`, `waiting_flags`, `classifying`, `done`, `no_result`), `reason`, `no_result_reason` (`no_history`, `never_synced`, `uidvalidity`, `cost_unknown`, `stopped`), `key` (jsonb EvidenceKey), `window_start`, `backfill_done_at`, `sample_target`, `cost_usd` (numeric), `capped` (bool), `result` (jsonb per moving category), `attempts`, `locked_at`, `next_attempt_at`, `created_at`, `finished_at`, `notified_at`. Partial unique index: one row per mailbox with `status` not in (`done`, `no_result`).
- `history_check_items`: `check_id`, `org_id`, `email_id` (FK `emails` on delete cascade), `category`, `confidence`, `reason_code`, `acted_on` (bool), `source` (`triage_result`, `classified`, `rule`), `cost_usd`; primary key `(check_id, email_id)`.
- `autonomy_trips`: `id`, `org_id`, `mailbox_id`, `category`, `granted_at`, `reason`, `counts` (jsonb), `tripped_at`, `cleared_at`; unique `(mailbox_id, category, granted_at)`.
- `memberships`: `quiet_start`, `quiet_end` (text `HH:MM`, null = 22:00–07:00; equal values = no quiet hours), `report_channel` (`telegram` default, `mail`, `both`), `report_mailbox_id` (FK `mailboxes` on delete set null).
- `emails.skip_reason` gains `history_check` (check constraint, if one exists).
- Stage 21: `email_headers.list_unsubscribe_post` (bool, null on old rows); `unsubscribe_requests`: `id`, `org_id`, `mailbox_id`, `sender_lower`, `sender_domain`, `method` (`one_click`), `status` (`requested`, `done`, `failed`, `refused`), `code`, `created_at`, `finished_at`; unique `(mailbox_id, sender_lower)`.
- Every new table and column: `EXPORT_MAP`, `DSR_ADDRESS_MAP` or `NOT_PERSONAL`, and a `DELETE_SEEDS` seed (F106 tests).

## Notice kinds (stage 10)

- `trust_report_ready` (dedup `trust_report:<mailbox id>`; counts only), `autonomy_paused` (dedup `autonomy_paused:<trip id>`; category and reason code only). Linked owners. Both also go by mail (D14).

## Routes (OpenAPI, `apiDoc` in the same commit)

- `GET /api/trust/:mailboxId` (any member), `POST /api/trust/:mailboxId/recommended` (owner), `POST /api/trust/:mailboxId/history-check` (owner; queue again), stage 11.
- `GET /api/review/sample?mailboxId=`, `POST /api/review/label` (source `review`), stage 15.
- `GET/PATCH /api/me/notify` (`quietStart`, `quietEnd`, `reportChannel`, `reportMailboxId`), stage 18.
- `GET /api/newsletters/:mailboxId`, `POST /api/newsletters/:mailboxId/unsubscribe` (owner), stages 22–23.

## Feature flags (`packages/core/src/features.ts`, default off, remove-by 2027-03-01, epic `E4-B`)

`trust_ladder`, `panel_review`, `why_lines`, `spam_review_line`, `report_mail`, `user_quiet_hours`, `urgency_editor`, `bulk_unsubscribe`. Each stage adds its own flag.
