# F102 stage 07 — Axe frame

Part of [`../plan.md`](../plan.md). Read P3, D13, D14, F2, N2 and the web Proof. Needs stage 01 landed (one `bun.lock` change at a time) and F101 (Astro 7) in `spec/features/done/`. Changes `bun.lock` (never next to another `bun.lock` change): install with `bash scripts/ci-bun.sh install`; `git diff bun.lock` adds only `@axe-core/playwright` and its `axe-core` (a second copy beside the 4.10.3 of `eslint-plugin-jsx-a11y` is expected), no other version change. The panel is on Astro 7.4.12 (F101 stage 02); its CLI needs Node 22.23.4 or later (CI pins 24).

## Step 1 — Dependency and helper

- **Goal:** every e2e spec can check a page against WCAG 2.2 A and AA with one call.
- **Files:** `apps/web/package.json` (dev dependency), `bun.lock`, a new helper in `apps/web/e2e/` (next to the existing fixtures).
- **Interfaces:**
  - `@axe-core/playwright` `4.14.0`, exact pin, dev dependency of `apps/web`. No other package changes.
  - `expectNoA11yViolations(page: Page, opts?: { include?: string; exclude?: string[] }): Promise<void>`: runs `AxeBuilder` with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`; on a violation it fails with one line per violation: rule id, impact, the first target selector, the help URL. No page text in the message (rule: no mail text in test output).
- **Decisions:** D13. No rule is turned off globally. A rule off for one element needs an `exclude` with a code comment that names the reason; every such case goes into the final message.
- **Test:** T1: a spec on the 404 page runs the helper and passes (the page is static and public).
- **Done when:** T1 passes; `bash scripts/ci-bun.sh install --frozen-lockfile` passes.

## Step 2 — Every existing page

- **Goal:** each existing panel page has zero violations.
- **Files:** the specs in `apps/web/e2e/tests/`; the pages, islands and UI parts that a violation names.
- **Decisions:**
  - Each page that a spec opens gets one helper call after the page has loaded its data (and one more with an open dialog where a spec opens one): Login, Setup, Forgot, Onboarding, Activity (with the detail panel open), Mailboxes, Settings (with the Account card), Rules, Stats (flag on), Operator (operator user), a legal page, 404. The desktop and the mobile project both run them.
  - At `d70e540e` no spec opens Stats or Operator. Add `stats.spec.ts` (seed org with `stats_page` on) and `operator.spec.ts` (a seeded TOTP user in the e2e `OPERATOR_USER_IDS`; a password session, as F119 refuses SSO). If the operator user needs more than the seed and the e2e env, skip Operator and report it (Q20).
  - Fix the violations in the code, not in the check, inside the CSP rule of `plan.md` § Rules: labels, names of icon buttons (`aria-label` from an i18n key in `en.ts` and `pl.ts`), contrast through the theme tokens, landmarks, heading order. A visible change stays as small as the fix needs.
  - Budget: about 200 changed lines of fixes. If the first run shows more, stop before the fixes and report the violations per page and rule (N2); the coordinator splits the stage.
- **Test:**
  - T2: every page in the list above runs the helper in at least one spec, on `desktop` and `mobile`.
  - T3: the full e2e suite passes, with zero violations.
  - T4: `apps/web/src/i18n/i18n.test.ts` and the typecheck pass (new labels in both languages).
- **Done when:** T2–T4 pass.
- **Out of scope:** the new pages (their stages call the helper); a manual audit; colour or layout changes beyond a fix.

## Done when (stage)

- Steps 1 and 2 hold. The web Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s07`).
- The final message lists the violations found per page and rule, and each fix.
