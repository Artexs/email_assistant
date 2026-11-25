# F172 stage 04 — The mockup leaves the repository, and the changelog holds the release

Needs stage 03: `visual-review.md` is complete (the review reads the mockup shots this stage deletes; D5). Opus review before the land (new Polish text).

Part of [`../plan.md`](../plan.md). Decisions P3, P4, P6, D5, PB-13.

## Step 1 — Delete `design/`

- **Do:** `git rm -r design/` (55 tracked files at the plan base). Remove the `design/**` ignore and its comment from `eslint.config.js`, and the seven `design/` lines from `.gitignore`.
- **Do not** delete or move the ignored files of the design study in the main checkout: this worktree does not hold them, and the coordinator moves them in stage 06.
- **Records:** ADR 0037 § Context says the drawing was the source and is in Git history at commit `94092626b` (path `design/ui-proposals/proposals/03-pebble/`); from now on the ADR, the pattern page (`/dev/patterns`) and the code are the reference. The programme page (`docs/product/pebble-ui/README.md`) gets the same line under § What changes and marks PB-13 done. Other mentions of `design/` in `docs/` and `notes/` stay: they are history. A done or active ticket is never edited.
- **Check:** `git ls-files design` prints nothing; `bun run lint:full` passes (no file under `design/` is left for ESLint).

## Step 2 — The changelog entry

- **Do:** under `## [Unreleased]` of `CHANGELOG.md`, add the release text. Release `v0.5.0` itself (the version heading) is stage 05 (`release:prepare`).
- **`### For users`** (the form of the comment at the top of the file; the panel card and the public docs changelog page show this group). P6: it names only what a member with the default flags sees. Approvals, Delegations, Review and Stats sit behind default-off flags (`approvals_page`, `delegation_pages`, `panel_review`, `stats_page`), and the docs test T10 (`apps/docs/src/flagged-text.test.ts`) fails on their texts. The meaning (the words are not fixed; name pages and buttons as the panel does at `HEAD`):
  1. Always: the new look: one teal colour, larger text and buttons, rounded cards, a tab bar at the bottom on a phone; light or dark follows the device setting.
  2. Only if T10 passes with it: a sender rule is added as one sentence on the Rules page.
- **Voice:** PB-8 (no first-person past tense, no promise that is not true today). No ticket id, no name of a person. Polish uses the panel's own Polish words for each button and page.
- **`### Changed`** (operator text, one line each): the panel follows ADR 0037 (design system); Approvals is a one-draft queue with a "sent to" state and "Later"; Delegations show status columns; the docs site has the teal accent; the mockup folder is gone; the `next-themes` dependency is removed; no migration — `deploy/rollback.sh` alone returns to `v0.4.5`.
- **Test:**
  1. The existing changelog test (the parser of `@ea/core/web` that the card and the docs page use) reads `[Unreleased]` with 1 or 2 `forUsers` items, each with `en` and `pl`. T10 passes.
  2. `whatsNew` with releases `[{0.5.0, 4 items}, {0.4.5, 1 item}]` and stored `"0.4.5"` shows only `0.5.0`; with stored `"0.5.0"` it shows nothing (add the case to `whats-new.test.ts` if no case covers a stored older version).
  3. `bun run docs:stale --strict` passes.

## Step 3 — Capability page

- **Do:** `docs/capabilities/web-panel.md` § Look names the guards of stages 01 and 02 (emoji, unused file, unused token, stock shadow, the ADR-named allow lists) and says that the mockup is no longer in the repository. The shell frame rule keeps the card text; add that the card shows the newest release with a "For users" item once per member and browser, only with `docs_links` on (P3).

## Out of scope

The `## [0.5.0]` heading, the version in `package.json`, the tag (stage 05). Turning `docs_links` on (P3). The ignored design study files (stage 06).

## Proof

`mkdir -p /tmp/f172-04 && bun run check:job > /tmp/f172-04/check.log 2>&1 && bun run lint:full > /tmp/f172-04/lint.log 2>&1 && bun run docs:build > /tmp/f172-04/docs-build.log 2>&1 && bun run docs:test > /tmp/f172-04/docs.log 2>&1 && bun run docs:stale --strict > /tmp/f172-04/stale.log 2>&1 && bun test apps/docs/src/flagged-text.test.ts > /tmp/f172-04/t10.log 2>&1 && echo PROOF_OK`
