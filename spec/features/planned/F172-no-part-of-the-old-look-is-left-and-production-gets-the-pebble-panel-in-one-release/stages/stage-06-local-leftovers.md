# F172 stage 06 — Local leftovers of the design study and the contact sheets

Coordinator only (the main checkout and the dev machine; no worker can see them). Needs stage 04: its land removes the `design/` lines from `.gitignore`, so the ignored design study files show as untracked in the main checkout. Run it right after that land. May run next to 05, except step 3 (it waits for the release land, P1).

Part of [`../plan.md`](../plan.md). Decision D8.

## Step 1 — The design study files in the main checkout

- **Look first:** in the main checkout, `git status --short design/` lists the untracked files (the other proposals `01-ledger`, `02-cockpit`, `04-today` … `08-aurora` and the gallery output). `git ls-files design` prints nothing (stage 04 landed).
- **Do:** move, not delete: `mkdir -p ~/.local/share/email-assistant/design-study-2026-11 && mv design ~/.local/share/email-assistant/design-study-2026-11/`. Then `git status --short` shows no `design/` line.
- **Stop:** if `git status` shows a tracked change under `design/` (a file that stage 04 did not remove), do not move it; report it.

## Step 2 — Scratch processes, worktree and databases

From the intake note (`notes/2026-11-23-pebble-ui-plan-intake.md`, "Left over from the design study"):

1. The gallery servers: `pgrep -af 'http.server 8700'`. Stop each one whose working folder is under the design study (`ls -l /proc/<pid>/cwd`). Leave any other process.
2. The scratch worktree `/tmp/ea-ui-shots`: `git worktree list` in the main checkout. If it is listed, `git worktree remove --force /tmp/ea-ui-shots`; if it is only a folder, look at it first (`git -C /tmp/ea-ui-shots status`), then remove the folder. Then `git worktree prune`.
3. Its two databases `2026-11-22-a1b2c3d4` and `2026-11-22-a1b2c3d4-e2e`: drop them on the dev Postgres the same way the coordinator drops a job DB after a land. They hold seed data only.

## Step 3 — Contact sheet folders

After the release lands (stage 05 step 4 passed): delete every job folder under `~/.local/share/email-assistant/ui-sheet/` except the folder that `visual-review.md` names (the owner's full sheet). Keep that one folder for 14 days; then the next coordinator clean-up removes it. This ends the outside path of F166 (its plan says "the cleanup ticket deletes the rest").

## Done when

- `git status --short` in the main checkout has no `design/` line.
- `git worktree list` has no `/tmp/ea-ui-shots`; `pgrep -af 'http.server 8700'` prints nothing that serves the design study.
- `ls ~/.local/share/email-assistant/ui-sheet/` lists only the folder of the full sheet.
- The results are one line each in the stage 05 section of `notes/2026-11-15-vps-deploy-queue.md` or in `outcome.md`.
