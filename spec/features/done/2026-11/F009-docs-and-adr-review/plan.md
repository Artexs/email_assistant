> **Status 2026-11-02 — done.** Nothing left.

# User review of docs and ADRs

Scope: `docs/architecture.md`, `docs/modules.md`, `docs/roadmap.md`, `docs/code-patterns.md`, `docs/decisions/`. Needs: — (the cold review `done/mvp-plan-review.md` already changed these files).

## Goal
The user reviews the proposed docs. Accepted ADRs get status `accepted`; changes get new ADRs.

## Done when
- ADRs 0001–0003, 0005, 0008–0012 are `accepted` or replaced (0004 and 0006 are already superseded by 0010 and 0011).
- `architecture.md`, `modules.md`, `roadmap.md`, `code-patterns.md` headers say "Accepted".

## Plan
- [x] Cold review of the docs rewrite (commit `29e9522`) by the `reviewer` subagent, round 1.
- [x] Fix the round-1 findings; review the fixes, round 2.
- [x] Fix the round-2 findings.
- [x] The user accepts the docs and the ADRs; set the statuses.

## Done-checklist
- [x] Done-when checks pass (see log).
- [x] `docs/decisions/README.md` table matches the ADR files.
- [x] Follow-up ideas are in `planned/` (none new: the open checks are marked `[not verified]` in the docs and belong to S1a and S4).

## Log
- 2026-11-02: Created from the open items of `architecture-reset.md`.
- 2026-11-02: Scope updated after the cold review: new ADRs 0010–0012 and `docs/code-patterns.md`.
- 2026-11-02: Round 1 (`reviewer` subagent, commit `29e9522`): FAIL, 19 findings. Main ones: `imap_move` feedback without a check that the system moved the mail; exactly-once send cannot work (now at-most-once with a Sent search and `outcome_unknown`); gaps in the status flow, retention and the module graph.
- 2026-11-02: Round 2 (fixes in the working tree): FAIL, 16 findings (2 major). Major: mark a send `applied` at once after the SMTP 250 and copy it to Sent as a separate step; ADR statuses not set. Minor: retry a send only on an error with a known stage before DATA, status edges, duplicate copies, Undo race, draft→send policy, "moves not supported", `locked_at`, graph edges, retention, S3 test, S0 notes, roadmap line, Mermaid `;`.
- 2026-11-02: Round-2 fixes applied. The main session checked each of the 15 doc findings by grep (no third reviewer round). The user accepted the docs and ADRs ("all is fine and approved"). ADRs 0001–0003, 0005, 0008–0012 set to `accepted`; README table updated. Check: `grep -n "^- Status" docs/decisions/*.md` → no `proposed`; `grep -c "| proposed |" docs/decisions/README.md` → 0.
