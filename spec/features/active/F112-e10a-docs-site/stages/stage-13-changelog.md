# F112 stage 13 — Changelog

Part of [`../plan.md`](../plan.md). Read D5, D10, D12, discovery notes §4.6. Needs stage 06. May run next to stages 07–12 (one id in `site-map.test.ts`, one gate check in stage 05's workflow: the later land merges).

Two steps. Interface for stages 14–15 and F114's `release:prepare` (landed; F114 made `CHANGELOG.md` and tag `v0.1.0`).

## Step 1 — `CHANGELOG.md` and `parseChangelog`

- **Goal:** one changelog format for the site, the card and `release:prepare`.
- **Files:** `CHANGELOG.md` (exists), `packages/core/src/changelog.ts` (new, `@ea/core`) and test, `docs/release-checklist.md`, one test beside `apps/server/src/scripts/release-prepare.test.ts`.
- **Format** (Keep a Changelog 1.1, as F114 writes it; an HTML comment below the header paragraph states the "For users" form. Its examples are indented, and none is `## [Unreleased]` after trim: `prepareRelease` finds that heading by `line.trim()`):
  - Heading `## [x.y.z] - YYYY-MM-DD`, plain SemVer (no pre-release or build part); the first may be `## [Unreleased]`. Newest first. Tag `v<x.y.z>`.
  - Optional section `### For users`: each item is `- en: <text>`, next line `  pl: <text>` (two spaces). Other `###` sections (`Added`, `Changed`, `Fixed`, `Removed`, `Security`) are free text.
  - The parser skips HTML comments and link lines (`[x.y.z]: <url>`) at the end.
  - Keep F114's text and `0.1.0` unchanged. Add the comment and, under `## [Unreleased]`, one "For users" item about the docs site. `0.1.0` has no "For users" lines: the card never shows it (P9).
  - `docs/release-checklist.md`: step 2 gains the optional group `For users` (`- en:` / `  pl:` pairs); a new check before step 7: `bun run docs:stale --strict` passes (decision 6; review 1 N6; F114 landed without it).
- **Interfaces:**
  ```ts
  export interface ChangelogRelease { version: string; date: string | null; forUsers: { en: string; pl: string }[] }
  export class ChangelogError extends Error { constructor(message: string, readonly line: number) }
  export function parseChangelog(markdown: string): ChangelogRelease[]; // newest first; Unreleased has version "Unreleased", date null
  export function compareSemver(a: string, b: string): number; // "0.10.0" > "0.9.0"; throws on anything but x.y.z
  ```
  `ChangelogError` messages: `changelog_heading`, `changelog_order`, `changelog_duplicate`, `changelog_date`, `changelog_for_users_item`, each with the 1-based line.
- **Test** (fixed strings):
  - T1: releases `0.2.0 - 2026-12-01` and `0.1.0 - 2026-11-20`, one item each → 2 releases, newest first, en and pl.
  - T2: `## [Unreleased]` first → `version: "Unreleased"`, `date: null`.
  - T3: `0.1.0` above `0.2.0` → `changelog_order`, line of the second heading.
  - T4: an item with `en:` and no `pl:` line → `changelog_for_users_item`, its line.
  - T5: `## [0.2] - 2026-12-01` and `## [0.2.0-rc.1] - 2026-12-01` → `changelog_heading`; `## [0.2.0] - 2026-13-01` → `changelog_date`.
  - T6: `compareSemver("0.10.0", "0.9.0") > 0`; `compareSemver("1.0.0", "1.0.0") === 0`; `compareSemver("1.0.0-rc.1", "1.0.0")` throws.
  - T7: a comment with an indented example heading, two end link lines → ignored.
  - T8: the real `CHANGELOG.md` parses: `Unreleased`, then `0.1.0` (`2026-11-15`, `forUsers: []`).
  - T8b: `prepareRelease` to `0.2.0` on a fixture whose `Unreleased` holds one `Added` line and one "For users" pair → `parseChangelog` gives `0.2.0` with that pair and an empty `Unreleased`.
- **Done when:** T1–T8b pass.

## Step 2 — Site page and deploy check

- **Goal:** the changelog page, read in place; a tag without its release fails the deploy.
- **Files:** `apps/docs/src/in-place.ts` (entry `{ id: "changelog", path: "CHANGELOG.md", transform }`), its test, `site-map.test.ts`, `apps/docs/scripts/deploy-gate.ts` and `.github/workflows/docs-deploy.yml` (stage 05).
- **Interfaces:**
  - `IN_PLACE_PAGES` entries get an optional `transform?: (markdown: string) => string`, applied before `rewriteLinks`. The changelog transform calls `parseChangelog` (a bad file fails the build), then replaces each "For users" item with its `en` text only (the page is English, P6).
  - `deployDecision` gets the parsed release versions as one more input; a pushed tag `vX` with no release `X` → `{ deploy: false, error: "changelog_missing X" }`; the workflow fails (not a skip). The gate uses `compareSemver`.
- **Test:**
  - T9: the transform of a T1 fixture keeps the headings; items are `- <en text>`, no `en:`/`pl:` marks.
  - T10: `bun run docs:build` builds `dist/changelog/index.html`; `site-map.test.ts` has `changelog`.
  - T11: `deployDecision` on push of `v0.2.0` with releases `[0.1.0]` → error `changelog_missing 0.2.0`; with `[0.2.0, 0.1.0]` → deploy.
- **Done when:** T9–T11 hold.
- **Out of scope:** release scripts, tags, the version in `package.json` (F114); `isGreaterVersion` of `release-prepare-lib.ts` stays.

## Proof

The plan's chain with `NN` = `13`.
