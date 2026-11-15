# F114 stage 03 — The `ops.slo` job, the alert texts, the send

Part of [`../plan.md`](../plan.md). Decisions P2, D2–D5, D7, D8. Needs stages 01 and 02. Opus review (sends to people).

## Step 1 — The tick

- **Files:** `modules/operator/slo-job.ts`.
- **Interface:** `runSloTick(deps: { db, checks: SloCheckFn[], send: ((text: string) => Promise<void>) | null, cfg, log }, now: Date): Promise<void>`; `type SloCheckFn = (now: Date) => Promise<SloReading | null>`. Stage 04 appends two checks to the list that `main.ts` builds.
- **Per check, in `SLO_KINDS` order:**
  1. Run the check. A throw → `warn` `slo_check_failed` (`kind`, error fields); skip this kind this tick. `null` (check off) → skip; an open row of that kind stays as it is.
  2. `getActiveAlert`, then `nextAlertStep(row, check, now, SLO_REPEAT_H)`.
  3. `open`: `openAlert` when there is no row; send; `markAlertSent(open)`. `repeat`: send; `markAlertSent(repeat)`. `resolve`: `resolveAlert` when `resolved_at` is null; send; `markAlertSent(resolved)`. `silent_close`: `resolveAlert(silent: true)`, no send.
  4. Each write stores the current `facts`.
- **Send:** a real send, then `info` `slo_alert_sent` (`kind`, `status` = phase). `send` null (no operator chat) → the same line only, and the step counts as sent (D4). A send throw → `warn` `slo_alert_send_failed` (`kind`, `status`, error fields); no mark; next kind.
- **Decisions:** send, then mark (D3). No memory between ticks: a restart changes nothing.

## Step 2 — Texts

- **Files:** `modules/operator/slo-texts.ts`. `sloAlertText({ kind, phase, facts, ids, openedAt, now })` → string. `phase`: `open | repeat | resolved | test`.
- **Form** (English, plain text, as the other operator notices):
  - Line 1: `ALERT <kind>` / `STILL OPEN <kind> (since <openedAt ISO>)` / `RESOLVED <kind> (open <N> min)` / `TEST <kind>`.
  - Line 2: the facts in words, for example `free 12.3 % (1.8 GB)`, `2 mailboxes, oldest sync 47 min ago`.
  - Line 3 (open, repeat, test): up to 5 ids (`mailbox` / `email` / `org`), then `+N more`.
  - Last line: `Runbook: docs/known-alerts.md#<kind>`.
- **Never:** a subject, an address, a folder name, an error text, the chat id.

## Step 3 — Wiring and two CLIs

- `main.ts`: `scheduler.add("ops.slo", "30 */5 * * * *", …)` in every case (also without `TELEGRAM_BOT_TOKEN`). `send` = the same operator direct send that `channels.operator` gets (chat set) or null.
- `bun run ops:alerts [--days 7]`: one line per row: kind, opened, notices, resolved (or `open`), facts. Numbers and kinds only.
- `bun run ops:alert-test (--kind <kind> | --all)`: renders the `test` text from fixed facts and sends it through the real path; no `ops_alerts` write. Prints `sent <kind>` or `unsent <kind> no_chat`; exit 1 on a send error. Stage 09 uses it.
- Both use `createCliOutput`.

## Step 4 — Docs

- `docs/known-alerts.md`: one entry per kind (heading `` ### `slo_<x>` ``, so the anchor matches) and for `slo_check_failed`, `slo_alert_send_failed`: fire and clear rule, keys, what to do.
- New `docs/capabilities/operations.md` § Alerts; a pointer line in `digest-and-notices.md` rule 11.

## Test

Integration, fake `send` and clock, `now = 2026-11-20T10:00:00Z`, fake checks:

1. `slo_disk` firing → one send, line 1 `ALERT slo_disk`, row `notice_count = 1`.
2. +5 min, firing, a new `runSloTick` deps object (restart) → no send.
3. +6 h → one send `STILL OPEN slo_disk (since 2026-11-20T10:00:00.000Z)`, count 2.
4. +6 h 5 min, clear → one send `RESOLVED slo_disk (open 365 min)`; the next clear tick → no send.
5. `send` throws on open → no mark; the next tick sends open again; one row.
6. Open send failed, then clear → `silent_close`, no resolved send.
7. `send` null → no send call, line `slo_alert_sent` with `kind=slo_disk`, `status=open`; row marked.
8. Sync check throws → `slo_check_failed` with `kind=slo_sync_lag`; the disk alert still opens.
9. Real `checkUrgentLatency` with a late mail, subject `Secret plan`, from `ceo@x.test` → the text holds the email id, not `Secret`, not `@`.
10. Seven mailbox ids → five ids and `+2 more`.
11. `ops:alert-test --all`, fake send → five sends, each line 1 `TEST <kind>`; no `ops_alerts` row.

## Done when

The new tests 1–11 pass; the job is in `main.ts`; the docs entries exist; the Proof prints `PROOF_OK`.

Out of scope: disk and backup checks (04); the console list (F081); outbox rows (alerts are direct sends).

## Carry-over from stage 01 review

- `markAlertSent` (`modules/operator/alerts-repo.ts`) has no state guard: a second `resolved` mark overwrites `resolved_sent_at`. The job must follow `nextAlertStep` and call each mark once per step.
- Note: the old-release `EXPORT_MAP` completeness test (master code with the `ops_alerts` table present) fails only in CI, not at runtime. A rollback image keeps working.
