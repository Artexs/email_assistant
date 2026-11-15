FAIL 12d4c8809e9afe656c9d97895ab77e63039083d4

The plan cannot build as written. Two blocking findings would ship bugs that reach people: B1, where Cc recipients never get the mail, and B2, where attachment and header edits in the mail client are not seen. 14 gaps and 10 notes follow. HEAD is the candidate and the tree is clean. I ran no test suite: this is a plan review. Each finding rests on reads of the plan files and the code at HEAD.

## BLOCKING

**B1. Pre-mortem: the user taps Reply all, and the Cc people never get the mail.** Stages 04 and 13 let this through. No stage implements the rule.
- D14 (`plan.md:30`) says: "Send limits and `SEND_SCOPE self` check each recipient." No stage file mentions the envelope, `SEND_SCOPE` or the send limits.
- At HEAD, three places read `payload.to` only:
  - the SMTP envelope (`apps/server/src/modules/actions/send.ts:421`),
  - the limit check (`send.ts:398-404`, `send-limit.ts:31`),
  - the `self` claim filter, which is SQL over `payload->'to'` (`actions/repo/filters.ts:25-28`).
- So the `cc` of the reply payload (`interfaces.md:17`) becomes a `Cc:` header with no RCPT TO (stage 04 test 4, `stage-04-reply-kind.md:24`).
- If a worker adds `cc` to the envelope without a change to `filters.ts`, `SEND_SCOPE=self` lets external Cc addresses through.
- Stage 13 test 5 (`stage-13-telegram-redraft.md:20`) checks only the payload.
- Needed: an owning stage, plus tests. RCPT, `sendScopeAdmits`/`sendFilterExpr` and `checkSendLimits` must cover `to ∪ cc`. A `self` send with one Cc outside the list must stay held.

**B2. Pre-mortem: the user adds an attachment to the draft in the mail client, or changes To or Subject, then taps Send.** The system sends the old text without the attachment and deletes the user's copy. Stage 08 lets this through.
- D9 (`plan.md:25`) hashes only `fetchContent → { text }`.
- That text is the plain-text part, or HTML converted to text (`mail/imap/client.ts:281-295`, `mail/imap/capture.ts:159-169`). Attachments, To, Cc and Subject never change the hash.
- With an equal hash, stage 08 step 2 sends (`stage-08-copy-hash.md:18`), and step 3 deletes the copy (`stage-08-copy-hash.md:32`).
- This breaks the ticket outcome (`ticket.md:9`) and ADR 0033 §6.
- No rule covers `text: null`. That happens when the copy is larger than `bodyLimitBytes` (`client.ts:287-290`), which a user attachment can cause.
- Needed: a decision on what the baseline covers, for example text + attachment list + To/Cc/Subject. Also a stage 08 test: an attachment is added and the body is the same → `draft_changed`, and the copy stays.

## GAP

