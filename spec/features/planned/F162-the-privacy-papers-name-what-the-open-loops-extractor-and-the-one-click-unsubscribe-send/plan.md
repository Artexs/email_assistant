# F162 plan — the papers name the extractor call and the one-click request

> **Status 2026-11-20 — planned.** Plan base: fb1df6d64. Three stages; no migration, no `bun.lock`.

## Input

Ticket source, owner log 2026-11-20 ("F153 plan P8"): "The one-click unsubscribe line, `members` in `unsubscribe-data`, the report-mail line and the open-loops extractor call stay out of F153; a new ticket holds them and lands before the `bulk_unsubscribe` or `open_loops` flag goes on."

Owner decision 2026-11-18 (one-click, `docs/owner-decisions.md`): "after an owner tap the server sends ONE request from its own address to the server the newsletter names (the one-click URL). That server learns that this subscription asked to leave, that the mailbox is active and when the tap happened. … Saying so is a legal text change and needs a `TERMS_VERSION` bump."

`open_loops` is on for the pilot organization (owner log 2026-11-20).

### Decisions

- **P1 One legal version for the four items.** Stage 01 changes every text that feeds the legal digest (six pages, two registries). Rejected: one version per flag (two re-acceptances).
- **P2 No behaviour change, no flag change** (ticket).
- **P3 What the privacy page says of the extractor** ("AI model" bullet; "AI results" bullet for the stored answer). With open loops on (an optional feature, off by default) and the switch "Track my sent mail" on, the assistant sends, for each own Sent mail that it analyses: the subject, the local date, time and weekday of the send, the number of recipients, and up to 8,000 characters of the text. No address from the headers. The text goes as written, so it can hold names, addresses and the quoted earlier mail of other people. Only mail of the last 14 days, with at most 10 recipients, not a list, automatic or calendar mail, and not a draft of the system. One call per mail; a failed call is tried again, at most three calls. The AI answers with a short ask or promise (at most 80 characters) and a due date; the system stores them. Same provider as triage. Rejected: name the prompt version or flag key in the page (operator words).
- **P4 What the privacy page says of the one-click request** (new bullet "Newsletter senders" in "Who receives data"). With the newsletters feature on (optional, off by default), after an owner's Unsubscribe tap, the server sends one HTTPS POST request with the fixed body `List-Unsubscribe=One-Click` and a fixed program name, from the network address of the server, to the address that the newsletter named in its own mail. It holds no data of the mailbox, no cookie and no sign-in. That server learns that this subscription asks to leave, that the mailbox is in use, the time, and the network address of the server. No repeat. The system keeps the sender address and domain and the result, not the link. Not a sub-processor: no registry row (`OUTSIDE_CALL_CLASSES.unsubscribe_target` records why). Rejected: a registry row (an open set of hosts that the mail names).
- **P5 `members` in `unsubscribe-data`.** `subjects` becomes `["users", "others"]`: a row tells that a member's mailbox left a list. The records row and row C174 follow.
- **P6 The report-mail line** ("Digests and notices" purpose and "Mail provider" bullet). With report by mail on (optional, off by default), the system puts the digest, the weekly report and two trust notices as a mail into the INBOX of a mailbox that the member chose. It logs in to that mailbox and sends no mail. The mail provider keeps it like other mail; each person who reads that mailbox can read it; the assistant does not delete it.
- **P7 Two new purposes** in "Why and on what basis": "Open loops" and "Newsletters", each with `\<to confirm: legal basis>` (default, owner to confirm). Rejected: fold them into "Drafts" (the extractor runs with no draft).
- **P8 The public claim `ai-provider-receives` names the extractor** (stage 03), as F153 named the history check: "an optional feature, off by default", no flag key, no panel string of `apps/docs/src/flagged-text.ts` (default, owner to confirm). The one-click request gets no public claim. Rejected: leave the public claim incomplete while the pilot has the flag on.
- **D1 Ledger rows.** New section "Later additions (F162)" with C263–C266 and the count table updated; changed rows C136, C139 (AI registry rows) and C174 (subjects). If master took these ids first, use the next free ids everywhere.
  - C263 — extractor input (P3 fields). Source: `packages/core/src/loops/extractor.ts` (`extractorInputOf`), `apps/server/src/modules/triage/prompts/extractor-v1.ts` (`buildUserPrompt`). Condition: flag `open_loops` (off by default).
  - C264 — which mail and how often (P3 limits, the three calls, the stored answer). Source: `packages/core/src/loops/extractor.ts` (`sentSkipReason`), `apps/server/src/modules/loops/analyze.ts`, `docs/capabilities/open-loops.md` rule 2. Condition: flag `open_loops`.
  - C265 — the one-click request (P4). Source: `apps/server/src/platform/public-http.ts`, `docs/capabilities/trust.md` rule 21, `apps/server/src/platform/outside-services.ts`. Condition: flag `bulk_unsubscribe`.
  - C266 — report mail (P6). Source: `docs/capabilities/trust.md` rule 19, `apps/server/src/modules/channels/report-mailbox-imap.ts`. Condition: flag `report_mail`.
