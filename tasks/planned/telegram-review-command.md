> **Status 2026-11-06 — planned.** Idea from S2 (stage 22): more labels for the go/no-go tables.

# `/review` command in Telegram

Scope: `docs/roadmap.md` §2 (S1b and S3 go/no-go tables need labels). Needs: S2 (digest lines with ✅ / ✏️ buttons, `triage.recordFeedback`).

## Goal

A `/review` command shows more triaged mail that has no label yet, each line with ✅ / ✏️ buttons, than the 15 lines of a digest. The user labels mail in a quiet moment, and the labels feed the per-category go/no-go tables of S1b (eval on real mail) and S3 (assist mode).

## Done when

- `/review` shows the mail without a `triage_feedback` row, newest first, with the same line format and the same buttons as a digest line (✅ = the shown category is right; ✏️ opens the picker; an `unsure` line has only ✏️).
- Categories with the fewest labels come first, so the thin categories (for example `urgent`, `needs_reply`, `info`) get labels sooner. The plan decides the rule and the page size (a message holds at most 4096 characters and 15 lines with buttons, like a digest).
- A tap writes the same `triage_feedback` row as a digest button (source `telegram`; the latest row wins; the same answer twice writes nothing).
- Only linked chats can use it; an unlinked chat gets no reply. The command is in `BOT_COMMANDS` and in `/help`.
- Tests: the lines skip labeled mail; the order by label count; a mail of another organization never shows.

## Plan

Written when the task starts. Reuse `renderDigest` pieces from `packages/core/src/digest/` and `listTriagedBetween` / `latestFeedback` from `triage`. Add a read query for "triaged mail without feedback" in `triage` (filter by `org_id`).

- [ ] step

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap).
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-06: Created in S2 stage 22.
