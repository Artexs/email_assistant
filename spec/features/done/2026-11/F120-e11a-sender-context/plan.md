# F120 · E11a Sender context: plan

> **Status 2026-11-18 — planned.** Plan base: db85425a. 14 stages (01–03, 03b, 04–13); none built. Build after F100 (done), F104 and F110 (last stages left).

Names: [interfaces.md](interfaces.md). Defaults: [questions.md](questions.md). Scouts: [scouts.md](scouts.md). Sources: `E11-discovery-notes.md` §2, ADR 0034.

## Input

Owner, 2026-11-13 (PD-104–PD-114): "Okay, go with defaults." Binding: PD-105 (no page; Suggestions card; sender line), PD-106 (counts only, keyed hash, 12 months, DSR), PD-107 (prompt only on a holdout win), PD-108 (suggestions), PD-109 (contact wait).

- **P1** Flags, default off, epic `E11a`, remove-by 2027-06-01: `sender_context` (job, sender line), `sender_suggestions`, `contact_wait`. The last two count as off unless `sender_context` is on. Rejected: one flag (no staged roll-out).
- **P2** Sender line only in the panel; Telegram unchanged (Q1). Reason: ADR 0032 detail level not built; strict outbox views.
- **P3** Owner taps Accept or Dismiss; a member sees the card read-only. Accept calls `addSenderRule` for the mailbox.
- **P4** Weekly report: one count line, fixed link to `/rules`.
- **P5** The contact wait wins over `loop_wait_days`.
- **D1** Storage is a derived snapshot. A job recomputes all rows of a mailbox from the source tables of 90 days in one pass. Reason: increments cannot keep a rolling window; a recompute is idempotent and crash-safe. Rejected: increments in each writer (drift, double counts).
- **D2** Only address rows are stored; domain aggregates live in memory for suggestions. Reason: no reader needs them; less personal data. Amends ADR 0034 point 1.
- **D3** Key `senderKeyHash`: HMAC-SHA256, key from `CREDENTIALS_KEY` by HKDF, org id in the message. Reason: no new secret; no link across organizations. A key change orphans rows until retention.
- **D4** Window 90 days by `received_at`; real mail only; own addresses get no row. Keys = senders of incoming mail ∪ To and Cc of `origin = user` Sent mail. History-check mail counts.
- **D5** Reply delays: user delay where Sent `parent_message_id` = incoming `message_id_header`; their delay where the Sent `message_id` is one of the ids in incoming `in_reply_to` (whole-id compare, as `replyMatch`). Delays ≤ 0 are dropped. Median only with ≥ 5 samples.
- **D6** A row absent from the window keeps its dates; the pass sets its counts to 0. Retention deletes rows with `last_seen_at` older than 365 days.
- **D7** Module `contacts`, layer 3; edges `contacts → triage`, `contacts → delegation`, `loops → contacts`. Triage gets the profile reader as a parameter from `composition.ts`.
- **D8** One per-mailbox advisory lock (transaction level). The pass takes it with try (busy → skip) and reads after it; the DSR erase takes it blocking for each mailbox before it deletes. So a pass never writes back an erased row.
- **D9** Known domains for `lookalike_domain`: registrable domains of To and Cc of `origin = user` Sent mail of 90 days with ≥ 2 user mails, minus `freeMailDomains`, minus any domain with a suspicious incoming mail in 90 days. Active only when `sender_context` and `suspicious_mail` are both on (suspicious reasons block drafts even with the flag off).
- **D10** Suggestion rules: discovery notes §2.6, plus: VIP and whitelist never with a suspicious mail; no whitelist for a blocklisted sender; whitelist and blocklist both true → neither; blocklist only with Sent coverage (D16). Domain suggestions: only whitelist and blocklist, non-free-mail, not an own mailbox domain, ≥ 2 senders meet the rule, and no address of the domain is protected (blocklist: known, delegate, VIP, whitelisted, answered or written to; whitelist: suspicious mail, blocklisted). Cap 3 rows created per mailbox in 7 days; order whitelist, VIP, blocklist.
- **D11** Suggestion life: `open` → `accepted`, `dismissed`, `withdrawn`, `expired` (30 days). Withdraw only when a covering rule exists, a "never" condition turns true, or a domain row replaces it; a drop of a ratio does not withdraw. Pattern cleared at every end. Dismiss hides the key and kind 90 days; ended rows are deleted 90 days after the end.
- **D12** Wait = clamp(ceil(1.5 × median their-reply hours / 24), 1, 7) working days, at loop open only (`waiting`, `delegated`, no stated date), for the loop's stored counterpart. `due_source = 'contact'`; `usual_reply_days` = clamp(round(h / 24), 1, 60). Restart and Later keep 3 days.
- **D13** Classifier: `classifier-v4` = v3 plus part `profile` (replaces `history`). Baseline is the production prompt (v2) and v3[list], not the E3b hint: the hint already lost to v2, so a win over v2 is stricter than PD-107. Pointer unchanged; ship is Q4. Spend cap $1.50.
- **D14** DSR: erase deletes the person's profile rows and address suggestions in every mailbox of the org; find counts them. Export joins the address where a stored address of the org hashes to the key.
- **D15** Both tables join the legal data catalog (subject `others`); privacy text waits for the next legal batch (Q2).
- **D16** Sent coverage = flag `sent_sync` on, the mailbox switch on and `first_pass_at` set. Without it: no blocklist suggestion; `relation` and wait come out without Sent facts.
- **D17** Bulk ratio counts only mail whose captured headers are not cleared (`texts_cleared_at IS NULL`); noreply counts on all mail.

