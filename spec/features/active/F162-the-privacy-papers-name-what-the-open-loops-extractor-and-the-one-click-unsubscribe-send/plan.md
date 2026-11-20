# F162 plan — the papers name the extractor call and the one-click request

> **Status 2026-11-20 — planned.** Plan base: fb1df6d64. Four stages; no migration, no `bun.lock`.

## Input

Owner log 2026-11-20 ("F153 plan P8"): "The one-click unsubscribe line, `members` in `unsubscribe-data`, the report-mail line and the open-loops extractor call stay out of F153; a new ticket holds them and lands before the `bulk_unsubscribe` or `open_loops` flag goes on."

Owner decision 2026-11-18 (one-click): "after an owner tap the server sends ONE request from its own address to the server the newsletter names (the one-click URL). That server learns that this subscription asked to leave, that the mailbox is active and when the tap happened."

`open_loops` is on for the pilot organization (owner log 2026-11-20).

### Decisions

- **P1 One legal version for all in-app texts.** Stage 01 changes every digest input: privacy, DPA and terms pages (en, pl) and both registries. Rejected: one version per flag (two re-acceptances).
- **P2 No behaviour or flag change** (ticket).
- **P3 The extractor** (privacy "AI model" and "AI results"; the `openai` and `gemini` rows: `dataReceived` and `purpose`). With open loops on (optional, off by default) and the switch "Track my sent mail" on, for each own Sent mail that it analyses the assistant sends: the subject, the local date, time and weekday of the send, the number of recipients and up to 8,000 characters of the text. No address from the headers. The text goes as written: it can hold names, addresses and quoted mail of other people. Only mail of the last 14 days, at most 10 recipients, not list, automatic or calendar mail, not a system draft. A call that fails because of the mail is tried at most three times; when the AI service is busy or down, it is tried again later (soft errors count no attempt). The AI answers with a short ask or promise (at most 80 characters) and a due date, which the system stores. Rejected: the prompt version or flag key in the page.
- **P4 The one-click request** (privacy "Who receives data", new bullet "Newsletter senders"; one clause in "Transfers outside the EEA": that server can be anywhere). With the newsletters feature on (optional, off by default), after an owner's Unsubscribe tap, the server sends one HTTPS POST with the fixed body `List-Unsubscribe=One-Click` and a fixed program name, from the network address of the server, to the link that the newsletter wrote in its own mail. The link can identify the subscriber. No other mailbox data, cookie or sign-in. That server learns that this subscription asks to leave, that the mailbox is in use, the time and the server's network address. No repeat. The system keeps the sender address, domain and result, not the link. Rejected: a registry row (an open set of hosts; `OUTSIDE_CALL_CLASSES` records why).
- **P5 `members` in `unsubscribe-data`.** `subjects` becomes `["users", "others"]`. The records row and ledger row C174 follow.
- **P6 Report mail** (privacy "Digests and notices" and "Mail provider"). With report by mail on (optional, off by default), the system puts the digest, the weekly report and two trust notices as a mail into the INBOX of a mailbox that the member chose. It logs in to that mailbox and sends no mail. The provider keeps it like other mail; each person who reads that mailbox can read it; the assistant does not delete it.
- **P7 New purposes** "Open loops" and "Newsletters" in the privacy page, the DPA "Nature and purpose", DPIA Purposes and record B, each privacy one with `\<to confirm: legal basis>` (default, owner to confirm). Rejected: fold them into "Drafts".
- **P8 The public claim `ai-provider-receives` names the extractor**, as F153 named the history check: optional, off by default, no flag key, no string of `apps/docs/src/flagged-text.ts` (default, owner to confirm). The one-click request gets no public claim; the short list of `security.mdx` stays (the owner rule of 2026-11-15: the docs pages describe no flagged feature).
- **P9 Shadow mode and "AI and decisions" stay true** (review finding 3). Report mail appends into the INBOX in every mode. Each sentence "in shadow mode the assistant changes nothing in the mailbox" (privacy, terms, DPIA Modes and Less intrusive options) adds "except a report mail that a member asked for". The privacy "AI and decisions" bullets name the ask or promise from own Sent mail, and "The assistant only sorts, flags, moves and drafts" adds "tracks open loops and, after an owner's tap, asks a newsletter to unsubscribe". Rejected: a code change to skip report mail in shadow mode (P2).
- **P10 DPIA risk R10** "A newsletter sender learns that the mailbox is in use" (L `medium`, S `low`), with measures and a residual line in the form of R9 (default, owner to confirm).
- **D1 Ledger rows.** Section "Later additions (F162)": C263 extractor input, C264 which mail and how often, C265 one-click request, C266 report mail; the count table follows. Changed: C136, C139 (AI rows), C174 (subjects), the DPA purpose rows, the shadow-mode rows. Sources in the stage 01 file. If master took the ids, use the next free ones everywhere. `apps/docs/src/security/claims.test.ts` pins the row count: the stage that adds rows changes it.
- **D2 Code ties in a new test file** `apps/server/src/legal-outside-calls.test.ts` (`legal-papers.test.ts` has 415 lines). Constants through public indexes.
- **D3 Number strings come from the constants.** English `${n.toLocaleString("en-US")} characters` (8,000), Polish the plain number (`8000 znaków`); `14 days` / `14 dni`, `10 recipients` / `10 adresatów`. A changed constant then fails the tests.
- **D4 The version entry.** The first commit that changes a digest input carries a new `TERMS_HISTORY` entry from `nextLegalVersion` (the pre-commit hook runs `legal-version.test.ts`). Each later commit of stage 01 re-digests that same unlanded entry. After `git merge master`, when master gained a newer entry (for example F122 stage 05 on the data categories), move the entry after it with a fresh version; never edit a landed entry.
- **D5 No 7-day wording** in new text.
- **D6 `deploy/README.md`.** "The privacy text does not yet name the one-click request (owner decision 2026-11-18): decide that first." becomes "Turn it on only on a release that carries the legal version that names the one-click request (F162 stage 01)."

