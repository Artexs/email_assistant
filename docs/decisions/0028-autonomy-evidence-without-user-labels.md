# 0028 — Autonomy per category is earned from global evidence and a history check, not from user labels

- Status: proposed (E4 discovery, 2026-11-13; the owner's rule, PD-030). Changes PD-018 and the real-label clause of PD-024. E3 sets the numbers.
- Date: 2026-11-13

## Context

Today a category gets `auto` only when the real-label gate is `go`: precision ≥ 98% on at least 30 labelled rows of that mailbox (`apps/server/src/modules/triage/gate.ts`, `packages/core/src/web/settings.ts`). A new user never gives 30 labels per category, so the gate never opens without "set anyway".

The owner's rule (2026-11-13): "we can't rely on users to confirm any values there, whether this is 30 or 10 or even 1." The system must work on global assumptions. An automatic check of the mailbox history (received and sent mail, the PRD cold start, `.ai/prd.md` §3.3 and US-018) adjusts it. User checks are optional and suggested; they never block.

## Decision

1. **Global evidence decides by default.** A category is eligible for `auto` when it passes go/no-go on the frozen simulator holdout for the running prompt and model version (E2a, PD-024: at least 200 cases, Wilson 95% lower bound against the bar). The result is stored per version and is the same for every mailbox.
2. **History check at connect.** Without a user step, the system reads the last 30 days of the mailbox read-only (INBOX and synced folders, with `\Seen`, `\Answered`, `\Flagged`; Sent after the E5 read-Sent ADR), classifies a capped sample, and compares the result with weak labels from the user's behaviour. It counts mail the user acted on (answered, flagged, wrote to the sender) that a moving category (`notification`, `spam`, `info`) would have moved. A category that fails stays off, with the reason and the example mails. No history or no result: global evidence alone decides.
3. **User signals only block.** Corrections, Undo, moved-back mail and optional reviews never unlock a category. A tripwire pauses `auto` for a category when its corrections pass a rate, with a notice. With enough labels (at least 30) the real-label gate counts as an extra block.
4. **Consent stays a tap.** Shadow stays the default mode. The user turns on the recommended categories with one tap on the report page; the mode is the consent (D2). "Set anyway" for a category that failed stays, with its audit row.
5. **E3 owns the numbers:** the history-check bound (default: Wilson 95% upper bound of acted-on mail moved ≤ 2% on at least 50 mails), the sample cap (default 500 mails) and its cost cap, the tripwire rate (default 2 corrections of applied moves in 7 days, or one acted-on mail moved).

## Consequences

- A new user gets a report and a recommendation within the first hour (M6), not after a week of labelling.
- The first real-mail proof for a mailbox is automatic. The Stage 2 exit line "`notification` and `spam` pass on real mail" (`03` §7) is read as "pass the history check on the pilot mailbox".
- New data: IMAP flags per stored mail (or a history-check table) and a stored holdout result per prompt and model version.
- Weak labels are noisy; they are used only as a one-sided safety check, never as a precision number.
- `docs/architecture.md` §4.3 ("A category gets automatic moves only after it passes the go/no-go bar") gets the new evidence rule when E4-B lands.