- **D2 Code ties in a new test file** `apps/server/src/legal-outside-calls.test.ts` (`legal-papers.test.ts` has 415 lines). Constants come through public indexes; add an index export only when missing.
- **D3 Number forms.** English `8,000 characters`, `14 days`, `10 recipients`, `80 characters`; Polish `8000 znaków`, `14 dni`, `10 adresatów`, `80 znaków`. The tests use these exact strings.
- **D4 The version entry.** One `TERMS_HISTORY` entry from `nextLegalVersion`, written in the last commit of stage 01 after `git merge master`. When master gained a newer entry (another legal change, for example F122 stage 05 on the data categories), append after it with a fresh digest; never edit a landed entry.
- **D5 No 7-day wording.** The new texts name 14 days and never "7 days", so `sevenDayLimitProblems` stays empty.
- **D6 `deploy/README.md`.** The line "The privacy text does not yet name the one-click request (owner decision 2026-11-18): decide that first." becomes "Turn it on only on a release that carries the legal version that names the one-click request (F162 stage 01)." (stage 01).
- **D7 Internal papers in stage 02.** The DPIA and records B say P3, P4, P6, P7. No new DPIA risk row (the test needs exactly eight). The capability pages `open-loops.md` rule 2 and `trust.md` rules 19 and 21 point to the privacy text.

## Facts checked (2026-11-20, at fb1df6d64)

- `extractorInputOf` sends `subject` (no cap), `sentLocal` (date, time, weekday), `recipientCount`, `body` cut to `EXTRACT_BODY_MAX = 8000`; `buildUserPrompt` adds no address. `SENT_MAX_AGE_DAYS = 14`, `SENT_MAX_RECIPIENTS = 10`, `EXTRACT_TEXT_MAX = 80` (all `@ea/core`). `MAX_ATTEMPTS = 3` (`loops/analyze.ts`). Production prompt `extractor-v1` (`prompts.extractor`, exported by `modules/triage`). The extractor uses the `light` tier of `LLM_PROVIDER` (`open-loops.md` rule 2).
- `postOneClick`: POST, body `ONE_CLICK_BODY`, `User-Agent` `ONE_CLICK_USER_AGENT` (`email-assistant-unsubscribe/1`), https 443 only, no redirect, no retry, URL never stored (`public-http.ts`, `trust.md` rule 21).
- `unsubscribe-data` has `subjects: ["others"]`. `reportMailKinds` = digest, weekly_report, trust_report_ready, autonomy_paused (`@ea/core`).
- The privacy pages name none of the four items. Highest ledger id C262. `TERMS_HISTORY` ends at `2026-11-20`; the F138 branch that adds a version is dropped.

## Not verified

- Whether another branch takes C263+ or a legal version first: stage 01 checks after `git merge master` (D1, D4).

## Done when

The ticket Acceptance (4 lines); each stage's Proof exits 0.

## Rules for every stage

- Plain technical English; the Polish text says the same facts. No new claim without a ledger row. No real host, name or address (public repository).
- Never `bun run format` repo-wide; format only the stage's files.
- A gap or a deviation is a question in the final message, not a choice.

## Proof

`mkdir -p /tmp/f162 && bun test apps/web/src/lib packages/core/src/legal packages/core/src/web apps/server/src/legal-papers.test.ts apps/server/src/legal-retention.test.ts apps/server/src/legal-outside-calls.test.ts apps/server/src/trust-docs.test.ts apps/docs/src apps/docs/integrations > /tmp/f162/legal.log 2>&1 && bun run docs:build > /tmp/f162/docs.log 2>&1 && grep -q "claim_check ok" /tmp/f162/docs.log && bun run check:job`

The explicit list runs the tests that read Markdown (`check:job` sees no import edge to them).

## User checkpoints and user steps

- Stage 01 adds a legal version: on the release that carries it (after v0.4.4), each member accepts again at the next sign-in. The coordinator names it in the release notes. No owner stop.
- Record, not a stage: `bulk_unsubscribe` and `report_mail` go on only on a release that carries stage 01 (D6).

## Review

Stage 01 `[risky]` (legal text that members accept, a version): one review job with `claude-opus-5-5` before the land. Stages 02 and 03 land on the proof.

## Stages

- [ ] 01 `[risky]` privacy pages, AI registry rows, `unsubscribe-data` subjects, legal version, rows C263–C266, code ties — [stage-01](stages/stage-01-privacy-and-version.md)
- [ ] 02 DPIA, records B, capability pages, DPIA ties — [stage-02](stages/stage-02-dpia-and-records.md)
- [ ] 03 public claim `ai-provider-receives` — [stage-03](stages/stage-03-public-claim.md)

## How to run (coordinator)

Order: 01, then 02 and 03 next to each other (no shared file). Move the ticket to `active/` first. One job per stage (board worker model, `--prepare 'bash scripts/limen-prepare.sh'`); final proof is § Proof.

`questions.md` lists the defaults with their kinds.

## Planning progress

- Scouts: 3 (`scouts.md`). Stages 01–03 [written]. Words: see § Log.

## Cold review

Not run yet.

## Log

- 2026-11-20 plan written at `fb1df6d64`. Words: plan 1500, stages 646, 543, 371.
