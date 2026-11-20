# F153 plan — the papers say what the AI provider call sends

> **Status 2026-11-20 — planned.** Plan base: 535e6f76. Three stages.

## Input

Ticket words (2026-11-20, from the review of the public security page stage, F121 stage 02):

> Ledger row C032 says the assistant does not send mail older than 7 days to the AI provider. This is false: the call also sends up to three earlier mails of the same thread as context (sender, subject, up to 500 characters of body), with no age limit (`listThreadContext` in `apps/server/src/modules/mail/repo/lookup.ts`). Rows C031, C193 and C201 (the DPIA draft) carry the same wording.

> - `docs/legal/claims.md` rows C030–C032, C193 and C201 state the thread context mails and the 7-day rule for the classified mail only.
> - The public security page claim `ai-provider-receives` moves the context sentence from "does not promise" into the claim, with its proof row.
> - `bun run docs:build` prints `claim_check ok`.

Owner decision 2026-11-18 (`docs/owner-decisions.md`, "F110 history check …"): "The sentence in `apps/web/src/legal/en/privacy.md` (and the Polish text) must say that, with the trust ladder on, the history check sends a capped sample of the last 30 days of mail (about 500 mails at most, $0.25 cap) to the model once at connect and again after a model change. The fix is a legal text change and needs a `TERMS_VERSION` bump."

### Decisions

- **P1 Fix the papers, not only the ledger.** A ledger row quotes a paper: C031 and C032 the privacy policy ("AI model"), C193 and C201 the DPIA draft. Paper and row change together. Rejected: mark C032 `gap` — `gap` means the code breaks the text; here the code is the intended design and the text is wrong.
- **P2 No code change.** Context mails keep no age limit. Rejected: an age limit in `listThreadContext` — an unasked classifier change that needs the eval gate.
- **P3 The privacy change gets a new legal version (default, owner to confirm).** `TERMS_HISTORY` gets one entry; every member accepts again at the next sign-in. `legal-version.test.ts` forces it; the 2026-11-18 decision asked for it. Rejected: a silent edit.
- **P4 The history-check sentence goes in now** (owner decision 2026-11-18), as an optional feature, off by default, with no flag key. Rejected: a later ticket and a second re-acceptance.
- **P5 What the classifier call sends (from `classifier-v2`, the production prompt, and `triage/classify-input.ts`).** The classified mail: sender, To and Cc addresses, subject, date and text (up to 8,000 characters); the sender marks from the user's settings (whitelist, VIP, looks automatic); the delegates. Up to three earlier mails of the same thread: sender, subject, date and up to 500 characters of the body each, with no age limit. The 7-day rule is for the classified mail only.
- **P6 Two new ledger rows, appended** in "Rows added by later changes" (ids stay; C261, C262 when no other branch took them first — take the next free ids at `HEAD` and use them everywhere this plan says C261 and C262):
  - C261 — context mails: "Each context mail carries its sender, subject, date and up to 500 characters of its body; context mails have no age limit." Source: `apps/server/src/modules/mail/repo/lookup.ts` (`listThreadContext`), `docs/capabilities/triage.md` rule 3. Condition `—`. Paper: privacy policy and DPIA.
  - C262 — history check: "With the trust ladder on, a history check classifies up to 500 INBOX mails of the last 30 days, at connect, on request and after a change of the model; it stops at $0.25." Source: `docs/capabilities/trust.md` rules 7 and 8, `apps/server/src/modules/trust/history-classify.ts`. Condition: `flag trust_ladder (off by default)`. The triggers in the text are those of `history_checks.reason` at `HEAD`; the worker reads them in `trust.md` and the code.
- **D1 One shared check.** `sevenDayLimitProblems(texts: readonly string[]): string[]` in `packages/core/src/legal/seven-day.ts`, exported through `@ea/core`. It returns each text that names the 7-day limit (`older than 7 days`, `up to 7 days old`, `starszej niż 7 dni`, `starszych niż 7 dni`, `starsze niż 7 dni`) and does not name both the context (`context`, `kontekst`) and the classified mail (`classif`, `klasyfik`). The local copy in `apps/docs/src/security/claims.test.ts` goes; that test calls the shared one.
- **D2 Where the check runs.** `apps/server/src/legal-papers.test.ts` scans each line of the legal pages (`apps/web/src/legal/*/*.md`, stage 01) and of `docs/legal/*.md` (stage 02). `claims.test.ts` keeps its scan of the claims and the security page (stage 03 adds the Polish page).
- **D3 Numbers tied to code.** `legal-papers.test.ts` checks rows C261 and C262 against `THREAD_MAILS`, `EXCERPT_CHARS` (production pointer `classifier-v2`), `HISTORY_SAMPLE_SIZE`, `HISTORY_WINDOW_DAYS`, `HISTORY_COST_CAP_USD`, imported through the module index (add the export if missing). A prompt switch then fails it.
- **D4 Internal docs follow.** `docs/capabilities/triage.md` rule 3 names the content of P5 and "no age limit" (`listThreadContext`); its rule-list line "Mail older than 7 days is not sent to the LLM" names the classified mail only. `docs/architecture.md` (after-an-outage line) gets the same fix. ADRs are history and stay.
- **D5 Public claim.** `ai-provider-receives` cites C030, C031, C032, C261 and C262, adds the proofs `apps/server/src/modules/mail/repo/lookup.ts` and `docs/capabilities/trust.md`, and states the context content and the optional history check in plain words (no flag key). The "does not promise" bullet about the 7-day limit goes from both pages (`security.mdx`, `pl/security.mdx`).