- **G1. Rule conflict.** Stage 05 says `closeReplySend` answers `busy` for an `approved` send that has `locked_at` (`stage-05-lifetime.md:30`). A committer claim sets `locked_at` on `approved` rows (`actions/repo/claims.ts:172,199`). But stages 08 and 09 close claimed sends with `closeReplySend` (`stage-08-copy-hash.md:19`, `stage-09-answered-sweep.md:10,14`). The reason list (`interfaces.md:29`) also lacks `draft_missing`.
- **G2. Missing dependency.** Stage 08 uses `closeReplySend` and `replaceApproval`, which stage 05 builds. The plan says stage 08 "needs 04" only and may build in parallel with 05 (`plan.md:99,114`).
- **G3. Missing interface.** The committer pre-send pass runs in module `actions` and needs the request's folder and the thread facts (`stage-09-answered-sweep.md:10`). The table `reply_requests` belongs to module `replies`. Because `replies → actions` is an edge (`plan.md:17`), an import from `actions` to `replies` closes a cycle, and `layers.json` forbids that. The payload has no `folder` or `thread_key` field. Needed: a payload field or an injected hook.
- **G4. Unmapped acceptance.** No test checks that a `reply` copy APPENDed to Drafts carries `In-Reply-To` (`ticket.md:26`). Stage 07 tests check DB rows only, and stage 04 has unit tests only.
- **G5. Rule conflict.** The sweep closes tapped, held `approved` replies with `notify: false` (`stage-09-answered-sweep.md:26`). `questions.md:11` (#7) says a notice goes out after a Send tap.
- **G6. Missing edge case.** Review cards reuse the dedup key `approval:<sendId>` (`stage-12-telegram-review.md:19`, `channels/notices/approval.ts:97`). The outbox has `UNIQUE (org_id, user_id, dedup_key)` (`db/migrations/20261106000001_telegram.sql:72`). So after Skip, a later Review cannot show that card again.
- **G7. Missing interface and end states.**
  - When a draft is already open, `{ kind: "queued" }` carries no `sendId` and no request id (`stage-13-telegram-redraft.md:12`, `interfaces.md:28`).
  - Requests that end `cancelled` or `superseded` get no result text (`stage-13-telegram-redraft.md:26`, `stage-15-panel-reply.md:10`).
  - No rule covers a redraft whose `previous_send_id` is no longer open at write time (`stage-07-drafter-job.md:18`).
- **G8. A worker must guess.** Stage 02 runs `--set reply-injection --drafter --judge` and `--budget-usd 2` (`stage-02-prototype-run.md:21,26`). At HEAD, `--judge` and `--budget-usd` are sim-only options (`apps/server/src/scripts/eval-args.ts:107-121`). Without `--sim` they are a usage error.
- **G9. Rule conflict.** The migration copies `style_text` into every mailbox signature (`stage-03-migration.md:10`). The profile signature wins (D13, `plan.md:29`). But the org signature card stays editable (`stage-11-style-card.md:13`). After the migration, edits there change nothing for existing mailboxes.
- **G10. Unflagged risky change.** Stage 08 changes the send path for every draft kind, with no flag (`stage-08-copy-hash.md:5`). Fact N1, that the copy text is stable, is checked only in stage 18 (`plan.md:47`). If the text is not stable, every delegation send ends `draft_changed`.
- **G11. Missing edge case.** The phone rule (`stage-01-drafter-core.md:10`) matches normal dates and times. `18.11.2026 10:00` gives 10 digits in one run, so it fails as `phone`. The stage has no negative test for dates or amounts.
- **G12. Source misapplied.** The consent version is checked only on a new link request (`channels/routes.ts:45`). `questions.md:5` (#1) cites the 2026-11-14 decision, but that decision covers chats linked before the consent step (`docs/owner-decisions.md:233`). `docs/owner-decisions.md:114` says to raise the version "to ask again". Under D16, chats that are already linked get the new data with no new consent.
- **G13. Rule conflict.** Stage 16 computes the outcome counts outside the metric pattern (`stage-16-samples-outcomes.md:20-21`). `docs/code-patterns.md:278` requires a core metric function and a `weekStatsSchema` field.
- **G14. Notes §3.7 not followed.** Notes §3.7 asks for an answered check before the draft write and before the "replies ready" notice (`E06-discovery-notes.md:119`). Stage 07 re-checks only the switch and the mode (`stage-07-drafter-job.md:18`). There is no flag re-check either. The stage 12 detector has no answered check.

## NOTE

- **N1 (plausible).** A kept, user-changed old version can stay in Drafts next to the new version (`stage-08-copy-hash.md:36`). This creates a double-reply risk when Sent sync is off.
- **N2 (plausible).** Any newer mail closes the draft without a notice, including an out-of-office reply from a third party (`questions.md:15`, `questions.md:11`).
- **N3 (plausible).** No rule covers a mail that is flagged later, a category change away from `needs_reply`, or suspicion on the thread level (compare `triage/suspicious-repo.ts:94`).
- **N4.** The ticket asks for `*-drafter-v1-*.md` (`ticket.md:25`). The stage 02 report name ends in `drafter-v1.md` (`stage-02-prototype-run.md:26`), so it does not match. The injection report has no name.
- **N5.** Stage 08 test 3 depends on stage 05 (see G2).
- **N6.** A tap request has no maximum life: soft errors never count (`stage-07-drafter-job.md:20`), but the panel polls for only 60 s (`stage-14-reply-routes.md:10`).
- **N7.** The plan does not say whether `closeReplySend` edits the Telegram card.
- **N8.** Stage 18 may add a CLI inside a stage that the coordinator runs (`stage-18-pilot.md:11`). That code is better placed in stage 08.
- **N9.** The panel takes `gaps` from the payload (`stage-14-reply-routes.md:24`), so the list goes stale after an edit. Derive it from `body_text ?? body`.
- **N10.** All files are within the size limits: the largest stage has 697 words and `plan.md` has 1,495.

## Checks run

- `git rev-parse HEAD && test -z "$(git status --short)" && grep …` (one call, joined with `&&`, exit 0). It printed `12d4c8809e9afe656c9d97895ab77e63039083d4` and found the cited lines in `send.ts`, `repo/filters.ts`, `imap/client.ts`, `eval-args.ts`, `20261106000001_telegram.sql`, `notices/approval.ts`, `channels/routes.ts`, `docs/code-patterns.md`, `repo/claims.ts` and `stage-08-copy-hash.md`.
- I wrote the verdict to `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-15-f115-plan-review-d6921517/verdict.md` and checked it with `head -1`. Output: `FAIL 12d4c88…`.
- Not run: `bun install` and the lint, typecheck, unit and integration suites. A plan review has no code to test.

## Note check

- HEAD is the candidate: proven. `git rev-parse HEAD && test -z "$(git status --short)" && grep …` printed `12d4c8809e9afe656c9d97895ab77e63039083d4`, and the tree was clean.
- Each finding cites file:line, sits in BLOCKING, GAP or NOTE, and was checked against the sources: proven for the code-backed findings. The same `&&` command found the cited code lines for B1, B2, G1, G2, G6, G8, G12 and G13. The plan-file and epic citations come from reads in this session, not from a command that meets the rule.
- First line is `PASS <sha>` or `FAIL <sha>`: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-15-f115-plan-review-d6921517/verdict.md` starts with `FAIL 12d4c8809e9afe656c9d97895ab77e63039083d4`, and so does this message.
- Easy-to-miss rule ("Missing code detail … is not a finding; a missing decision, edge case, test or interface is"): followed. Each BLOCKING and GAP item above names a missing decision, edge case, test, interface, dependency or rule conflict. No finding is about line numbers, edit text or file lists. The evidence is this message itself; no command can prove it.
