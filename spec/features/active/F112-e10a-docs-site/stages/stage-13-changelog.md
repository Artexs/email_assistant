# F112 stage 13 — Changelog

Part of [`../plan.md`](../plan.md). Read D5, D10, D12 and discovery notes §4.6. Needs stage 06. May run next to stages 07–12 (it adds one id to `site-map.test.ts` and one gate check to stage 05's workflow: the later land merges).

Two steps. Interface for F114 (E8b release scripts) and stages 14–15.

## Step 1 — `CHANGELOG.md` and `parseChangelog`

- **Goal:** one changelog format that the site, the panel card and the release scripts share.
- **Files:** `CHANGELOG.md` (new, repo root), `packages/core/src/changelog.ts` (new, exported from `@ea/core`) and its test.
- **Format** (Keep a Changelog 1.1; a short HTML comment at the top of `CHANGELOG.md` states it for the next writer, with examples indented so that no example line starts with `#`):
  - Release heading `## [x.y.z] - YYYY-MM-DD`, plain SemVer, no pre-release or build part; the first heading may be `## [Unreleased]`. Releases newest first. The git tag of a release is `v<x.y.z>`.
  - Optional section `### For users`: each item is `- en: <text>` and the next line `  pl: <text>` (two spaces). Other `###` sections (`Added`, `Changed`, `Fixed`, `Removed`, `Security`) are free text for operators.
  - The parser skips HTML comments and Keep a Changelog link lines (`[x.y.z]: <url>`) at the end of the file.
  - The new file holds the header, the comment and `## [Unreleased]` with one "For users" item about the docs site (en and pl).
- **Interfaces:**
  ```ts
  export interface ChangelogRelease { version: string; date: string | null; forUsers: { en: string; pl: string }[] }
  export class ChangelogError extends Error { constructor(message: string, readonly line: number) }
  export function parseChangelog(markdown: string): ChangelogRelease[]; // newest first; Unreleased has version "Unreleased", date null
  export function compareSemver(a: string, b: string): number; // "0.10.0" > "0.9.0"; throws on anything but x.y.z
  ```
  `ChangelogError` messages: `changelog_heading`, `changelog_order`, `changelog_duplicate`, `changelog_date`, `changelog_for_users_item`, each with the 1-based line.
- **Test** (fixed strings):
  - T1: two releases `0.2.0 - 2026-12-01` and `0.1.0 - 2026-11-20`, each with one item → 2 releases, newest first, items with en and pl.
  - T2: `## [Unreleased]` first → `version: "Unreleased"`, `date: null`.
  - T3: `0.1.0` above `0.2.0` → `changelog_order` with the line of the second heading.
  - T4: an item with `en:` and no `pl:` line → `changelog_for_users_item`, its line.
  - T5: `## [0.2] - 2026-12-01` and `## [0.2.0-rc.1] - 2026-12-01` → `changelog_heading`; `## [0.2.0] - 2026-13-01` → `changelog_date`.
  - T6: `compareSemver("0.10.0", "0.9.0") > 0`; `compareSemver("1.0.0", "1.0.0") === 0`; `compareSemver("1.0.0-rc.1", "1.0.0")` throws.
  - T7: a comment with an indented example heading and two link lines at the end → ignored.
  - T8: the real `CHANGELOG.md` parses (a test reads the file).
- **Done when:** T1–T8 pass.

## Step 2 — Site page and deploy check

- **Goal:** the site shows the changelog, read in place; a tag without its release fails the deploy.
- **Files:** `apps/docs/src/in-place.ts` (entry `{ id: "changelog", path: "CHANGELOG.md", transform }`), its test, `site-map.test.ts`, `apps/docs/scripts/deploy-gate.ts` and `.github/workflows/docs-deploy.yml` (stage 05).
- **Interfaces:**
  - `IN_PLACE_PAGES` entries get an optional `transform?: (markdown: string) => string`, applied before `rewriteLinks`. The changelog transform calls `parseChangelog` (a bad file fails the build), then replaces each "For users" item with its `en` text only (the page is English, P6).
  - `deployDecision` gets one more input, the parsed release versions; a push of tag `vX` with no release `X` in `CHANGELOG.md` → `{ deploy: false, error: "changelog_missing X" }`, and the workflow fails (not a skip). The gate then uses `compareSemver` instead of its own compare.
- **Test:**
  - T9: the transform of a T1 fixture keeps the headings and shows `- <en text>` items with no `en:`/`pl:` marks.
  - T10: `bun run docs:build` builds `dist/changelog/index.html`; `site-map.test.ts` has `changelog`.
  - T11: `deployDecision` on push of `v0.2.0` with releases `[0.1.0]` → error `changelog_missing 0.2.0`; with `[0.2.0, 0.1.0]` → deploy.
- **Done when:** T9–T11 hold.
- **Out of scope:** release scripts, tags, the version in `package.json` (F114).

## Proof

The plan's chain with `NN` = `13`.
