import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseChangelog } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { prepareRelease } from "./release-prepare-lib";

const realChangelog = readFileSync(join(import.meta.dir, "../../../../CHANGELOG.md"), "utf8");
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

  test("T8c the real CHANGELOG.md still goes through release:prepare and parses", () => {
    // The real file may have an empty Unreleased: the test adds one For users pair, and uses a version above every real one.
    const item = "### For users\n\n- en: Prepared item.\n  pl: Przygotowany punkt.\n";
    const changelog = realChangelog.replace(/^## \[Unreleased\]\n/m, `## [Unreleased]\n\n${item}`);
    expect(changelog).not.toBe(realChangelog);
    const result = prepareRelease({ version: "99.0.0", date: "2099-01-01", changelog, packageJson });
    if (!result.ok) throw new Error(result.reason);
    const before = parseChangelog(realChangelog);
    const after = parseChangelog(result.changelog);
    const realVersions = before.map((release) => release.version);
    expect(realVersions).toContain("0.1.0");
    expect(after.map((release) => release.version)).toEqual(["Unreleased", "99.0.0", ...realVersions.slice(1)]);
    expect(after[0]?.forUsers).toEqual([]);
    expect(after[1]).toEqual({
      version: "99.0.0",
      date: "2099-01-01",
      forUsers: [{ en: "Prepared item.", pl: "Przygotowany punkt." }],
    });
    // Every real release keeps its own For users items.
    expect(after.slice(2)).toEqual(before.slice(1));
  });
});
