# F120 · E11a Sender context: plan

> **Status 2026-11-18 — planned.** Plan base: db85425a. 13 stages; none built. Build after F100 (done), F104 and F110 (last stages left).

Names: [interfaces.md](interfaces.md). Defaults and owner steps: [questions.md](questions.md). Scouts: [scouts.md](scouts.md). Sources: epic E11 page § Discovery, `E11-discovery-notes.md` §2, ADR 0034 (proposed).

## Input

Owner, 2026-11-13 (PD-104–PD-114): "Okay, go with defaults." The binding rows: PD-105 (no contacts page; a Suggestions card on the Rules page; one sender line in activity and approvals), PD-106 (counts and dates only, no text, no LLM; relation class by code; keyed hash; deleted 12 months after the last mail; DSR, export, delete), PD-107 (profile in the prompt only if it beats the hint on the holdout), PD-108 (VIP, whitelist, blocklist suggestions with a reason; Accept or Dismiss for 90 days; at most 3 new a week; never automatic; no delegate suggestions), PD-109 (per-contact wait 1.5 × median, 1–7 working days, ≥ 5 replies).

- **P1** Three flags, default off, epic `E11a`, remove-by 2027-06-01: `sender_context` (profile job, sender line, known domains), `sender_suggestions`, `contact_wait`. The last two do nothing without profiles. Rejected: one flag (no staged roll-out of the user-visible parts).
- **P2** Sender line only in the panel (Activity, Approvals). Telegram cards do not change (default, owner to confirm, Q1). Reason: the Telegram detail level of ADR 0032 is not built; strict outbox views make a rollback harder.
- **P3** Suggestions: owner taps Accept or Dismiss; a member sees the card read-only. Accept calls `addSenderRule` with the mailbox as scope.
- **P4** Weekly report line: one count line and a fixed link to `/rules`, no address. No consent change (counts and fixed words, as F110 D15).
- **P5** Per-contact wait wins over `loop_wait_days` when the contact has ≥ 5 reply samples (PD-109 "else E5's default").
- **D1** Storage is a derived snapshot, not counters. A job recomputes all profile rows of a mailbox from the source tables of the last 90 days in one pass. Reason: a rolling 90-day window cannot be kept by increments; a recompute is idempotent, survives a crash and a double run, and needs no hook in triage, flag refresh or Sent sync. Rejected: increments in each writer (drift, double counts on retry, 4 hook points).
- **D2** Only address rows are stored. Domain aggregates are computed in memory for suggestions. Reason: no reader needs stored domain rows (the look-alike rule needs plain domains, D9); fewer rows of personal data. This amends ADR 0034 point 1 (stage 12 writes the amendment).
- **D3** Key: `senderKeyHash(credentialsKey, orgId, address)` = HMAC-SHA256 hex, key HKDF-SHA256 of `CREDENTIALS_KEY` (empty salt, info `ea/sender-profile/v1`), message `<orgId>:<normalized address>`. Reason: no new secret (as `dsrAddressHash`); the org id stops linking one person across organizations. A key change orphans rows: the next pass writes new rows, old rows age out (D6).
- **D4** Window and sources: mail of the last 90 days with `received_at` in the window; real mail only (test mail never counts); own addresses never get a row. Profile keys = senders of incoming mail ∪ To and Cc of `origin = user` Sent mail. History-check mail (`status = skipped`) counts. Column meanings: interfaces.md § Profile row.
- **D5** Reply delays: user delay = Sent `sent_at` − incoming `received_at` where Sent `parent_message_id` = incoming `message_id_header`; their delay = incoming `received_at` − Sent `sent_at` where incoming `in_reply_to` = Sent `message_id`. Median only with ≥ 5 samples, else null.
- **D6** A row absent from the window keeps only `first_seen_at` and `last_seen_at`; the pass sets its counts to 0. Retention deletes a row whose `last_seen_at` is older than 365 days.
- **D7** Module `contacts`, layer 3. Edges: `contacts → triage`, `contacts → delegation`, `loops → contacts`. Triage gets the profile reader as a parameter from `composition.ts` (triage must not import contacts: cycle). Reports (activity), channels (approvals, weekly report) and privacy import contacts from higher layers.
- **D8** Two runs at once: a transaction-level advisory lock per mailbox; the second run skips the mailbox. A crash before commit leaves the old snapshot.
- **D9** Known domains for `lookalike_domain`: add registrable domains of To and Cc of `origin = user` Sent mail of 90 days, minus `freeMailDomains`, read live from `sent_emails` (plain text is needed for the look-alike compare; a hash cannot be compared). Behind `sender_context`.
- **D10** Suggestion rules: discovery notes §2.6 with these additions. VIP and whitelist never for a sender with a suspicious reason on any mail in 90 days. Whitelist and blocklist both true: neither. Domain suggestions only whitelist and blocklist, non-free-mail domain, ≥ 2 distinct senders meet the rule. Order under the cap: whitelist, VIP, blocklist; then the larger count; then the hash. Cap: rows created in the last 7 days per mailbox, any status, at most 3.
- **D11** Suggestion life: `open` → `accepted`, `dismissed`, `withdrawn` (rule no longer holds, or the rule exists), `expired` (30 days). Pattern cleared at every end state. Dismissed blocks the same key and kind for 90 days. End-state rows are deleted 90 days after the end.
- **D12** Wait = clamp(ceil(1.5 × median their-reply hours / 24), 1, 7) working days, used only at loop open for `waiting` and `delegated` loops without a stated date. `due_source = 'contact'`, `usual_reply_days` = max(1, round(median hours / 24)). The restart and Later rules keep their 3 days.
- **D13** Classifier: a new prompt version `classifier-v4` = v3 plus the part `profile` (the full `SenderHistory` line; it replaces `history` when both are chosen). The production pointer does not change in F120; a ship is an owner decision (Q4). Spend cap $1.50 for the stage.
- **D14** DSR: erase deletes the profile rows and suggestions of the hashed address in every mailbox of the organization; find counts them. Export gives each row with the address when a hash of an address in `emails`, `sent_emails`, `sender_rules` or `delegates` of the org matches, else null.
- **D15** Data category: profiles and suggestions join the legal data catalog as subject `others`. The privacy page text change is batched with the next legal change (as F110), default, owner to confirm (Q2).

