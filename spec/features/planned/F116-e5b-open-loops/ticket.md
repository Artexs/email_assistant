---
opened: 2026-11-13
---

# F116 · E5b Open loops

## Outcome

Nothing the executive waits for slips. The system tracks the replies they wait for, the dated promises they made, and the work they delegated by hand, and it chases each one with a follow-up draft that waits for one tap. The first digest of the day becomes a "needs you today" brief. Source: row 22 of `docs/product/stage-2/05-execution-plan.md` §2.1 and the epic page `docs/product/stage-2/epics/E05-open-loops.md` (owner decisions PD-115–PD-129).

## Scope

- A sent-mail eval bank and an extractor gate, built with the offline-lab tools.
- A new server module `loops` that owns the loop table, the analysis of the user's own sent mail, the close rules and the one chaser (it takes over the delegation chaser).
- A follow-up draft kind that goes through the existing approval and send path.
- A Delegate button with a delegate picker in Telegram and the panel; hand forwards to a delegate become tracked delegations.
- Loop sections in the morning digest, loop taps in Telegram, `/api` loop commands, an "Open loops" panel page, mailbox settings and the M2 numbers for loops.

## Out of scope

- Promises that other people made (PD-122), snooze of incoming mail, calendar items, a wait per contact (sender context, E11a).
- A delegate alias list (only if the live-lab week shows the miss), the report mail channel (ADR 0022 is not built), the "no sent mail seen" notice of the Sent reader.

## Acceptance

- On the frozen sent-mail holdout, `expects_reply` recall ≥ 90% and precision ≥ 80%, promise precision ≥ 90%, due date exact ≥ 90% (gate file under `evals/results/gate/`).
- A sent mail that asks a question and gets no answer shows as a Waiting line in the morning brief on its due day; a reply from any original recipient closes it; an auto-reply does not.
- "Draft follow-up" makes an approval card with the original To and Cc, in the thread; nothing goes out without the second tap.
- A Delegate tap on a digest row makes a delegation draft to the chosen delegate.
- The panel page "Open loops" shows the tabs Delegated, Waiting and Promised with zero axe violations.
- On the pilot mailbox, one real follow-up went out after a tap.

## Sequenced

- Plan after: F104 (Sent reader), F102 (panel commands and delegation page), F109 (suspicious-mail readers), F115 (reply drafts: shared thread index and consent gate). All four have stage files.
- Build after: F097 (offline lab) and F100 (measurement) in `done/`; F102 and F104 in `done/` before stage 07; F109 stage 04 is on `master`. Stages 01–06 need only F097.
- Gate: Second pass after the first E3a weekly report and the E2b live week (PD-119, PD-120, PD-122): gate G1 before stage 24.

## Notes

- Design input: `docs/product/stage-2/06-architecture-review.md` §5 and §8 decision 3 (one `loops` module, one chaser).
- Absorbs the planned "delegation reply from another address" ticket (F040) for Waiting loops (PD-121).
