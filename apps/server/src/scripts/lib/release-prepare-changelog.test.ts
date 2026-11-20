import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseChangelog } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { prepareRelease } from "./release-prepare-lib";

const realChangelog = readFileSync(join(import.meta.dir, "../../../../../CHANGELOG.md"), "utf8");
const packageJson = '{\n  "version": "0.1.0"\n}\n';

describe("release:prepare and the changelog parser", () => {
  test("T8b release:prepare keeps a For users pair, and the parser reads it in the new release", () => {
    const changelog = [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "### Added",
      "",
      "- Operator item.",
      "",
      "### For users",
      "",
      "- en: User item.",
      "  pl: Punkt dla użytkownika.",
      "",
      "## [0.1.0] - 2026-11-15",
      "",
      "### Added",
      "",
      "- Old.",
      "",
    ].join("\n");
    const result = prepareRelease({
      version: "0.2.0",
      date: "2026-12-01",
      changelog,
      packageJson,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(parseChangelog(result.changelog)).toEqual([
      { version: "Unreleased", date: null, forUsers: [] },
      { version: "0.2.0", date: "2026-12-01", forUsers: [{ en: "User item.", pl: "Punkt dla użytkownika." }] },
      { version: "0.1.0", date: "2026-11-15", forUsers: [] },
    ]);
  });

  test("T8c the real CHANGELOG.md, given one Unreleased item, still goes through release:prepare and parses", () => {
    // The real Unreleased section is empty right after a release: add one item, and use a far version.
    const changelog = realChangelog.replace(
      "## [Unreleased]\n",
      "## [Unreleased]\n\n### For users\n\n- en: A test item.\n  pl: Element testowy.\n"
    );
    const result = prepareRelease({
      version: "99.0.0",
      date: "2026-12-01",
      changelog,
      packageJson,
    });
    if (!result.ok) throw new Error(result.reason);
    const releases = parseChangelog(result.changelog);
    expect(releases.slice(0, 2).map((release) => release.version)).toEqual(["Unreleased", "99.0.0"]);
    expect(releases.map((release) => release.version)).toContain("0.1.0");
    expect(releases[1]?.forUsers.length).toBeGreaterThan(0);
    expect(releases[0]?.forUsers).toEqual([]);
  });
});
