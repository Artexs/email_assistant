---
opened: 2026-11-13
---

# F085 · A mailbox whose host the guard refuses gets a status and a notice

## Outcome

When the mail host guard (F082 stage 8) refuses the host of a mailbox, the mailbox gets a clear status and the owner gets one notice. Today the refusal is only a `sync <id> failed: host not allowed` log line on every run, so nobody sees it. The status shows in the panel and in `mailbox:check`, and the notice follows the same one-per-episode rule as the other mailbox notices.

## Scope

- Starting seam: `apps/server/src/modules/mail/host-guard.ts` (`HostNotAllowedError`), the sync loop in `modules/mail/`, the mailbox status flow (§4.6 of `docs/architecture.md`) and the notice detection of `channels.notifier`.
- Found by the cold review of F082 (finding 5, `spec/features/active/F082-s6b-public-login/plan-review-1.md`).
- Design, decisions and stages: [plan.md](plan.md). Defaults for the owner: [questions.md](questions.md).

## Out of scope

- Changes to the guard rules or its address ranges.
- The connect form: it already refuses such a host with an answer.

## Acceptance

- A mailbox whose host the guard refuses at sync or send time gets a status that the panel and `mailbox:check` show.
- The owner gets one Telegram notice per episode, with no host name or address in the text.
- A test with a fake resolver that returns a local address covers the status and the notice.
- Detail: `plan.md` § Done when (9 checks).

## Slices

One worker job per stage (`plan.md` § How to run): 01 → 02 → 03 → 04 → 05 → 07, each after the one before has landed. Stage 06 may build after stage 04 lands, next to stage 05. Stage 02 is the only migration: never next to another migration in build. No `bun.lock` change. No owner checkpoint.

## Sequenced

- Plan after: none (the plan uses landed interfaces only: the notice detector and renderer registries of the notices-as-facts ticket F088, and the texts registry of the Polish UI ticket F098, whose text stages 06–11 are in `master`).
- Build after: F088, in `spec/features/done/`.
- Gate: —
