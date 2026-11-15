# F115 · Reply drafts: plan

> **Status 2026-11-15 — planned.** Plan base: 9341d9f0. 18 stages; nothing built.

Names between stages: [interfaces.md](interfaces.md). Defaults: [questions.md](questions.md). Sources: epic E06, its notes §3, ADR 0033, `docs/capabilities/drafts-and-send.md`, `sent-mail.md`.

## Input

Owner: "Okay, go with defaults." (PD-070–PD-084). Job (2026-11-15): "Owner order: owner steps and checkpoints are not a stop: use plan defaults." "Consent rule: a new kind of mail-derived data in Telegram needs a consent bump." F109 review-4 N3: "the F115 plan … must also require a `triage_results` row, or use a three-state return."

### Product decisions (do not reopen)

- **P1** PD-071 to PD-083 as written in `docs/product/stage-2/decisions.md`; ADR 0033 §1–7. G1 may change PD-071, PD-072 (model) and PD-083.

### Design decisions

- **D1 Module.** New module `replies`, layer 3, same-layer edges `replies → actions` and `replies → triage`. Rejected: inside `triage` (file size).
- **D2 Requests.** Table `reply_requests` is the drafter's work list; after drafting, the actions pair is the truth. Rejected: a `drafting` action status (every action reader changes).
- **D3 Scan.** The drafter job inserts an `auto` request (unique key) for triaged `needs_reply` mail of the last 7 days. Rejected: a write in `saveTriage` (module cycle).
- **D4 Eligibility** is one pure core function over stored facts. It needs a `triage_results` row and an `email_headers` row, else `not_checked` (N3). Suspicion is three-state; any reason blocks, also on tap, whatever the `suspicious_mail` flag (PD-063). Tap skips category, language, age and the 80% share.
- **D5 Cap.** While today's `llm.call` rows of the mailbox (all roles) are ≥ 80% of `LLM_DAILY_CAP`, an auto request waits for the next quota day (no count). A tap at 100% ends `failed` / `llm_cap`, and the user is told. Drafter calls write `llm.call` (role `drafter`, endpoint).
- **D6 Crash.** The LLM call runs outside a transaction; one transaction then writes the pair (keys `<request id>:create_draft`, `:send`) and ends the request. A crash between them repeats the call, never the draft.
- **D7 Thread.** The write takes an advisory lock on `(mailbox_id, thread_key)`. A newer mail in the thread (any category or sender, by `received_at`) closes the older open reply as `newer_mail`; a request older than an open reply ends `superseded`. Rejected: send reason `superseded` (F102 edit versions).
- **D8 Versions.** Redraft, Reply all and Use Reply-To make a new version through F102's supersede path (`replaceApproval`). A version with `[[` is not approvable (`has_gaps`): approve and committer check.
- **D9 Copy hash.** After APPEND or locate, the committer fetches the copy text once and stores `copy_hash` (SHA-256, normalized text) in the draft's `provider_result`. Before SMTP it hashes the copy again: same → send; other → `draft_changed`; missing → `draft_missing`, or `sent_by_user` for an answered reply. A reverse row removes a copy only on a hash match. No `copy_hash` (older drafts): today's path. Rejected: a hash of our own message (the server may re-encode it).
- **D10 Answered** = `email_flags.answered` or a `listUserAnswers` hit. Before a reply send the committer runs `syncSentHeaders` on its connection and one `fetchFlagsIn` for the original. Sent sync off: only `\Answered`, and the card says so.
- **D11 Lifetime.** A reply send expires 7 days after `created_at` (`timeout`); no `not_notified` or `not_seen`. A sweep (every 5 min) closes open replies: `answered`, `newer_mail`, `original_moved` (`emails.folder` ≠ the request's folder). Held approved replies keep 48 h.
- **D12 Gates.** Org flag `reply_drafts`; mailbox switch `tool_switches.reply_drafts` (default off, no migration). A request needs `assist`, the switch and the flag; the pair is `ready` / `awaiting_approval`. Flag off: no new drafts or notices, approve answers `feature_off`, the committer holds reply sends. Switch off or shadow: open reply sends close `policy_changed`.
- **D13 Profile.** Table `mailbox_profiles` (display name, signature, writing style ≤ 1,000); the migration copies `organizations.style_text` into each signature. Fallbacks: signature → org `style_text` → owner name; display name → owner name → address. Every draft kind uses it.
- **D14 Recipients.** `to` = stored `From`. Reply all adds stored To and Cc minus own mailboxes and `to`, at most 10, else `too_many_recipients`. Use Reply-To swaps `to`. Send limits and `SEND_SCOPE self` check each recipient.
- **D15 Telegram.** Review cards are outbox kind `approval`, so F102 card sync works; the approval detector skips kind `reply`. A card with gaps has no Send. The Redraft text is a Telegram reply to the card or to the prompt. Every reply tap is owners only. Full text until E9b.
- **D16 Consent.** Stage 12 bumps `TELEGRAM_CONSENT_VERSION` and the en and pl text in one commit: AI-written replies and other recipients' addresses are new data in Telegram.
- **D17 Logs.** F103 event lines `reply_drafted`, `reply_draft_failed`, `reply_closed`, `reply_superseded`, `reply_send_checked`: ids, codes, counts.
- **D18 Privacy.** New text columns and payload `cc` enter the F106 address and export maps in the stage that adds them; retention clears instruction and sample text with the payloads.

## Facts checked (2026-11-15, 9341d9f0)

- **F1** `planActions` returns `[]` for `needs_reply`. `suspiciousReasonsOf` answers "absent" for untriaged and clean mail.
- **F2** `listUserAnswers` reads direct replies only; `syncSentHeaders(deps, ctx, mailboxId)` takes a read-only provider and needs flag `sent_sync` and the switch.
- **F3** `MailProvider` has `fetchContent → { text }` and `fetchFlagsIn`; `locateByActionId` finds a copy by FETCH.
- **F4** `recordLlmCall` writes `endpoint` (8d230f2d). Role `drafter` exists. Judge rubric `reply` exists; `judgeCaseDraft` always grades `delegation`.
- **F5** `emails` has `to_addresses`, `cc_addresses`, `folder`, `thread_key`, no `(mailbox_id, thread_key)` index. `actions.status_reason` is free text.
- **F6** The consent text names draft texts with the quote, not other recipients.

## Not verified

- **N1** Interia keeps the copy text stable, threads an APPENDed reply and sets `\Answered`: stage 18 (D9 fails safe).
- **N2** `gpt-6-luna` meets PD-083: stage 02.

## Done when

1. The stage 02 report and gate file exist; G1 is decided.
2. A `needs_reply` mail gets one checked `reply` draft with In-Reply-To and the reply quote.
3. Each close rule of D7, D11, D12 has a passing test.
4. No send of any kind leaves with a changed or missing copy.
5. Review, Redraft, Reply all and Draft reply pass their `channels` tests.
6. The panel shows the reply kind; e2e has zero axe violations.
7. Capability pages and architecture updated; ADR 0033 "accepted".
8. Stage 18: three real replies sent from drafts.

## Rules for every stage

- Read `docs/code-patterns.md`, this file, `interfaces.md` and your stage.
- Format only your files. Commit by explicit path after `git diff --staged`.
- No mail or draft text, instruction, subject or address in a log, error, audit row or test name.
- New texts in `packages/core/src/texts/` or `apps/web/src/i18n/` (en, pl) with a Polish unit test.
- New log lines: event form only (D17).
- A new `/api` route gets `apiDoc` in the same commit.
- A gap or deviation is a question in the final message, not a choice.

## Proof

```
mkdir -p /tmp/f115-sNN && bun run lint > /tmp/f115-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f115-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f115-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f115-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages 11 and 15 extend it (their stage files).

## Gate, checkpoints, owner steps

- **G1** after 02: PD-071, PD-072 model, PD-083 from the report (owner, or the coordinator on the defaults with an owner-decisions entry).
- **C1** after 09, **C2** after 15: a review of the stages since the last stop; not a stop.
- **O1** stage 18: three real replies from drafts, one sent from the mail client.
- After stage 03: `bun run db:migrate` on the shared dev DB.

## Review

`claude-opus-5-5` before land: 01, 02, 03, 07, 08, 09, 12, 13, 18 (risk); 11, 15 (Polish). Else `claude-sonnet-5-5`.

## Stages

- 01 [Drafter core](stages/stage-01-drafter-core.md) `[risky]`
- 02 [Prototype on the holdout](stages/stage-02-prototype-run.md) `[risky]`; G1 after
- 03 [Migration and repositories](stages/stage-03-migration.md) `[risky]`
- 04 [Reply kind and message](stages/stage-04-reply-kind.md); needs 03
- 05 [Lifetime and approval rules](stages/stage-05-lifetime.md); needs 04
- 06 [Eligibility facts](stages/stage-06-eligibility.md); needs 03
- 07 [Drafter job](stages/stage-07-drafter-job.md) `[risky]`; needs 01, 05, 06
- 08 [Copy hash for every kind](stages/stage-08-copy-hash.md) `[risky]`; needs 04
- 09 [Answered and sweep](stages/stage-09-answered-sweep.md) `[risky]`; needs 07, 08; C1 after
- 10 [Switch and profile API](stages/stage-10-settings-api.md); needs 07
- 11 [Style card](stages/stage-11-style-card.md); needs 10
- 12 [Replies ready and review](stages/stage-12-telegram-review.md) `[risky]`; needs 09
- 13 [Redraft, Reply all, Draft reply](stages/stage-13-telegram-redraft.md) `[risky]`; needs 12
- 14 [Reply routes](stages/stage-14-reply-routes.md); needs 13
- 15 [Panel reply kind](stages/stage-15-panel-reply.md); needs 14; C2 after
- 16 [Samples and outcome counts](stages/stage-16-samples-outcomes.md); needs 15
- 17 [Docs and ADR](stages/stage-17-docs.md); needs 01–16
- 18 [Pilot](stages/stage-18-pilot.md) `[risky]`; needs 17

## How to run (coordinator)

- Worker `claude-sonnet-5-5`, `--prepare 'bash scripts/limen-prepare.sh'`; ticket in `active/`; drift check first.
- Parallel after 03: {04→05}, {06}, {08 after 04}; else by "needs". `spec/build.md` land check; drop the job DB.
- Advisory: F103 stages 08–09 convert `actions/` logs; merge `master` before each land.

## Planning progress

- Scouts: 4 (first planner job), all done: `scouts.md`.
- [written] ticket, plan, interfaces, questions, stages 01–18. Words: plan 1493; stages 298–697.

## Cold review

Pending.

## Log

- 2026-11-15 written at 9341d9f0.
