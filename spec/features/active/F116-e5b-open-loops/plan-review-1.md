PASS a0131ce14e3ef733930481dd6b7209571ff95a86

The plan can deliver every acceptance bullet as written. I found no BLOCKING finding. It has 17 gaps. Five of them can cause the pre-mortem bugs (G1–G5). Fix them before stages 09–15 build.

HEAD check: `git rev-parse HEAD` = a0131ce14e3ef733930481dd6b7209571ff95a86. This matches the candidate.

## BLOCKING

None.

## Unverified

- No test suite ran. This is a plan review with no code change, so a suite cannot tell good from bad here. I checked facts by reading the code at HEAD (paths below).

## GAP

**G1 — The system's own follow-up comes back from Sent as a "user" mail. It can open a second loop or corrupt the quote.** Stages 09, 10, 12. Proven by reading the code; the effect on loops is plausible.
- The committer APPENDs a Sent copy of every system send (`apps/server/src/modules/actions/send.ts:220-238`).
- The Sent reader looks up `X-EA-Action-Id` with `sentOriginOf`. That function inner-joins `emails` on `a.email_id` (`actions/repo/planned.ts:41-42`), so for a loop-anchored draft it returns null.
- Null becomes `origin: "user"`, `actionId: null`, with the body stored (`mail/sent-rules.ts:74,92-93`). This is exactly the input of D6 (`plan.md:64`).
- Stage 12's thread rule needs the row to be "newer than the loop's `wait_from_at`" (`stage-12:10`). `onFollowUpSent` set that time at apply time (`stage-10:22`).
- So there are two outcomes:
  - If the Date header is older than `wait_from_at`, the LLM reads the template ("Could you let me know where this stands?") and opens a second waiting loop. The unique key `(org_id, sent_email_id, kind)` does not stop it, because the sent row is a different one. That gives two chase chains in one thread.
  - If it counts as newer, `restartLoop` sets `last_sent_email_id` to the follow-up. Follow-up 2 then quotes follow-up 1 instead of the user's ask (`stage-14:18`).
- Stage 09 hides loop rows only from the readers it names (`stage-09:23`). No stage makes `sentOriginOf` or `isOwnActionId` (`planned.ts:12-28`) see loop-anchored drafts. No stage tests "a system follow-up copy in Sent → `system`, no analysis".
- Missing: a decision and a test (stage 10 or 12).

**G2 — After a rejected or expired follow-up, no new follow-up can ever be planned.** Stages 11, 14, 15, 16. Proven by reading the code.
- The keys are `<loop id>:follow_up:<n>` with `n = follow_ups_sent + 1` (`stage-14:17-18`).
- A rejected or expired follow-up "does not change the loop" (`stage-11:24`), so `n` stays the same.
- `createPlanned` inserts nothing when `(org_id, idempotency_key)` exists (`actions/repo/planned.ts:121-133`).
- Effects:
  - The next tap answers `waiting` with a dead `sendId`.
  - The chaser (`stage-15:19`) never plans for that loop again.
  - A `delegated` loop then never reaches `stale`.
- The same applies to the Delegate button: key `<email id>:create_draft:delegation:button` (`stage-16:14`), after a rejected delegation draft.
- The existing chaser avoids this with a per-day key (`delegation/chaser.ts:166,172`).
- Missing: a key rule for a retry after reject or expiry, and a test.

**G3 — Sent rows whose text has not arrived yet get skipped forever as `no_text`.** Stages 05, 12. Plausible.
- Sent rows are inserted with `content: "pending"` and no body (`sent-rules.ts:94`).
- The text step comes later, at most 100 rows per run (`sent-rules.ts:16`, `sent-sync.ts:207-221`).
- `auto_submitted`, `list_id` and `has_calendar` are written only with the text (`mail/repo/sent-emails.ts:121-129`).
- Stage 12's candidate rule has no `content` condition (`stage-12:9`). `sentSkipReason` turns a missing body into a permanent `no_text` skip (`stage-05:16`).
- During a first pass with more than 100 rows, most of the 14 days of sent mail opens no loop. This is the "loop that never surfaced" bug.
- D6 says "with text" (`plan.md:64`), but it gives no rule for `pending` (wait) versus `headers_only` or `gone` (skip).

