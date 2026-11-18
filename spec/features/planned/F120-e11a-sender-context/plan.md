# F120 · E11a Sender context: plan

> **Status 2026-11-18 — planned.** Plan base: db85425a. 13 stages; none built. Build after F100 (done), F104 and F110 (last stages left).

Names: [interfaces.md](interfaces.md). Defaults and owner steps: [questions.md](questions.md). Scouts: [scouts.md](scouts.md). Sources: epic E11 page § Discovery, `E11-discovery-notes.md` §2, ADR 0034 (proposed).

## Input

Owner, 2026-11-13 (PD-104–PD-114): "Okay, go with defaults." Binding: PD-105 (no page; Suggestions card; sender line), PD-106 (counts only, keyed hash, 12 months, DSR), PD-107 (prompt only on a holdout win), PD-108 (suggestion rules), PD-109 (contact wait). Text: E11 page § Decisions.

- **P1** Three flags, default off, epic `E11a`, remove-by 2027-06-01: `sender_context` (job, sender line, known domains), `sender_suggestions`, `contact_wait`. Rejected: one flag (no staged roll-out).
- **P2** Sender line only in the panel (Activity, Approvals); Telegram unchanged (default, owner to confirm, Q1). Reason: ADR 0032 detail level not built; strict outbox views.
- **P3** Suggestions: owner taps Accept or Dismiss; a member sees the card read-only. Accept calls `addSenderRule` with the mailbox as scope.
- **P4** Weekly report: one count line and a fixed link to `/rules`; no consent change (counts only).
- **P5** Per-contact wait wins over `loop_wait_days` when the contact has ≥ 5 reply samples (PD-109 "else E5's default").
- **D1** Storage is a derived snapshot, not counters. A job recomputes all profile rows of a mailbox from the source tables of the last 90 days in one pass. Reason: increments cannot keep a rolling window; a recompute is idempotent, crash-safe and needs no hook in the writers. Rejected: increments in each writer (drift, double counts on retry).
- **D2** Only address rows are stored. Domain aggregates are computed in memory for suggestions. Reason: no reader needs them (look-alike needs plain domains, D9); less personal data. Amends ADR 0034 point 1.
- **D3** Key: `senderKeyHash` (interfaces.md): HMAC-SHA256, key from `CREDENTIALS_KEY` by HKDF, org id in the message. Reason: no new secret; no link of one person across organizations. A key change orphans rows; they age out (D6).
- **D4** Window and sources: mail of the last 90 days with `received_at` in the window; real mail only (test mail never counts); own addresses never get a row. Keys = senders of incoming mail ∪ To and Cc of `origin = user` Sent mail. History-check mail counts. Columns: interfaces.md.
- **D5** Reply delays: user delay = Sent `sent_at` − incoming `received_at` where Sent `parent_message_id` = incoming `message_id_header`; their delay = incoming `received_at` − Sent `sent_at` where incoming `in_reply_to` = Sent `message_id`. Median only with ≥ 5 samples, else null.
- **D6** A row absent from the window keeps only `first_seen_at` and `last_seen_at`; the pass sets its counts to 0. Retention deletes a row whose `last_seen_at` is older than 365 days.
- **D7** Module `contacts`, layer 3. Edges: `contacts → triage`, `contacts → delegation`, `loops → contacts`. Triage gets the profile reader as a parameter from `composition.ts` (no cycle). Higher layers import contacts directly.
- **D8** Two runs at once: a transaction-level advisory lock per mailbox; the second run skips the mailbox. A crash before commit leaves the old snapshot.
- **D9** Known domains for `lookalike_domain`: add the registrable domains of To and Cc of `origin = user` Sent mail of 90 days, minus `freeMailDomains`, read live from `sent_emails` (a hash cannot be compared for look-alikes). Behind `sender_context`.
- **D10** Suggestion rules: discovery notes §2.6 with these additions. VIP and whitelist never for a sender with a suspicious reason on any mail in 90 days. Whitelist and blocklist both true: neither. Domain suggestions only whitelist and blocklist, non-free-mail domain, ≥ 2 distinct senders meet the rule. Cap: at most 3 rows created per mailbox in 7 days, any status; order whitelist, VIP, blocklist.
- **D11** Suggestion life: `open` → `accepted`, `dismissed`, `withdrawn` (rule no longer holds, or the rule exists), `expired` (30 days). Pattern cleared at every end state. Dismissed blocks the same key and kind for 90 days. End-state rows are deleted 90 days after the end.
- **D12** Wait = clamp(ceil(1.5 × median their-reply hours / 24), 1, 7) working days, used only at loop open for `waiting` and `delegated` loops without a stated date. `due_source = 'contact'`, `usual_reply_days` = max(1, round(median hours / 24)). The restart and Later rules keep their 3 days.
- **D13** Classifier: new prompt version `classifier-v4` = v3 plus part `profile` (replaces `history`). The production pointer does not change in F120; a ship is an owner decision (Q4). Spend cap $1.50.
- **D14** DSR: erase deletes the profile rows and suggestions of the hashed address in every mailbox of the organization; find counts them. Export joins the address where a stored address of the org hashes to the key, else null.
- **D15** Both tables join the legal data catalog (subject `others`); the privacy text change waits for the next legal batch (Q2).