## Facts checked (2026-11-20, at fb1df6d64; review 1 confirmed at 127f4fac)

- `extractorInputOf` keys: `subject`, `sentLocal`, `recipientCount`, `body` (8000 cap); constants as P3 (`@ea/core`, loops index); soft errors count no attempt (`loops/analyze.ts`); prompt `extractor-v1`; one provider for all roles.
- `postOneClick`: POST, `ONE_CLICK_BODY`, `ONE_CLICK_USER_AGENT` `email-assistant-unsubscribe/1`, no redirect, no retry, URL never stored.
- `report-mail-sender.ts` does not read the mailbox mode. DPIA has R1–R9. `claims.test.ts` pins 262 rows. The F138 branch with a version is dropped.

## Not verified

- Whether another branch takes C263+ or a legal version first: stage 01 checks after `git merge master` (D1, D4).

## Done when

The ticket Acceptance; each stage's Proof exits 0.

## Rules for every stage

- Plain technical English; the Polish text says the same facts. No new claim without a ledger row. No real host, name or address (public repository).
- Never `bun run format` repo-wide; format only the stage's files.
- A gap or a deviation is a question in the final message, not a choice.

## Proof

`mkdir -p /tmp/f162 && bun test apps/web/src/lib packages/core/src/legal packages/core/src/web apps/server/src/legal-papers.test.ts apps/server/src/legal-retention.test.ts apps/server/src/legal-outside-calls.test.ts apps/server/src/trust-docs.test.ts apps/docs/src apps/docs/integrations > /tmp/f162/legal.log 2>&1 && bun run docs:build > /tmp/f162/docs.log 2>&1 && grep -q "claim_check ok" /tmp/f162/docs.log && bun run check:job`

The list runs the tests that read Markdown. Stage 01 drops the not yet existing `legal-outside-calls.test.ts`.

## User checkpoints and user steps

- Stage 01 adds a legal version: on the release that carries it (after v0.4.4), each member accepts again; name it in the release notes. No owner stop.
- Record, not a stage: `bulk_unsubscribe` and `report_mail` go on only on that release (D6).

## Review

Stage 01 `[risky]`: one review job with `claude-opus-5-5` before the land. Stages 02–04 land on the proof.

## Stages

- [ ] 01 `[risky]` in-app texts, registries, legal version, ledger rows — [stage-01](stages/stage-01-privacy-and-version.md)
- [ ] 02 code ties and capability pages — [stage-02](stages/stage-02-code-ties.md)
- [ ] 03 DPIA, records B, R10 — [stage-03](stages/stage-03-dpia-and-records.md)
- [ ] 04 public claim `ai-provider-receives` — [stage-04](stages/stage-04-public-claim.md)

## How to run (coordinator)

01 first. Then 02 and 04 next to each other; 03 after 02. A land conflict (the row count in `claims.test.ts`) is "merge master, re-prove". One job per stage (board worker model, `--prepare 'bash scripts/limen-prepare.sh'`).

`questions.md` lists the defaults.

## Planning progress

- Scouts: 3 (`scouts.md`). Stages 01–04 [written]. Words: plan 1497; stages 594, 463, 533, 370.

## Cold review

One round, `claude-opus-5-5` (stage 01 `[risky]`), job `2026-11-20-f162-plan-review-290419c5`: FAIL, 5 blocking, 7 notes (`plan-review-1.md`). Fixed 1–10 (P3, P1, P7, P9, D4, P10, D3, stage 04, D1, stage 02, P4). Rejected 11 (the stylist call is outside the four items: a new ticket) and 12 (P8).

## Log

- 2026-11-20 plan at `fb1df6d64`; review 1 fixes, stage 01 split in two.
