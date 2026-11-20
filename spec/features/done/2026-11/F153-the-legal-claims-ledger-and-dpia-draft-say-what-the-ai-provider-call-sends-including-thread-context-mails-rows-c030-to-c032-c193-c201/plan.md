# F153 plan — the papers say what the AI provider call sends

> **Status 2026-11-20 — planned.** Plan base: 535e6f76. Three stages.

## Input

Ticket words (2026-11-20, review of F121 stage 02, the security page):

> Ledger row C032 says the assistant does not send mail older than 7 days to the AI provider. This is false: the call also sends up to three earlier mails of the same thread as context (sender, subject, up to 500 characters of body), with no age limit (`listThreadContext` in `apps/server/src/modules/mail/repo/lookup.ts`). Rows C031, C193 and C201 (the DPIA draft) carry the same wording.

The ticket's first "Done when" (3 lines, `git show 535e6f76:` the ticket) became Acceptance lines 1, 4 and 5.

Owner decision 2026-11-18 (`docs/owner-decisions.md`, "F110 history check …"): "The sentence in `apps/web/src/legal/en/privacy.md` (and the Polish text) must say that, with the trust ladder on, the history check sends a capped sample of the last 30 days of mail (about 500 mails at most, $0.25 cap) to the model once at connect and again after a model change. The fix is a legal text change and needs a `TERMS_VERSION` bump."

### Decisions

- **P1 Fix the papers, not only the ledger.** A row quotes a paper: C031, C032 the privacy policy, C136, C139 the registry, C193, C201 the DPIA. Paper and row change together. Rejected: mark C032 `gap` (that means the code breaks the text; here the text is wrong).
- **P2 No code change.** Rejected: an age limit on context mails (an unasked classifier change; eval gate).
- **P3 The privacy change gets a new legal version (default, owner to confirm).** One `TERMS_HISTORY` entry; members accept again at the next sign-in. `legal-version.test.ts` forces it. Rejected: a silent edit.
- **P4 The history-check sentence goes in now** (owner decision 2026-11-18), as an optional feature, off by default, with no flag key. Rejected: a later ticket and a second re-acceptance.
- **P5 What the classifier call sends** (`classifier-v2`, `triage/classify-input.ts`). The classified mail: sender, To and Cc addresses, subject, date, text (up to 8,000 characters); the sender marks (whitelist, VIP, looks automatic); the delegates. Up to three earlier mails of the thread: sender, subject, date, up to 500 characters of body each, no age limit. The 7-day rule is for the classified mail, with two exceptions: the one-off backfill and the history check (P4).
- **P6 Two new ledger rows, appended** in "Rows added by later changes" (if another branch took C261, C262 first, use the next free ids everywhere):
  - C261 — context mails: "Each context mail carries its sender, subject, date and up to 500 characters of its body; context mails have no age limit." Source: `apps/server/src/modules/mail/repo/lookup.ts` (`listThreadContext`), `docs/capabilities/triage.md` rule 3. Condition `—`. Papers: privacy policy, DPIA. No other row cites `lookup.ts`.
  - C262 — history check: "With the trust ladder on, a history check classifies up to 500 INBOX mails of the last 30 days, when the feature is turned on, at connect, on request and after a change of the model; it stops at $0.25." Source: `docs/capabilities/trust.md` rules 7 and 8, `apps/server/src/modules/trust/history-classify.ts`. Condition: `flag trust_ladder (off by default)`. The triggers are the `history_checks.reason` values (`flag_on`, `connect`, `cli`/`web`, `model_switch`); a new value at `HEAD` is a question.
- **D1 One shared check.** `sevenDayLimitProblems(texts: readonly string[]): string[]` in `packages/core/src/legal/seven-day.ts`, exported through `@ea/core`. It returns each text that names the 7-day limit (`older than 7 days`, `up to 7 days old`, `7-day limit`, `starszej niż 7 dni`, `starszych niż 7 dni`, `starsze niż 7 dni`, `limit 7 dni`) and does not name both the context (`context`, `kontekst`) and the classified mail (`classif`, `klasyfik`). It replaces the local copy in `claims.test.ts`.
- **D2 Where the check runs.** `legal-papers.test.ts` scans each line of `apps/web/src/legal/*/*.md` (stage 01) and `docs/legal/*.md` (stage 02); `claims.test.ts` scans the claims and both security pages (stage 03).
- **D3 Numbers tied to code.** `legal-papers.test.ts` checks rows C261 and C262 against `THREAD_MAILS`, `EXCERPT_CHARS` (production pointer `classifier-v2`), `HISTORY_SAMPLE_SIZE`, `HISTORY_WINDOW_DAYS`, `HISTORY_COST_CAP_USD`, imported through the module index (add the export if missing). A prompt switch then fails it.
- **D4 Internal docs follow (stage 02).** `triage.md` rule 3 and its 7-day line, the "Privacy text" note of `trust.md`, the after-an-outage line of `docs/architecture.md`. ADRs are history and stay.
- **P7 The AI rows of the sub-processor registry change in the same version.** The privacy page and the DPA render `dataReceived` of `openai` and `gemini` next to the new bullet; two lists on one page would conflict. Rejected: a later fix, which needs a second version.
- **P8 Not in this version (default, owner to confirm).** The other items of the 2026-11-18 "same bump batch" (the one-click unsubscribe request line, `members` in `unsubscribe-data`, the report-mail line) and the open-loops extractor call (flag `open_loops`, off) need their own fact checks, and their features are off. The coordinator files one ticket, to land before those flags go on. Rejected: add them here (a twice larger risky stage to save one tap).
- **D5 Public claim.** `ai-provider-receives` cites C030–C032, C261, C262, adds the proofs `lookup.ts` and `trust.md`, and states the context and the optional history check (no flag key). The 7-day "does not promise" bullet goes from both pages.

