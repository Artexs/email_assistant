> **Status 2026-11-12 — planned.** Follow-up of S5e (stage 5 "Out of scope"). Not started. Small docs change.

# Editor rule files still name Supabase

Scope: `.cursor/rules/{api-supabase-astro-init,backend,db-supabase-migrations,shared}.mdc`, `.windsurfrules`, `.github/copilot-instructions.md`. Needs: none.

## Goal

The editor and Copilot rule files describe the real stack (Bun, Hono, Postgres 17, dbmate, Kysely, Astro static build with Better Auth; ADR 0011, ADR 0015), so an editor agent does not write Supabase code.

## Done when

- `grep -il supabase .cursor/rules/* .windsurfrules .github/copilot-instructions.md` → no file, or each hit says that the old stack is history.
- The rules that stay point to `CLAUDE.md` and `docs/code-patterns.md` instead of repeating them.

## Plan

- Decide with the user: delete the old rule files, or rewrite them. Nobody may rely on them (`.ai/` is history, `CLAUDE.md` is the source).
- Make the change in one commit on `master` (`Git mode: master`).

## Log

- 2026-11-12: Created at the S5e close; `grep -lis supabase` finds these six files.
