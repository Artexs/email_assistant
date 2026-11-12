> **Status 2026-11-12 — planned.** Checks and cleanups that the user skipped when S5e closed. Do them whenever the user wants; none blocks S6 planning, but the hardening items should be done before another person gets an account.

# S5e open checks

Scope: `tasks/done/s5e-web-deploy-docs.md` (stages 3, 4 and 6.2). Needs: S5e deployed (VPS `master` `8f6a8b2`, 2026-11-11 23:37:21 UTC).

## Goal

Close the items of S5e that have no evidence. On 2026-11-12 the user decided to keep the panel as it is and skip them: "Can we skip all those steps? As they are not necessary and not relevant. I want to keep it as it is right now."

## Done when

- The phone: signed in on the OnePlus 12 (phone type and browser in the log); the page does not open with Tailscale off (mobile data); the bottom sheet with a long AI text works.
- ↩️ once on a mail, with `web undo started` 1 in the log and the mail moved back; ✏️ once on a mail whose category is really wrong.
- The 39 ✅ rows (`triage_feedback.source = 'web'`, `verdict = 'right'`, 2026-11-11 23:54 to 2026-11-12 00:03 UTC, about 14 seconds per mail): the user says whether each category was checked. If not, exclude the window from the go/no-go counts (`triage/gate.ts` reads every source).
- Hardening items, security-relevant:
  - `~/.cache/ea-smoke.pw` on `omarchy` holds the owner's current password in plain text (mode 600). Change the password (Settings, Account card), use "sign out everywhere", and delete the file.
  - `~/email_assistant/.env.bak-s5e` on the VPS holds every secret (mode 600). Delete it (`rm ~/email_assistant/.env.bak-s5e`); `git status --short` on the VPS shows it as untracked until the `.gitignore` rule (`.env.*`, in `master`) is pulled by the next update.
- The pilot after the deploy: the digest of 07:00 UTC on 2026-11-12 was sent, and the committer and notifier ran (`outbox` digest rows with `sent_at` after T, the log lines). No evidence existed at the close.
- Optional: a 24 h day of use with the report of what was slow, wrong or missing (checkpoint 4 of the master plan).

## Plan

Each item is one command or one tap; the agent counts the audit rows and log lines afterwards (`web.login`, `web undo started`, `triage_feedback` by source and verdict, `auth_sessions`, `error` lines, the six warn texts of E10 in the S5e task).

## Log

- 2026-11-12: Created at the S5e close; the items come from the stage 3.4, 4.4, 4.5, 4.6 and 6.2 lists and the group review (findings 2, 3, 8, 9).
