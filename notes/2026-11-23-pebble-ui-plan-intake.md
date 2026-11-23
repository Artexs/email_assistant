# Pebble redesign of the web panel: plan intake (2026-11-23)

Input: the handoff `~/.pi/agent/notes/2026-11-23-handoff-pebble-ui-migration-plan.md`. Method: `~/.pi/agent/skills/plan-task/SKILL.md`.
State: step 1 (collect) done at commit `cd7c95a39`. Step 2 (questions to the owner) sent 2026-11-23. The owner answered with a wider task: analyse the whole transition first, no redesign flag, one production release, no leftovers. The analysis and the current decision list are in `notes/2026-11-23-pebble-ui-transition-analysis.md`; it replaces the question list at the end of this file. No ticket exists yet.
Do not run `limen ticket new` before the owner answers: an uncommitted ticket in `planned/` with no stages shows as "needs plan" in `scripts/coord-scan.sh`, and a coordinator session can start a second planner for it.

## Goal

One Limen feature folder (ticket, plan, one file per stage) that moves `apps/web` from the stock shadcn look to the Pebble design (`design/ui-proposals/proposals/03-pebble/index.html`). The stages cover every page, also the pages the mockup does not show.

## Handoff claims checked against the code

True: branch `master` at `cd7c95a39`; `design/` is the only untracked path; 48 Pebble shots; no ticket for the redesign; both gallery servers run on port 8700; the scratch worktree `/tmp/ea-ui-shots` exists; `global.css` holds the stock neutral tokens; the page, island and shell lists.

Differences:

1. **The GitHub repo is public** (`gh repo view`: `Artexs/email_assistant`, `PUBLIC`). A commit of `design/` publishes the mockup. `design/ui-proposals/analysis.md` names the Tailscale address of this machine in two places (§ How to view): remove those lines before a commit.
2. **The board prose is stale.** `spec/build.md` NEXT still lists F108, F121, F122, F124, F125, F129, F141, F158, F162, F163 as open. All are in `spec/features/done/2026-11/`. `planned/` holds no ticket. Active: only F115 (reply drafts; all 19 stages landed, owner checks open) and F151 (demo video and docs shots; stages 05, 06, 07 open).
3. **The Stage 2 order table is history** (`spec/build.md` NEXT last line; row 28 is in `done/`). The redesign is a new ticket after Stage 2: it needs a NEXT line on the board, not a row in `05-execution-plan.md` § 2.
4. **F162 and F163 (privacy texts) landed** on 2026-11-20 and 2026-11-21. They do not conflict.
5. **"6.5 hours saved" has no metric**: `packages/core/src/metrics/` holds m1–m5, m7, m8, `reply-drafts`, `week-stats`, `cost-model`; none computes saved time. The number comes from `_shared/data.js` (`savedHours`).
6. **The mockup has no dark-mode switch in the product UI.** The switch is in the gallery tool bar (`_shared/kit.js`). The panel follows `prefers-color-scheme` today; `next-themes` is a dependency already (used by the toast component only: check before use).
7. **A self-hosted font passes the CSP**: `apps/web/astro.config.mjs` sets `font-src 'self'`.
8. **`apps/web/e2e/.seed.json` is not in the main checkout.** The e2e global setup writes it; it exists only in a prepared job worktree.
9. **The real panel is much larger than the 12 mockup screens.** Settings has 23 component files (two-factor, push devices, reply style and samples, security log, sent mail, sync folders, Telegram lock, notice routes, loop settings…). Rules has newsletters, suggestions and the urgency editor. Delegations becomes the Open loops board (`components/loops/`) while the flag `open_loops` is on. Approvals holds the reply-draft controls (`ReplyControls.tsx`). There are also the Telegram detail pages, the operator console, setup, forgot, legal, 404, offline, the terms dialog, the "what's new" dialog and three banners. The plan must give each of them a stage; the worker has no mockup for them, only the Pebble patterns.
10. **The mockup changes more text and structure than the handoff lists.** Page headings are in the first person ("What I did", "Was I right?", "Waiting on others", "Your week", "What I would have done"). The phone tab bar shows approvals, review, activity, stats, settings; today it shows the first five of activity, approvals, delegations, mailboxes, settings, rules, stats. The mockup home is Approvals; today `/` goes to `/onboarding`. The Mailboxes mockup has an "Automatic actions" card, a Pause button and a "mails today" number; the delegate cards have "open" and "overdue" counts; the review cards have confidence dots; Stats has a week-by-week bar chart. Each needs a data check in plan step 3.
11. **Polish first-person past tense has a gender** ("zrobiłem" / "zrobiłam"). A direct translation of "What I did" gives the assistant a gender.

