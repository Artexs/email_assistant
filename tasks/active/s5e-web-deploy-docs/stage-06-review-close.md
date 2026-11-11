# s5e-web-deploy-docs — Stage 6

Part of [`../s5e-web-deploy-docs.md`](../s5e-web-deploy-docs.md). Read that file's "Done when", "User checkpoints", "Review model" and the master plan's "Done when", "Done-checklist" and "Segments" first.

## Stage 6 — Group review, checkpoint 4, close of S5, follow-up, handoff for S6

- [ ] **6.1 Group review** (main session calls the `reviewer` subagent on `claude-bridge/claude-opus-5-5` high)
  - Scope: the S5e branch range (`<branch base>..HEAD`, stages 1 and 5 and any smoke fixes) plus the stage 2 and 4 logs as evidence. Questions: a pre-mortem ("a month after the deploy the panel failed the user or leaked data: which S5e decision let it through?"); the runbook against the real deploy log (a step that differs from what ran); the ADRs and docs against the code (a claim the code does not hold); a tailnet name anywhere in the diff; the done-when lines and their evidence.
  - FAIL → fix steps (max 2 rounds, then the user decides). Smoke-fix code (stage 4.6) gets the full check line: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int && bun run web:build` and, if a page changed, `TELEGRAM_BOT_TOKEN= WEB_MAIL_ALLOW_LOCAL=true bun run test:e2e` (needs an e2e database; see `tasks/done/s5d-web-activity.md` user step 0 for the keys).
  - Done when: PASS.

- [ ] **6.2 Checkpoint 4 and the final merge**
  - At least 24 h after the first login (E11): ask the user how the panel worked (the phone and the PC; what was slow, wrong or missing). Each item → a fix (small, safe, in this branch, deployed with this merge) or a `tasks/planned/` file. Quote the user's words in the log.
  - The follow-up file `tasks/planned/compose-network-subnet.md` (E3: pin the Compose network subnet so `WEB_TRUSTED_PROXIES` survives a network recreate; needs a planned `down`/`up` of the stack outside a pilot week; status `planned`), and, if the editor rule files still name Supabase, `tasks/planned/editor-rules-cleanup.md`.
  - Merge (`tasks/README.md` § "Git mode", worktree step 3): `git fetch`; `git merge origin/master` in the branch; `bun run lint && bun run typecheck && bun run test:unit`; in the main checkout `git merge --no-ff task/s5e-web-deploy-docs`; push. If the merge holds code (smoke fixes), deploy it with the runbook "Update" (no migration expected) after the user's go, and repeat the access check of E9 once.
  - Done when: `master` has S5e; CI `image` and `e2e` green, `ci` red only on the known timing tests.

- [ ] **6.3 Close S5** (main session, `Git mode: master`)
  - This task: tick the done-checklist with the evidence (the commands and outputs from stages 1–5); status `done`; `git mv tasks/active/s5e-web-deploy-docs.md tasks/active/s5e-web-deploy-docs tasks/done/`.
  - The master plan `tasks/active/s5-web-panel.md`: fix the stale lines (difference 7: the S5d segment line; D23 "0014 reserved by llm-provider-switch" → a dated line that 0014 is the sync folders ADR); a dated line on D22 and the checkpoints with two deviations and their reasons: the first password was set on the PC, not the phone (A4: the link never leaves the user's terminal and browser), and the `.env` keys were set after the checkpoint 3 go, in stage 4.2 (the gateway is read on the VPS first); tick the S5e segment box and link it to `../done/s5e-web-deploy-docs.md`; the done-when lines with their evidence ("set up a mailbox and link Telegram without the CLI": S5b Playwright and the stage 4 Onboarding item; "the activity page …": S5d Playwright and the smoke item 6; "Playwright smoke tests pass": 40 on the S5d merge and the CI run of the final merge; "reachable from outside the home network only through TLS": E9); the done-checklist; status `done`; `git mv` it to `tasks/done/` (difference 14: S5a–S5d are there already). Fix the relative links in both files after the move (`../done/…` → `./…` or as needed; `tasks/README.md`: link fixes are the one allowed edit of done files).
  - Clean up: `git worktree remove ../email_assistant-wt/s5e-web-deploy-docs`, `git branch -d task/s5e-web-deploy-docs`, `git push origin --delete task/s5e-web-deploy-docs`.
  - Commit `tasks: S5 done — S5e closed, master plan to tasks/done` by explicit paths; push.

- [ ] **6.4 Handoff for S6**
  - With the `handoff` skill: a handoff file `~/.pi/agent/notes/<date>-handoff-s6-plan.md` for the S6 plan session (`tasks/planned/s6-pre-sale.md`; the Polish translation and the e-mail sender lines; `tasks/planned/web-public-hardening.md` before the panel leaves Tailscale; ADR 0016's S6 path). Show it to the user; open the new session only when the user asks.
  - Done when: the handoff file exists and the user saw it.
