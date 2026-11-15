# F112 stage 13 — Changelog

Part of [`../plan.md`](../plan.md). Read P2, D5, D10, D12. Needs stage 06. May run next to stages 07–12 (the later land merges). Two steps. Interface for stages 14–15; fits F114's landed `release:prepare`.

## Step 1 — `CHANGELOG.md` and `parseChangelog`

- **Files:** `CHANGELOG.md` (exists), `packages/core/src/changelog.ts` (new, `@ea/core`) and test, `docs/release-checklist.md`, one test beside `apps/server/src/scripts/release-prepare.test.ts`.
- **Format** (Keep a Changelog 1.1, as F114 writes it; an HTML comment below the header states the "For users" form, with indented examples, none `## [Unreleased]` after trim: `prepareRelease` matches `line.trim()`):
  - Heading `## [x.y.z] - YYYY-MM-DD`, plain SemVer (no pre-release or build part); the first may be `## [Unreleased]`. Newest first. Tag `v<x.y.z>`.
  - Optional `### For users`: item `- en: <text>`, next line `  pl: <text>`. Other `###` groups are free operator text.
  - The parser skips HTML comments and link lines (`[x.y.z]: <url>`) at the end.
  - Keep F114's text and `0.1.0`. Add the comment and one "For users" item (the docs site) under `Unreleased`.
  - `docs/release-checklist.md`: step 2 gains the optional group `For users`; a new check before step 7: `bun run docs:stale --strict` passes (decision 6).
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
  - T8: the real `CHANGELOG.md` parses; first entry `Unreleased`; `0.1.0` present with `forUsers: []` (no exact list).
  - T8b: `prepareRelease` to `0.2.0` on an `Unreleased` with one `Added` line and one pair → `parseChangelog` gives `0.2.0` with that pair, empty `Unreleased`.
- **Done when:** T1–T8b pass.

## Step 2 — Site page and deploy check

- **Files:** `apps/docs/src/in-place.ts` (entry `{ id: "changelog", path: "CHANGELOG.md", transform }`) and test, `site-map.test.ts`, `deploy-gate.ts`, `docs-deploy.yml` (stage 05).
- **Interfaces:**
  - `IN_PLACE_PAGES` entries get an optional `transform?: (markdown: string) => string`, applied before `rewriteLinks`. The changelog transform builds the page from `parseChangelog` only (a bad file fails the build; P2): `# Changelog`, then per release `## <x.y.z> - <date>` and its "For users" items as `- <en text>` (P6). Not published: `Unreleased`, the header, comments, every other `###` group (operator text). A release without items keeps its heading only.
  - `deployDecision` gets the parsed release versions as one more input; a pushed tag `vX` with no release `X` → `{ deploy: false, error: "changelog_missing X" }`; the workflow fails (not a skip). The gate uses `compareSemver`.
- **Test:**
  - T9: T1 fixture plus an `### Added` line and an `Unreleased` item → both headings and `- <en text>` items; no `en:`/`pl:`, `Added` text or `Unreleased`.
  - T10: `bun run docs:build` builds `dist/changelog/index.html`: heading `0.1.0`, no `Offline quality lab` (its `Added` text), no `FLAGGED_TEXT` string (stage 07); `site-map.test.ts` has `changelog`.
  - T11: `deployDecision` on push of `v0.2.0` with releases `[0.1.0]` → error `changelog_missing 0.2.0`; with `[0.2.0, 0.1.0]` → deploy.
- **Done when:** T9–T11 hold.
- **Out of scope:** release scripts, tags, `package.json` version (F114); F114's `isGreaterVersion` stays.

## Proof

The plan's chain with `NN` = `13`.
