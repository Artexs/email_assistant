# F115 · Reply drafts: plan

> **Status 2026-11-15 — planned.** Plan base: 17b2a369, refreshed 2026-11-15. 19 stages (03b split in refresh 1); nothing built.

Names: [interfaces.md](interfaces.md). Defaults: [questions.md](questions.md). Sources: epic E06, ADR 0033.

## Input

Owner: "Okay, go with defaults." (PD-070–084). Job: "Owner order: owner steps and checkpoints are not a stop: use plan defaults." "Consent rule: a new kind of mail-derived data in Telegram needs a consent bump." F109 review-4 N3: "the F115 plan … must also require a `triage_results` row, or use a three-state return."

### Product decisions (do not reopen)

- **P1** PD-071 to PD-083 as written in `docs/product/stage-2/decisions.md`; ADR 0033 §1–7. G1 may change PD-071, PD-072 (model) and PD-083.

### Design decisions

- **D1 Module.** New module `replies`, layer 3, edges `replies → actions`, `replies → triage`. Rejected: inside `triage` (size).
- **D2 Requests.** Table `reply_requests` is the drafter's work list; after drafting, the actions pair is the truth. Rejected: an action status `drafting`.
- **D3 Scan.** The drafter job inserts an `auto` request (unique key) for triaged `needs_reply` mail of the last 7 days. Rejected: a write in `saveTriage` (module cycle).
- **D4 Eligibility** is one pure core function. It needs a `triage_results` and an `email_headers` row, else `not_checked` (N3). Suspicion is three-state; any reason blocks every trigger, whatever the `suspicious_mail` flag. Tap skips category, language, age and the 80% share.
- **D5 Cap.** At ≥ 80% of `LLM_DAILY_CAP` (today's `llm.call` rows of the mailbox, all roles) an auto request waits for the next quota day; a tap at 100% ends `failed` / `llm_cap`. Drafter calls write `llm.call` (role `drafter`, endpoint).
- **D6 Crash.** The LLM call runs outside a transaction; one transaction writes the pair (keys `<request id>:create_draft`, `:send`) and ends the request. A crash repeats the call, never the draft.
- **D7 Thread.** The write takes an advisory lock on `(mailbox_id, thread_key)`. A newer mail in the thread (by `received_at`; not an automatic one: `Auto-Submitted` set and not `no`) closes the older open reply as `newer_mail`; a request older than an open reply ends `superseded`. Rejected: send reason `superseded` (F102 versions).
- **D8 Versions.** Redraft, Reply all and Use Reply-To make a new version through F102's supersede path (`replaceApproval`). A version with `[[` is not approvable (`has_gaps`): approve and committer check.
- **D9 Copy hash.** After APPEND, the committer reads the copy once and stores `copy_hash` (`interfaces.md`: text, Subject, To, Cc, attachments; text null = changed). Before SMTP: same → send; other → `draft_changed`; missing → `draft_missing` (`sent_by_user` if answered). A reverse row deletes only a matching copy. No `copy_hash`: today's path. Replies always check; other kinds behind org flag `draft_copy_check` (stage 18 turns it on after N1). Rejected: a hash of our own message (servers re-encode).
- **D10 Answered** = `email_flags.answered` or a `listUserAnswers` hit. Before a reply send the committer runs `syncSentHeaders` on its connection and one `fetchFlagsIn` for the original. Sent sync off: only `\Answered`, and the card says so.
- **D11 Lifetime.** A reply send expires 7 days after `created_at`; no `not_notified` or `not_seen`. A sweep (5 min) closes open replies: `answered`, `newer_mail`, `original_moved` (`emails.folder` ≠ payload `folder`), `suspicious`. Held replies keep 48 h.
- **D12 Gates.** Org flag `reply_drafts`; switch `tool_switches.reply_drafts` (default off). A request needs `assist`, the switch and the flag; the pair is `ready` / `awaiting_approval`. Flag off: no drafts or notices, approve answers `feature_off`, the committer holds reply sends. Switch off or shadow: open replies close `policy_changed`.
- **D13 Profile.** Table `mailbox_profiles` (display name, signature, writing style); the migration copies `organizations.style_text` into each signature; the org card becomes read-only. Fallbacks: signature → `style_text` → owner name; name → owner name → address. All kinds.
- **D14 Recipients.** `to` = stored `From`. Reply all adds stored To and Cc minus own mailboxes and `to`, at most 10, else `too_many_recipients`. Use Reply-To swaps `to`. Sends cover `to ∪ cc` (F3).
- **D15 Telegram.** Review cards are outbox kind `approval` (F102 card sync); the approval detector skips `reply`. A card with gaps has no Send. Redraft text = a Telegram reply to the card or prompt. Reply taps: owners only. Full text until E9b.
- **D16 Consent.** Stage 12 bumps `TELEGRAM_CONSENT_VERSION` and the texts (AI-written replies and other recipients' addresses are new). A user with an older consent gets counts and a panel link only, and can re-consent in the panel.
- **D17 Logs.** F103 event lines (`reply_drafted`, `reply_draft_failed`, `reply_closed`, `reply_superseded`, `reply_send_checked`): ids, codes, counts.
- **D18 Privacy.** New text columns and payload `cc` enter the F106 maps in the stage that adds them; retention clears instruction and sample text.
- **D19 Mailbox kind** (default). Password IMAP mailboxes only until E9 (F117); others get `oauth_mailbox` (stages 10, 11, 16). Rejected: no guard.

## Facts checked (F3, F5, F7–F10 at 17b2a369)

- **F1** `planActions` gives `[]` for `needs_reply`; `suspiciousReasonsOf` answers "absent" for untriaged and clean mail.
- **F2** `listUserAnswers` reads direct replies only; `syncSentHeaders` takes a read-only provider and needs `sent_sync` and the switch.
- **F3** `fetchContent` gives `text` and the attachment capture; `fetchMetaIn` gives To, Cc, Subject. The envelope, limits and `self` filter cover `to ∪ cc` for every kind (`sendRecipients`, F116 stage 10); the send schema allows Cc only for `follow_up`.
- **F4** `recordLlmCall` writes `endpoint` (8d230f2d). Role `drafter` exists. Judge rubric `reply` exists; `judgeCaseDraft` always grades `delegation`.
- **F5** `emails` has `to_addresses`, `cc_addresses`, `folder`, `thread_key`; thread index `emails_thread_received_idx` (F116). `status_reason` is free text.
- **F6** The consent text names drafts, not other recipients.
- **F7** A `follow_up` (F116) send has `loop_id`, no `email_id`.
- **F8** Log fields are an allow-list (`platform/log-fields.ts`); `request_id` is the HTTP context.
- **F9** Deploy = `deploy/release.sh`; one-offs in the `cli` service; CI runs `db:check-migrations`.
- **F10** Consent version `2026-11-15`; the link route checks equality.

## Not verified

- **N1** Interia keeps the copy stable (probe P1 after stage 08), threads an APPENDed reply and sets `\Answered` (stage 18). D9 fails safe.
- **N2** `gpt-6-luna` meets PD-083 (stage 02).

## Done when

Ticket § Acceptance; G1 decided; a test per close rule of D7, D11, D12; zero axe violations; docs and ADR 0033 "accepted".

## Rules for every stage

- Read `docs/code-patterns.md`, this file, `interfaces.md` and your stage.
- No mail or draft text, instruction, subject or address in a log, error, audit row or test name.
- New texts in `packages/core/src/texts/` or `apps/web/src/i18n/` (en, pl) with a Polish unit test.
- New log lines: event form only (D17); new field names in the same stage (F8); a reply request id is `reply_request_id`.
- A new `/api` route gets `apiDoc` in the same commit.
- A gap or deviation is a question, not a choice.

## Proof

```
mkdir -p /tmp/f115-sNN && bun run lint > /tmp/f115-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f115-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f115-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f115-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages 11 and 15 extend it (their stage files).

## Gate, checkpoints, owner steps

- **G1** after 02: PD-071, PD-072 model, PD-083 from the report (owner, or the coordinator on the defaults with an owner-decisions entry).
- **P1** after 08 (coordinator, test mailbox, no SMTP): `bun run reply:check-copy` on a test draft, again after 1 h; the hashes match.
- **C1** after 09, **C2** after 15: a review of the stages since the last stop; not a stop.
- **O1** stage 18: three real replies from drafts, one sent from the mail client.

## Review

`claude-opus-5-5` before land: 01, 02, 03, 07, 08, 09, 12, 13, 18 (risk); 11, 15 (Polish). Else `claude-sonnet-5-5`.

## Stages

- 01 [Drafter core](stages/stage-01-drafter-core.md) `[risky]`
- 02 [Prototype on the holdout](stages/stage-02-prototype-run.md) `[risky]`; G1 after
- 03 [Migration, notice kinds, privacy maps](stages/stage-03-migration.md) `[risky]`
- 03b [Repositories, retention, flag, switch](stages/stage-03b-repos-retention-flags.md); needs 03
- 04 [Reply kind and message](stages/stage-04-reply-kind.md); needs 03b
- 05 [Lifetime and approval rules](stages/stage-05-lifetime.md); needs 04
- 06 [Eligibility facts](stages/stage-06-eligibility.md); needs 03b
- 07 [Drafter job](stages/stage-07-drafter-job.md) `[risky]`; needs 01, 05, 06
- 08 [Copy hash for every kind](stages/stage-08-copy-hash.md) `[risky]`; needs 05; probe P1 after
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
- Parallel after 03b: {04→05→08}, {06}; else by "needs". Land check; drop the job DB.
- F116 stages 11–25 touch `actions/`, `channels/`: merge `master` first.

## Planning progress

- Scouts: 4 (`scouts.md`). [written] all files, review fixes.
- Refresh 1: [plan-refresh-1.md](plan-refresh-1.md); no scouts. [plan-review-2.md](plan-review-2.md): FAIL, all fixed. Words: plan 1500; stages ≤ 700 (03 694, 03b 330).

## Cold review

Opus (`[risky]` stages). [plan-review-1.md](plan-review-1.md): FAIL; fixed except N1 (rejected) and N10.

