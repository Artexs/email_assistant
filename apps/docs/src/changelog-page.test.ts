import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { changelogPage } from "./changelog-page";

const FIXTURE = [
  "# Changelog",
  "",
  "Header text that stays private.",
  "",
  "<!-- a comment that stays private -->",
  "",
  "## [Unreleased]",
  "",
  "### For users",
  "",
  "- en: Unreleased user item.",
  "  pl: Punkt z Unreleased.",
  "",
  "## [0.2.0] - 2026-12-01",
  "",
  "### Added",
  "",
  "- Operator added text.",
  "",
  "### For users",
  "",
  "- en: Second user item.",
  "  pl: Drugi punkt.",
  "- en: Third user item.",
  "  pl: Trzeci punkt.",
  "",
  "## [0.1.0] - 2026-11-20",
  "",
  "### Fixed",
  "",
  "- Operator fixed text.",
  "",
].join("\n");

describe("changelogPage", () => {
  test("T9 headings with version and date, the For users items in English, nothing else", () => {
    expect(changelogPage(FIXTURE)).toBe(
      [
        "# Changelog",
        "",
        "## 0.2.0 - 2026-12-01",
        "",
        "- Second user item.",
        "- Third user item.",
        "",
        "## 0.1.0 - 2026-11-20",
        "",
      ].join("\n")
    );
  });

  test("T9 no en:/pl: marker, no operator group text, no Unreleased, no header or comment", () => {
    const page = changelogPage(FIXTURE);
    for (const text of [
      "en:",
      "pl:",
      "Added",
      "Fixed",
      "Operator",
      "Unreleased",
      "Header text",
      "comment",
      "Punkt",
      "Drugi",
    ]) {
      expect(page).not.toContain(text);
    }
  });

  test("a file with no release gives the title only; a bad file throws", () => {
    expect(changelogPage("# Changelog\n\n## [Unreleased]\n")).toBe("# Changelog\n");
    expect(() => changelogPage("## [1.0] - 2026-01-01\n")).toThrow("changelog_heading");
  });

  test("the real CHANGELOG.md: 0.1.0 is there, and the operator text of its Added group is not", () => {
    const page = changelogPage(readFileSync(join(import.meta.dir, "../../../CHANGELOG.md"), "utf8"));
    expect(page).toContain("## 0.1.0 - ");
    expect(page).not.toContain("Offline quality lab");
    expect(page).not.toContain("Unreleased");
    expect(page).not.toContain("docs site");
  });
});