## Facts checked (planner, 2026-11-18, files read)

- No `sender_profiles` exists. `SenderHistory`, `relationOf` (`packages/core/src/triage/sender-history.ts`) hold the E11 shape; sim cases carry it; `eval-extras.ts` passes 3 fields.
- Production prompt `classifier-v2`; E3b `history` lost on dev; owner decision 42 open.
- `dsrAddressHash`: HKDF of `CREDENTIALS_KEY`. `addSenderRule(db | trx, …)` → `added`, `exists`, `limit`, `mailbox_not_found`.
- `open_loops.due_source` is `('stated','default')` in the CHECK, `loops/repo.ts` and `core/web/loops.ts` (strict enums).
- Captured list headers clear after `data_retention_days` (30 by default); addresses after 90 days. Activity `mailboxId` is optional.

## Not verified

- Profile line value: stage 11 dev runs.
- Effect of D9 on the sim phishing rates (the sim has no Sent history).

## Done when

1. One row per contact of 90 days; no plain address in any column (03).
2. Retention, DSR, export, deletes cover both tables (04).
3. At most 3 new suggestions a week with reasons; Accept creates the rule; Dismiss hides 90 days (05–07).
4. Sender line (08), contact wait (09), known domains (10) behind their flags.
5. `classifier-v4[profile]` dev summary committed (11).
6. `sender-context.md`; ADR 0034 accepted with amendments (12).

## Rules for every stage

- A gap or a deviation from a decision is a question in the final message, not a choice.
- Format only the stage's files.
- No address, hash, subject or per-sender count in a log line or an audit field. Exception: the DSR audit rows keep `address_hash` and counts (account-data rule 13).
- Every query filters `org_id`; new tables get the `tenant_rows` policy.
- Fixture `seedSenderActivity` (stage 03) in `apps/server/test/integration/fixtures.ts`.
- Fixed clock: `now = 2026-11-18T10:00:00Z`, zone `Europe/Warsaw`.

## Proof