**G4 — A follow-up can quote a later mail to the wrong people.** Stages 12, 14. Plausible.
- Restart takes any later own mail in the thread, with no recipient check (`plan.md:69` D9, `stage-12:10`).
- `restartLoop` changes `last_sent_email_id` and the message ids but keeps To and Cc (`stage-08:12`).
- The quote comes from `last_sent_email_id` (`stage-14:18`).
- Example: the user writes an internal side note in the same thread ("Bob, Anna is slow, can you push her?"). The follow-up to Anna then quotes that note.
- Missing: a decision. Options: restart only when the To∪Cc sets overlap, or always quote the mail that opened the loop. Also missing: a test.

**G5 — An ignored waiting loop never ends.** Stages 08, 15.
- `stale` needs 2 follow-ups (`stage-15:21`).
- With `auto_follow_up` off (PD-120), shadow mode, or drafts off, an untouched waiting or delegated loop stays open forever. It shows in every morning brief.
- Its To, Cc and subject also outlive the 90-day recipient rule (D5, `plan.md:63`). `clearLoopTexts` touches only closed loops (`stage-08:21`).
- Missing: an end state and a retention rule for open loops.

**G6 — A mixed approval set breaks the consent gate and the "see the mail" rule.** Stages 11, 15.
- Stage 15 builds one set from delegation reminders and loop follow-ups (`stage-15:10`).
- Stage 11 hides follow-up items from owners whose consent is older (`stage-11:13`).
- But `as:<setId>` approves the whole set (`channels/approval-taps.ts:84,188`). An owner whose consent is older can approve follow-ups they never saw.
- Set items show "recipient, subject, text" (`stage-11:12`): one recipient, no Cc, no rendered mail. PD decision 6 says "you see the rendered mail and tap Send". This matters for waiting loops once G1 or G25 turns `auto_follow_up` on.
- The current set detector throws on a non-reminder item (`channels/notices/approval-set.ts:28`). Stage 11 owns that change, but has no decision for a mixed set.

**G7 — Stage 18 imports across a layer border that does not exist.**
- Stage 18 has `reports` read `consentVersionsOf` (`stage-18:25`).
- Stage 17 puts that function in `channels` (`stage-17:12`).
- `layers.json` allows only `channels → reports` (`apps/server/src/modules/layers.json` sameLayerEdges). So `reports → channels` fails lint.
- Missing: which module reads consent, and how it gets into the brief input.

**G8 — Stage order: stage 08 uses things from stages 09 and 10, and no later stage finishes it.**
- `onSentOff` "expires each waiting follow-up send … `loop_closed`" (`stage-08:28`).
- `actions.loop_id` comes in stage 09, and the `loop_closed` expiry comes in stage 10.
- No later stage adds the expiry to `onSentOff` or tests it. Stage 10 T6, stage 13 T10 and stage 14 T14 cover other close paths.
- When the user turns the Sent switch off, a waiting follow-up card stays in Telegram with sent-mail data. The send itself stops later, at `isOpen`.

**G9 — Stage order: stages 20 and 23 use stages they do not depend on.**
- Stage 20 T9 runs "the stage 15 T6 case through the route" (`stage-20:22`), but stage 20 needs only 14 and 16 (`plan.md:144`).
- Stage 23 reads "the loop's applied sends" (`stage-23:22`), which need `actions.loop_id` (09) and the follow-up send (10). But stage 23 needs only 13 (`plan.md:147`).
- The lane line runs `{23}` in parallel with `{09→10}` and `{12→13}` (`plan.md:154`). That line also contradicts stage 23's own "needs 13".

**G10 — A hand nudge in a delegation thread can make two chases to the same delegate.**
- Example: the user writes "any news?" by hand in the thread of an open triage or button delegation.
- This opens a `delegated` loop next to the delegation (D8, `stage-12:21`). The one chaser then plans both a reminder and a follow-up to the same delegate (`stage-15:10,19`).
- Missing: a rule. For example, a sent mail in the thread of an open delegation restarts or skips, but opens no loop.

**G11 — The plan narrows a "do not reopen" decision without saying so.**
- PD-122 (epic `E05-open-loops.md:107`, decision 8): a promise is "closed by your later mail to the same person".
- D9 and stage 12 close it only in the same thread (`plan.md:69`, `stage-12:10`).
- P1 says "do not reopen" (`plan.md:55`). Either do what PD-122 says or record the change in questions.md.

