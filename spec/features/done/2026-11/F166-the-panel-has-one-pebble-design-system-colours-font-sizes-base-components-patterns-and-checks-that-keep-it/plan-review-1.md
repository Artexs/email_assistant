Packet: Cold pre-mortem review of the F166 plan (the Pebble design system) and its programme page, judged against apps/web at HEAD
Base: 5b83dbaaf
Verified: a bun contrast script run on the interfaces.md values (sRGB WCAG formula, plus a 14 % mix in sRGB and in OKLab) -> "light ring60 vs bg 2.50 vs card 2.59" ; `rg "await expectNoA11yViolations\(" apps/web/e2e | wc -l` -> "102"
Unknowns: The Fontsource facts at plan.md:28 (OFL, subsets, weights) are not checked because I made no network call. The "525 of 557 role selectors" count at plan.md:32 is not checked. The e2e run time with two scans is not measured: I ran no suite, because this is a review job.

BLOCKING
1. Stage 04 says the pattern page needs no session and gets a `public` sheet row (stage-04-primitives-a.md:9, :8). The server sends every path that is not in `PUBLIC_PAGE_PATHS` to /login (apps/server/src/platform/http.ts:151-165, :449-451), and that list has no `/dev/`. So the `public` row shoots the login page. The ticket acceptance "answers 404 in a production build" (ticket.md:29) is also false for a visitor with no session, who gets a 302 to /login. A decision is missing: add `/dev/` to the public list, or sign in for the pattern page. That choice changes a security surface. — observed
2. There is no separate e2e build. The CI e2e job runs `bun run web:build` and then `test:e2e` on one dist (.github/workflows/ci.yml:122-124), and deploy/Dockerfile:26 runs the same command. Stage 04 says "set EA_DEV_PAGES=1 where the e2e build … run[s]" (stage-04:8), but it names no place for it. The Proof of stages 03–06 builds with no flag (plan.md:57), so `patterns.spec.ts` (stage-04:23) fails. Stage 04 test (2), "no dist/dev", needs the opposite build of that same dist. — observed
3. D2 fixes the light `--ring` at "--primary at 60 %" (interfaces.md:25). Over the background that gives 2.50:1, and over a card 2.59:1. That is below the 3:1 control bar of DB-3 (README.md:44) and of WCAG 1.4.11 for focus indicators. No test in stage 03 test 1 (stage-03:31) checks the ring, and D2 forbids a worker to pick a colour. — observed (computed)

GAP
4. A pill is "the colour as text on a 14 % mix of the same colour with the surface" (interfaces.md:42). The plan does not say which surface: a fixed `--card`, or alpha over whatever is below the pill. It also does not give the colour space of the mix. With alpha, every light pill on `--muted` is 4.32–4.38:1, below AA. Stage 03 test 1 checks the pill only on card and on background (stage-03:31). — observed (computed)
5. InitialsAvatar is "white text … pick the five from the category tokens' light values or darker" (stage-06:20). This breaks D2, because the worker picks a colour. It gives no rule for the dark scheme: white on the dark `--cat-urgent` is 2.49:1. It also conflicts with the stage 07 ban on `text-white` without an opacity (stage-07:9), and `text-primary-foreground` is #04201b in dark. interfaces.md:65 has no avatar tokens. — observed
6. FactBox is "the Alert variant accent" (interfaces.md:71). Alert hard-codes `role="alert"` (components/ui/alert.tsx:24). So a calm "why" box becomes an assertive live region. It also adds a second `alert` role to the pages where e2e specs use the alert role, which appears 36 times in apps/web/e2e. A decision on the role is missing. — observed
7. `Row({ title: string; … children })` (interfaces.md:63) has no way to link the title to the control at the end, such as `htmlFor` or `id`. Today there are 74 `<Label htmlFor` uses in feature code, and the e2e specs make 151 `getByLabel` or switch-role calls. The page tickets F169 and F170 then lose accessible names, or each one invents its own link. — observed
8. StickyActions is "fixed above the tab bar" (interfaces.md:72, stage-06:26). The tab bar belongs to F167, which F166 does not build. No shared token for the tab bar height or the safe-area offset is in interfaces.md, so F166 and F167 must each guess. — observed
9. The unused-key rule (stage-07:17) has three problems:
   - It excludes only `i18n/texts/`. The plural tables live in `i18n/en.ts` and `i18n/pl.ts` (en.ts:28), so those keys always count as used.
   - It does not scan packages/core. The core schemas emit text keys (core/web/organization.ts emits `empty_patch`; core/web/password.ts emits `passwords_differ`).
   - It does not say whether test files count. If they do not count, `empty_patch` is deleted, because its only web mention is i18n/en.test.ts:44. The user then sees a raw key.
   — observed
