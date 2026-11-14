---
opened: 2026-11-13
landed: 2026-11-14
---

# F099 · E7-T2 Platform controls (send limits, feature flags, operator console, security log)

## Outcome

A bug can no longer send many mails: a mailbox sends at most 20 mails per rolling hour, 100 per rolling 24 h and 5 to one address per rolling 24 h. A send over a limit waits with a visible reason, and the operator gets one notice per mailbox per day. The operator works in a `/operator` console that shows ids, codes, counts and dates only, and an owner sees a security log in the Account card behind a flag. The panel learns which flags are on for its organization, so later epics can ship web features behind flags (PD-044, PD-045, PD-046, PD-048, ADR 0027).

## Scope

- Start at the send step of the committer (`modules/actions/send.ts`): the limit check runs where the send becomes `applying`.
- The operator console builds on the flag store, the operator check and the first operator route that the feature-flag ticket landed (F087); it absorbs the dropped operator-notice list ticket (F081).
- The security log reads the existing `audit_log` rows of sign-ins, lockouts, password changes and ended sessions.

## Out of scope

- TOTP for operators and the 2FA, export, delete and DSR log events: the identity and account-data tickets of E7 add them.
- SSO provider setup in the console, Polish texts, the E3a stats command.

## Acceptance

- The 21st send of a mailbox within one hour waits until the oldest of the 20 leaves the window, and the panel shows "approved, waiting: send limit".
- Two committers that run at once never send more than the limit (integration test with two connections).
- A non-operator, also an owner, gets 404 on every `/api/operator/*` route and on the `/operator` page.
- The operator sees every organization with plan, mailbox statuses, last job runs, failures of 24 h, LLM calls today, notices and flags, and changes a plan or a flag with the same audit rows as the CLIs.
- An owner of an organization with `security_log` on sees the newest security events; an assistant gets 403.
- The full list with the proving tests: [plan.md](plan.md) § Done when (13 checks).

## Slices

15 stages, one worker job each ([plan.md](plan.md) § Stages). Lane A (send limits) 01→05; lane B (operator) 06→11; lane C (security log) 12→13 after 06; 14 (docs) after all lanes; 15 (VPS deploy, run by the coordinator) last. Stages 02 and 05 add a migration: never next to another migration of any ticket. No owner checkpoint. Commands: [plan.md](plan.md) § "How to run (coordinator)".

## Sequenced

- Plan after: the repo-split ticket (F091; it has `stages/`): new action queries go into its `actions/repo/` files.
- Build after: public login (F082, landed); the repo split (F091) in `spec/features/done/`, because stages 02–05 edit the `actions`, `mail` and `channels/notices` files that it moves.
- Gate: —. Stages 02 and 05: no other migration in build.

## Notes

Open defaults: [questions.md](questions.md). Sources: `docs/product/stage-2/epics/E07-discovery-notes.md` §5–§7, ADR 0027.