**G12 — The ⌛ stale line can leak sent-mail data to an owner whose consent is older.**
- The line "⌛ Closed without an answer: <subject>" (`stage-18:15`) carries sent-mail data.
- Stage 18's consent rule names only the ⏳ and 🤝 sections (`stage-18:17`). T4 checks only "no address".
- The general rule exists (`stage-17:16`), but stage 18 has no test for this line. Add ⌛ to the rule and to T4.

**G13 — Failed or held follow-ups have no notice.**
- Stage 11 covers the card, the set and `send_result` only (`stage-11:13,25`).
- `action_failed` and `send_held` for loop-anchored sends get no decision: who sees them, what they show, the consent gate.
- Stage 09 filters loop rows out of the email-joined readers. So a follow-up that fails at SMTP (`send.ts:421`) can fail with no notice.

**G14 — The chaser cannot run its "all modes" steps in shadow mode as planned.**
- `createChaserJob` skips mailboxes that are not in `assist` or have drafts off, before any per-mailbox work (`delegation/chaser.ts`, the `settings.mode !== "assist"` check in `run`).
- D3 says "gates stay" (`plan.md:61`). Stage 15 (c) and (d) say "All modes" (`stage-15:21-22`).
- No test covers `stale` or `expired` in shadow (T7 checks only "nothing planned").

**G15 — The Later toast needs a date that the command does not return.**
- `laterLoop` returns only `{ kind: "ok" }` (`interfaces.md:197`).
- Stage 19 shows "Moved to {date}." (`stage-19:16`). It needs the new `due_at`.

**G16 — The shared index does not match F115's plan.**
- `interfaces.md:181` and `stage-07:12` say F115 stage 03 plans the same named index with `IF NOT EXISTS`.
- F115 `stage-03-migration.md:11` says plain `CREATE INDEX`, with no name.
- This needs an edit to the F115 stage, which is outside this folder. The plan does not list it.

**G17 — The checker cannot see the date rules it must apply.**
- Stage 04's checker may read only the README "Sent bank" section and the blind file (`stage-04:10`).
- But it must resolve time words to dates (`stage-04:12`). Stage 02's Done line (`stage-02:38`) does not require that section to hold the time-word rules (`stage-01:14`) or the org time zone.
- Expect avoidable disagreements, rewrite rounds and dropped cases.

## NOTE

- **N1 — Stage numbers drifted.**
  - `stage-06:19` says "Stage 11 does not start analysis"; analysis is stage 12.
  - `stage-05:39` says "the job (11)" and `stage-01:14` says "from stage 11"; both mean 12.
  - `interfaces.md:191` says "`loopSections` … (stage 17)"; stage 18 builds it.
  - The gate-evidence runtime refusal is in no stage's tests.
- **N2 — The C1 rule conflicts with itself.** `plan.md:113` says "07–11 may build"; `stage-06:30` says "07–10".
- **N3 — The gate bars are stricter than the ticket.**
  - The gate uses Wilson lower bounds (`stage-06:11`); the ticket says point values (`ticket.md:26`).
  - About 125 positive cases with a bound ≥ 0.90 needs about 95% measured recall. About 60 promise cases with a bound ≥ 0.90 needs about 97% measured precision.
  - So the extractor can meet the ticket and still fail C1. Record this as owner-visible, or align the ticket.