## Facts for the plan (found in step 1)

- Web stack: Astro 7.4, React 19, Tailwind 4.3, `radix-ui`, `lucide-react`, `sonner`, `next-themes`. Dark tokens are in a `@media (prefers-color-scheme: dark)` block; components use Tailwind `dark:` classes (media-based by default).
- `global.css` also styles the legal pages by hand (`.legal-*`): they read `--border`, `--radius`, `--muted`, so a radius of 22 px reaches them.
- i18n: `apps/web/src/i18n/texts/en-<group>.ts` and `pl-…`; key groups never repeat (`texts/groups.test.ts`).
- e2e: 37 spec files in `apps/web/e2e/tests/`; `a11y.ts` (28 lines); `docs-shots/shots.spec.ts` refuses an organization with any flag on; `demo/record.spec.ts` drives the approvals page by id.
- Flags of pages: `approvals_page`, `delegation_pages`, `stats_page`, `panel_review`, `open_loops` (`packages/core/src/features.ts`).
- Docs rule: PD-009 and PD-100 (`docs/code-patterns.md` § Capability map): a landed user-visible change updates `docs/capabilities/web-panel.md` and the user page in the same change; a feature behind a default-off flag gets no user page until the flag defaults on.
- Board models: worker `claude-sonnet-5-5`; review `claude-opus-5-5` for `[risky]`, sending to people, and new user-facing Polish text.
- Left over from the design study: scratch worktree `/tmp/ea-ui-shots`, DBs `2026-11-22-a1b2c3d4` and `2026-11-22-a1b2c3d4-e2e`, two `python3 -m http.server 8700` processes.

## Questions sent to the owner (plan-task step 2), with the proposed defaults

1. **Publish the mockup in the public repo?** Default: commit the Pebble HTML, `_shared/`, `tools/`, `analysis.md` (without the Tailscale lines) and the 48 Pebble shots (7.6 MB). The other seven directions and `current/` stay local and go into `.gitignore`. Reason: a job worktree sees only committed files.
2. **Behaviour changes and flags.** Default: the theme, the shell and every restyle ship with no flag. Two flags, on for the pilot first: the approvals focus queue and the delegation status columns. The onboarding mode cards, the sentence rule form and the new empty states show the same controls in a new layout, so they get no flag. Rejected: five flags (each one keeps two code paths and two test sets). The columns apply only to the Delegations tab; the Open loops tabs keep their lists.
3. **Mockup items with no data today** ("12 approved this week", "3 min on average", "6.5 hours", and each item of difference 10 that the API does not give). Default: cut; the plan lists each cut; a new metric is a later ticket by the metric rule.
4. **Text voice.** Default: take the friendly headings and button texts that need no gendered Polish verb ("Yes, send it", "Was I right?"); keep the navigation names; no first-person past tense. Every new Polish text gets an Opus review.
5. **Font.** Default: self-host Nunito (variable, OFL licence, Latin and Latin Extended for Polish) as a file in `apps/web/public/`, no new dependency; stage 01 checks the licence text and the size.
6. **Dark mode.** Default: system setting only, as today. A manual switch needs a script before the first paint; later ticket if wanted.
7. **Name and mark.** Default: keep "Email Assistant" with the teal mail mark of the mockup.
8. **Order with the demo video and docs shots (F151).** Default: F151 finishes its tooling stages now; nothing publishes until the redesign lands; the last redesign stage runs the docs shots and the demo take again.
9. **Proof and checkpoints.** Default: each stage saves screenshots of its pages (desktop and phone, light and dark, English and Polish) and passes the a11y scan; no visual-diff tool. Owner checkpoints: after the theme and shell stage, and before the focus-queue flag goes on for the pilot.
10. **Lane and size.** Default: one ticket in `planned/`, about 15 to 18 stages; the build starts after the owner approves the plan.
11. **Cleanup.** Default: remove the scratch worktree and its two DBs now; keep the gallery servers until the plan is approved.

## Next steps after the answers

1. Record each answer as a numbered decision with its date (`P1…`) in `plan.md` § Input.
2. Plan-task step 3: check the data source of each mockup element (difference 10), the Nunito licence and file size, Tailwind 4 theme facts, and which e2e tests find elements by text that the redesign changes.
3. `limen ticket new "<what becomes true>" --lane planned`, then `plan.md`, the stage files, the commit, the cold review (scout job), the end summary.
