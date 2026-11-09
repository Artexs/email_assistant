> **Status 2026-11-09 — planned.** Not started. Needs an eval run before any prompt change.

# Give the classifier the source folder as a hint

Scope: follow-up of [`../active/sync-sort-folders.md`](../active/sync-sort-folders.md) (D13). Needs: that task done, its pilot data, and the eval runner.

## Goal

The classifier gets no hint about the folder where a mail arrived (D13). A mail in `Oferty` (Interia's offers tab) or in the spam folder probably has a different spam and urgency base rate than INBOX mail. Test whether a folder hint in the prompt improves the labels.

## Done when

- The eval set has cases with a source folder. An eval run with and without the hint is in `notes/`, with the numbers for each category.
- Only if the hint wins: the prompt change, the `ClaimedEmail.source_folder` use and the prompt version bump are built, and the eval gate passes.
- An injected folder name in mail text cannot change the hint (the hint comes from the server's folder list, never from mail text, D15).

## Plan

Write the file-level plan when the task starts. `[risky]`: LLM prompts and evals.

- [ ] Write the plan.

## Done-checklist

- [ ] Done-when checks pass (name the command and its output in the log).
- [ ] `docs/` describe what was built (architecture, modules, roadmap); related ADRs set to accepted or superseded.
- [ ] Learned facts are in `notes/`; new alerts in `docs/known-alerts.md`.
- [ ] Follow-up ideas are in `planned/`.

## Log

- 2026-11-09: Created from the follow-ups of `sync-sort-folders` (stage 15, step 15.2).