- **N4 — Two files are over the size limits.** `wc -w`: plan.md 1512 (limit 1,500), stage-01 702 (limit 700). `plan.md:161` still says 1498.
- **N5 — Stage 17 T7 breaks at the next bump.** The test asserts the version equals `OPEN_LOOPS_CONSENT_SINCE` (`stage-17:25`). This fails when F115 bumps the version again; use `>=`. Also, two bumps on the same day give one version string, so one confirmation covers both texts.
- **N6 — Member response conflicts.** A member gets `not_found` from the route in stage 16 (`stage-16:9`), but 403 from `requireOwner` in stage 20 (`stage-20:11`).
- **N7 — The LLM cap counts a different day than triage.** Stage 12 counts the local day (`stage-12:19`). The triage cap uses the `QUOTA_TIMEZONE` day per mailbox (`triage/service.ts:486`, `triage/jobs.ts:161`).
- **N8 — A short wait shows a Draft button that only answers `too_soon`.** With `loop_wait_days` < 3, the due comes before the 3-working-day gap (D12), and the Draft button still shows (`stage-19:15`).
- **N9 — Delegated follow-ups should go to the stored address.** Stage 14 sends "the delegate's address" (`stage-14:18`). Use the loop's `counterpart`, the address the mail went to. Otherwise a changed delegate address gets a follow-up for a mail it never received.
- **N10 — No decision for org flags turned off.** If `open_loops` or `sent_sync` goes off for the org, open loops keep their texts. D18 covers only the mailbox switch.
- **N11 — One fact has no source.** "Telegram allows at most 8 buttons per line" (`questions.md:13`, `stage-19:25`) is not in facts.md.
- **N12 — Two route-answer details are unclear.**
  - `LoopItem.delegate (null)` (`interfaces.md:216`) contradicts stage 21's "delegate's name".
  - Stage 20 T3 expects `{ status: "planned" }`, but the command uses `kind`.
- **N13 — Some later asks are never read.** Because of the thread rule, a new ask or promise in a later own mail in an open loop's thread is never extracted (D6). This is a design choice; write it in the capability page.
- **N14 — The pilot can need unplanned code.** Under G1, PD-120 can force a code change inside stage 25 ("one small job before step 1", `stage-25:8`). Turning `auto_follow_up` on makes G6 real for waiting loops.

## Pre-mortem: which stage let each bug through

| Bug | Stages |
| --- | --- |
| Wrong follow-up recipient or content | G4 (12, 14); G6 set item without Cc (11, 15); N9 (14) |
| A loop that never surfaced or was never chased | G3 (12); G2 (14, 15); G5 (15) |
| False close | None beyond PD-121 (any participant closes, which is intended). The subject fallback is limited to recipients and auto-replies are excluded (stage 13 T2–T5, T9). |
| Sent-mail data in Telegram without consent | G6 (11, 15); G12 (18); G13 (11); G8 (08) |
| Double send or double chase | G1 (09, 10, 12); G10 (12, 15) |
| Broken committer path for existing kinds | None found. Stage 09 T7 and the stage 10 Proof run the full suites. |

## What I checked

All reads are at HEAD a0131ce:
- `git rev-parse HEAD` → matches the candidate.
- Code: `actions/repo/planned.ts`, `actions/repo/claims.ts`, `actions/send.ts`, `actions/send-limit.ts`, `actions/repo/retention.ts`, `delegation/chaser.ts`, `channels/notices/approval-set.ts`, `channels/routes.ts`, `mail/sent-sync.ts`, `mail/sent-rules.ts`, `mail/sent-texts.ts`, `mail/repo/sent-emails.ts`, `mail/sent-switch.ts`, `mail/sync-rules.ts` (`threadKey`), `layers.json`, `core/digest/callback.ts` (prefixes: no collision with `lf`, `ll`, `lc`, `lx`, `lr`, `dg`, `dp`), `core/web/telegram.ts` (version `2026-11-14`), `main.ts` (chaser and triage cap).
- Migrations: sent_mail, measure_capture, delegation, approval_edit.
- `wc -w` on plan.md and the stage files.
- `date` for the weekday of every fixed test date. All test dates are correct, including the CEST date 2026-03-30.
- F104 and F109 facts F1–F3 and F5–F7 hold at HEAD. `sent_emails` already has `UNIQUE (id, org_id)`.

## Note check

- HEAD is the candidate sha: proven. `git rev-parse HEAD` (a separate call, exit 0) printed a0131ce14e3ef733930481dd6b7209571ff95a86.
- Every finding is classified and has file:line, and every pre-mortem bug has a stage or a "none found" line: proven. The evidence is this final message (the BLOCKING, GAP and NOTE sections and the pre-mortem table).
- Facts checked against the code at HEAD: not proven by a saved command log. I read the files and cited them with line numbers above, but no single exit-0 command is saved as proof.
- Easy-to-miss rule ("Missing code detail … is not a finding"): followed. Each GAP names a missing decision, edge case, test, interface or stage-order error, not code detail. No separate artifact proves this beyond the message itself.
