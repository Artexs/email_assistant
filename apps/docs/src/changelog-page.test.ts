import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseChangelog, UNRELEASED } from "@ea/core";

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

  test("the real CHANGELOG.md: every release is there, and no operator text, header or comment is", () => {
    const real = readFileSync(join(import.meta.dir, "../../../CHANGELOG.md"), "utf8");
    const page = changelogPage(real);
    const versions = parseChangelog(real)
      .map((release) => release.version)
      .filter((version) => version !== UNRELEASED);
    expect(versions).toContain("0.1.0");
    for (const version of versions) expect(page).toContain(`## ${version} - `);
    expect(page).not.toContain("Unreleased");
    expect(page).not.toContain("<!--");
    expect(page).not.toContain('The group "For users"');
    // The text of every group except "For users" is operator text, for any release.
    expect(operatorLines(real).length).toBeGreaterThan(0);
    for (const line of operatorLines(real)) expect(page).not.toContain(line);
    expect(page).not.toContain("Offline quality lab");
  });
});

// The text of the bullets under every group of the file except "For users", without the bullet mark.
function operatorLines(markdown: string): string[] {
  const found: string[] = [];
  let group = "";
  for (const line of markdown.split("\n")) {
    if (line.startsWith("### ")) group = line.slice(4).trim();
    else if (line.startsWith("## ")) group = "";
    else if (group !== "" && group !== "For users" && line.startsWith("- ")) found.push(line.slice(2).trim());
  }
  return found;
}