## Facts checked (2026-11-20, at 535e6f76)

- `listThreadContext`: `left(body_text, 500)`, `received_at < before`, `limit(3)`, no age filter.
- `classifier-v2`: `THREAD_MAILS = 3`, `EXCERPT_CHARS = 500`, `BODY_CHARS = 8000`; the classified mail block holds From, To, Cc, Subject, Date, body; sender marks and delegates are separate blocks. Production pointer: `classifier-v2` (`triage.md` rule 3).
- History check: `HISTORY_SAMPLE_SIZE = 500`, `HISTORY_COST_CAP_USD = 0.25` (`trust/history-classify.ts`), `HISTORY_WINDOW_DAYS = 30` (`trust/history-queue.ts`); reasons `connect`, `cli`, `web`, `model_switch`, `flag_on` (`trust.md`); flag `trust_ladder` default off.
- False texts today: `privacy.md` en and pl ("AI model" bullet), `dpia.md` (Flow, "Is the data needed?", R1 measure), ledger C031, C032, C193, C201, `triage.md` rule-list line, `architecture.md` after-an-outage line.
- `claimProblems` needs every proof path named in a cited row's source, and a claim condition when a cited row has one.

## Not verified

- Whether another branch takes ledger ids C261/C262 or a `TERMS_HISTORY` version first. Stage 01 and 02 check at `HEAD` after `git merge master`.

## Done when

The ticket Acceptance (6 lines), and the Proof of each stage exits 0 at the last stage's commit.

## Rules for every stage

- Legal text is plain technical English; the Polish text says the same facts in the style of the existing Polish page. No new claim without a ledger row.
- Never `bun run format` repo-wide; format only the stage's files.
- A ledger edit keeps the counts table true (`legal-papers.test.ts`).
- A gap or a deviation is a question in the final message, not a choice.

## Proof

`mkdir -p /tmp/f153 && bun run lint > /tmp/f153/lint.log 2>&1 && bun run typecheck > /tmp/f153/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f153/unit.log 2>&1 && bun run docs:build > /tmp/f153/docs.log 2>&1 && grep -q "claim_check ok" /tmp/f153/docs.log && echo PROOF_OK`

No integration test changes: no `test:int:ci`.

## User checkpoints and user steps

- Stage 01 changes the legal version: on the first release that carries it, every member accepts the terms again. The coordinator names it in the release notes. No owner stop.
- No DB migration, no `bun.lock` change, no deploy.

## Review

Stage 01 `[risky]` (legal text a member accepts, privacy): one review job (board reviewer model) before the land. Stages 02 and 03 land on the worker's proof.

## Stages

- [ ] 01 `[risky]` privacy policy, legal version, rows C031, C032, C261, C262, triage page, shared check — [stage-01](stages/stage-01-privacy-and-shared-check.md)
- [ ] 02 DPIA draft, rows C193, C201, architecture line, scan of `docs/legal` — [stage-02](stages/stage-02-dpia-and-ledger.md)
- [ ] 03 public claim `ai-provider-receives` — [stage-03](stages/stage-03-public-claim.md)

## How to run (coordinator)

Order: 01, then 02 and 03 in parallel (02 edits `docs/legal/*`, `docs/architecture.md`, `legal-papers.test.ts`; 03 edits `apps/docs/src/security/*` and the security pages; no shared file). Move the ticket to `active/` and commit before the first spawn.

```
limen spawn --engine pi --provider claude-bridge --model <board worker model> --thinking <board level> \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F153" \
  'Implement F153 stage NN. Read spec/features/active/F153-…/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof of plan.md. In the final message, list as proven only what a saved log shows.'
```

Drop the job DB after each land.

## Decisions taken

- P3 (user-visible): a new legal version; members accept again. Undo: drop the entry, revert the text.
- P4 (scope): the history-check sentence ships in this version. Undo: remove it and row C262 (new version).
- P2 (scope): no code change. Undo: a new ticket with an eval gate.
- P5 (privacy): the papers name To and Cc addresses and the sender marks. Undo: revert the sentence.

`questions.md` holds the same items with their kinds.

## Planning progress

- Scouts: 1, empty packet (`scouts.md`); the planner read the facts in code.
- Written: ticket, plan, stages 01–03 [written]. Words: plan 1490, stages 661, 439, 566.

## Cold review

Not run yet.

## Log
