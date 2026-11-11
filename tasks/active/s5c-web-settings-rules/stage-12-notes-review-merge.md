# s5c-web-settings-rules — Stage 12

Part of [`../s5c-web-settings-rules.md`](../s5c-web-settings-rules.md). Read that file's "Done when", "Owns", S1–S11, "Facts checked", B1–B16, "User steps" and the master plan's "Rules for every step" (`tasks/active/s5-web-panel.md`) first.

## Stage 12 — Notes, alerts, master plan lines, group review, checkpoint, merge

- [ ] **12.1 Docs for the next agents**
  - Goal: what S5c learned and changed is findable without this chat.
  - Files: create `notes/<date>-web-settings-rules-facts.md`; change `docs/known-alerts.md`, `docs/code-patterns.md`, `tasks/active/s5-web-panel.md`, `tasks/planned/s5d-web-activity.md`, `tasks/planned/s5e-web-deploy-docs.md`, `tasks/planned/web-public-hardening.md` (pointer lines only).
  - Decisions:
    - The note: the gate facts (fact 4, `atConfidence`, the `forced` change of B2), the timezone effects (fact 3 with the five cases), the signature effect (fact 7: a change applies to every message built after it, also to the send of an older draft), the server time-zone list (B10), the Better Auth session facts (fact 1), the e2e members (B15), every deviation from the plan with its stage.
    - `docs/known-alerts.md` (one entry each: text, cause, fix, status): `organization <id> timezone changed by <actor>` and `organization <id> signature changed by <actor>` (info; expected); `rules:add` `refused: rule limit reached (1000)` (a CLI line; the cap of B7).
    - `docs/code-patterns.md`, "HTTP routes (S5)": one clause: a route that needs another module's service gets it as an injected dependency from the composition root (`settingsRoutes` gets the gate and the folder setter, B6); `config` reads `mailboxes` for `mailboxInOrg`, as it does for `getMovesSupported`. "Web app": a form under polling keeps its draft with `lib/draft.ts`.
    - Master plan (`s5-web-panel.md`): dated lines (2026-11-1x, "S5c build") on D8 (no `triage/routes.ts` in S5c; the `auto` route in `config/routes.ts` with the gate injected, B6), D10 (b) (a result union, `forced` only when the gate did not pass, `atConfidence`, B2), D10 (d) (one `updateOrganizationSettings`, style text ≤ 500, `org.style_changed { set }`, B9), D10 (e) (`mailbox_id` in the rule audit data, the cap, B7), D16 (no digest times in the settings view; `/api/me.digestTimes`; the server's time-zone list, B9, B10), U8 (fact 3), D9 (the code `rule_limit`), the contract rows (`GET /api/settings/:mailboxId` shape; new `GET /api/organization`; new `PATCH /api/settings/:mailboxId/sync-folders/:key`; `POST /api/rules` 404 and 409 `rule_limit`; `GET /api/me` `digestTimes`; `no_go` body `{ error, gate }`; `PATCH …/auto/:category` returns the plain settings change without `gate`; `GET /api/rules?mailboxId=` of another organization's mailbox answers 200 with the org-wide rules, not 404, B8); P7 and round 1 question 7 ("timezone … read-only in S5" is superseded by U8 and S7: the timezone is editable); the S5c segment box ticked with a link to `tasks/done/s5c-web-settings-rules.md`; the status line "next: the S5d plan session".
    - S5d pointer: `triage/routes.ts` does not exist yet (S5d creates it); `ApiError.raw` and `useResource.mutate` exist; the e2e seed has `members` per project; `cleanUpOrg` resets rules, timezone, signature and the owner's digest times. S5e pointer: the time-zone list comes from the server (check one change on the VPS image, Bun 1.3.14); the U8 note. `web-public-hardening.md`: an audit row for "Sign out everywhere" (B13).
  - Check: `bunx prettier --check` on every changed Markdown file.
  - Done when: the files are written and pass Prettier.

- [ ] **12.2 Group review, checkpoint, merge**
  - Goal: the whole segment is reviewed as one change, the user sees it work, and it lands on `master`.
  - Decisions:
    - Group review: the `reviewer` subagent on `claude-bridge/claude-opus-5-5` high over the range `<branch base>..HEAD` (all stages PASS first): a pre-mortem ("a bug of S5c reached the user: which stage let it through?"), the owner and tenant rules over every new route, the gate against the CLI's old behaviour, no pattern or signature text in an audit row or log line, the polling and draft behaviour of the forms, the e2e cleanup. Findings → fix commits, then a new review of the fix range.
    - The full check line in the worktree: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int && bun run web:build && bun run test:e2e`; record the counts.
    - The user checkpoint of the segment file (the agent runs the walk-through unless the user wants to; screenshots at 400 px and 1280 px; zero console or CSP errors); then ask for the go.
    - Merge (`tasks/README.md` § "Git mode", worktree step 3): `git fetch`; S5c has no migration, so no rename; `git merge origin/master` in the branch; the full check line again; in the main checkout `git merge --no-ff task/s5c-web-settings-rules`, push; `bun install --frozen-lockfile` on the dev checkout. CI on the merge commit: `e2e` and `image` green; `ci` may stay red only on the known testmail flake (`docs/known-alerts.md`).
    - Close: the done-checklist, the status line `done`, `git mv` the task file and its folder to `tasks/done/`, remove the worktree, delete the branch (local and remote), `bun run db:worktree s5c --drop` (user step 3).
  - Check: the commands above, each with its output in the log.
  - Done when: `master` holds S5c, CI as stated, the task is in `tasks/done/`.
