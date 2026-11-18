---
opened: 2026-11-13
landed: 2026-11-18
---

# F110 · E4-B Earn trust

## Outcome

A new user earns automatic moves per category without labelling mail. At connect the system checks 30 days of the mailbox by itself, shows a "what I would have done" report in the panel, and turns on the recommended categories with one tap. A tripwire and a model or endpoint switch pause a category with a notice. The user can also get the digest by mail, set their own quiet hours, see why and how sure each digest line is, edit "what is urgent for me", and unsubscribe from newsletters with one tap.

## Scope

- Evidence for `auto` per ADR 0028: global holdout (gate files), the history check at connect, the tripwire, the re-gate on a model or endpoint switch.
- Report page, "Turn on recommended", autonomy card with three sources, optional "Check 10 decisions", M8 evidence rows.
- Why-line gaps, spam review line, per-user quiet hours and report channel, report mail into the own INBOX (ADR 0022).
- Urgency editor card; bulk unsubscribe (last group, can be cut).

## Out of scope

- Approvals, delegates and delegation pages, nav badge (E4-A, F102).
- Sent-folder signals for the history check (E5a, F104); sample reply drafts on the report (E6a).
- Telegram `/review` (F028 in E2a); history backfill of folders other than INBOX (F060).

## Acceptance

- A new mailbox gets a history check with no user step, and its report page shows the result within one hour (stage 07 test 8, stage 14 tests).
- "Turn on recommended" turns on only eligible moving categories, and the mailbox is in `assist` after it.
- After a model or endpoint switch, no mail moves under the old grant.
- Two corrections of applied moves in 7 days turn `auto` off for the category and queue one notice.
- A mail-only member finds the digest in INBOX, and sync does not triage it.
- Each stage's Proof prints `PROOF_OK`.

## Slices

One worker job per stage, 26 stages; order, lanes and checkpoints in `plan.md` § Stages and § How to run. Stages 03 and 22 add migrations and never build next to another migration.

## Sequenced

- Plan after: F102 (E4-A, OpenAPI frame stages 01–03 written), F109 (E3b, suspicious readers, stage 04), F111 (E11b, endpoint in gate files, stage 03). All have `stages/`.
- Build after: F097 (E2a) and F100 (E3a) in `done/`; F102 stages 01–03, F109 stage 04 and F111 stage 03 landed (all at plan base 9341d9f0). The urgency command of E3b is landed.
- Gate: —
- Refresh: before stage 01 builds, if master moved (`scripts/plan-drift.sh`). Refresh 1 base: 17b2a369 ([plan-refresh-1.md](plan-refresh-1.md)).

## Notes

Source row: `docs/product/stage-2/05-execution-plan.md` §2.1 # 16. Open defaults: `questions.md`.
