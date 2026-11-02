> **Status 2026-11-01 — in progress.** Left: decide on old rule files (`.cursor/rules/`, `.windsurfrules`, `.ai/`; `.github/copilot-instructions.md` does not exist); check code rules from Hotshots-appbackend.

# Agent config setup for email_assistant

Source inventory: `notes/2026-11-01-agent-config-inventory.md`.

## Done
- Copied skill `vps-ssh` from `mega/.claude/skills/` → `.claude/skills/`. Added: own folder `~/email_assistant/` and URL path `/email_assistant/` (server and port are shared with other projects).
- `mega-browser` was copied, then removed: the user said it is not useful here.
- Wrote `CLAUDE.md` (universal parts only + project summary; imports `.ai/AGENT.md`). User added rule: commit and push to `master` only (the repo's main branch; no `main` exists, do not rename), never force-push.
- Created work structure: `tasks/{active,planned,done}/`, `tasks/README.md` (from Hotshots-appbackend), `notes/`, `docs/known-alerts.md` (template from Hotshots-appbackend, Telegram text removed).

## Left
- plan-to-issues skill (mega/s01e05/rig): verdict — not usable as is (needs plan.md, docs/issues/, ADR 0004). Global `gh-tickets` covers GitHub issues. Decide later.
- Code rules from Hotshots-appbackend `.claude/rules/`: check each against this repo's code before copy.