## Facts checked (2026-11-20, at 535e6f76)

- `listThreadContext`: `left(body_text, 500)`, `limit(3)`, no age filter.
- `classifier-v2` (production): `THREAD_MAILS = 3`, `EXCERPT_CHARS = 500`, `BODY_CHARS = 8000`; the mail block holds From, To, Cc, Subject, Date, body; sender marks and delegates apart.
- History check: `HISTORY_SAMPLE_SIZE = 500`, `HISTORY_COST_CAP_USD = 0.25` (`trust/history-classify.ts`), `HISTORY_WINDOW_DAYS = 30` (`trust/history-queue.ts`); reasons `connect`, `cli`, `web`, `model_switch`, `flag_on` (`trust.md`); flag `trust_ladder` default off.
- `claimProblems` needs every proof path named in a cited row's source, and a claim condition when a cited row has one.
- Registry `dataReceived` of `openai` and `gemini` lists only text, subject, sender for triage; the registries are in `legalTextParts()`.

## Not verified

- Whether another branch takes ids C261/C262 or a `TERMS_HISTORY` version first: stage 01 checks after `git merge master`.

## Done when

The ticket Acceptance (6 lines); each stage's Proof exits 0.

## Rules for every stage

- Plain technical English; the Polish text says the same facts in the style of its page. No new claim without a ledger row.
- Never `bun run format` repo-wide; format only the stage's files.
- A gap or a deviation is a question in the final message, not a choice.

## Proof

`mkdir -p /tmp/f153 && bun run lint > /tmp/f153/lint.log 2>&1 && bun run typecheck > /tmp/f153/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f153/unit.log 2>&1 && bun run docs:build > /tmp/f153/docs.log 2>&1 && grep -q "claim_check ok" /tmp/f153/docs.log && echo PROOF_OK`

No integration test changes: no `test:int:ci`.

## User checkpoints and user steps

- Stage 01 changes the legal version: on the release that carries it, members accept again; name it in the release notes. No owner stop.
- No DB migration, no `bun.lock` change, no deploy.

## Review

Stage 01 `[risky]`: one review job (board reviewer model) before the land. Stages 02 and 03 land on the proof.

## Stages

- [ ] 01 `[risky]` shared check, privacy policy, AI registry rows, legal version, rows C031, C032, C136, C139, C261, C262 — [stage-01](stages/stage-01-privacy-and-shared-check.md)
- [ ] 02 DPIA draft, rows C193, C201, capability and architecture lines, scan of `docs/legal` — [stage-02](stages/stage-02-dpia-and-ledger.md)
- [ ] 03 public claim `ai-provider-receives` — [stage-03](stages/stage-03-public-claim.md)

## How to run (coordinator)

Order: 01, then 02 and 03 in parallel (02: `docs/`, `legal-papers.test.ts`; 03: `apps/docs/`; no shared file). Move the ticket to `active/` and commit first.

```
limen spawn --engine pi --provider claude-bridge --model <board worker model> --thinking <board level> \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F153" \
  'Implement F153 stage NN. Read spec/features/active/F153-…/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof of plan.md. In the final message, list as proven only what a saved log shows.'
```

Drop the job DB after each land.

## Decisions taken

- P3 (user-visible): a new legal version; members accept again. Undo: drop the entry, revert the text.
- P4 (scope): the history-check sentence ships now. Undo: remove it and row C262 (new version).
- P5, P7 (privacy): the papers and the AI registry rows name To and Cc, date and the sender marks. Undo: revert.
- P8 (scope): the other 2026-11-18 batch items and the open-loops call wait for a new ticket. Undo: add them to stage 01.
- P2 (scope): no code change. Undo: a new ticket with an eval gate.

`questions.md` holds the same items with their kinds.

## Planning progress

- Scouts: 1, empty packet (`scouts.md`). Stages 01–03 [written]; plan ≤ 1500 words, stages ≤ 700.

## Cold review

One round, `claude-opus-5-5` (stage 01 `[risky]`), job `2026-11-20-f153-plan-review-667a08d9`: PASS, 5 findings, 5 notes (`plan-review-1.md`). Fixed F1 (triggers), F2 (7-day exceptions), F3 (registry, P7), F4 (P8), F5 (ticket), N1, N2, N4, N5; N3 joins P8.

## Log

- 2026-11-20 plan written at `535e6f76`; cold review fixes applied.
