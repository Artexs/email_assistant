# F112 stage 12 — Changelog

Part of [`../plan.md`](../plan.md). Read D5, D12, P9 and discovery notes §4.6. Needs stage 06. May run next to stages 07–11 (it adds one id to `site-map.test.ts`: the later land merges).

Two steps. Interface for F114 (E8b release scripts) and stage 13.

## Step 1 — `CHANGELOG.md` and `parseChangelog`

- **Goal:** one changelog format that the site, the panel card and the release scripts share.
- **Files:** `CHANGELOG.md` (new, repo root), `packages/core/src/changelog.ts` (new, exported from `@ea/core`) and its test.
- **Format** (Keep a Changelog 1.1; written once in an HTML comment at the top of `CHANGELOG.md` for the next writer):
  - Release heading `## [x.y.z] - YYYY-MM-DD`; the first heading may be `## [Unreleased]`. Releases newest first.
  - Optional section `### For users`: each item is `- en: <text>` and the next line `  pl: <text>` (two spaces). Other `###` sections (`Added`, `Changed`, `Fixed`, `Removed`, `Security`) are free text for operators.
  - The new file holds the header, the comment and `## [Unreleased]` with one "For users" item about the docs site (en and pl).
- **Interfaces:**
  ```ts
  export interface ChangelogRelease { version: string; date: string | null; forUsers: { en: string; pl: string }[] }
  export class ChangelogError extends Error { constructor(message: string, readonly line: number) }
  export function parseChangelog(markdown: string): ChangelogRelease[]; // newest first; Unreleased has version "Unreleased", date null
  export function compareSemver(a: string, b: string): number; // "0.10.0" > "0.9.0"; throws on a non-SemVer
  ```
  `ChangelogError` messages: `changelog_heading`, `changelog_order`, `changelog_duplicate`, `changelog_date`, `changelog_for_users_item`, each with the 1-based line.
- **Test** (fixed strings):
  - T1: two releases `0.2.0 - 2026-12-01` and `0.1.0 - 2026-11-20`, each with one item → 2 releases, newest first, items with en and pl.
  - T2: `## [Unreleased]` first → `version: "Unreleased"`, `date: null`.
  - T3: `0.1.0` above `0.2.0` → `changelog_order` with the line of the second heading.
  - T4: an item with `en:` and no `pl:` line → `changelog_for_users_item`, its line.
  - T5: `## [0.2] - 2026-12-01` → `changelog_heading`; `## [0.2.0] - 2026-13-01` → `changelog_date`.
  - T6: `compareSemver("0.10.0", "0.9.0") > 0`; `compareSemver("1.0.0", "1.0.0") === 0`; `compareSemver("x", "1.0.0")` throws.
  - T7: the real `CHANGELOG.md` parses (a test reads the file).
- **Done when:** T1–T7 pass.

## Step 2 — Site page

- **Goal:** the site shows the changelog, read in place.
- **Files:** `apps/docs/src/in-place.ts` (entry `{ id: "changelog", path: "CHANGELOG.md", transform }`), its test, `site-map.test.ts`.
- **Interfaces:** `IN_PLACE_PAGES` entries get an optional `transform?: (markdown: string) => string`, applied before `rewriteLinks`. The changelog transform first calls `parseChangelog` (a bad file fails the build), then replaces each "For users" item with its `en` text only (the page is English, P6).
- **Test:**
  - T8: the transform of a T1 fixture keeps the headings and shows `- <en text>` items with no `en:`/`pl:` marks.
  - T9: `bun run docs:build` builds `dist/changelog/index.html`; `site-map.test.ts` has `changelog`.
- **Done when:** T8, T9 hold.
- **Out of scope:** release scripts, tags, the version in `package.json` (F114).

## Proof

The plan's chain with `NN` = `12`.
