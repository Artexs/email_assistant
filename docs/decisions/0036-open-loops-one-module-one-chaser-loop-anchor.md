# 0036 — Open loops: one module, one chaser, a loop anchor for actions

- Status: accepted (F116, 2026-11-18)
- Date: 2026-11-18

## Context

The user waits for replies to their own mail, makes promises with dates, and forwards work to people by hand. Nothing tracked this. Stage 2 epic E5b (PD-115 to PD-129) adds the tracking and a follow-up draft that waits for one tap.

Four facts shaped the design:

- Delegations already have a table, a chaser job and a reminder template (`modules/delegation`). A second engine for waiting replies would chase the same people twice.
- A follow-up answers the user's own Sent mail. Often the thread holds no incoming mail. Every `actions` row until now hung on an incoming mail (`email_id`).
- Sent text and recipients expire (ADR 0029: text after `data_retention_days`, addresses after 90 days).
- A loop line shows recipients, an ask and a promise of the user's own mail. In Telegram that is a new kind of mail-derived data (`docs/code-patterns.md` § The consent version).

## Decision

1. **D1, one module.** A new server module `loops` (layer 3) owns the table `open_loops`, the analysis of the user's own Sent mail, the close rules, the commands, the one chaser and `delegateMail`. Its edges go to `actions`, `delegation` and `triage`. No module of layers 1 to 3 imports it; `channels`, `reports` and the composition root may.
   - Rejected: the code inside `delegation`. The module would grow past its size, and it has no edge to `triage` (the suspicious-thread check).
2. **D2, three kinds in one table.** `open_loops.kind` is `waiting` (the user asked and waits), `promised` (the user promised something with a date) or `delegated` (a hand forward to an active delegate, PD-124). Delegations that triage plans stay in `delegations`; a button delegation is a `delegations` row too (`source = button`).
   - Rejected: nullable mail and action ids on `delegations`. Every delegation reader would change, and the reminder template has no quote of the user's own mail.
3. **D3, one chaser.** The job `loops.chaser` replaces `delegation.chaser`. In one transaction it runs the delegation step as before, then the loop step (follow-up cards, `stale`, `expired`), then the reminder set. `delegation.chaser` stays an alias of the job name for `job:run`.
   - Rejected: a second job next to the old one. Two jobs would plan two mails to the same person and two approval sets, and would need a lock between them.
4. **D4, a loop anchor.** `actions.email_id` is nullable and `actions.loop_id` is a second anchor. A check allows exactly one of them, and a `loop_id` row is a `create_draft` or a `send`. The committer reads the loop through `LoopHooks` (`isOpen`, `anchorOf`, `onFollowUpSent`), defined in `actions` and implemented by `loops`. The recipients of a follow-up come from the loop row only.
   - Rejected: an incoming mail of the thread as the anchor. A new thread that the user starts has none.
5. **D17, consent per user.** Loop lines and follow-up cards carry Sent-mail data. The Telegram consent version is bumped, and `loopConsentOf` (`channels/consent.ts`) is the one gate: a user whose consent is older gets counts and a panel link, never a loop line or a card. The panel asks again with a Confirm button (a user with an older consent sees it while `open_loops` is on).
   - Rejected: no bump. The owner rule of 2026-11-15 says a new kind of mail-derived data in Telegram needs a bump and a re-ask.

## Consequences

- Later kinds extend the same table and the same chaser. E6 may replace the `follow_up` template if the E2a judge shows a gain. E11a replaces `loop_wait_days` with a wait per contact.
- Every reader of `actions` and `outbox` has to handle a row with no incoming mail. `emailIdOf` throws `loop_anchor` for a loop row, so a reader that forgets it fails loud; a new reader must handle `loop_id` on purpose.
- Delete rules reach more copies: `open_loops` texts, the follow-up payloads, the cards and the digest rows that name a loop. The Sent switch off, the retention job and the erase of a person each have a test that scans every table.
- The follow-up is a draft and a send with the same two taps as every other send (ADR 0003). The system never sends it alone. The switch `auto_follow_up` (off) only plans the card for `waiting` loops.
- ADR 0029 stays true: the Sent folder is read-only. Loops add the analysis of that mail (one `extractor` call per mail, as untrusted data) and nothing else. Commands are typed `/api` routes and Telegram taps with a `via` (ADR 0023).
- Consent text and version are in `packages/core/src/web/telegram.ts` and `apps/web/src/i18n`. A later change of the loop data that reaches Telegram bumps the version again.