```
mkdir -p /tmp/f120-sNN && bun run lint > /tmp/f120-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f120-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f120-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f120-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages (07, 08, 09) add the web tail of F102 `plan.md` § Proof before `echo PROOF_OK` (own e2e DB `f120_sNN_e2e`).

## Owner checkpoints and steps

- After 04: a review job checks 02–04; go on unless BLOCKING.
- Owner steps: Q4, stage 13 flags, Q2. Defaults in questions.md.

## Review

Opus before the land: 02, 03, 03b, 04, 05, 10, 11, 13; and 07–09 for the Polish texts. Sonnet: 06, 12.

## Stages

| # | Stage | Mark |
| --- | --- | --- |
| 01 | [Core rules and key](stages/stage-01-core-rules.md) | |
| 02 | [Migration and data maps](stages/stage-02-migration.md) | [risky] migration |
| 03 | [Profile read and write](stages/stage-03-profile-pass.md) | [risky] |
| 03b | [Profile job, lock, flags](stages/stage-03b-profile-job.md) | [risky] |
| 04 | [Retention, DSR, export](stages/stage-04-privacy.md) | [risky] |
| 05 | [Suggestion engine and commands](stages/stage-05-suggestions.md) | [risky] |
| 06 | [Suggestion routes and weekly line](stages/stage-06-suggestion-routes.md) | |
| 07 | [Rules page card](stages/stage-07-rules-card.md) | |
| 08 | [Sender line](stages/stage-08-sender-line.md) | |
| 09 | [Contact wait](stages/stage-09-contact-wait.md) | |
| 10 | [Known domains](stages/stage-10-known-domains.md) | [risky] |
| 11 | [Classifier profile line](stages/stage-11-classifier-profile.md) | [risky] LLM |
| 12 | [Docs](stages/stage-12-docs.md) | |
| 13 | [Pilot deploy](stages/stage-13-pilot.md) | [risky] VPS |

## How to run (coordinator)

- Worker `claude-sonnet-5-5`, `--prepare 'bash scripts/limen-prepare.sh'`; ticket in `active/`; drift check first.
- Order: 01 → 02 → 03 → 03b → 04 → 05 → 06 → 07. After 03b: 08, 09, 10, 11 may run next to 05–07 (no shared files). 12 after all; 13 last, after F104 and F110 are in `done/`.
- Stage 02 is the only migration: never next to another migration or `bun.lock` change. Drop the job DB after each land.

## Planning progress

Scouts: 4. All files written. Words: plan.md ≤ 1,500, each stage ≤ 700 (`wc -w`, 2026-11-18).

## Cold review

Model `claude-opus-5-5` (risky stages: migration, privacy, LLM). Review 1 ([plan-review-1.md](plan-review-1.md)): FAIL, 1 BLOCKING, 10 MAJOR, 12 NOTE. All 23 findings accepted; the fix of each: [plan-review-1-fixes.md](plan-review-1-fixes.md).

## Log

- 2026-11-18 planned at db85425a; review 1 fixed.

- 2026-11-19 stage 13 (coordinator): F120 code shipped in v0.4.1 (`release ok v0.4.1 previous v0.3.1`, run by the release job). `sender_context` on for the pilot org; `contacts.refresh` ran once: mailboxes 1, written 91, mailbox errors 0, no `contacts_refresh_mailbox_failed`. Checks: `/health` 200, `EA_RELEASE=v0.4.1`; `sender_profiles` keys not 64-hex: 0; server error lines in 30 min: 0; `ops:alerts`: no open alert. Rollback target v0.3.1 (flags off first, then the stage 13 Rollback steps). Open: check 5 (`contact_wait` on after one day, 2026-11-20 20:00 UTC or later; then a `due_source = 'contact'` loop within 7 days, or "no contact with 5 samples yet"); `sender_suggestions` stays off until the owner turns it on (Q3).
- 2026-11-19 check 5 (closed early by owner decision): `contact_wait` on for the pilot org about 1 h after `contacts.refresh`, not after one day. No loop with `due_source = 'contact'` yet: "no contact with 5 samples yet" is not measured either. `sender_suggestions` stays off (Q3, owner step).