## Facts checked (planner, 2026-11-18, at db85425a; files read)

- No `sender_profiles` table or writer exists (grep).
- `SenderHistory`, `relationOf` in `packages/core/src/triage/sender-history.ts` hold the E11 shape; sim cases carry `sim.senderHistory`; `eval-extras.ts` passes 3 fields only.
- Production prompt `classifier-v2`; E3b `history` lost on dev (K 27 vs 23); owner decision 42 open (`notes/2026-11-15-e3b-improve-results.md`).
- `dsrAddressHash`: HKDF of `CREDENTIALS_KEY`; no per-org secret.
- `addSenderRule(db | trx, …)` returns `added`, `exists`, `limit`, `mailbox_not_found`.
- `open_loops.due_source` CHECK `('stated','default')`; `analyze-write.ts` calls `defaultDue`.
- Retention clears addresses on `emails`, `sent_emails` after 90 days; `loops` is layer 3.

## Not verified

- The aggregate pass time on a 30k-mail mailbox: stage 03 measures it with a seeded test and a time limit.
- Profile line value on the sim: stage 11 dev runs.

## Done when

1. The job writes one row per contact of 90 days; no plain address in any column (stage 03).
2. Retention, DSR, export, org and mailbox delete cover both tables (stage 04).
3. At most 3 new suggestions a week with reasons; Accept creates the rule; Dismiss hides 90 days (05–07).
4. Sender line (08), contact wait (09), known domains (10) work behind their flags.
5. The `classifier-v4[profile]` dev summary (and holdout report on a win) is committed (11).
6. `sender-context.md` exists; ADR 0034 accepted with amendments (12).

## Rules for every stage

- A gap or a deviation from a decision is a question in the final message, not a choice.
- Format only the stage's files. Never `bun run format` repo-wide.
- No address, hash, subject or count of one sender in a log line or an audit field; audit holds kind, scope, ids.
- Every query filters `org_id`; new tables get the `tenant_rows` policy.
- Test fixtures: stage 03 adds `seedSenderActivity` in `apps/server/test/integration/fixtures.ts`; later stages reuse it.
- Fixed clock in tests: `now = 2026-11-18T10:00:00Z`, zone `Europe/Warsaw`.

## Proof

```
mkdir -p /tmp/f120-sNN && bun run lint > /tmp/f120-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f120-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f120-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f120-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages (07, 08, 09) add before `echo PROOF_OK` the web tail of F102 `plan.md` § Proof (`web:build`, CSP check, `test:e2e` under `flock`, own e2e DB `f120_sNN_e2e`).

## Owner checkpoints and steps

- Checkpoint after stage 04: a review job checks 02–04; the coordinator goes on unless it finds a BLOCKING item.
- Owner steps: Q4 (ship `classifier-v4`, only if stage 11 wins), stage 13 flags on the pilot, Q2 privacy text. Defaults in questions.md.

## Review

Opus review before the land: 02, 03, 04, 05, 11, 13 (migration, data delete, privacy, LLM spend, VPS). Sonnet: 06–10, 12. Polish texts in 07–09: Opus.

## Stages

| # | Stage | Mark |
| --- | --- | --- |
| 01 | [Core rules and key](stages/stage-01-core-rules.md) | |
| 02 | [Migration and data maps](stages/stage-02-migration.md) | [risky] migration |
| 03 | [Profile pass and job](stages/stage-03-profile-pass.md) | [risky] |
| 04 | [Retention, DSR, export](stages/stage-04-privacy.md) | [risky] |
| 05 | [Suggestion engine and commands](stages/stage-05-suggestions.md) | [risky] |
| 06 | [Suggestion routes and weekly line](stages/stage-06-suggestion-routes.md) | |
| 07 | [Rules page card](stages/stage-07-rules-card.md) | |
| 08 | [Sender line](stages/stage-08-sender-line.md) | |
| 09 | [Contact wait](stages/stage-09-contact-wait.md) | |
| 10 | [Known domains](stages/stage-10-known-domains.md) | |
| 11 | [Classifier profile line](stages/stage-11-classifier-profile.md) | [risky] LLM |
| 12 | [Docs](stages/stage-12-docs.md) | |
| 13 | [Pilot deploy](stages/stage-13-pilot.md) | [risky] VPS |

## How to run (coordinator)

- Worker `claude-sonnet-5-5`, `--prepare 'bash scripts/limen-prepare.sh'`; ticket in `active/`; drift check first (`scripts/plan-drift.sh`).
- Order: 01 → 02 → 03 → 04 → 05 → 06 → 07. After 03: 08, 09, 10, 11 may run in parallel with 05–07 (09 changes loops, 10 triage, 11 prompts: no shared files). 12 after all; 13 last, after F104 and F110 are in `done/`.
- Stage 02 is the only migration: never next to another ticket's migration or `bun.lock` change. Drop the job DB after each land.

## Planning progress

Scouts: 4 (all returned). All files written. Word counts: § Cold review.

## Cold review

Not run yet.

## Log

- 2026-11-18 planned at db85425a.
