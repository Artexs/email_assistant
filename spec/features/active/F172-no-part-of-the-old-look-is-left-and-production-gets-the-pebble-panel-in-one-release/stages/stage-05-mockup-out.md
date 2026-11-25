# F172 stage 05 — The mockup leaves the repository, and the changelog holds the release

Needs stage 04: a final verdict on every row of `visual-review.md` (D5). Needs the guards of stages 01 and 02 for the capability text. Owns `docs/capabilities/web-panel.md` § Look (D10). Opus review (new Polish text).

Decisions P3, P4, P6, D5, D10, PB-13.

## Step 1 — Delete `design/`

- **Do:** `git rm -r design/` (55 tracked files at the plan base). Remove the `design/**` ignore and its comment from `eslint.config.js`, and the seven `design/` lines from `.gitignore`.
- **Do not** touch the ignored design study files of the main checkout. After this land ESLint there reads them until stage 07 step 1 moves them, in the same coordinator turn.
- **Records:** ADR 0037 § Context: the drawing was the source and is in Git history at `94092626b` (`design/ui-proposals/proposals/03-pebble/`); now the ADR, `/dev/patterns` and the code are the reference. The programme page gets the same line under § What changes and marks PB-13 done. Other mentions of `design/` stay (history); no done or active ticket is edited.
- **Check:** `git ls-files design` is empty; `lint:full` passes.

## Step 2 — The changelog entry

- **Do:** under `## [Unreleased]` of `CHANGELOG.md`, add the release text. The version heading is stage 06 (`release:prepare`).
- **`### For users`** (the form of the comment at the top of the file; the card and the public docs changelog show it). P6: only what a member with the default flags sees. Approvals, Delegations, Review and Stats sit behind default-off flags: do not name or paraphrase them. The meaning (name pages and buttons as the panel does):
  1. Always: the new look: one teal colour, larger text and buttons, rounded cards, a tab bar at the bottom on a phone; light or dark follows the device setting.
  2. Only if the Rules page has no default-off flag: a sender rule is added as one sentence on the Rules page.
- **Voice:** PB-8. No ticket id, no name of a person. Polish uses the panel's own Polish words.
- **`### Changed`** (operator text, one line each): the panel follows ADR 0037; Approvals is a one-draft queue with a "sent to" state and "Later"; Delegations show status columns; the docs site has the teal accent; the mockup folder is gone; `next-themes` is removed (only if stage 02 removed it); no migration — `deploy/rollback.sh` alone returns to `v0.4.5`.

## Step 3 — T10 reads the unreleased text

- **Do:** add a case to `apps/docs/src/flagged-text.test.ts`: "T10 the For users text of `[Unreleased]` holds no string of a default-off flag". It renames the `[Unreleased]` heading of a copy of `CHANGELOG.md` to `## [0.0.0-unreleased] - 2000-01-01`, runs `changelogPage` and `flaggedTextProblems`. An empty `[Unreleased]` passes (stage 06 empties it).
- **Test:**
  1. The new case passes on the real file.
  2. Break it: add "what is new" (a `docs_links` literal) to a "For users" line of `[Unreleased]`; the new case fails, the old T10 case passes.
  3. A fixture changelog with two `forUsers` items in `[Unreleased]`, each `en` and `pl`, parses to two items. No test pins the real `[Unreleased]` count.
  4. `whatsNew` with releases `[{0.5.0, 4 items}, {0.4.5, 1 item}]` and stored `"0.4.5"` shows only `0.5.0`; with stored `"0.5.0"` it shows nothing (add the case to `whats-new.test.ts` if no case covers a stored older version).
  5. `bun run docs:stale --strict` passes.

## Step 4 — Capability page

- **Do:** `docs/capabilities/web-panel.md` § Look names the guards (emoji, unused file with the pattern page as importer, unused token, stock and arbitrary shadow, ADR-named allow lists) and says the mockup left the repository. Add that the card shows the newest release with a "For users" item once per member and browser, only with `docs_links` on (P3).

## Out of scope

The `## [0.5.0]` heading, the version, the tag (stage 06). Turning `docs_links` on (P3). The ignored design study files (stage 07).

## Proof

`mkdir -p /tmp/f172-05 && bun run check:job > /tmp/f172-05/check.log 2>&1 && bun run lint:full > /tmp/f172-05/lint.log 2>&1 && bun run docs:build > /tmp/f172-05/docs-build.log 2>&1 && bun run docs:test > /tmp/f172-05/docs.log 2>&1 && bun run docs:stale --strict > /tmp/f172-05/stale.log 2>&1 && bun test apps/docs/src/flagged-text.test.ts > /tmp/f172-05/t10.log 2>&1 && echo PROOF_OK`