10. Stage 03 step 4 says to fix a dark contrast violation "by a token class on the element" (stage-03:27). But D5 says no feature file changes (plan.md:17), and stage 03 puts `components/ui` class changes out of scope (stage-03:11). A violation in a primitive or a feature file therefore has no allowed fix. — observed
11. F172 acceptance says "guard tests … pass with no allow-list entry" (F172 ticket.md:24). That conflicts with D10, the permanent QR exception (plan.md:23), and with the scrim and theme-color entries (stage-07:9). — observed
12. The doubled a11y scan has no time budget. The CI e2e job already took 935 s (notes/2026-11-20-worker-time-and-cpu.md:66), and its timeout is 20 minutes (ci.yml:70, :133). The plan only "records" the new time (plan.md:39). It does not say what happens when the job comes near the timeout. — observed
13. The sheet writes into `apps/web/e2e/test-results/ui-sheet/` (interfaces.md:79, stage-02:17). Playwright clears that output folder on each `test:e2e` run (playwright.config.ts:19), and .gitignore:51 ignores it. So the Proof erases the pictures, and the Sonnet review in another worktree (plan.md:66) cannot open "the pictures the worker named". The owner looks (PB-12) need a stable location. — observed + guessed (the clear on each run is Playwright default behaviour)
14. Two stages are too big for one 90-minute job:
   - Stage 06 builds 12 patterns, a section file and a render test for each, the category record, and an a11y spec (stage-06:13-27).
   - Stage 03 runs the full e2e suite at least twice (about 16 minutes or more each, now with two scans), plus a fix loop with no limit and `ui:sheet` (stage-03:27, :33, Proof plan.md:57).
   — guessed (from the measured e2e time)

NOTE
15. plan.md:32 says "131 calls of expectNoA11yViolations". The real count is 102 calls plus 29 import lines. — observed
16. Stage 01 test 2 says "17 token rows" (stage-01:24). The token table in interfaces.md:11-28 has 18 rows. — observed
17. interfaces.md drops some variants and sizes that exist today:
   - Badge `ghost` and `link` (interfaces.md:52; badge.tsx:16-17).
   - TabsList `line` and the vertical orientation (tabs.tsx:24-25).
   - SelectTrigger size `sm` (select.tsx:24).
   This conflicts with D5, "keep every existing variant". — observed
18. Stage 03 step 3 swaps the severities without a reason (stage-03:22). Today the suspended-organization banner is red and the mailbox login-error banner is amber (PausedBanner.tsx:7, AuthErrorBanner.tsx:20). The plan makes the paused banner the warm accent and the login-error banner red. — observed
19. `--accent` changes from a neutral hover colour to the warm box. After stage 03 the active nav item (Nav.tsx:106-107), the Skeleton and the menu focus turn orange until F167 or stage 05. That is allowed by D1, but the plan does not say it. — observed
20. PageHead hides the lead below `lg` when an action is present (stage-06:16). F167 acceptance says "each signed-in page shows its title and a lead line" (F167 ticket.md:28). — observed
21. EmptyState and SectionCard both render a fixed `h2` (interfaces.md:62, :69), so an empty state inside a section card nests one h2 in another. The default "Radius from --radius" mapping at global.css:82-85 gives 18/20/22/26 px, not 10/16/22/28, so stage 03 must replace it, not keep it. — observed
22. Stages 05 and 06 may both add the Alert `accent` variant in parallel (stage-06:25), and each edits alert.tsx. Stage 01 excludes `docs/capabilities/web-panel.md` (stage-01:19), but the styleguide's PD-009 rule wants the capability page updated in the same change. The e2e seed has no operator user, so the sheet cannot shoot `/operator`. — observed

Checks: The read of packages/core/src/triage/categories.ts:3 covers the category enum. It lists 7 values, and the 7 category rows match it. The contrast script covers every pair in plan.md:33 (4.65, 5.14, 5.59, 7.42, 3.02/3.03, light pills ≥ 4.59), and all match. The script misses rendered colours, because no build or e2e run was made. `git status --short` covers the read-only rule; it printed nothing.

Note check
- Findings quote file and line and sit in BLOCKING, GAP or NOTE: proven. The evidence is this handoff text, items 1–22.
- Token values against the category enum: proven by `git status --short && rg -n "export const categories" packages/core/src/triage/categories.ts`, which exited 0 and printed line 3 with the 7 values.
- plan.md § Facts checked claims against HEAD: not proven. The contrast script ran in a call joined with `;`, and its file /tmp/f166rev/c.ts is deleted, so no log of the run is saved. The numbers are in the Verified line and in item 3.
- interfaces.md against the primitive call sites and F167–F172: not proven. The rg calls that showed this used pipes or `;`, and no log file is saved.
- Easy-to-miss rule "Read-only: change no file": followed. `git status --short && rg …` exited 0, and `git status` printed nothing. The note file I wrote is in the .limen job folder, outside the worktree.
- Reminder "tests run once per job; do not run test:unit, test:int, test:e2e": followed. I ran no suite. My only `bun` run was a contrast script, which is not a test.
- Reminder "a job that commits product code runs check:job last": does not apply. This is a review job, and it made no commit.
- Reminder "a review job runs no test suite, lint or typecheck": followed. I ran none of them.
- Reminder "never delete node_modules/.cache": followed. I deleted only /tmp/f166rev.