## Facts checked (planner, 2026-11-18, at db85425a)

- No `sender_profiles` table or writer exists (scout 1; checked by grep).
- `SenderHistory`, `senderHistorySchema`, `relationOf` exist in `packages/core/src/triage/sender-history.ts` with the full E11 shape; the sim bank cases carry it (`sim.senderHistory`); `eval-extras.ts` passes only `days`, `received`, `corrections` (scout 4; file read).
- Production prompt is `classifier-v2`; the E3b `history` part lost on dev (K 27 vs 23); owner decision 42 (v3[list]) is open (`notes/2026-11-15-e3b-improve-results.md`).
- `dsrAddressHash` uses HKDF of `CREDENTIALS_KEY`; no per-org secret (read `platform/crypto.ts`).
- `addSenderRule(db | trx, ctx, { mailboxId, pattern, kind, actor, now })` returns `added`, `exists`, `limit`, `mailbox_not_found` (read).
- `open_loops.due_source` CHECK is `('stated','default')`; `analyze-write.ts` calls `defaultDue(sentAt, env.waitDays, tz)` (read).
- Retention clears `emails` and `sent_emails` addresses after 90 days (scout 2; `retention.ts` read).
- Layers: `loops` is layer 3 (`layers.json` read).

## Not verified

- The aggregate pass time on a 30k-mail mailbox: stage 03 measures it with a seeded test and a time limit.
- Whether the sim week cases render the profile line well: stage 11 dev runs.

## Done when

1. With `sender_context` on, the job writes one row per sender and recipient of 90 days, no plain address in any column (stage 03 scan test).
2. Retention, DSR find and erase, export, org and mailbox delete cover both tables (stage 04 tests).
3. With `sender_suggestions` on, the Rules card shows at most 3 new suggestions a week with reasons; Accept creates the rule; Dismiss hides it 90 days (stages 05–07).
4. Activity and Approvals show the sender line (stage 08); loops use the contact wait (stage 09); known domains grow (stage 10).
5. A dev and, if won, holdout report for `classifier-v4[profile]` is committed (stage 11).
6. Capability page `sender-context.md`, ADR 0034 accepted with amendments (stage 12).

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

- Checkpoint after stage 04 (schema, job, privacy): a review job checks 02–04; the coordinator goes on without the owner unless it finds a BLOCKING item.
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

Scouts: 4 (all returned). Files written: see `git log`. Word counts: § Cold review.

## Cold review

Not run yet.

## Log

- 2026-11-18 planned at db85425a.
